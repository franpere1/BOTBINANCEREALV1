import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabaseAdmin.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: keys, error: keysError } = await supabaseAdmin
      .from('api_keys')
      .select('api_key, api_secret')
      .eq('user_id', user.id)
      .single()

    if (keysError || !keys) {
      return new Response(JSON.stringify({ error: 'API keys not found for this user.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const binanceUrl = 'https://api.binance.com/api/v3/account';
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    
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

    const response = await fetch(urlWithParams, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': keys.api_key,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
        return new Response(JSON.stringify({ error: 'Failed to fetch from Binance API', details: data }), {
            status: response.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const balances = data.balances.filter((asset: any) => parseFloat(asset.free) > 0 || parseFloat(asset.locked) > 0);

    return new Response(JSON.stringify({ balances }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})