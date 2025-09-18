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

  try {
    // 1. Autenticar al usuario
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '');

    // 2. Crear un cliente de Supabase con privilegios de servicio para acceder a la base de datos
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Obtener las claves de API del usuario desde la base de datos
    const { data: keys, error: keysError } = await supabaseAdmin
      .from('api_keys')
      .select('api_key, api_secret')
      .eq('user_id', user.id)
      .single();

    if (keysError || !keys) {
      return new Response(JSON.stringify({ error: 'API keys not found for this user.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { api_key, api_secret } = keys;

    // 4. Crear la solicitud firmada para Binance
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = new HmacSha256(api_secret).update(queryString).toString();
    
    const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;

    // 5. Realizar la llamada a la API de Binance
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': api_key,
      },
    });

    const responseData = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Binance API error: ${responseData.msg}`, details: responseData }), { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 6. Filtrar y devolver los balances que no son cero
    const balances = responseData.balances.filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);

    return new Response(JSON.stringify(balances), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Unhandled error in Edge Function:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});