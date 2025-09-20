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