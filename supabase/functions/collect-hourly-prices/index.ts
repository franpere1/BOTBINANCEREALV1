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

  const functionName = 'collect-hourly-prices';

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`[${functionName}] Starting hourly price collection.`);

    const assetsToCollect = ['BTCUSDT', 'ETHUSDT']; // Puedes añadir más activos aquí

    for (const asset of assetsToCollect) {
      try {
        const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${asset}`;
        const tickerResponse = await fetch(tickerPriceUrl);
        const tickerData = await tickerResponse.json();

        if (!tickerResponse.ok || tickerData.code) {
          console.error(`[${functionName}] Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`, tickerData);
          throw new Error(`Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`);
        }
        const currentPrice = parseFloat(tickerData.price);

        // Insertar el nuevo precio
        const { error: insertError } = await supabaseAdmin
          .from('hourly_prices')
          .insert({
            asset: asset,
            price: currentPrice,
          });

        if (insertError) {
          console.error(`[${functionName}] Error inserting hourly price for ${asset}:`, insertError);
          throw new Error(`Error inserting hourly price for ${asset}: ${insertError.message}`);
        }
        console.log(`[${functionName}] Successfully collected and stored price for ${asset}: ${currentPrice}`);

        // Lógica de retención de datos: mantener solo las últimas 100 horas
        const { count, error: countError } = await supabaseAdmin
          .from('hourly_prices')
          .select('id', { count: 'exact' })
          .eq('asset', asset);

        if (countError) {
          console.error(`[${functionName}] Error counting hourly prices for ${asset}:`, countError);
          // No lanzamos error fatal, solo registramos y continuamos
        } else if (count !== null && count >= 150) {
          console.log(`[${functionName}] ${asset}: ${count} records found. Deleting oldest 50.`);
          
          // Obtener los IDs de los 50 registros más antiguos
          const { data: oldestRecords, error: fetchOldestError } = await supabaseAdmin
            .from('hourly_prices')
            .select('id')
            .eq('asset', asset)
            .order('timestamp', { ascending: true })
            .limit(50);

          if (fetchOldestError) {
            console.error(`[${functionName}] Error fetching oldest records for ${asset}:`, fetchOldestError);
          } else if (oldestRecords && oldestRecords.length > 0) {
            const idsToDelete = oldestRecords.map(record => record.id);
            const { error: deleteError } = await supabaseAdmin
              .from('hourly_prices')
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

    console.log(`[${functionName}] Hourly price collection cycle completed.`);
    return new Response(JSON.stringify({ message: 'Hourly price collection completed.' }), {
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