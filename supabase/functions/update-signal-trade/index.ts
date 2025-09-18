import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Tasa de comisión de Binance (0.1%)
const BINANCE_FEE_RATE = 0.001;

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

    // Lógica para actualizar la operación
    const { tradeId, takeProfitPercentage, status } = await req.json();
    if (!tradeId) throw new Error('El parámetro "tradeId" es obligatorio.');

    const updatePayload: {
      take_profit_percentage?: number;
      target_price?: number;
      status?: string;
    } = {};

    // Si se proporciona takeProfitPercentage, recalcular target_price
    if (takeProfitPercentage !== undefined) {
      const { data: trade, error: fetchTradeError } = await supabaseAdmin
        .from('signal_trades')
        .select('purchase_price')
        .eq('id', tradeId)
        .eq('user_id', user.id)
        .single();

      if (fetchTradeError || !trade) {
        throw new Error(`Operación no encontrada o no autorizada: ${fetchTradeError?.message || 'desconocido'}`);
      }

      if (!trade.purchase_price) {
        throw new Error('No se puede actualizar el porcentaje de ganancia sin un precio de compra registrado.');
      }

      const purchasePrice = trade.purchase_price;
      const newTargetPrice = (purchasePrice * (1 + takeProfitPercentage / 100)) / (1 - BINANCE_FEE_RATE);

      updatePayload.take_profit_percentage = takeProfitPercentage;
      updatePayload.target_price = newTargetPrice;
    }

    // Si se proporciona status, actualizarlo
    if (status !== undefined) {
      if (!['active', 'paused', 'completed', 'error'].includes(status)) {
        throw new Error('Estado inválido. Los estados permitidos son: active, paused, completed, error.');
      }
      updatePayload.status = status;
    }

    if (Object.keys(updatePayload).length === 0) {
      return new Response(JSON.stringify({ message: 'No hay parámetros para actualizar.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from('signal_trades')
      .update(updatePayload)
      .eq('id', tradeId)
      .eq('user_id', user.id); // Asegurar que el usuario es dueño de la operación

    if (updateError) {
      throw new Error(`Error al actualizar la operación en DB: ${updateError.message}`);
    }

    return new Response(JSON.stringify({ message: 'Operación actualizada con éxito' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error en la Edge Function update-signal-trade:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});