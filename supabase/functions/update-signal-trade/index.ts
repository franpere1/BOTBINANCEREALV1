import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";
import { BINANCE_FEE_RATE } from '../_utils/binance-helpers.ts';

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

    // Lógica para actualizar la operación
    const { tradeId, usdtAmount, takeProfitPercentage, status } = await req.json();
    if (!tradeId) throw new Error('El parámetro "tradeId" es obligatorio.');

    const updatePayload: {
      usdt_amount?: number;
      take_profit_percentage?: number;
      target_price?: number | null; // Puede ser null si no hay purchase_price
      status?: string;
    } = {};

    // Obtener el trade actual para verificar el estado y purchase_price
    const { data: existingTrade, error: fetchTradeError } = await supabaseAdmin
      .from('signal_trades')
      .select('purchase_price, status')
      .eq('id', tradeId)
      .eq('user_id', user.id)
      .single();

    if (fetchTradeError || !existingTrade) {
      throw new Error(`Operación no encontrada o no autorizada: ${fetchTradeError?.message || 'desconocido'}`);
    }

    // Solo permitir la edición de usdtAmount y takeProfitPercentage si el trade está en 'awaiting_buy_signal'
    if (existingTrade.status === 'awaiting_buy_signal') {
      if (usdtAmount !== undefined) {
        updatePayload.usdt_amount = usdtAmount;
      }
      if (takeProfitPercentage !== undefined) {
        updatePayload.take_profit_percentage = takeProfitPercentage;
        // Si no hay purchase_price (está awaiting_buy_signal), target_price debe ser null
        updatePayload.target_price = null; 
      }
    } else if (existingTrade.status === 'active' || existingTrade.status === 'paused') {
      // Si el trade está activo o pausado, solo se puede actualizar takeProfitPercentage y recalcular target_price
      if (takeProfitPercentage !== undefined) {
        if (!existingTrade.purchase_price) {
          throw new Error('No se puede actualizar el porcentaje de ganancia sin un precio de compra registrado.');
        }
        const purchasePrice = existingTrade.purchase_price;
        const newTargetPrice = (purchasePrice * (1 + takeProfitPercentage / 100)) / (1 - BINANCE_FEE_RATE);

        updatePayload.take_profit_percentage = takeProfitPercentage;
        updatePayload.target_price = newTargetPrice;
      }
    } else {
      // Para otros estados, no permitir edición de estos campos
      if (usdtAmount !== undefined || takeProfitPercentage !== undefined) {
        throw new Error(`No se pueden editar la cantidad o el porcentaje de ganancia para operaciones en estado '${existingTrade.status}'.`);
      }
    }

    // Si se proporciona status, actualizarlo (esto es independiente de los otros campos)
    if (status !== undefined) {
      if (!['active', 'paused', 'completed', 'error', 'awaiting_buy_signal'].includes(status)) {
        throw new Error('Estado inválido. Los estados permitidos son: active, paused, completed, error, awaiting_buy_signal.');
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