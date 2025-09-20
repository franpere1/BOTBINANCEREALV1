import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASSETS_TO_MONITOR = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'TRXUSDT'];
const MAX_MINUTE_RECORDS_PER_ASSET = 6500; // Límite superior antes de borrar (para 100 horas de datos de 1 minuto + buffer)
const MINUTE_RECORDS_TO_KEEP = 6000; // Cantidad de registros de 1 minuto a mantener después de borrar (100 horas * 60 minutos)

const MAX_HOURLY_RECORDS_PER_ASSET = 120; // Límite superior para 5 días de datos de 1 hora + buffer
const HOURLY_RECORDS_TO_KEEP = 100; // Cantidad de registros de 1 hora a mantener (aprox. 4 días)

// Helper function to aggregate 1-minute klines into 1-hour klines
function aggregateToHourlyKline(minuteKlines: any[]): any | null {
  if (minuteKlines.length === 0) return null;

  // Ordenar por created_at ascendente para asegurar el orden correcto de agregación
  minuteKlines.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const firstKline = minuteKlines[0];
  const lastKline = minuteKlines[minuteKlines.length - 1];

  let highPrice = parseFloat(firstKline.high_price);
  let lowPrice = parseFloat(firstKline.low_price);
  let volume = 0;

  for (const kline of minuteKlines) {
    highPrice = Math.max(highPrice, parseFloat(kline.high_price));
    lowPrice = Math.min(lowPrice, parseFloat(kline.low_price));
    volume += parseFloat(kline.volume);
  }

  return {
    open_price: parseFloat(firstKline.open_price),
    high_price: highPrice,
    low_price: lowPrice,
    close_price: parseFloat(lastKline.close_price),
    volume: volume,
    created_at: new Date(Math.floor(new Date(firstKline.created_at).getTime() / (1000 * 60 * 60)) * (1000 * 60 * 60)).toISOString(),
  };
}

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
    const currentMinute = new Date().getMinutes();
    const isStartOfHour = currentMinute >= 0 && currentMinute <= 5; // Permitir un pequeño margen al inicio de la hora

    for (const asset of ASSETS_TO_MONITOR) {
      try {
        // --- 1. Recolectar y almacenar la última vela de 1 minuto ---
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

        const { error: insertMinuteError } = await supabaseAdmin
          .from('minute_prices')
          .insert({
            asset: asset,
            open_price: openPrice,
            high_price: highPrice,
            low_price: lowPrice,
            close_price: closePrice,
            volume: volume,
            created_at: klineOpenTime,
          });

        if (insertMinuteError) {
          throw new Error(`Error inserting 1-minute kline data for ${asset}: ${insertMinuteError.message}`);
        }

        // --- 2. Gestionar el límite de registros de 1 minuto ---
        const { count: minuteCount, error: countMinuteError } = await supabaseAdmin
          .from('minute_prices')
          .select('id', { count: 'exact' })
          .eq('asset', asset);

        if (countMinuteError) {
          throw new Error(`Error counting 1-minute records for ${asset}: ${countMinuteError.message}`);
        }

        if (minuteCount && minuteCount > MAX_MINUTE_RECORDS_PER_ASSET) {
          const recordsToDelete = minuteCount - MINUTE_RECORDS_TO_KEEP;
          
          const { data: oldMinuteRecords, error: fetchOldMinuteError } = await supabaseAdmin
            .from('minute_prices')
            .select('id')
            .eq('asset', asset)
            .order('created_at', { ascending: true })
            .limit(recordsToDelete);

          if (fetchOldMinuteError) {
            throw new Error(`Error fetching old 1-minute records for ${asset}: ${fetchOldMinuteError.message}`);
          }

          if (oldMinuteRecords && oldMinuteRecords.length > 0) {
            const oldMinuteRecordIds = oldMinuteRecords.map(record => record.id);
            const { error: deleteMinuteError } = await supabaseAdmin
              .from('minute_prices')
              .delete()
              .in('id', oldMinuteRecordIds);

            if (deleteMinuteError) {
              throw new Error(`Error deleting old 1-minute records for ${asset}: ${deleteMinuteError.message}`);
            }
            console.log(`Deleted ${oldMinuteRecords.length} old 1-minute records for ${asset}.`);
          }
        }
        results.push({ asset, status: 'success', message: `1-minute kline collected and managed for ${asset}.` });

        // --- 3. Agregación y almacenamiento de velas de 1 hora (al inicio de cada hora) ---
        if (isStartOfHour) {
          console.log(`[collect-minute-prices] Aggregating hourly kline for ${asset} at start of hour.`);
          // Obtener las últimas 60 velas de 1 minuto
          const { data: last60MinuteKlines, error: fetch60MinError } = await supabaseAdmin
            .from('minute_prices')
            .select('open_price, high_price, low_price, close_price, volume, created_at')
            .eq('asset', asset)
            .order('created_at', { ascending: false })
            .limit(60);

          if (fetch60MinError) {
            console.warn(`[collect-minute-prices] Error fetching last 60 minute klines for ${asset}: ${fetch60MinError.message}`);
          } else if (last60MinuteKlines && last60MinuteKlines.length === 60) {
            const hourlyKline = aggregateToHourlyKline(last60MinuteKlines);

            if (hourlyKline) {
              // Verificar si ya existe una vela horaria para esta hora para evitar duplicados
              const hourStart = new Date(hourlyKline.created_at);
              const { data: existingHourlyKline, error: checkHourlyError } = await supabaseAdmin
                .from('hourly_prices')
                .select('id')
                .eq('asset', asset)
                .gte('created_at', hourStart.toISOString())
                .lt('created_at', new Date(hourStart.getTime() + 60 * 60 * 1000).toISOString())
                .single();

              if (checkHourlyError && checkHourlyError.code !== 'PGRST116') { // PGRST116 means "no rows found"
                console.error(`[collect-minute-prices] Error checking existing hourly kline for ${asset}: ${checkHourlyError.message}`);
              }

              if (!existingHourlyKline) {
                const { error: insertHourlyError } = await supabaseAdmin
                  .from('hourly_prices')
                  .insert({ asset: asset, ...hourlyKline });

                if (insertHourlyError) {
                  console.error(`[collect-minute-prices] Error inserting hourly kline for ${asset}: ${insertHourlyError.message}`);
                } else {
                  console.log(`[collect-minute-prices] Hourly kline inserted for ${asset} at ${hourlyKline.created_at}.`);
                }
              } else {
                console.log(`[collect-minute-prices] Hourly kline already exists for ${asset} at ${hourlyKline.created_at}. Skipping insertion.`);
              }
            }
          } else {
            console.warn(`[collect-minute-prices] Not enough 1-minute klines (${last60MinuteKlines?.length || 0}) to aggregate an hourly kline for ${asset}.`);
          }

          // --- 4. Gestionar el límite de registros de 1 hora ---
          const { count: hourlyCount, error: countHourlyError } = await supabaseAdmin
            .from('hourly_prices')
            .select('id', { count: 'exact' })
            .eq('asset', asset);

          if (countHourlyError) {
            console.error(`[collect-minute-prices] Error counting 1-hour records for ${asset}: ${countHourlyError.message}`);
          }

          if (hourlyCount && hourlyCount > MAX_HOURLY_RECORDS_PER_ASSET) {
            const recordsToDelete = hourlyCount - HOURLY_RECORDS_TO_KEEP;
            
            const { data: oldHourlyRecords, error: fetchOldHourlyError } = await supabaseAdmin
              .from('hourly_prices')
              .select('id')
              .eq('asset', asset)
              .order('created_at', { ascending: true })
              .limit(recordsToDelete);

            if (fetchOldHourlyError) {
              console.error(`[collect-minute-prices] Error fetching old 1-hour records for ${asset}: ${fetchOldHourlyError.message}`);
            }

            if (oldHourlyRecords && oldHourlyRecords.length > 0) {
              const oldHourlyRecordIds = oldHourlyRecords.map(record => record.id);
              const { error: deleteHourlyError } = await supabaseAdmin
                .from('hourly_prices')
                .delete()
                .in('id', oldHourlyRecordIds);

              if (deleteHourlyError) {
                console.error(`[collect-minute-prices] Error deleting old 1-hour records for ${asset}: ${deleteHourlyError.message}`);
              }
              console.log(`Deleted ${oldHourlyRecords.length} old 1-hour records for ${asset}.`);
            }
          }
        }

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