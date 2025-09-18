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

    // Lógica de la orden de compra y registro en DB
    const { pair, usdtAmount, takeProfitPercentage } = await req.json();
    if (!pair || !usdtAmount || !takeProfitPercentage) {
      throw new Error('Los parámetros "pair", "usdtAmount" y "takeProfitPercentage" son obligatorios.');
    }

    // 1. Insertar la operación en la base de datos con estado 'pending'
    const { data: trade, error: insertError } = await supabaseAdmin
      .from('signal_trades')
      .insert({
        user_id: user.id,
        pair: pair,
        usdt_amount: usdtAmount,
        take_profit_percentage: takeProfitPercentage,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Error al crear la operación en DB: ${insertError.message}`);
    }

    // 2. Invocar la Edge Function para ejecutar la compra en Binance
    let queryString = `symbol=${pair}&side=BUY&type=MARKET&quoteOrderQty=${usdtAmount}&timestamp=${Date.now()}`;
    const signature = new HmacSha256(api_secret).update(queryString).toString();
    const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': api_key },
    });

    const orderResult = await response.json();
    if (!response.ok) {
      // Si la orden falla, actualizar el estado de la operación a 'error'
      await supabaseAdmin
        .from('signal_trades')
        .update({ status: 'error', error_message: `Binance API error: ${orderResult.msg || 'Error desconocido'}` })
        .eq('id', trade.id);
      throw new Error(`Error de Binance al comprar: ${orderResult.msg || 'Error desconocido'}`);
    }

    // 3. Calcular precio de compra y precio objetivo
    const executedQty = parseFloat(orderResult.executedQty);
    const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
    const purchasePrice = cummulativeQuoteQty / executedQty;
    const targetPrice = purchasePrice * (1 + takeProfitPercentage / 100);

    // 4. Actualizar la operación en la DB con los detalles de la compra
    const { error: updateError } = await supabaseAdmin
      .from('signal_trades')
      .update({
        status: 'active',
        asset_amount: executedQty,
        purchase_price: purchasePrice,
        target_price: targetPrice,
        binance_order_id_buy: orderResult.orderId.toString(),
      })
      .eq('id', trade.id);

    if (updateError) {
      throw new Error(`Error al actualizar la operación en DB: ${updateError.message}`);
    }

    return new Response(JSON.stringify({ message: 'Operación de señal iniciada con éxito', tradeId: trade.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error en la Edge Function initiate-signal-trade:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});