import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

// Inlined from _utils/binance-helpers.ts
const adjustQuantity = (qty: number, step: number) => {
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  const adjusted = Math.floor(qty / step) * step;
  return parseFloat(adjusted.toFixed(precision));
};

// Tasa de comisión de Binance (0.1%)
const BINANCE_FEE_RATE = 0.001;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const functionName = 'initiate-strategic-purchase';

  try {
    // Autenticación y obtención de claves de API
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Falta la cabecera de autorización');
    const token = authHeader.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError) throw userError;
    if (!user) throw new Error('Token inválido');

    const { data: keys, error: keysError } = await supabaseAdmin
      .from('api_keys')
      .select('api_key, api_secret')
      .eq('user_id', user.id)
      .single();
    if (keysError) throw new Error('Claves de API no encontradas.');

    const { api_key, api_secret } = keys;

    // Lógica de la estrategia de compra
    const { pair, usdtAmount, takeProfitPercentage, dipPercentage, lookbackMinutes } = await req.json();
    if (!pair || !usdtAmount || !takeProfitPercentage || !dipPercentage || !lookbackMinutes) {
      throw new Error('Todos los parámetros (pair, usdtAmount, takeProfitPercentage, dipPercentage, lookbackMinutes) son obligatorios.');
    }

    console.log(`[${functionName}] Iniciando estrategia para ${pair}: USDT=${usdtAmount}, TP=${takeProfitPercentage}%, Dip=${dipPercentage}%, Lookback=${lookbackMinutes}min`);

    // 1. Obtener datos de precios por minuto de la base de datos
    const { data: minutePrices, error: pricesError } = await supabaseAdmin
      .from('minute_prices')
      .select('close_price, created_at')
      .eq('asset', pair)
      .order('created_at', { ascending: false })
      .limit(lookbackMinutes);

    if (pricesError) {
      console.error(`[${functionName}] Error fetching minute prices for ${pair}:`, pricesError);
      throw new Error(`Error al obtener precios por minuto: ${pricesError.message}`);
    }

    let dipSignal = false;
    let dipReason = '';
    let currentPrice = 0;

    if (!minutePrices || minutePrices.length < lookbackMinutes) {
      dipReason = `No hay suficientes datos de precios por minuto (${minutePrices?.length || 0}/${lookbackMinutes}) para ${pair}.`;
      console.warn(`[${functionName}] ${dipReason}`);
    } else {
      const prices = minutePrices.map(p => p.close_price);
      currentPrice = prices[0]; // El precio más reciente
      const highPriceInLookback = Math.max(...prices);

      console.log(`[${functionName}] Precios en los últimos ${lookbackMinutes} min:`, prices.map(p => p.toFixed(4)));
      console.log(`[${functionName}] Precio actual: ${currentPrice.toFixed(4)}, Precio máximo en lookback: ${highPriceInLookback.toFixed(4)}`);

      // 2. Aplicar la lógica de "Compra en Dip"
      const requiredDip = highPriceInLookback * (dipPercentage / 100);
      const priceDrop = highPriceInLookback - currentPrice;

      if (priceDrop >= requiredDip) {
        // Opcional: Confirmación de rebote (precio actual > precio de cierre anterior)
        if (prices.length > 1 && currentPrice > prices[1]) {
          dipSignal = true;
          dipReason = `Dip del ${dipPercentage}% detectado y rebote confirmado.`;
        } else {
          dipSignal = true; // Considerar señal incluso sin rebote inmediato si el dip es significativo
          dipReason = `Dip del ${dipPercentage}% detectado.`;
        }
      } else {
        dipReason = `No se detectó un dip suficiente. Caída actual: ${((priceDrop / highPriceInLookback) * 100).toFixed(2)}% (requerido: ${dipPercentage}%)`;
      }
      console.log(`[${functionName}] Señal de dip: ${dipSignal}, Razón: ${dipReason}`);
    }

    if (!dipSignal) {
      // Si no hay señal de dip, registrar como pendiente
      const finalReason = `No se ejecutó la compra. Razón del dip: ${dipReason}.`;
      const { error: insertPendingError } = await supabaseAdmin
        .from('manual_trades')
        .insert({
          user_id: user.id,
          pair: pair,
          usdt_amount: usdtAmount,
          take_profit_percentage: takeProfitPercentage,
          status: 'awaiting_dip_signal', // Nuevo estado
          strategy_type: 'strategic',
          dip_percentage: dipPercentage,
          lookback_minutes: lookbackMinutes,
          error_message: finalReason, // Guardar la razón por la que está pendiente
        });

      if (insertPendingError) {
        console.error(`[${functionName}] Error al registrar la operación pendiente en DB: ${insertPendingError.message}`);
        throw new Error(`Error al registrar la operación pendiente en DB: ${insertPendingError.message}`);
      }
      console.log(`[${functionName}] Operación estratégica para ${pair} registrada como pendiente.`);

      return new Response(JSON.stringify({ message: `Operación estratégica para ${pair} registrada como pendiente: ${finalReason}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Si hay señal de dip, proceder con la compra en Binance
    // Obtener información de intercambio para precisión y límites
    const exchangeInfoUrl = `https://api.binance.com/api/v3/exchangeInfo?symbol=${pair}`;
    const exchangeInfoResponse = await fetch(exchangeInfoUrl);
    const exchangeInfoData = await exchangeInfoResponse.json();

    if (!exchangeInfoResponse.ok || exchangeInfoData.code) {
      throw new Error(`Error al obtener información de intercambio: ${exchangeInfoData.msg || 'Error desconocido'}`);
    }

    const symbolInfo = exchangeInfoData.symbols.find((s: any) => s.symbol === pair);
    if (!symbolInfo) {
      throw new Error(`Información de intercambio no encontrada para el símbolo ${pair}`);
    }

    // Ejecutar la orden de compra en Binance
    let queryString = `symbol=${pair}&side=BUY&type=MARKET&quoteOrderQty=${usdtAmount}&timestamp=${Date.now()}`;
    const signature = new HmacSha256(api_secret).update(queryString).toString();
    const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;
    console.log(`[${functionName}] Enviando orden de compra a Binance para ${pair} con ${usdtAmount} USDT.`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': api_key },
    });

    const orderResult = await response.json();
    if (!response.ok) {
      console.error(`[${functionName}] Binance BUY order error for ${pair}: ${orderResult.msg || 'Unknown error'}`, orderResult);
      // Registrar el error en la DB si es posible, o simplemente lanzar el error
      throw new Error(`Error de Binance al comprar: ${orderResult.msg || 'Error desconocido'}`);
    }
    console.log(`[${functionName}] Binance BUY order successful for ${pair}. Order ID: ${orderResult.orderId}`);

    // 4. Calcular precio de compra y precio objetivo
    const executedQty = parseFloat(orderResult.executedQty);
    const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
    const purchasePrice = cummulativeQuoteQty / executedQty;
    
    // Ajustar el precio objetivo para incluir la comisión de venta
    const targetPrice = (purchasePrice * (1 + takeProfitPercentage / 100)) / (1 - BINANCE_FEE_RATE);

    // 5. Insertar la operación en la base de datos con estado 'active' y strategy_type 'strategic'
    const { error: insertError } = await supabaseAdmin
      .from('manual_trades') // Usamos manual_trades pero con strategy_type
      .insert({
        user_id: user.id,
        pair: pair,
        usdt_amount: usdtAmount,
        asset_amount: executedQty,
        purchase_price: purchasePrice,
        take_profit_percentage: takeProfitPercentage,
        target_price: targetPrice,
        status: 'active',
        binance_order_id_buy: orderResult.orderId.toString(),
        strategy_type: 'strategic', // Marcar como operación estratégica
        dip_percentage: dipPercentage, // Guardar los parámetros de la estrategia
        lookback_minutes: lookbackMinutes,
        error_message: null, // Limpiar cualquier mensaje de error anterior
      });

    if (insertError) {
      console.error(`[${functionName}] Error al registrar la operación estratégica en DB: ${insertError.message}`);
      throw new Error(`Error al registrar la operación estratégica en DB: ${insertError.message}`);
    }
    console.log(`[${functionName}] Operación estratégica para ${pair} registrada con éxito.`);

    return new Response(JSON.stringify({ message: `¡Compra estratégica de ${pair} ejecutada con éxito! Objetivo de ganancia: ${takeProfitPercentage}%` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error(`Error en la Edge Function ${functionName}:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});