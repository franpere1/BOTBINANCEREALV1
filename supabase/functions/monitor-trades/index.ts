import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

// Inlined from _utils/binance-helpers.ts
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

  const functionName = 'monitor-trades';

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`[${functionName}] Starting monitoring cycle.`);

    // 1. Obtener todas las operaciones activas (manuales y de señales) y las estratégicas pendientes
    const { data: manualTrades, error: manualTradesError } = await supabaseAdmin
      .from('manual_trades')
      .select('id, user_id, pair, usdt_amount, asset_amount, purchase_price, take_profit_percentage, target_price, status, strategy_type, dip_percentage, lookback_minutes')
      .in('status', ['active', 'awaiting_dip_signal']); // Incluir el nuevo estado

    if (manualTradesError) {
      console.error(`[${functionName}] Error fetching active/awaiting manual trades:`, manualTradesError);
      return new Response(JSON.stringify({ error: 'Error fetching active/awaiting manual trades' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Obtener todas las operaciones de señales activas Y las que están esperando señal de compra
    const { data: signalTrades, error: signalTradesError } = await supabaseAdmin
      .from('signal_trades')
      .select('id, user_id, pair, usdt_amount, asset_amount, purchase_price, take_profit_percentage, target_price, status, strategy_type, stop_loss_price') // Añadir strategy_type y stop_loss_price
      .in('status', ['active', 'paused', 'awaiting_buy_signal', 'pending']); // Incluir 'pending' para Pump 5 Pares

    if (signalTradesError) {
      console.error(`[${functionName}] Error fetching active/awaiting signal trades:`, signalTradesError);
      return new Response(JSON.stringify({ error: 'Error fetching active/awaiting signal trades' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const allTrades = [...(manualTrades || []), ...(signalTrades || [])];

    if (!allTrades || allTrades.length === 0) {
      console.log(`[${functionName}] No active or awaiting trades to monitor. Exiting.`);
      return new Response(JSON.stringify({ message: 'No active or awaiting trades to monitor.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[${functionName}] Monitoring ${allTrades.length} active/awaiting trades.`);

    for (const trade of allTrades) {
      console.log(`[${functionName}] Processing trade ${trade.id} (${trade.pair}), current status: ${trade.status}, strategy: ${(trade as any).strategy_type || 'N/A'}`);
      try {
        const tableName = (trade as any).strategy_type ? 'manual_trades' : (manualTrades?.some(t => t.id === trade.id) ? 'manual_trades' : 'signal_trades');
        const tradeStrategyType = (trade as any).strategy_type || 'ml_signal'; // Default para signal_trades antiguas

        // Obtener las claves de API del usuario para esta operación
        const { data: keys, error: keysError } = await supabaseAdmin
          .from('api_keys')
          .select('api_key, api_secret')
          .eq('user_id', trade.user_id)
          .single();

        if (keysError || !keys) {
          console.error(`[${functionName}] API keys not found for user ${trade.user_id} for trade ${trade.id}. Skipping.`);
          await supabaseAdmin
            .from(tableName)
            .update({ status: 'error', error_message: 'API keys not found or invalid.' })
            .eq('id', trade.id);
          continue;
        }

        const { api_key, api_secret } = keys;

        // --- INICIO: Verificación de saldo USDT antes de cualquier compra ---
        if (trade.status === 'awaiting_dip_signal' || trade.status === 'awaiting_buy_signal' || trade.status === 'pending') {
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
            const errorMessage = `Error al obtener el balance de la cuenta de Binance para el usuario ${trade.user_id}: ${accountData.msg || 'Error desconocido'}`;
            console.error(`[${functionName}] ${errorMessage}`);
            await supabaseAdmin
              .from(tableName)
              .update({ status: 'error', error_message: errorMessage })
              .eq('id', trade.id);
            continue; // Saltar a la siguiente operación
          }

          const usdtBalance = accountData.balances.find((b: any) => b.asset === 'USDT');
          const availableUSDT = usdtBalance ? parseFloat(usdtBalance.free) : 0;

          if (availableUSDT < trade.usdt_amount) {
            const insufficientBalanceMessage = `Saldo insuficiente de USDT. Disponible: ${availableUSDT.toFixed(2)} USDT, Requerido: ${trade.usdt_amount.toFixed(2)} USDT.`;
            console.warn(`[${functionName}] ${insufficientBalanceMessage}`);
            await supabaseAdmin
              .from(tableName)
              .update({ error_message: insufficientBalanceMessage }) // Actualizar solo el mensaje de error, mantener el estado de espera
              .eq('id', trade.id);
            continue; // Saltar a la siguiente operación
          }
        }
        // --- FIN: Verificación de saldo USDT ---


        if (trade.status === 'awaiting_dip_signal') {
          // Lógica para operaciones estratégicas esperando un dip
          console.log(`[${functionName}] Strategic trade ${trade.id} (${trade.pair}) is awaiting DIP signal.`);

          const { data: minutePrices, error: pricesError } = await supabaseAdmin
            .from('minute_prices')
            .select('close_price, created_at')
            .eq('asset', trade.pair)
            .order('created_at', { ascending: false })
            .limit(trade.lookback_minutes || 15); // Usar lookback_minutes del trade o un default

          if (pricesError) {
            console.error(`[${functionName}] Error fetching minute prices for strategic trade ${trade.id}:`, pricesError);
            await supabaseAdmin
              .from(tableName)
              .update({ error_message: `Error al obtener precios por minuto: ${pricesError.message}` })
              .eq('id', trade.id);
            continue;
          }

          let dipSignal = false;
          let dipReason = '';
          let currentPrice = 0;

          if (!minutePrices || minutePrices.length < (trade.lookback_minutes || 15)) {
            dipReason = `No hay suficientes datos de precios por minuto (${minutePrices?.length || 0}/${trade.lookback_minutes || 15}) para ${trade.pair}.`;
            console.warn(`[${functionName}] ${dipReason}`);
          } else {
            const prices = minutePrices.map(p => p.close_price);
            currentPrice = prices[0]; // El precio más reciente
            const highPriceInLookback = Math.max(...prices);

            const requiredDip = highPriceInLookback * ((trade.dip_percentage || 0.5) / 100);
            const priceDrop = highPriceInLookback - currentPrice;

            if (priceDrop >= requiredDip) {
              if (prices.length > 1 && currentPrice > prices[1]) {
                dipSignal = true;
                dipReason = `Dip del ${trade.dip_percentage}% detectado y rebote confirmado.`;
              } else {
                dipSignal = true;
                dipReason = `Dip del ${trade.dip_percentage}% detectado.`;
              }
            } else {
              dipReason = `No se detectó un dip suficiente. Caída actual: ${((priceDrop / highPriceInLookback) * 100).toFixed(2)}% (requerido: ${trade.dip_percentage}%)`;
            }
          }

          if (dipSignal) {
            console.log(`[${functionName}] DIP signal detected for strategic trade ${trade.id} (${trade.pair}). Initiating buy order.`);

            // Obtener información de intercambio para precisión y límites
            const exchangeInfoUrl = `https://api.binance.com/api/v3/exchangeInfo?symbol=${trade.pair}`;
            const exchangeInfoResponse = await fetch(exchangeInfoUrl);
            const exchangeInfoData = await exchangeInfoResponse.json();

            if (!exchangeInfoResponse.ok || exchangeInfoData.code) {
              throw new Error(`Error al obtener información de intercambio: ${exchangeInfoData.msg || 'Error desconocido'}`);
            }

            const symbolInfo = exchangeInfoData.symbols.find((s: any) => s.symbol === trade.pair);
            if (!symbolInfo) {
              throw new Error(`Información de intercambio no encontrada para el símbolo ${trade.pair}`);
            }

            // Ejecutar la orden de compra en Binance
            let queryString = `symbol=${trade.pair}&side=BUY&type=MARKET&quoteOrderQty=${trade.usdt_amount}&timestamp=${Date.now()}`;
            const signature = new HmacSha256(api_secret).update(queryString).toString();
            const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;
            console.log(`[${functionName}] Sending BUY order for strategic trade ${trade.id} (${trade.pair}) with ${trade.usdt_amount} USDT.`);

            const response = await fetch(url, {
              method: 'POST',
              headers: { 'X-MBX-APIKEY': api_key },
            });

            const orderResult = await response.json();
            if (!response.ok) {
              console.error(`[${functionName}] Binance BUY order error for strategic trade ${trade.id} (${trade.pair}): ${orderResult.msg || 'Unknown error'}`, orderResult);
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `Error de Binance al comprar: ${orderResult.msg || 'Error desconocido'}` })
                .eq('id', trade.id);
              continue;
            }
            console.log(`[${functionName}] Binance BUY order successful for strategic trade ${trade.id} (${trade.pair}). Order ID: ${orderResult.orderId}`);

            // Calcular precio de compra y precio objetivo
            const executedQty = parseFloat(orderResult.executedQty);
            const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
            const purchasePrice = cummulativeQuoteQty / executedQty;
            const targetPrice = (purchasePrice * (1 + trade.take_profit_percentage / 100)) / (1 - BINANCE_FEE_RATE);

            // Actualizar la operación en la DB a 'active'
            const { error: updateToActiveError } = await supabaseAdmin
              .from(tableName)
              .update({
                status: 'active',
                asset_amount: executedQty,
                purchase_price: purchasePrice,
                target_price: targetPrice,
                binance_order_id_buy: orderResult.orderId.toString(),
                error_message: null, // Limpiar el mensaje de error
                created_at: new Date().toISOString(), // Set creation time when it becomes active
              })
              .eq('id', trade.id);

            if (updateToActiveError) {
              console.error(`[${functionName}] Error updating strategic trade ${trade.id} to 'active' status:`, updateToActiveError);
              throw new Error(`Error al actualizar la operación estratégica a activa en DB: ${updateToActiveError.message}`);
            }
            console.log(`[${functionName}] Strategic trade ${trade.id} activated and buy order placed successfully.`);

          } else {
            // Si no hay señal, actualizar el mensaje de error en la DB
            const finalReason = `No se ejecutó la compra. Razón del dip: ${dipReason}.`;
            await supabaseAdmin
              .from(tableName)
              .update({ error_message: finalReason })
              .eq('id', trade.id);
            console.log(`[${functionName}] Strategic trade ${trade.id} still awaiting DIP signal. Reason: ${finalReason}`);
          }

        } else if (trade.status === 'awaiting_buy_signal' || (trade.status === 'pending' && tradeStrategyType === 'pump_five_pairs')) {
          // Lógica para operaciones esperando señal de compra (ML Signals y Pump 5 Pares)
          console.log(`[${functionName}] Trade ${trade.id} (${trade.pair}) is awaiting BUY signal for strategy ${tradeStrategyType}.`);
          
          let signalType: 'BUY' | 'HOLD' = 'HOLD';
          let entryReason = '';
          let currentPrice = 0;
          let stopLossPrice: number | null = null;

          if (tradeStrategyType === 'ml_signal') {
            // Invocar la función get-ml-signals para obtener la señal
            const { data: mlSignalData, error: mlSignalError } = await supabaseAdmin.functions.invoke('get-ml-signals', {
              body: { asset: trade.pair },
            });

            if (mlSignalError) {
              console.error(`[${functionName}] Error invoking get-ml-signals for ${trade.pair}:`, mlSignalError);
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `Error al obtener señal de ML: ${mlSignalError.message}` })
                .eq('id', trade.id);
              continue;
            }
            
            const mlSignal = mlSignalData[0]; // get-ml-signals devuelve un array, tomamos el primero
            currentPrice = mlSignal.price;

            if (mlSignal.signal === 'BUY' && mlSignal.confidence >= 70) {
              signalType = 'BUY';
              entryReason = `Señal de COMPRA de ML detectada con ${mlSignal.confidence.toFixed(1)}% de confianza.`;
              stopLossPrice = currentPrice * (1 - 0.01); // 1% de riesgo para ML signals
            } else {
              entryReason = `No hay señal de COMPRA de ML (>=70% confianza). Señal actual: ${mlSignal.signal}, Confianza: ${mlSignal.confidence.toFixed(1)}%.`;
            }

          } else if (tradeStrategyType === 'pump_five_pairs') {
            // Re-evaluar las condiciones de entrada para 'Pump 5 Pares'
            const klines1hUrl = `https://api.binance.com/api/v3/klines?symbol=${trade.pair}&interval=1h&limit=100`;
            const klines1hResponse = await fetch(klines1hUrl);
            const klines1hData = await klines1hResponse.json();
            if (!klines1hResponse.ok || klines1hData.code) {
              throw new Error(`Error fetching 1h klines for ${trade.pair}: ${klines1hData.msg || 'Unknown error'}`);
            }
            const closes1h = klines1hData.map((k: any) => parseFloat(k[4]));
            const highs1h = klines1hData.map((k: any) => parseFloat(k[2]));
            const volumes1h = klines1hData.map((k: any) => parseFloat(k[5]));

            const klines5mUrl = `https://api.binance.com/api/v3/klines?symbol=${trade.pair}&interval=5m&limit=100`;
            const klines5mResponse = await fetch(klines5mUrl);
            const klines5mData = await klines5mResponse.json();
            if (!klines5mResponse.ok || klines5mData.code) {
              throw new Error(`Error fetching 5m klines for ${trade.pair}: ${klines5mData.msg || 'Unknown error'}`);
            }
            const closes5m = klines5mData.map((k: any) => parseFloat(k[4]));
            const opens5m = klines5mData.map((k: any) => parseFloat(k[1]));
            const highs5m = klines5mData.map((k: any) => parseFloat(k[2]));
            const volumes5m = klines5mData.map((k: any) => parseFloat(k[5]));
            currentPrice = closes5m[closes5m.length - 1];

            if (closes1h.length < 20 || closes5m.length < 20) {
              entryReason = 'No hay suficientes datos de klines para el análisis.';
            } else {
              const rsi1h = calculateRSI(closes1h, 14);
              const rsi5m = calculateRSI(closes5m, 14);
              const ema20_5m = calculateEMASeries(closes5m, 20).pop() || 0;

              const lookbackResistance = 24; // 2 horas en velas de 5m
              const recentHigh = Math.max(...highs5m.slice(-lookbackResistance));
              const isBreakingResistance = currentPrice > recentHigh;

              const avgVolume5m = calculateSMA(volumes5m, 20);
              const currentVolume5m = volumes5m[volumes5m.length - 1];
              const isVolumeValidated = currentVolume5m > (avgVolume5m * 1.5);

              if (rsi1h < 80 && isBreakingResistance && isVolumeValidated && currentPrice > ema20_5m) {
                signalType = 'BUY';
                entryReason = 'Continuación alcista: RSI 1h < 80, ruptura de resistencia con volumen validado, precio > EMA20 5m.';
                stopLossPrice = currentPrice * (1 - 0.01); // 1% de riesgo para Pump 5 Pares
              } else {
                entryReason = `No se cumplen las condiciones de compra: RSI 1h (${rsi1h.toFixed(2)}) ${rsi1h < 80 ? '< 80' : '>= 80'}, Ruptura Resistencia: ${isBreakingResistance}, Volumen Validado: ${isVolumeValidated}, Precio > EMA20 5m: ${currentPrice > ema20_5m}.`;
              }
            }
          }

          if (signalType === 'BUY') {
            console.log(`[${functionName}] BUY signal detected for ${trade.pair} for strategy ${tradeStrategyType}. Initiating buy order.`);

            // Obtener información de intercambio para precisión y límites
            const exchangeInfoUrl = `https://api.binance.com/api/v3/exchangeInfo?symbol=${trade.pair}`;
            const exchangeInfoResponse = await fetch(exchangeInfoUrl);
            const exchangeInfoData = await exchangeInfoResponse.json();

            if (!exchangeInfoResponse.ok || exchangeInfoData.code) {
              throw new Error(`Error al obtener información de intercambio: ${exchangeInfoData.msg || 'Error desconocido'}`);
            }

            const symbolInfo = exchangeInfoData.symbols.find((s: any) => s.symbol === trade.pair);
            if (!symbolInfo) {
              throw new Error(`Información de intercambio no encontrada para el símbolo ${trade.pair}`);
            }

            // Ejecutar la orden de compra en Binance
            let queryString = `symbol=${trade.pair}&side=BUY&type=MARKET&quoteOrderQty=${trade.usdt_amount}&timestamp=${Date.now()}`;
            const signature = new HmacSha256(api_secret).update(queryString).toString();
            const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;
            console.log(`[${functionName}] Sending BUY order for ${trade.pair} with ${trade.usdt_amount} USDT.`);

            const response = await fetch(url, {
              method: 'POST',
              headers: { 'X-MBX-APIKEY': api_key },
            });

            const orderResult = await response.json();
            if (!response.ok) {
              console.error(`[${functionName}] Binance BUY order error for ${trade.pair}: ${orderResult.msg || 'Unknown error'}`, orderResult);
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `Error de Binance al comprar: ${orderResult.msg || 'Error desconocido'}`, entry_reason: entryReason })
                .eq('id', trade.id);
              continue;
            }
            console.log(`[${functionName}] Binance BUY order successful for ${trade.pair}. Order ID: ${orderResult.orderId}`);

            // Calcular precio de compra y precio objetivo
            const executedQty = parseFloat(orderResult.executedQty);
            const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
            const purchasePrice = cummulativeQuoteQty / executedQty;
            const targetPrice = (purchasePrice * (1 + trade.take_profit_percentage / 100)) / (1 - BINANCE_FEE_RATE);

            // Actualizar la operación en la DB a 'active'
            const { error: updateToActiveError } = await supabaseAdmin
              .from(tableName)
              .update({
                status: 'active',
                asset_amount: executedQty,
                purchase_price: purchasePrice,
                target_price: targetPrice,
                stop_loss_price: stopLossPrice, // Set SL here
                binance_order_id_buy: orderResult.orderId.toString(),
                created_at: new Date().toISOString(), // Set creation time when it becomes active
                error_message: null, // Clear any previous error message
                entry_reason: entryReason, // Store the reason for successful entry
              })
              .eq('id', trade.id);

            if (updateToActiveError) {
              console.error(`[${functionName}] Error updating trade ${trade.id} to 'active' status:`, updateToActiveError);
              throw new Error(`Error al actualizar la operación a activa en DB: ${updateToActiveError.message}`);
            }
            console.log(`[${functionName}] Trade ${trade.id} activated and buy order placed successfully.`);

          } else {
            console.log(`[${functionName}] No BUY signal for ${trade.pair} for strategy ${tradeStrategyType}. Current reason: ${entryReason}. Continuing to await.`);
            // Update the entry_reason in the DB if it changed
            await supabaseAdmin
              .from(tableName)
              .update({ entry_reason: entryReason })
              .eq('id', trade.id);
          }

        } else if (trade.status === 'active') {
          // Lógica existente para operaciones activas (monitorear precio objetivo y vender)
          const tickerUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${trade.pair}`;
          const tickerResponse = await fetch(tickerUrl);
          const tickerData = await tickerResponse.json();

          if (!tickerResponse.ok) {
            console.error(`[${functionName}] Error fetching ticker price for ${trade.pair}: ${tickerData.msg || 'Unknown error'}`, tickerData);
            throw new Error(tickerData.msg || `Error fetching ticker price for ${trade.pair}`);
          }
          const currentPrice = parseFloat(tickerData.price);

          console.log(`[${functionName}] Trade ${trade.id} (${trade.pair}): Current Price = ${currentPrice}, Target Price = ${trade.target_price}, Stop Loss Price = ${(trade as any).stop_loss_price}`);

          // Verificar si se alcanzó el Take Profit o el Stop Loss
          const targetReached = currentPrice >= trade.target_price;
          const stopLossReached = (trade as any).stop_loss_price && currentPrice <= (trade as any).stop_loss_price;

          if (targetReached || stopLossReached) {
            console.log(`[${functionName}] ${targetReached ? 'Target price reached' : 'Stop loss reached'} for trade ${trade.id}. Executing sell order.`);

            // Obtener información de intercambio para precisión y límites
            const exchangeInfoUrl = `https://api.binance.com/api/v3/exchangeInfo?symbol=${trade.pair}`;
            const exchangeInfoResponse = await fetch(exchangeInfoUrl);
            const exchangeInfoData = await exchangeInfoResponse.json();

            if (!exchangeInfoResponse.ok || exchangeInfoData.code) {
              throw new Error(`Error al obtener información de intercambio: ${exchangeInfoData.msg || 'Error desconocido'}`);
            }

            const symbolInfo = exchangeInfoData.symbols.find((s: any) => s.symbol === trade.pair);
            if (!symbolInfo) {
              throw new Error(`Información de intercambio no encontrada para el símbolo ${trade.pair}`);
            }

            const quantityFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
            if (!quantityFilter) {
              throw new Error(`Filtro LOT_SIZE no encontrado para el símbolo ${trade.pair}.`);
            }
            const minNotionalFilter = symbolInfo.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
            const minNotional = minNotionalFilter ? parseFloat(minNotionalFilter.minNotional) : 0;
            const stepSize = parseFloat(quantityFilter.stepSize);
            const minQty = parseFloat(quantityFilter.minQty);

            // Obtener el balance actual del activo para vender
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
              console.error(`[${functionName}] Error fetching Binance account balance for user ${trade.user_id}: ${accountData.msg || 'Unknown error'}`, accountData);
              throw new Error(`Error al obtener el balance de la cuenta de Binance: ${accountData.msg || 'Error desconocido'}`);
            }

            const baseAsset = trade.pair.replace('USDT', '');
            const assetBalance = accountData.balances.find((b: any) => b.asset === baseAsset);
            
            // Determine the actual quantity to attempt to sell
            let quantityToSell = 0;
            const actualFreeBalance = assetBalance ? parseFloat(assetBalance.free) : 0;

            if (actualFreeBalance > 0) {
                // Prioritize selling what's actually available on Binance, capped by what the trade thinks it bought
                quantityToSell = Math.min(trade.asset_amount || actualFreeBalance, actualFreeBalance);
            }

            let binanceSellAttemptedInMonitor = false;
            let binanceErrorMessageInMonitor: string | null = null;
            let shouldAttemptBinanceSellInMonitor = true;
            let binanceSellOrderId: string | null = null;
            let adjustedQuantityInMonitor = 0; // Declarar aquí para que esté disponible en el scope
            let actualSellPriceInMonitor: number | null = null; // Nuevo: para almacenar el precio de venta

            if (quantityToSell === 0) {
              binanceErrorMessageInMonitor = `No hay saldo disponible de ${baseAsset} para vender o la cantidad es demasiado pequeña para ${trade.pair}.`;
              console.warn(`[${functionName}] ${binanceErrorMessageInMonitor}`);
              shouldAttemptBinanceSellInMonitor = false;
            } else {
              adjustedQuantityInMonitor = adjustQuantity(quantityToSell, stepSize); // Asignar a la variable declarada
              console.log(`[${functionName}] Calculated quantity to sell for ${trade.pair}: ${quantityToSell}, Adjusted: ${adjustedQuantityInMonitor}`);

              if (adjustedQuantityInMonitor < minQty) {
                binanceErrorMessageInMonitor = `La cantidad ajustada (${adjustedQuantityInMonitor}) es menor que la cantidad mínima (${minQty}) para ${trade.pair}. No se realizará la venta.`;
                console.warn(`[${functionName}] ${binanceErrorMessageInMonitor}`);
                shouldAttemptBinanceSellInMonitor = false;
              } else {
                const notionalValue = adjustedQuantityInMonitor * currentPrice;
                if (notionalValue < minNotional) {
                  binanceErrorMessageInMonitor = `El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${trade.pair}. No se realizará la venta.`;
                  console.warn(`[${functionName}] ${binanceErrorMessageInMonitor}`);
                  shouldAttemptBinanceSellInMonitor = false;
                }
              }
            }

            if (shouldAttemptBinanceSellInMonitor) {
              binanceSellAttemptedInMonitor = true;
              const sellQueryString = `symbol=${trade.pair}&side=SELL&type=MARKET&quantity=${adjustedQuantityInMonitor}&timestamp=${Date.now()}`;
              const sellSignature = new HmacSha256(api_secret).update(sellQueryString).toString();
              const orderUrl = `https://api.binance.com/api/v3/order?${sellQueryString}&signature=${sellSignature}`;
              console.log(`[${functionName}] Sending SELL order for ${trade.pair} with quantity ${adjustedQuantityInMonitor}.`);

              const orderResponse = await fetch(orderUrl, {
                method: 'POST',
                headers: { 'X-MBX-APIKEY': api_key },
              });

              const orderData = await orderResponse.json();

              if (!orderResponse.ok) {
                console.error(`[${functionName}] Binance SELL order error for ${trade.pair}: ${orderData.msg || 'Unknown error'}`, orderData);
                binanceErrorMessageInMonitor = `Binance sell order error: ${orderData.msg || 'Unknown error'}`;
              } else {
                console.log(`[${functionName}] Binance SELL order successful for ${trade.pair}. Order ID: ${orderData.orderId}`);
                binanceSellOrderId = orderData.orderId.toString();
                // Calcular el precio de venta promedio de los 'fills'
                if (orderData.fills && orderData.fills.length > 0) {
                    let totalQuoteQty = 0;
                    let totalBaseQty = 0;
                    for (const fill of orderData.fills) {
                        totalQuoteQty += parseFloat(fill.price) * parseFloat(fill.qty);
                        totalBaseQty += parseFloat(fill.qty);
                    }
                    if (totalBaseQty > 0) {
                        actualSellPriceInMonitor = totalQuoteQty / totalBaseQty;
                    }
                }
              }
            } else {
              console.log(`[${functionName}] Skipping Binance sell order for trade ${trade.id} due to validation failure or no assets to sell.`);
            }

            // Calcular profit_loss_usdt si la operación se completó y tenemos los precios
            console.log(`[${functionName}] Debugging PnL calculation for trade ${trade.id}:`);
            console.log(`[${functionName}]   actualSellPriceInMonitor: ${actualSellPriceInMonitor}`);
            console.log(`[${functionName}]   trade.purchase_price: ${trade.purchase_price}`);
            console.log(`[${functionName}]   trade.asset_amount: ${trade.asset_amount}`);

            let profitLossUsdtInMonitor: number | null = null;
            if (actualSellPriceInMonitor !== null && trade.purchase_price !== null && trade.asset_amount !== null) {
              profitLossUsdtInMonitor = (actualSellPriceInMonitor - trade.purchase_price) * trade.asset_amount;
              console.log(`[${functionName}] Calculated Profit/Loss for trade ${trade.id}: ${profitLossUsdtInMonitor.toFixed(2)} USDT`);
            } else if (trade.status === 'error' && trade.usdt_amount !== null) {
              if (trade.purchase_price && trade.asset_amount) {
                profitLossUsdtInMonitor = -(trade.purchase_price * trade.asset_amount);
              } else {
                profitLossUsdtInMonitor = -trade.usdt_amount;
              }
              console.log(`[${functionName}] Estimated Loss for failed trade ${trade.id}: ${profitLossUsdtInMonitor.toFixed(2)} USDT`);
            } else {
              profitLossUsdtInMonitor = null;
              console.log(`[${functionName}] Profit/Loss for trade ${trade.id} set to NULL due to missing data.`);
            }

            // Si la operación es manual, se marca como completada y no se reinicia.
            // Si es de señal, se reinicia para el siguiente ciclo de monitoreo.
            if (tableName === 'manual_trades') {
              const { error: updateManualError } = await supabaseAdmin
                .from(tableName)
                .update({
                  status: 'completed',
                  binance_order_id_sell: binanceSellOrderId,
                  completed_at: new Date().toISOString(),
                  error_message: binanceErrorMessageInMonitor, // Almacenar el error si lo hubo
                  sell_price: actualSellPriceInMonitor, // Nuevo: Guardar el precio de venta
                  profit_loss_usdt: profitLossUsdtInMonitor, // Guardar la ganancia/pérdida en USDT
                })
                .eq('id', trade.id);
              if (updateManualError) {
                console.error(`[${functionName}] Error updating manual trade ${trade.id} to 'completed' status:`, updateManualError);
                throw new Error(`Error al actualizar la operación manual a completada en DB: ${updateManualError.message}`);
              }
              console.log(`[${functionName}] Manual trade ${trade.id} completed successfully.`);
            } else { // tableName === 'signal_trades'
              const updatePayload: any = {
                binance_order_id_sell: binanceSellOrderId,
                completed_at: new Date().toISOString(), // Mantener el registro de cuándo se completó el ciclo
                error_message: binanceErrorMessageInMonitor, // Almacenar el error si lo hubo
                sell_price: actualSellPriceInMonitor, // Nuevo: Guardar el precio de venta
                profit_loss_usdt: profitLossUsdtInMonitor, // Guardar la ganancia/pérdida en USDT
              };

              if (tradeStrategyType === 'pump_five_pairs') {
                // Para 'Pump 5 Pares', la operación se considera completada y no se reinicia automáticamente.
                // La estrategia buscará nuevas entradas en el siguiente ciclo horario.
                updatePayload.status = 'completed';
                console.log(`[${functionName}] 'Pump 5 Pares' trade ${trade.id} completed.`);
              } else { // Default para 'ml_signal'
                updatePayload.status = 'awaiting_buy_signal'; // Reiniciar para monitoreo recurrente
                updatePayload.asset_amount = null;
                updatePayload.purchase_price = null;
                updatePayload.target_price = null;
                updatePayload.binance_order_id_buy = null;
                updatePayload.stop_loss_price = null; // Limpiar SL al reiniciar
                updatePayload.entry_reason = null; // Limpiar razón de entrada
                // created_at se mantiene para saber cuándo se inició el monitoreo original
                console.log(`[${functionName}] Signal trade ${trade.id} completed and reset to 'awaiting_buy_signal' for recurrence.`);
              }

              const { error: updateSignalError } = await supabaseAdmin
                .from(tableName)
                .update(updatePayload)
                .eq('id', trade.id);
              if (updateSignalError) {
                console.error(`[${functionName}] Error updating signal trade ${trade.id} status:`, updateSignalError);
                throw new Error(`Error al actualizar la operación de señal en DB: ${updateSignalError.message}`);
              }
            }
          }
        }
      } catch (tradeError: any) {
        console.error(`[${functionName}] Error processing trade ${trade.id}:`, tradeError);
        const tableName = (trade as any).strategy_type ? 'manual_trades' : (manualTrades?.some(t => t.id === trade.id) ? 'manual_trades' : 'signal_trades');
        await supabaseAdmin
          .from(tableName)
          .update({ status: 'error', error_message: tradeError.message })
          .eq('id', trade.id);
        console.log(`[${functionName}] Trade ${trade.id} status updated to 'error'.`);
      }
    }

    console.log(`[${functionName}] Monitoring cycle completed.`);
    return new Response(JSON.stringify({ message: 'Trade monitoring completed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error(`[${functionName}] Unhandled error in ${functionName} Edge Function:`, error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});