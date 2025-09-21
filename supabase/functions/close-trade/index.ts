import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";
import { adjustQuantity } from '../_utils/binance-helpers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const functionName = 'close-trade';

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
    console.log(`[${functionName}] Processing trade ${tradeId} of type ${tradeType} from table ${tableName}.`);

    // 1. Obtener los detalles de la operación
    const { data: trade, error: fetchTradeError } = await supabaseAdmin
      .from(tableName)
      .select('id, pair, asset_amount, user_id')
      .eq('id', tradeId)
      .eq('user_id', user.id) // Asegurar que el usuario es dueño de la operación
      .single();

    if (fetchTradeError || !trade) {
      throw new Error(`Operación no encontrada o no autorizada: ${fetchTradeError?.message || 'desconocido'}`);
    }

    const { pair } = trade;
    const baseAsset = pair.replace('USDT', '');
    console.log(`[${functionName}] Trade ${trade.id} for pair ${pair}. Base Asset: ${baseAsset}`);

    let binanceSellOrderId: string | null = null;
    let binanceErrorMessage: string | null = null;
    let shouldAttemptBinanceSell = true; // Bandera para controlar la llamada a la API de Binance
    let adjustedQuantity = 0; // Declarar aquí para que esté disponible en el scope

    // Solo intentar vender si la operación tiene una cantidad de activo registrada y es positiva
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

        console.log(`[${functionName}] Exchange Info para ${pair}: stepSize=${stepSize}, minQty=${minQty}, minNotional=${minNotional}`);

        // 3. Obtener el balance actual del activo del usuario en Binance
        const timestamp = Date.now();
        const accountQueryString = `timestamp=${timestamp}`;
        const accountSignature = new HmacSha256(api_secret).update(accountQueryString).toString();
        const accountUrl = `https://api.binance.com/api/v3/account?${accountQueryString}&signature=${accountSignature}`;

        const accountResponse = await fetch(accountUrl, {
          method: 'GET',
          headers: { 'X-MBX-APIKEY': api_key },
        });
        const accountData = await accountResponse.json();

        if (!accountResponse.ok) {
          throw new Error(`Error al obtener el balance de la cuenta de Binance: ${accountData.msg || 'Error desconocido'}`);
        }

        const assetBalance = accountData.balances.find((b: any) => b.asset === baseAsset);
        const actualFreeBalance = assetBalance ? parseFloat(assetBalance.free) : 0;

        // Determine the actual quantity to attempt to sell
        let quantityToSell = 0;
        if (actualFreeBalance > 0) {
            // Prioritize selling what's actually available on Binance, capped by what the trade thinks it bought
            quantityToSell = Math.min(trade.asset_amount || actualFreeBalance, actualFreeBalance);
            
            // ELIMINADO: La reducción del 0.1% que podía causar que la cantidad se redondeara a cero.
            // if (quantityToSell > 0.00000001) { // Avoid reducing already tiny amounts to zero
            //     quantityToSell *= 0.999; // Reduce by 0.1%
            // }
        }

        if (quantityToSell === 0) {
            binanceErrorMessage = `No hay saldo disponible de ${baseAsset} en Binance para vender o la cantidad es demasiado pequeña para ${pair}.`;
            console.warn(`[${functionName}] ${binanceErrorMessage}`);
            shouldAttemptBinanceSell = false;
        } else {
          // 4. Obtener el precio actual para verificar MIN_NOTIONAL en ventas
          const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
          const tickerPriceResponse = await fetch(tickerPriceUrl);
          const tickerPriceData = await tickerPriceResponse.json();
          if (!tickerPriceResponse.ok || tickerPriceData.code) {
            throw new Error(`Error al obtener el precio actual para ${pair}: ${tickerPriceData.msg || 'Error desconocido'}`);
          }
          const currentPrice = parseFloat(tickerPriceData.price);
          console.log(`[${functionName}] Precio actual de ${pair}: ${currentPrice}`);

          // 5. Validar y ajustar quantity
          adjustedQuantity = adjustQuantity(quantityToSell, stepSize); // Asignar a la variable declarada
          console.log(`[${functionName}] Cantidad a vender: ${quantityToSell}, Cantidad ajustada (usando stepSize ${stepSize}): ${adjustedQuantity}`);

          if (adjustedQuantity < minQty) {
            binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${pair}. No se realizará la venta.`;
            console.error(`[${functionName}] ${binanceErrorMessage}`);
            shouldAttemptBinanceSell = false;
          } else {
            const notionalValue = adjustedQuantity * currentPrice;
            console.log(`[${functionName}] Valor nocional para la orden de venta: ${notionalValue.toFixed(8)} (Mínimo: ${minNotional})`);
            if (notionalValue < minNotional) {
              binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${pair}. No se realizará la venta.`;
              console.error(`[${functionName}] ${binanceErrorMessage}`);
              shouldAttemptBinanceSell = false;
            }
          }
        }
      } catch (sellAttemptError: any) {
        binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Error durante el intento de venta en Binance: ${sellAttemptError.message}`;
        console.error(`[${functionName}] ${binanceErrorMessage}`);
        shouldAttemptBinanceSell = false; // Si hay un error en la preparación, no intentar la venta
      }
    } else {
      console.log(`[${functionName}] Trade ${trade.id} no tiene 'asset_amount' o es 0. No se intentó orden de venta.`);
      shouldAttemptBinanceSell = false; // No hay activos para vender
    }

    if (shouldAttemptBinanceSell) {
        try {
            // 6. Ejecutar la orden de venta en Binance
            const sellQueryString = `symbol=${pair}&side=SELL&type=MARKET&quantity=${adjustedQuantity}&timestamp=${Date.now()}`;
            const sellSignature = new HmacSha256(api_secret).update(sellQueryString).toString();
            const sellUrl = `https://api.binance.com/api/v3/order?${sellQueryString}&signature=${sellSignature}`;
            console.log(`[${functionName}] Enviando orden de venta a Binance: ${sellUrl}`);

            const sellResponse = await fetch(sellUrl, {
                method: 'POST',
                headers: { 'X-MBX-APIKEY': api_key },
            });

            const sellOrderData = await sellResponse.json();
            console.log(`[${functionName}] Respuesta de Binance para la venta:`, sellOrderData);

            if (!sellResponse.ok) {
                binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Error de Binance al vender: ${sellOrderData.msg || 'Error desconocido'}`;
                console.error(`[${functionName}] ${binanceErrorMessage}`);
            } else {
                binanceSellOrderId = sellOrderData.orderId.toString();
                console.log(`[${functionName}] Activos de la operación ${trade.id} vendidos en Binance.`);
            }
        } catch (sellAttemptError: any) {
            binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Error durante el intento de venta en Binance: ${sellAttemptError.message}`;
            console.error(`[${functionName}] ${binanceErrorMessage}`);
        }
    } else {
        console.log(`[${functionName}] Skipping Binance sell order for trade ${trade.id} due to validation failure or no assets to sell.`);
    }

    // 7. Actualizar el estado de la operación en la base de datos
    const updatePayload: any = {
      binance_order_id_sell: binanceSellOrderId,
      completed_at: new Date().toISOString(),
      error_message: binanceErrorMessage, // Almacenar cualquier mensaje de error de Binance
    };

    if (tradeType === 'manual') {
      updatePayload.status = 'completed';
      console.log(`[${functionName}] Manual trade ${trade.id} updated to 'completed'.`);
    } else if (tradeType === 'signal') {
      // Para operaciones de señal, reiniciar a awaiting_buy_signal para recurrencia
      updatePayload.status = 'awaiting_buy_signal';
      updatePayload.asset_amount = null;
      updatePayload.purchase_price = null;
      updatePayload.target_price = null;
      updatePayload.binance_order_id_buy = null;
      updatePayload.error_message = null; // Limpiar errores anteriores al reiniciar
      // created_at se mantiene para saber cuándo se inició el monitoreo original
      console.log(`[${functionName}] Signal trade ${trade.id} updated to 'awaiting_buy_signal' for recurrence.`);
    } else {
      // Fallback, aunque tradeType siempre debería ser 'manual' o 'signal'
      updatePayload.status = 'completed';
      console.warn(`[${functionName}] Unknown tradeType '${tradeType}' for trade ${trade.id}. Defaulting to 'completed'.`);
    }

    const { error: updateError } = await supabaseAdmin
      .from(tableName)
      .update(updatePayload)
      .eq('id', trade.id);

    if (updateError) {
      console.error(`[${functionName}] Error al actualizar la operación en DB: ${updateError.message}`);
      throw new Error(`Error al actualizar la operación en DB: ${updateError.message}`);
    }
    console.log(`[${functionName}] Trade ${trade.id} status updated in DB.`);

    // Devolver una respuesta exitosa (HTTP 200), con una advertencia si la venta en Binance falló
    if (binanceErrorMessage) {
      return new Response(JSON.stringify({ message: 'Operación marcada como completada, pero hubo un error al vender activos en Binance.', binanceError: binanceErrorMessage }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    } else {
      return new Response(JSON.stringify({ message: 'Operación cerrada con éxito', orderId: binanceSellOrderId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

  } catch (error: any) {
    console.error(`Error en la Edge Function ${functionName}:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});