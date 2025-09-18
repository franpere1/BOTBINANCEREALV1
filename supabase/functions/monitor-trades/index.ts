import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Crear un cliente de Supabase con privilegios de servicio para acceder a la base de datos
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Obtener todas las operaciones activas
    const { data: activeTrades, error: tradesError } = await supabaseAdmin
      .from('manual_trades')
      .select('id, user_id, pair, asset_amount, purchase_price, target_price')
      .eq('status', 'active');

    if (tradesError) {
      console.error('Error fetching active trades:', tradesError);
      return new Response(JSON.stringify({ error: 'Error fetching active trades' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!activeTrades || activeTrades.length === 0) {
      return new Response(JSON.stringify({ message: 'No active trades to monitor.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Monitoring ${activeTrades.length} active trades.`);

    for (const trade of activeTrades) {
      try {
        // 2. Obtener las claves de API del usuario para esta operación
        const { data: keys, error: keysError } = await supabaseAdmin
          .from('api_keys')
          .select('api_key, api_secret')
          .eq('user_id', trade.user_id)
          .single();

        if (keysError || !keys) {
          console.error(`API keys not found for user ${trade.user_id} for trade ${trade.id}. Skipping.`);
          await supabaseAdmin
            .from('manual_trades')
            .update({ status: 'error', error_message: 'API keys not found or invalid.' })
            .eq('id', trade.id);
          continue;
        }

        const { api_key, api_secret } = keys;

        // 3. Obtener el precio actual del ticker desde Binance
        const tickerUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${trade.pair}`;
        const tickerResponse = await fetch(tickerUrl);
        const tickerData = await tickerResponse.json();

        if (!tickerResponse.ok) {
          throw new Error(tickerData.msg || `Error fetching ticker price for ${trade.pair}`);
        }
        const currentPrice = parseFloat(tickerData.price);

        console.log(`Trade ${trade.id} (${trade.pair}): Current Price = ${currentPrice}, Target Price = ${trade.target_price}`);

        // 4. Verificar si se alcanzó el precio objetivo
        if (currentPrice >= trade.target_price) {
          console.log(`Target price reached for trade ${trade.id}. Executing sell order.`);

          // 5. Ejecutar la orden de venta en Binance
          const timestamp = Date.now();
          const queryString = `symbol=${trade.pair}&side=SELL&type=MARKET&quantity=${trade.asset_amount}&timestamp=${timestamp}`;
          const signature = new HmacSha256(api_secret).update(queryString).toString();
          
          const orderUrl = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;

          const orderResponse = await fetch(orderUrl, {
            method: 'POST',
            headers: { 'X-MBX-APIKEY': api_key },
          });

          const orderData = await orderResponse.json();

          if (!orderResponse.ok) {
            throw new Error(`Binance sell order error: ${orderData.msg || 'Unknown error'}`);
          }

          // 6. Actualizar el estado de la operación en la base de datos
          await supabaseAdmin
            .from('manual_trades')
            .update({
              status: 'completed',
              binance_order_id_sell: orderData.orderId.toString(),
              completed_at: new Date().toISOString(),
            })
            .eq('id', trade.id);
          console.log(`Trade ${trade.id} completed successfully.`);

        }
      } catch (tradeError: any) {
        console.error(`Error processing trade ${trade.id}:`, tradeError);
        await supabaseAdmin
          .from('manual_trades')
          .update({ status: 'error', error_message: tradeError.message })
          .eq('id', trade.id);
      }
    }

    return new Response(JSON.stringify({ message: 'Trade monitoring completed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Unhandled error in monitor-trades Edge Function:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});