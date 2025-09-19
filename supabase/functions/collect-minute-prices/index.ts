import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASSETS_TO_MONITOR = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'USDCUSDT'];
const MAX_RECORDS_PER_ASSET = 1500; // Límite superior antes de borrar
const RECORDS_TO_KEEP = 1000; // Cantidad de registros a mantener después de borrar

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const results: { asset: string; status: string; message: string }[] = [];

    for (const asset of ASSETS_TO_MONITOR) {
      try {
        // 1. Obtener el precio actual del activo desde Binance
        const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${asset}`;
        const tickerResponse = await fetch(tickerPriceUrl);
        const tickerData = await tickerResponse.json();

        if (!tickerResponse.ok || tickerData.code) {
          throw new Error(`Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`);
        }
        const currentPrice = parseFloat(tickerData.price);

        // 2. Insertar el nuevo precio en la tabla minute_prices
        const { error: insertError } = await supabaseAdmin
          .from('minute_prices')
          .insert({
            asset: asset,
            price: currentPrice,
          });

        if (insertError) {
          throw new Error(`Error inserting price for ${asset}: ${insertError.message}`);
        }

        // 3. Gestionar el límite de registros (1500 max, mantener 1000)
        const { count, error: countError } = await supabaseAdmin
          .from('minute_prices')
          .select('id', { count: 'exact' })
          .eq('asset', asset);

        if (countError) {
          throw new Error(`Error counting records for ${asset}: ${countError.message}`);
        }

        if (count && count > MAX_RECORDS_PER_ASSET) {
          const recordsToDelete = count - RECORDS_TO_KEEP;
          
          // Obtener los IDs de los registros más antiguos para eliminar
          const { data: oldRecords, error: fetchOldError } = await supabaseAdmin
            .from('minute_prices')
            .select('id')
            .eq('asset', asset)
            .order('created_at', { ascending: true })
            .limit(recordsToDelete);

          if (fetchOldError) {
            throw new Error(`Error fetching old records for ${asset}: ${fetchOldError.message}`);
          }

          if (oldRecords && oldRecords.length > 0) {
            const oldRecordIds = oldRecords.map(record => record.id);
            const { error: deleteError } = await supabaseAdmin
              .from('minute_prices')
              .delete()
              .in('id', oldRecordIds);

            if (deleteError) {
              throw new Error(`Error deleting old records for ${asset}: ${deleteError.message}`);
            }
            console.log(`Deleted ${oldRecords.length} old records for ${asset}.`);
          }
        }
        results.push({ asset, status: 'success', message: `Price collected and managed for ${asset}.` });

      } catch (assetError: any) {
        console.error(`Error processing asset ${asset}:`, assetError);
        results.push({ asset, status: 'error', message: assetError.message });
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Unhandled error in Edge Function collect-minute-prices:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});