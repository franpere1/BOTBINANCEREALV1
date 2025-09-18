import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create a Supabase client with the user's auth context
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Get the user from the auth header
    const { data: { user } } = await supabaseAdmin.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Retrieve the user's API keys from the database
    const { data: keys, error: keysError } = await supabaseAdmin
      .from('api_keys')
      .select('api_key, api_secret')
      .eq('user_id', user.id)
      .single()

    if (keysError || !keys) {
      console.error('API keys error:', keysError);
      return new Response(JSON.stringify({ error: 'API keys not found for this user.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Prepare the request to the Binance API
    const binanceUrl = 'https://api.binance.com/api/v3/account';
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&recvWindow=10000`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(keys.api_secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(queryString));
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const urlWithParams = `${binanceUrl}?${queryString}&signature=${signature}`;

    // Make the request to Binance
    const response = await fetch(urlWithParams, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': keys.api_key,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    // If Binance returns an error, forward it
    if (!response.ok) {
        console.error('Binance API error:', data);
        return new Response(JSON.stringify({ error: 'Failed to fetch from Binance API', details: data }), {
            status: response.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Filter for balances with a positive amount
    const balances = data.balances.filter((asset: any) => parseFloat(asset.free) > 0 || parseFloat(asset.locked) > 0);

    // Return the balances
    return new Response(JSON.stringify({ balances }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Unhandled function error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})