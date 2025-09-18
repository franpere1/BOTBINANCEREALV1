import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Paso 1: Autenticar (ya sabemos que funciona, pero es necesario)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user } } = await supabaseAdmin.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    // Paso 2: Intentar obtener las claves API de la base de datos
    const { data: keys, error: keysError } = await supabaseAdmin
      .from('api_keys')
      .select('api_key')
      .eq('user_id', user.id)
      .single()

    if (keysError || !keys) {
      console.error('API keys error:', keysError);
      return new Response(JSON.stringify({ error: 'API keys not found for this user.', details: keysError }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Si tiene éxito, devuelve una confirmación. No se contacta a Binance.
    return new Response(JSON.stringify({ 
        message: "Prueba de obtención de claves API exitosa.",
        apiKeyFound: `${keys.api_key.substring(0, 4)}...${keys.api_key.slice(-4)}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'La prueba de obtención de claves API falló', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})