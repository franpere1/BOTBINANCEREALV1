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

  const functionName = 'get-latest-hourly-prices';

  try {
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

    const { api_key } = keys; // Solo necesitamos la API Key para precios públicos

    const { assets } = await req.json();
    if (!assets || !Array.isArray(assets) || assets.length === 0) {
      throw new Error('El parámetro "assets" es obligatorio y debe ser un array de strings.');
    }

    const results: { asset: string; price: number; timestamp: string; error?: string }[] = [];

    for (const asset of assets) {
      try {
        const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${asset}`;
        const tickerResponse = await fetch(tickerPriceUrl);
        const tickerData = await tickerResponse.json();

        if (!tickerResponse.ok || tickerData.code) {
          console.error(`[${functionName}] Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`, tickerData);
          throw new Error(`Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`);
        }
        const currentPrice = parseFloat(tickerData.price);

        results.push({
          asset: asset,
          price: currentPrice,
          timestamp: new Date().toISOString(),
        });
      } catch (assetError: any) {
        console.error(`[${functionName}] Failed to get price for ${asset}:`, assetError.message);
        results.push({
          asset: asset,
          price: 0, // O un valor que indique error
          timestamp: new Date().toISOString(),
          error: assetError.message,
        });
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error(`Error en la Edge Function ${functionName}:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});