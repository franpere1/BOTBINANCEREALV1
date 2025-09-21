import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";
import { adjustQuantity } from '../_utils/binance-helpers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Autenticación y obtención de claves de API
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

    // Obtener información de intercambio para precisión y límites
    const exchangeInfoUrl = `https://api.binance.com/api/v3/exchangeInfo?symbol=${pair}`;
    const exchangeInfoResponse = await fetch(exchangeInfoUrl);
    const exchangeInfoData = await exchangeInfoResponse.json();

    if (!exchangeInfoResponse.ok || exchangeInfoData.code) {
      throw new Error(`Error al obtener información de intercambio: ${exchangeInfoData.msg || 'Error desconocido'}`);
    }

    const symbolInfo = exchangeInfoData.symbols.find((s: any) => s.symbol === pair);
    if (!symbolInfo) {
      throw new Error(`Información de intercambio no encontrada para el símbolo ${pair}`);
    }

    const quantityFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
    if (!quantityFilter) {
      throw new Error(`Filtro LOT_SIZE no encontrado para el símbolo ${pair}.`);
    }

    const minNotionalFilter = symbolInfo.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
    const minNotional = minNotionalFilter ? parseFloat(minNotionalFilter.minNotional) : 0;

    const stepSize = parseFloat(quantityFilter.stepSize);
    const minQty = parseFloat(quantityFilter.minQty);

    let queryString = `symbol=${pair}&side=${side.toUpperCase()}&type=MARKET&timestamp=${Date.now()}`;
    
    if (side.toUpperCase() === 'BUY' && quoteOrderQty) {
      if (quoteOrderQty < minNotional) {
        throw new Error(`La cantidad de la orden en USDT (${quoteOrderQty}) es menor que el mínimo nocional (${minNotional}) para ${pair}.`);
      }
      queryString += `&quoteOrderQty=${quoteOrderQty}`;
    } else if (side.toUpperCase() === 'SELL' && quantity) {
      let adjustedQuantity = adjustQuantity(quantity, stepSize);
      if (adjustedQuantity < minQty) {
        throw new Error(`La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${pair}.`);
      }
      queryString += `&quantity=${adjustedQuantity}`;
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

  } catch (error: any) {
    console.error('Error en la Edge Function place-market-order:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500, 
    });
  }
});