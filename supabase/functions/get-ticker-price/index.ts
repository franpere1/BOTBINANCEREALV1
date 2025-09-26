import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const functionName = 'get-ticker-price'; // Add function name for clearer logs

  try {
    const { pair } = await req.json();
    if (!pair) {
      console.error(`[${functionName}] Missing 'pair' parameter.`);
      return new Response(JSON.stringify({ error: 'El parámetro "pair" es obligatorio.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
    console.log(`[${functionName}] Fetching from Binance: ${url}`);
    const response = await fetch(url);
    const data = await response.json();
    console.log(`[${functionName}] Binance response for ${pair}:`, data);

    if (!response.ok) {
      console.error(`[${functionName}] Binance API error for ${pair}: ${data.msg || 'Unknown error'}`, data);
      throw new Error(data.msg || 'Error al obtener el precio desde Binance.');
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) { // Explicitly type error as any for message property
    console.error(`[${functionName}] Unhandled error in Edge Function:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});