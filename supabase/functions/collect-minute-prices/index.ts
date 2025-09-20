import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const functionName = 'collect-minute-prices';

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`[${functionName}] Starting minute price collection.`);

    // Lista de activos para recolectar (coincide con los topPairs del frontend)
    const assetsToCollect = [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
      'DOGEUSDT', 'ADAUSDT', 'SHIBUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT'
    ];

    for (const asset of assetsToCollect) {
      try {
        // Obtener la última vela de 1 minuto de Binance
        const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1m&limit=1`;
        const klinesResponse = await fetch(klinesUrl);
        const klinesData = await klinesResponse.json();

        if (!klinesResponse.ok || klinesData.code || klinesData.length === 0) {
          console.error(`[${functionName}] Error fetching 1m klines for ${asset}: ${klinesData.msg || 'Unknown error'}`, klinesData);
          throw new Error(`Error fetching 1m klines for ${asset}: ${klinesData.msg || 'Unknown error'}`);
        }

        const kline = klinesData[0];
        const [
          openTime,
          openPrice,
          highPrice,
          lowPrice,
          closePrice,
          volume,
          closeTime,
          quoteAssetVolume,
          numberOfTrades,
          takerBuyBaseAssetVolume,
          takerBuyQuoteAssetVolume,
          ignore
        ] = kline;

        // Insertar el nuevo precio de cierre y otros datos de la vela
        const { error: insertError } = await supabaseAdmin
          .from('minute_prices')
          .insert({
            asset: asset,
            open_price: parseFloat(openPrice),
            high_price: parseFloat(highPrice),
            low_price: parseFloat(lowPrice),
            close_price: parseFloat(closePrice),
            volume: parseFloat(volume),
            created_at: new Date(openTime).toISOString(), // Usar openTime como timestamp
          });

        if (insertError) {
          console.error(`[${functionName}] Error inserting minute price for ${asset}:`, insertError);
          throw new Error(`Error inserting minute price for ${asset}: ${insertError.message}`);
        }
        console.log(`[${functionName}] Successfully collected and stored 1m kline for ${asset} at ${new Date(openTime).toLocaleString()}`);

        // Lógica de retención de datos: mantener solo las últimas 300 minutos (5 horas)
        const retentionLimit = 300; // Keep 5 hours of data
        const deleteThreshold = 350; // Start deleting when we have 350 records

        const { count, error: countError } = await supabaseAdmin
          .from('minute_prices')
          .select('id', { count: 'exact' })
          .eq('asset', asset);

        if (countError) {
          console.error(`[${functionName}] Error counting minute prices for ${asset}:`, countError);
        } else if (count !== null && count >= deleteThreshold) {
          console.log(`[${functionName}] ${asset}: ${count} records found. Deleting oldest ${count - retentionLimit}.`);
          
          const { data: oldestRecords, error: fetchOldestError } = await supabaseAdmin
            .from('minute_prices')
            .select('id')
            .eq('asset', asset)
            .order('created_at', { ascending: true })
            .limit(count - retentionLimit);

          if (fetchOldestError) {
            console.error(`[${functionName}] Error fetching oldest records for ${asset}:`, fetchOldestError);
          } else if (oldestRecords && oldestRecords.length > 0) {
            const idsToDelete = oldestRecords.map(record => record.id);
            const { error: deleteError } = await supabaseAdmin
              .from('minute_prices')
              .delete()
              .in('id', idsToDelete);

            if (deleteError) {
              console.error(`[${functionName}] Error deleting oldest records for ${asset}:`, deleteError);
            } else {
              console.log(`[${functionName}] Successfully deleted ${idsToDelete.length} oldest records for ${asset}.`);
            }
          }
        }

      } catch (assetError: any) {
        console.error(`[${functionName}] Failed to collect price for ${asset}:`, assetError.message);
      }
    }

    console.log(`[${functionName}] Minute price collection cycle completed.`);
    return new Response(JSON.stringify({ message: 'Minute price collection completed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error(`[${functionName}] Unhandled error in ${functionName} Edge Function:`, error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});