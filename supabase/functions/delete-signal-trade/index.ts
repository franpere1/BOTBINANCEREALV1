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

  const functionName = 'delete-signal-trade';

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

    // Lógica para eliminar la operación
    const { tradeId } = await req.json();
    if (!tradeId) throw new Error('El parámetro "tradeId" es obligatorio.');

    // 1. Obtener los detalles de la operación
    const { data: trade, error: fetchTradeError } = await supabaseAdmin
      .from('signal_trades')
      .select('pair, asset_amount, status')
      .eq('id', tradeId)
      .eq('user_id', user.id) // Asegurar que el usuario es dueño de la operación
      .single();

    if (fetchTradeError || !trade) {
      throw new Error(`Operación no encontrada o no autorizada: ${fetchTradeError?.message || 'desconocido'}`);
    }

    let binanceSellAttempted = false;
    let binanceErrorMessage: string | null = null;
    let shouldAttemptBinanceSell = true; // Bandera para controlar la llamada a la API de Binance
    let adjustedQuantity = 0; // Declarar aquí para que esté disponible en el scope

    // 2. Si la operación está activa y tiene una cantidad de activo, intentar vender los activos
    if (trade.status === 'active' && trade.asset_amount && trade.asset_amount > 0) {
      binanceSellAttempted = true;
      const baseAsset = trade.pair.replace('USDT', '');

      try {
        // Obtener información de intercambio para precisión y límites
        const exchangeInfoUrl = `https://api.binance.com/api/v3/exchangeInfo?symbol=${trade.pair}`;
        const exchangeInfoResponse = await fetch(exchangeInfoUrl);
        const exchangeInfoData = await exchangeInfoResponse.json();

        if (!exchangeInfoResponse.ok || exchangeInfoData.code) {
          throw new Error(`Error al obtener información de intercambio: ${exchangeInfoData.msg || 'Error desconocido'}`);
        }

        const symbolInfo = exchangeInfoData.symbols.find((s: any) => s.symbol === trade.pair);
        if (!symbolInfo) {
          throw new Error(`Información de intercambio no encontrada para el símbolo ${trade.pair}`);
        }

        const quantityFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
        if (!quantityFilter) {
          throw new Error(`Filtro LOT_SIZE no encontrado para el símbolo ${trade.pair}.`);
        }

        const minNotionalFilter = symbolInfo.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
        const minNotional = minNotionalFilter ? parseFloat(minNotionalFilter.minNotional) : 0;

        const stepSize = parseFloat(quantityFilter.stepSize);
        const minQty = parseFloat(quantityFilter.minQty);

        // Obtener el balance actual del activo del usuario en Binance
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
          binanceErrorMessage = `No hay saldo disponible de ${baseAsset} en Binance para vender o la cantidad es demasiado pequeña para ${trade.pair}.`;
          console.warn(`[${functionName}] ${binanceErrorMessage}`);
          shouldAttemptBinanceSell = false;
        } else {
          // Obtener el precio actual para verificar MIN_NOTIONAL en ventas
          const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${trade.pair}`;
          const tickerPriceResponse = await fetch(tickerPriceUrl);
          const tickerPriceData = await tickerPriceResponse.json();
          if (!tickerPriceResponse.ok || tickerPriceData.code) {
            throw new Error(`Error al obtener el precio actual para ${trade.pair}: ${tickerPriceData.msg || 'Error desconocido'}`);
          }
          const currentPrice = parseFloat(tickerPriceData.price);

          adjustedQuantity = adjustQuantity(quantityToSell, stepSize); // Asignar a la variable declarada

          if (adjustedQuantity < minQty) {
            console.warn(`[${functionName}] La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${trade.pair}. No se realizará la venta.`);
            binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Cantidad de venta (${adjustedQuantity}) menor que la mínima (${minQty}). No se realizó la venta.`;
            shouldAttemptBinanceSell = false;
          } else {
            const notionalValue = adjustedQuantity * currentPrice;
            if (notionalValue < minNotional) {
              console.warn(`[${functionName}] El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${trade.pair}. No se realizará la venta.`);
              binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Valor nocional de venta (${notionalValue.toFixed(8)}) menor que el mínimo (${minNotional}). No se realizó la venta.`;
              shouldAttemptBinanceSell = false;
            }
          }
        }
      } catch (sellAttemptError: any) {
        binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Error durante el intento de venta en Binance para eliminación: ${sellAttemptError.message}`;
        console.warn(`[${functionName}] ${binanceErrorMessage}`);
        shouldAttemptBinanceSell = false; // Si hay un error en la preparación, no intentar la venta
      }
    } else if (trade.status === 'awaiting_buy_signal') {
      console.log(`[${functionName}] Trade ${tradeId} está esperando una señal de compra. No hay activos para vender.`);
      shouldAttemptBinanceSell = false; // No hay activos para vender
    }

    if (shouldAttemptBinanceSell) {
        try {
            // Ejecutar la orden de venta en Binance
            const sellQueryString = `symbol=${trade.pair}&side=SELL&type=MARKET&quantity=${adjustedQuantity}&timestamp=${Date.now()}`;
            const sellSignature = new HmacSha256(api_secret).update(sellQueryString).toString();
            const sellUrl = `https://api.binance.com/api/v3/order?${sellQueryString}&signature=${sellSignature}`;

            const sellResponse = await fetch(sellUrl, {
                method: 'POST',
                headers: { 'X-MBX-APIKEY': api_key },
            });

            const sellOrderData = await sellResponse.json();

            if (!sellResponse.ok) {
                binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Error de Binance al vender activos para eliminar la operación: ${sellOrderData.msg || 'Error desconocido'}`;
                console.warn(`[${functionName}] ${binanceErrorMessage}`);
            } else {
                console.log(`[${functionName}] Activos de la operación ${tradeId} vendidos en Binance.`);
            }
        } catch (sellAttemptError: any) {
            binanceErrorMessage = (binanceErrorMessage ? binanceErrorMessage + "; " : "") + `Error durante el intento de venta en Binance para eliminación: ${sellAttemptError.message}`;
            console.warn(`[${functionName}] ${binanceErrorMessage}`);
        }
    } else {
        console.log(`[${functionName}] Skipping Binance sell order for trade ${trade.id} due to validation failure or no assets to sell.`);
    }

    // 3. Siempre eliminar el registro de la base de datos
    const { error: deleteError } = await supabaseAdmin
      .from('signal_trades')
      .delete()
      .eq('id', tradeId)
      .eq('user_id', user.id); // Asegurar que el usuario es dueño de la operación

    if (deleteError) {
      throw new Error(`Error al eliminar la operación de DB: ${deleteError.message}`);
    }

    let responseMessage = 'Operación eliminada con éxito';
    if (binanceSellAttempted && binanceErrorMessage) {
      responseMessage = `Operación eliminada, pero hubo un error al intentar vender activos en Binance: ${binanceErrorMessage}`;
    }

    return new Response(JSON.stringify({ message: responseMessage, binanceError: binanceErrorMessage }), {
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