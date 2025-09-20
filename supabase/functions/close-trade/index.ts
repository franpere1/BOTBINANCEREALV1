import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper para ajustar la cantidad a la precisión del stepSize de Binance
const adjustQuantity = (qty: number, step: number) => {
  // Calcula el número de pasos y luego multiplica por el stepSize para asegurar la precisión
  const numSteps = Math.floor(qty / step);
  return numSteps * step;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    // Lógica para cerrar la operación
    const { tradeId, tradeType } = await req.json();
    if (!tradeId || !tradeType) throw new Error('Los parámetros "tradeId" y "tradeType" son obligatorios.');

    const tableName = tradeType === 'manual' ? 'manual_trades' : 'signal_trades';

    // 1. Obtener los detalles de la operación
    const { data: trade, error: fetchTradeError } = await supabaseAdmin
      .from(tableName)
      .select('pair, asset_amount, user_id')
      .eq('id', tradeId)
      .eq('user_id', user.id) // Asegurar que el usuario es dueño de la operación
      .single();

    if (fetchTradeError || !trade) {
      throw new Error(`Operación no encontrada o no autorizada: ${fetchTradeError?.message || 'desconocido'}`);
    }

    const { pair } = trade;
    const baseAsset = pair.replace('USDT', '');
    console.log(`[CLOSE-TRADE] Procesando trade ${tradeId} para el par ${pair}. Base Asset: ${baseAsset}`);

    let binanceSellOrderId: string | null = null;
    let binanceErrorMessage: string | null = null;

    // Solo intentar vender si hay una cantidad de activo asociada al trade
    if (trade.asset_amount && trade.asset_amount > 0) {
      try {
        // 2. Obtener información de intercambio para precisión y límites
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

        const quantityFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
        if (!quantityFilter) {
          throw new Error(`Filtro LOT_SIZE no encontrado para el símbolo ${pair}.`);
        }

        const minNotionalFilter = symbolInfo.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
        const minNotional = minNotionalFilter ? parseFloat(minNotionalFilter.minNotional) : 0;

        const stepSize = parseFloat(quantityFilter.stepSize);
        const minQty = parseFloat(quantityFilter.minQty);

        console.log(`[CLOSE-TRADE] Exchange Info para ${pair}: stepSize=${stepSize}, minQty=${minQty}, minNotional=${minNotional}`);

        // 3. Obtener el balance actual del activo
        const timestamp = Date.now();
        const accountQueryString = `timestamp=${timestamp}`;
        const accountSignature = new HmacSha256(api_secret).update(accountQueryString).toString();
        const accountUrl = `https://api.binance.com/api/v3/account?${queryStringAccount}&signature=${signatureAccount}`;

        const accountResponse = await fetch(accountUrl, {
          method: 'GET',
          headers: { 'X-MBX-APIKEY': api_key },
        });
        const accountData = await accountResponse.json();

        if (!accountResponse.ok) {
          throw new Error(`Error al obtener el balance de la cuenta de Binance: ${accountData.msg || 'Error desconocido'}`);
        }

        const assetBalance = accountData.balances.find((b: any) => b.asset === baseAsset);
        
        if (!assetBalance || parseFloat(assetBalance.free) === 0) {
          console.warn(`[CLOSE-TRADE] No hay saldo disponible de ${baseAsset} para vender. Balance free: ${assetBalance?.free}`);
          throw new Error(`No hay saldo disponible de ${baseAsset} para vender.`);
        }
        let finalQuantity = parseFloat(assetBalance.free);
        console.log(`[CLOSE-TRADE] Balance libre de ${baseAsset} (antes de ajustar): ${finalQuantity}`);

        // 4. Obtener el precio actual para verificar MIN_NOTIONAL en ventas
        const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
        const tickerPriceResponse = await fetch(tickerPriceUrl);
        const tickerPriceData = await tickerPriceResponse.json();
        if (!tickerPriceResponse.ok || tickerPriceData.code) {
          throw new Error(`Error al obtener el precio actual para ${pair}: ${tickerPriceData.msg || 'Error desconocido'}`);
        }
        const currentPrice = parseFloat(tickerPriceData.price);
        console.log(`[CLOSE-TRADE] Precio actual de ${pair}: ${currentPrice}`);

        // 5. Validar y ajustar quantity
        let adjustedQuantity = adjustQuantity(finalQuantity, stepSize);
        console.log(`[CLOSE-TRADE] Cantidad ajustada (usando stepSize ${stepSize}): ${adjustedQuantity}`);

        if (adjustedQuantity < minQty) {
          console.error(`[CLOSE-TRADE] La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${pair}.`);
          throw new Error(`La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${pair}.`);
        }

        // Check MIN_NOTIONAL for sell orders
        const notionalValue = adjustedQuantity * currentPrice;
        console.log(`[CLOSE-TRADE] Valor nocional para la orden de venta: ${notionalValue.toFixed(8)} (Mínimo: ${minNotional})`);
        if (notionalValue < minNotional) {
          console.error(`[CLOSE-TRADE] El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${pair}.`);
          throw new Error(`El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${pair}.`);
        }

        // 6. Ejecutar la orden de venta en Binance
        const sellQueryString = `symbol=${pair}&side=SELL&type=MARKET&quantity=${adjustedQuantity}&timestamp=${Date.now()}`;
        const sellSignature = new HmacSha256(api_secret).update(sellQueryString).toString();
        const sellUrl = `https://api.binance.com/api/v3/order?${sellQueryString}&signature=${sellSignature}`;
        console.log(`[CLOSE-TRADE] Enviando orden de venta a Binance: ${sellUrl}`);

        const sellResponse = await fetch(sellUrl, {
          method: 'POST',
          headers: { 'X-MBX-APIKEY': api_key },
        });

        const sellOrderData = await sellResponse.json();
        console.log(`[CLOSE-TRADE] Respuesta de Binance para la venta:`, sellOrderData);

        if (!sellResponse.ok) {
          binanceErrorMessage = `Error de Binance al vender: ${sellOrderData.msg || 'Error desconocido'}`;
          console.error(`[CLOSE-TRADE] ${binanceErrorMessage}`);
        } else {
          binanceSellOrderId = sellOrderData.orderId.toString();
          console.log(`[CLOSE-TRADE] Activos de la operación ${tradeId} vendidos en Binance.`);
        }
      } catch (sellAttemptError: any) {
        binanceErrorMessage = `Error durante el intento de venta en Binance: ${sellAttemptError.message}`;
        console.error(`[CLOSE-TRADE] ${binanceErrorMessage}`);
      }
    } else {
      console.log(`[CLOSE-TRADE] Trade ${tradeId} no tiene 'asset_amount' o es 0. No se intentó orden de venta.`);
    }

    // 7. Actualizar el estado de la operación en la base de datos
    const { error: updateError } = await supabaseAdmin
      .from(tableName)
      .update({
        status: 'completed',
        binance_order_id_sell: binanceSellOrderId,
        completed_at: new Date().toISOString(),
        error_message: binanceErrorMessage, // Almacenar cualquier mensaje de error de Binance
      })
      .eq('id', tradeId);

    if (updateError) {
      throw new Error(`Error al actualizar la operación en DB: ${updateError.message}`);
    }
    console.log(`[CLOSE-TRADE] Trade ${tradeId} completado y actualizado en DB.`);

    // Devolver una respuesta exitosa, con una advertencia si la venta en Binance falló
    if (binanceErrorMessage) {
      return new Response(JSON.stringify({ message: 'Operación marcada como completada, pero hubo un error al vender activos en Binance.', binanceError: binanceErrorMessage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200, // Sigue siendo 200 porque la actualización de la DB fue exitosa
      });
    } else {
      return new Response(JSON.stringify({ message: 'Operación cerrada con éxito', orderId: binanceSellOrderId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

  } catch (error: any) {
    console.error('Error en la Edge Function close-trade:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});