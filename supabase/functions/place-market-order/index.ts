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
    // Autenticación y obtención de claves de API (igual que en la función de balance)
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

    const { api_key, api_secret } = keys;

    // Lógica de la orden
    const { pair, side, quantity, quoteOrderQty } = await req.json();
    if (!pair || !side) throw new Error('Los parámetros "pair" y "side" son obligatorios.');

    let queryString = `symbol=${pair}&side=${side.toUpperCase()}&type=MARKET&timestamp=${Date.now()}`;
    
    if (side.toUpperCase() === 'BUY' && quoteOrderQty) {
      queryString += `&quoteOrderQty=${quoteOrderQty}`;
    } else if (side.toUpperCase() === 'SELL' && quantity) {
      queryString += `&quantity=${quantity}`;
    } else {
      throw new Error('Parámetros de cantidad inválidos para la orden.');
    }

    const signature = new HmacSha256(api_secret).update(queryString).toString();
    const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': api_key },
    });

    const responseData = await response.json();
    if (!response.ok) {
      throw new Error(`Error de Binance: ${responseData.msg || 'Error desconocido'}`);
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error en la Edge Function place-market-order:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});