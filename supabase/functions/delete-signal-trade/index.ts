import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper para ajustar la cantidad a la precisión del stepSize de Binance
const adjustQuantity = (qty: number, step: number) => {
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

    // 2. Si la operación está activa, intentar vender los activos
    if (trade.status === 'active' && trade.asset_amount && trade.asset_amount > 0) {
      const baseAsset = trade.pair.replace('USDT', '');

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

      // Obtener el balance actual del activo
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
      
      if (!assetBalance || parseFloat(assetBalance.free) === 0) {
        console.warn(`[DELETE-TRADE] No hay saldo disponible de ${baseAsset} para vender al eliminar la operación ${tradeId}.`);
        // No hay activos para vender, se procede a eliminar el registro.
      } else {
        let finalQuantity = parseFloat(assetBalance.free);

        // Obtener el precio actual para verificar MIN_NOTIONAL en ventas
        const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${trade.pair}`;
        const tickerPriceResponse = await fetch(tickerPriceUrl);
        const tickerPriceData = await tickerPriceResponse.json();
        if (!tickerPriceResponse.ok || tickerPriceData.code) {
          throw new Error(`Error al obtener el precio actual para ${trade.pair}: ${tickerPriceData.msg || 'Error desconocido'}`);
        }
        const currentPrice = parseFloat(tickerPriceData.price);

        let adjustedQuantity = adjustQuantity(finalQuantity, stepSize);

        if (adjustedQuantity < minQty) {
          console.warn(`[DELETE-TRADE] La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${trade.pair}. No se realizará la venta.`);
        } else {
          const notionalValue = adjustedQuantity * currentPrice;
          if (notionalValue < minNotional) {
            console.warn(`[DELETE-TRADE] El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${trade.pair}. No se realizará la venta.`);
          } else {
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
              throw new Error(`Error de Binance al vender activos para eliminar la operación: ${sellOrderData.msg || 'Error desconocido'}`);
            }
            console.log(`[DELETE-TRADE] Activos de la operación ${tradeId} vendidos en Binance.`);
          }
        }
      }
    }

    // 3. Eliminar el registro de la base de datos
    const { error: deleteError } = await supabaseAdmin
      .from('signal_trades')
      .delete()
      .eq('id', tradeId)
      .eq('user_id', user.id); // Asegurar que el usuario es dueño de la operación

    if (deleteError) {
      throw new Error(`Error al eliminar la operación de DB: ${deleteError.message}`);
    }

    return new Response(JSON.stringify({ message: 'Operación eliminada con éxito' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error en la Edge Function delete-signal-trade:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});