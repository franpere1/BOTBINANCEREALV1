import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const functionName = 'get-top-pump-pairs';
  console.log(`[${functionName}] Starting to identify top pump pairs.`);

  try {
    // 1. Obtener los 5 pares USDT con mayor ganancia porcentual en la última 1 hora y volumen > 10M USD
    const ticker24hrUrl = `https://api.binance.com/api/v3/ticker/24hr`;
    const ticker24hrResponse = await fetch(ticker24hrUrl);
    const ticker24hrData = await ticker24hrResponse.json();

    if (!ticker24hrResponse.ok) {
      throw new Error(`Error fetching 24hr ticker data: ${ticker24hrData.msg || 'Unknown error'}`);
    }

    const topGainers = ticker24hrData
      .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 10_000_000) // Volumen > 10M USD
      .sort((a: any, b: any) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 5)
      .map((t: any) => t.symbol);

    console.log(`[${functionName}] Identified top 5 gainers with >10M volume:`, topGainers);

    return new Response(JSON.stringify(topGainers), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error(`[${functionName}] Unhandled error in ${functionName} Edge Function:`, error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});