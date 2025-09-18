import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    const { usdtAmount, takeProfitPercentage, selectedAssets } = await req.json();
    if (!usdtAmount || !takeProfitPercentage || !selectedAssets || selectedAssets.length === 0) {
      throw new Error('Los parámetros "usdtAmount", "takeProfitPercentage" y "selectedAssets" son obligatorios.');
    }

    const results: { asset: string; status: string; message: string }[] = [];

    for (const asset of selectedAssets) {
      try {
        const { error: insertError } = await supabaseAdmin
          .from('signal_trades')
          .insert({
            user_id: user.id,
            pair: asset,
            usdt_amount: usdtAmount,
            take_profit_percentage: takeProfitPercentage,
            status: 'awaiting_buy_signal', // Nuevo estado para monitoreo
          });

        if (insertError) {
          throw new Error(`Error al registrar el monitoreo para ${asset}: ${insertError.message}`);
        }
        results.push({ asset, status: 'success', message: 'Monitoreo configurado con éxito.' });
      } catch (assetError: any) {
        console.error(`Error al configurar monitoreo para ${asset}:`, assetError);
        results.push({ asset, status: 'error', message: assetError.message });
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error en la Edge Function setup-signal-monitoring:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});