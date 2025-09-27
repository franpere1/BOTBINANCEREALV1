import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

// Inlined from _utils/binance-helpers.ts (assuming it exists or will be created)
const adjustQuantity = (qty: number, step: number) => {
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  const adjusted = Math.floor(qty / step) * step;
  return parseFloat(adjusted.toFixed(precision));
};

// Tasa de comisión de Binance (0.1%)
const BINANCE_FEE_RATE = 0.001;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to calculate SMA
function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const sum = data.slice(-period).reduce((acc, val) => acc + val, 0);
  return sum / period;
}

// Helper function to calculate a series of EMA values
function calculateEMASeries(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [];
  let currentEMA = calculateSMA(data.slice(0, period), period); // Initial SMA for the first EMA
  emas.push(currentEMA);

  for (let i = period; i < data.length; i++) {
    currentEMA = (data[i] - currentEMA) * k + currentEMA;
    emas.push(currentEMA);
  }
  return emas;
}

// Helper function to calculate RSI
function calculateRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;

  let gains: number[] = [];
  let losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }
  }

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average for the first 'period'
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed average for the rest
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const functionName = 'execute-pump-five-pairs-strategy';
  console.log(`[${functionName}] Starting 'Pump 5 Pares' strategy execution.`);

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Obtener todas las configuraciones de usuarios para esta estrategia
    const { data: userConfigs, error: configError } = await supabaseAdmin
      .from('user_strategy_configs')
      .select('user_id, usdt_amount, take_profit_percentage')
      .eq('strategy_name', 'pump_five_pairs');

    if (configError) {
      console.error(`[${functionName}] Error fetching user strategy configs:`, configError);
      throw new Error(`Error fetching user strategy configs: ${configError.message}`);
    }

    if (!userConfigs || userConfigs.length === 0) {
      console.log(`[${functionName}] No users configured for 'Pump 5 Pares' strategy. Exiting.`);
      return new Response(JSON.stringify({ message: 'No users configured for strategy.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 2. Obtener los 5 pares USDT con mayor ganancia porcentual en la última 1 hora y volumen > 10M USD
    const ticker24hrUrl = `https://api.binance.com/api/v3/ticker/24hr`;
    const ticker24hrResponse = await fetch(ticker24hrUrl);
    const ticker24hrData = await ticker24hrResponse.json();

    if (!ticker24hrResponse.ok) {
      throw new Error(`Error fetching 24hr ticker data: ${ticker24hrData.msg || 'Unknown error'}`);
    }

    const topGainers = ticker24hrData
      .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 10_000_000) // Volumen > 10M USD
      .sort((a: any, b: any) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 5)
      .map((t: any) => t.symbol);

    console.log(`[${functionName}] Top 5 gainers with >10M volume:`, topGainers);

    if (topGainers.length === 0) {
      console.log(`[${functionName}] No top gainers found meeting criteria. Exiting.`);
      return new Response(JSON.stringify({ message: 'No top gainers found.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const results: { userId: string; asset: string; status: string; message: string }[] = [];

    for (const userConfig of userConfigs) {
      const { user_id, usdt_amount, take_profit_percentage } = userConfig;

      // Obtener las claves de API del usuario
      const { data: keys, error: keysError } = await supabaseAdmin
        .from('api_keys')
        .select('api_key, api_secret')
        .eq('user_id', user_id)
        .single();

      if (keysError || !keys) {
        console.error(`[${functionName}] API keys not found for user ${user_id}. Skipping.`);
        results.push({ userId: user_id, asset: 'N/A', status: 'error', message: 'API keys not found.' });
        continue;
      }
      const { api_key, api_secret } = keys;

      // Verificar saldo USDT antes de cualquier operación
      const timestamp = Date.now();
      const accountQueryString = `timestamp=${timestamp}`;
      const accountSignature = new HmacSha256(api_secret).update(accountQueryString).toString();
      const accountUrl = `https://api.binance.com/api/v3/account?${accountQueryString}&signature=${accountSignature}`;

      const accountResponse = await fetch(accountUrl, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': api_key },
      });
      const accountData = await accountResponse.json();

      if (!accountResponse.ok) {
        const errorMessage = `Error fetching Binance account balance for user ${user_id}: ${accountData.msg || 'Unknown error'}`;
        console.error(`[${functionName}] ${errorMessage}`);
        results.push({ userId: user_id, asset: 'N/A', status: 'error', message: errorMessage });
        continue;
      }

      const usdtBalance = accountData.balances.find((b: any) => b.asset === 'USDT');
      const availableUSDT = usdtBalance ? parseFloat(usdtBalance.free) : 0;

      if (availableUSDT < usdt_amount) {
        const insufficientBalanceMessage = `Insufficient USDT balance for user ${user_id}. Available: ${availableUSDT.toFixed(2)} USDT, Required: ${usdt_amount.toFixed(2)} USDT.`;
        console.warn(`[${functionName}] ${insufficientBalanceMessage}`);
        results.push({ userId: user_id, asset: 'N/A', status: 'skipped', message: insufficientBalanceMessage });
        continue;
      }

      for (const asset of topGainers) {
        try {
          // Check if there's already an active/pending trade for this asset and user
          const { data: existingTrade, error: existingTradeError } = await supabaseAdmin
            .from('signal_trades')
            .select('id, status')
            .eq('user_id', user_id)
            .eq('pair', asset)
            .eq('strategy_type', 'pump_five_pairs')
            .in('status', ['active', 'pending'])
            .single();

          if (existingTradeError && existingTradeError.code !== 'PGRST116') {
            throw new Error(`Error checking existing trade: ${existingTradeError.message}`);
          }

          if (existingTrade) {
            console.log(`[${functionName}] User ${user_id} already has an active/pending 'Pump 5 Pares' trade for ${asset}. Skipping new entry.`);
            results.push({ userId: user_id, asset, status: 'skipped', message: 'Existing active/pending trade.' });
            continue; // Skip to the next asset
          }

          // 3. Obtener klines de 1h y 5m para el análisis
          const klines1hUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1h&limit=100`;
          const klines1hResponse = await fetch(klines1hUrl);
          const klines1hData = await klines1hResponse.json();
          
          const klines5mUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=5m&limit=100`;
          const klines5mResponse = await fetch(klines5mUrl);
          const klines5mData = await klines5mResponse.json();

          if (!klines1hResponse.ok || klines1hData.code || !klines5mResponse.ok || klines5mData.code) {
            const reason = `Error fetching klines data for ${asset}: ${klines1hData.msg || klines5mData.msg || 'Unknown error'}`;
            console.warn(`[${functionName}] ${reason}`);
            await supabaseAdmin
              .from('signal_trades')
              .insert({
                user_id: user_id,
                pair: asset,
                usdt_amount: usdt_amount,
                take_profit_percentage: take_profit_percentage,
                status: 'pending',
                strategy_type: 'pump_five_pairs',
                error_message: reason,
                entry_reason: reason,
              });
            results.push({ userId: user_id, asset, status: 'pending', message: reason });
            continue;
          }

          const closes1h = klines1hData.map((k: any) => parseFloat(k[4]));
          const highs1h = klines1hData.map((k: any) => parseFloat(k[2]));
          const volumes1h = klines1hData.map((k: any) => parseFloat(k[5]));

          const closes5m = klines5mData.map((k: any) => parseFloat(k[4]));
          const opens5m = klines5mData.map((k: any) => parseFloat(k[1]));
          const highs5m = klines5mData.map((k: any) => parseFloat(k[2]));
          const volumes5m = klines5mData.map((k: any) => parseFloat(k[5]));
          const currentPrice = closes5m[closes5m.length - 1];

          if (closes1h.length < 20 || closes5m.length < 20) {
            const reason = `No hay suficientes datos de klines (${closes1h.length}h, ${closes5m.length}m) para el análisis de ${asset}.`;
            console.warn(`[${functionName}] ${reason}`);
            await supabaseAdmin
              .from('signal_trades')
              .insert({
                user_id: user_id,
                pair: asset,
                usdt_amount: usdt_amount,
                take_profit_percentage: take_profit_percentage,
                status: 'pending',
                strategy_type: 'pump_five_pairs',
                error_message: reason,
                entry_reason: reason,
              });
            results.push({ userId: user_id, asset, status: 'pending', message: reason });
            continue;
          }

          // Calcular Indicadores
          const rsi1h = calculateRSI(closes1h, 14);
          const rsi5m = calculateRSI(closes5m, 14);
          const ema20_5m = calculateEMASeries(closes5m, 20).pop() || 0; // Última EMA20 de 5m

          // Detección de ruptura de resistencia (alto de las últimas 2h = 2 * 60min / 5min = 24 velas de 5m)
          const lookbackResistance = 24; // 2 horas en velas de 5m
          const recentHigh = Math.max(...highs5m.slice(-lookbackResistance));
          const isBreakingResistance = currentPrice > recentHigh;

          // Verificación de volumen para validar ruptura (volumen actual > 150% del promedio de 20 velas anteriores)
          const avgVolume5m = calculateSMA(volumes5m, 20);
          const currentVolume5m = volumes5m[volumes5m.length - 1];
          const isVolumeValidated = currentVolume5m > (avgVolume5m * 1.5);

          let signalType: 'BUY' | 'HOLD' = 'HOLD';
          let entryReason = '';

          // Reglas de Entrada
          // Continuación alcista
          if (rsi1h < 80 && isBreakingResistance && isVolumeValidated && currentPrice > ema20_5m) {
            signalType = 'BUY';
            entryReason = 'Continuación alcista: RSI 1h < 80, ruptura de resistencia con volumen validado, precio > EMA20 5m.';
          } else {
            entryReason = `No se cumplen las condiciones de compra: RSI 1h (${rsi1h.toFixed(2)}) ${rsi1h < 80 ? '< 80' : '>= 80'}, Ruptura Resistencia: ${isBreakingResistance}, Volumen Validado: ${isVolumeValidated}, Precio > EMA20 5m: ${currentPrice > ema20_5m.toFixed(4)}.`;
          }

          if (signalType === 'BUY') {
            // Ejecutar la orden de compra en Binance
            const queryString = `symbol=${asset}&side=BUY&type=MARKET&quoteOrderQty=${usdt_amount}&timestamp=${Date.now()}`;
            const signature = new HmacSha256(api_secret).update(queryString).toString();
            const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;
            console.log(`[${functionName}] Sending BUY order for ${asset} with ${usdt_amount} USDT for user ${user_id}.`);

            const response = await fetch(url, {
              method: 'POST',
              headers: { 'X-MBX-APIKEY': api_key },
            });

            const orderResult = await response.json();
            if (!response.ok) {
              console.error(`[${functionName}] Binance BUY order error for ${asset}: ${orderResult.msg || 'Unknown error'}`, orderResult);
              // Registrar el error en la DB
              await supabaseAdmin
                .from('signal_trades')
                .insert({
                  user_id: user_id,
                  pair: asset,
                  usdt_amount: usdt_amount,
                  take_profit_percentage: take_profit_percentage,
                  status: 'error',
                  strategy_type: 'pump_five_pairs',
                  error_message: `Binance API error: ${orderResult.msg || 'Error desconocido'}`,
                  entry_reason: entryReason, // Store the reason for the failed entry
                });
              results.push({ userId: user_id, asset, status: 'error', message: `Binance BUY order failed: ${orderResult.msg || 'Unknown error'}` });
              continue;
            }
            console.log(`[${functionName}] Binance BUY order successful for ${asset}. Order ID: ${orderResult.orderId}`);

            // Calcular precio de compra y precio objetivo
            const executedQty = parseFloat(orderResult.executedQty);
            const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
            const purchasePrice = cummulativeQuoteQty / executedQty;
            const targetPrice = (purchasePrice * (1 + take_profit_percentage / 100)) / (1 - BINANCE_FEE_RATE);

            // Calcular Stop Loss (ejemplo: 1% por debajo del precio de compra)
            const stopLossPrice = purchasePrice * (1 - 0.01); // 1% de riesgo

            // 4. Insertar la operación en la base de datos con estado 'active'
            const { error: insertTradeError } = await supabaseAdmin
              .from('signal_trades')
              .insert({
                user_id: user_id,
                pair: asset,
                usdt_amount: usdt_amount,
                asset_amount: executedQty,
                purchase_price: purchasePrice,
                take_profit_percentage: take_profit_percentage,
                target_price: targetPrice,
                stop_loss_price: stopLossPrice, // Nuevo campo para SL
                status: 'active',
                binance_order_id_buy: orderResult.orderId.toString(),
                strategy_type: 'pump_five_pairs',
                entry_reason: entryReason,
              });

            if (insertTradeError) {
              console.error(`[${functionName}] Error inserting trade into DB:`, insertTradeError);
              throw new Error(`Error al registrar la operación en DB: ${insertTradeError.message}`);
            }
            console.log(`[${functionName}] 'Pump 5 Pares' trade for ${asset} activated for user ${user_id}.`);
            results.push({ userId: user_id, asset, status: 'success', message: 'Trade activated.' });

          } else {
            // If no BUY signal, insert a 'pending' trade to be monitored later
            const { error: insertPendingError } = await supabaseAdmin
              .from('signal_trades')
              .insert({
                user_id: user_id,
                pair: asset,
                usdt_amount: usdt_amount,
                take_profit_percentage: take_profit_percentage,
                status: 'pending', // Set status to pending
                strategy_type: 'pump_five_pairs',
                error_message: entryReason, // Store the reason why it's pending
                entry_reason: entryReason, // Also set entry_reason
              });

            if (insertPendingError) {
              console.error(`[${functionName}] Error inserting pending trade into DB:`, insertPendingError);
              throw new Error(`Error al registrar la operación pendiente en DB: ${insertPendingError.message}`);
            }
            console.log(`[${functionName}] 'Pump 5 Pares' trade for ${asset} set to 'pending' for user ${user_id}. Reason: ${entryReason}`);
            results.push({ userId: user_id, asset, status: 'pending', message: `Awaiting BUY signal: ${entryReason}` });
          }
        } catch (assetError: any) {
          console.error(`[${functionName}] Error processing asset ${asset} for user ${user_id}:`, assetError.message);
          results.push({ userId: user_id, asset, status: 'error', message: assetError.message });
        }
      }
    }

    console.log(`[${functionName}] 'Pump 5 Pares' strategy execution cycle completed.`);
    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error(`[${functionName}] Unhandled error in ${functionName} Edge Function:`, error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});