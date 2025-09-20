import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASSETS_TO_MONITOR = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'TRXUSDT'];
const MAX_RECORDS_PER_ASSET = 6500; // Límite superior antes de borrar (para 100 horas de datos de 1 minuto + buffer)
const RECORDS_TO_KEEP = 6000; // Cantidad de registros a mantener después de borrar (100 horas * 60 minutos)

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
        // 1. Obtener la última vela de 1 minuto desde Binance
        const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1m&limit=1`;
        const klinesResponse = await fetch(klinesUrl);
        const klinesData = await klinesResponse.json();

        if (!klinesResponse.ok || klinesData.code || klinesData.length === 0) {
          throw new Error(`Error fetching 1-minute kline for ${asset}: ${klinesData.msg || 'No data'}`);
        }
        
        const kline = klinesData[0];
        const openPrice = parseFloat(kline[1]);
        const highPrice = parseFloat(kline[2]);
        const lowPrice = parseFloat(kline[3]);
        const closePrice = parseFloat(kline[4]);
        const volume = parseFloat(kline[5]);
        const klineOpenTime = new Date(kline[0]).toISOString(); // Usar el tiempo de apertura de la vela como created_at

        // 2. Insertar el nuevo precio en la tabla minute_prices
        const { error: insertError } = await supabaseAdmin
          .from('minute_prices')
          .insert({
            asset: asset,
            open_price: openPrice,
            high_price: highPrice,
            low_price: lowPrice,
            close_price: closePrice,
            volume: volume,
            created_at: klineOpenTime, // Almacenar el tiempo de apertura de la vela
          });

        if (insertError) {
          throw new Error(`Error inserting kline data for ${asset}: ${insertError.message}`);
        }

        // 3. Gestionar el límite de registros
        const { count, error: countError } = await supabaseAdmin
          .from('minute_prices')
          .select('id', { count: 'exact' })
          .eq('asset', asset);

        if (countError) {
          throw new Error(`Error counting records for ${asset}: ${countError.message}`);
        }

        if (count && count > MAX_RECORDS_PER_ASSET) {
          const recordsToDelete = count - RECORDS_TO_KEEP;
          
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
        results.push({ asset, status: 'success', message: `1-minute kline collected and managed for ${asset}.` });

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