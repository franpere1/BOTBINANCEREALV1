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

  const functionName = 'update-manual-trade';

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

    // No necesitamos las claves de API para esta función, ya que solo actualiza la DB,
    // pero las obtenemos para mantener la consistencia de la autenticación.
    const { data: keys, error: keysError } = await supabaseAdmin
      .from('api_keys')
      .select('api_key, api_secret')
      .eq('user_id', user.id)
      .single();
    if (keysError) throw new Error('Claves de API no encontradas.');

    // Lógica para actualizar la operación
    const { tradeId, usdtAmount, takeProfitPercentage, dipPercentage, lookbackMinutes } = await req.json();
    if (!tradeId) throw new Error('El parámetro "tradeId" es obligatorio.');

    const updatePayload: {
      usdt_amount?: number;
      take_profit_percentage?: number;
      target_price?: number | null;
      dip_percentage?: number;
      lookback_minutes?: number;
      error_message?: string | null; // Para limpiar el mensaje de error si se edita
    } = {};

    // Obtener el trade actual para verificar el estado y purchase_price
    const { data: existingTrade, error: fetchTradeError } = await supabaseAdmin
      .from('manual_trades')
      .select('purchase_price, status, strategy_type')
      .eq('id', tradeId)
      .eq('user_id', user.id)
      .single();

    if (fetchTradeError || !existingTrade) {
      throw new Error(`Operación no encontrada o no autorizada: ${fetchTradeError?.message || 'desconocido'}`);
    }

    console.log(`[${functionName}] Updating trade ${tradeId} with status ${existingTrade.status} and strategy_type ${existingTrade.strategy_type}`);

    if (existingTrade.status === 'awaiting_dip_signal' && existingTrade.strategy_type === 'strategic') {
      // Permitir la edición de todos los parámetros de la estrategia
      if (usdtAmount !== undefined) updatePayload.usdt_amount = usdtAmount;
      if (takeProfitPercentage !== undefined) updatePayload.take_profit_percentage = takeProfitPercentage;
      if (dipPercentage !== undefined) updatePayload.dip_percentage = dipPercentage;
      if (lookbackMinutes !== undefined) updatePayload.lookback_minutes = lookbackMinutes;
      // NO limpiar el error_message aquí. Se actualizará en el siguiente ciclo de monitor-trades.
      updatePayload.target_price = null; // Asegurarse de que target_price sea null si está esperando dip
    } else if (existingTrade.status === 'active') {
      // Si el trade está activo, solo se puede actualizar takeProfitPercentage y recalcular target_price
      if (takeProfitPercentage !== undefined) {
        if (!existingTrade.purchase_price) {
          throw new Error('No se puede actualizar el porcentaje de ganancia sin un precio de compra registrado.');
        }
        const purchasePrice = existingTrade.purchase_price;
        const newTargetPrice = (purchasePrice * (1 + takeProfitPercentage / 100)) / (1 - BINANCE_FEE_RATE);

        updatePayload.take_profit_percentage = takeProfitPercentage;
        updatePayload.target_price = newTargetPrice;
      }
      // Otros campos como usdtAmount, dipPercentage, lookbackMinutes no se pueden editar si ya está activo
      if (usdtAmount !== undefined && usdtAmount !== existingTrade.usdt_amount) {
        throw new Error('No se puede actualizar la cantidad de USDT para una operación activa.');
      }
      if (dipPercentage !== undefined && dipPercentage !== existingTrade.dip_percentage) {
        throw new Error('No se puede actualizar el porcentaje de caída para una operación activa.');
      }
      if (lookbackMinutes !== undefined && lookbackMinutes !== existingTrade.lookback_minutes) {
        throw new Error('No se puede actualizar el período de búsqueda para una operación activa.');
      }
    } else {
      // Para otros estados, no permitir edición de estos campos
      throw new Error(`No se pueden editar la operación en estado '${existingTrade.status}'.`);
    }

    if (Object.keys(updatePayload).length === 0) {
      return new Response(JSON.stringify({ message: 'No hay parámetros para actualizar.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from('manual_trades')
      .update(updatePayload)
      .eq('id', tradeId)
      .eq('user_id', user.id); // Asegurar que el usuario es dueño de la operación

    if (updateError) {
      console.error(`[${functionName}] Error al actualizar la operación en DB: ${updateError.message}`);
      throw new Error(`Error al actualizar la operación en DB: ${updateError.message}`);
    }

    console.log(`[${functionName}] Operación ${tradeId} actualizada con éxito.`);
    return new Response(JSON.stringify({ message: 'Operación actualizada con éxito' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error(`[${functionName}] Error en la Edge Function ${functionName}:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});