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

  const functionName = 'setup-pump-five-pairs-strategy';

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

    const { usdtAmount, takeProfitPercentage } = await req.json();
    if (!usdtAmount || !takeProfitPercentage) {
      throw new Error('Los parámetros "usdtAmount" y "takeProfitPercentage" son obligatorios.');
    }

    // Upsert (insert or update) the user's strategy configuration
    const { error: upsertError } = await supabaseAdmin
      .from('user_strategy_configs')
      .upsert({
        user_id: user.id,
        strategy_name: 'pump_five_pairs',
        usdt_amount: usdtAmount,
        take_profit_percentage: takeProfitPercentage,
      }, { onConflict: 'user_id, strategy_name' });

    if (upsertError) {
      console.error(`[${functionName}] Error upserting strategy config:`, upsertError);
      throw new Error(`Error al guardar la configuración de la estrategia: ${upsertError.message}`);
    }

    console.log(`[${functionName}] Strategy 'pump_five_pairs' configured successfully for user ${user.id}.`);

    return new Response(JSON.stringify({ message: 'Configuración de estrategia guardada con éxito.' }), {
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