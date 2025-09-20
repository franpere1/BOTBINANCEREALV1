import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

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

// Helper function to calculate Standard Deviation
function calculateStdDev(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  const mean = slice.reduce((sum, val) => sum + val, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  return Math.sqrt(variance);
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

// Function to get ML signal for a single asset using Binance API
async function getMlSignalForAssetFromBinance(asset: string) {
  // 1. Obtener el precio actual del ticker
  const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${asset}`;
  const tickerResponse = await fetch(tickerPriceUrl);
  const tickerData = await tickerResponse.json();
  if (!tickerResponse.ok || tickerData.code) {
    throw new Error(`Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`);
  }
  const currentPrice = parseFloat(tickerData.price);

  // 2. Obtener las velas históricas de 1 hora de la API de Binance
  const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1h&limit=100`;
  const klinesResponse = await fetch(klinesUrl);
  const klinesData = await klinesResponse.json();

  if (!klinesResponse.ok || klinesData.code) {
    console.error(`Error fetching 1h klines for ${asset} from Binance API:`, klinesData);
    throw new Error(`Error fetching 1h klines for ${asset}: ${klinesData.msg || 'Unknown error'}`);
  }
  const closes = klinesData.map((k: any) => parseFloat(k[4])); // Close price is at index 4

  if (closes.length < 50) { // Necesitamos al menos 50 velas para MA50
    console.warn(`Not enough 1h klines data for ${asset} from Binance API. Skipping indicator calculations.`);
    return { asset, signal: 'HOLD', confidence: 0, price: currentPrice };
  }

  // Calcular Indicadores
  const ma20 = calculateSMA(closes, 20);
  const ma50 = calculateSMA(closes, 50);
  const rsi = calculateRSI(closes, 14);

  const ema12Series = calculateEMASeries(closes, 12);
  const ema26Series = calculateEMASeries(closes, 26);
  const macdLineData = ema12Series.slice(ema12Series.length - ema26Series.length).map((e12, i) => e12 - ema26Series[i]);
  const macdSignalLineSeries = calculateEMASeries(macdLineData, 9);

  const macd = macdLineData.length > 0 ? macdLineData[macdLineData.length - 1] : 0;
  const macdSignal = macdSignalLineSeries.length > 0 ? macdSignalLineSeries[macdSignalLineSeries.length - 1] : 0;
  const histMacd = macd - macdSignal;

  const bbPeriod = 20;
  const bbMiddleBand = calculateSMA(closes, bbPeriod);
  const stdDev = calculateStdDev(closes, bbPeriod);
  const upperBand = bbMiddleBand + (stdDev * 2);
  const lowerBand = bbMiddleBand - (stdDev * 2);

  const volatility = (stdDev / currentPrice) * 100;

  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let rawScore = 0;

  if (rsi < 30) rawScore += 30;
  else if (rsi < 40) rawScore += 15;
  else if (rsi > 70) rawScore -= 30;
  else if (rsi > 60) rawScore -= 15;

  if (macd > macdSignal && histMacd > 0) rawScore += 25;
  else if (macd < macdSignal && histMacd < 0) rawScore -= 25;

  if (currentPrice > ma20) rawScore += 20;
  else if (currentPrice < ma20) rawScore -= 20;

  if (currentPrice > ma50) rawScore += 15;
  else if (currentPrice < ma50) rawScore -= 15;

  if (currentPrice < lowerBand) rawScore += 10;
  else if (currentPrice > upperBand) rawScore -= 10;

  if (rawScore >= 20) {
    signal = 'BUY';
  } else if (rawScore <= -20) {
    signal = 'SELL';
  } else {
    confidence = 50 + (rawScore / 20) * 10;
  }

  if (signal === 'BUY') {
    confidence = 50 + Math.max(0, (rawScore - 20) / 80) * 50;
  } else if (signal === 'SELL') {
    confidence = 49.9 - Math.max(0, (Math.abs(rawScore) - 20) / 80) * 49.9;
  } else {
    confidence = 50 + (rawScore / 20) * 10;
  }
  confidence = Math.max(0, Math.min(100, confidence));

  return { asset, signal, confidence, price: currentPrice };
}


// Helper para ajustar la cantidad a la precisión del stepSize de Binance
const adjustQuantity = (qty: number, step: number) => {
  // Calculate the number of decimal places from stepSize
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  
  // Divide by step, floor, then multiply by step to get a quantity that is a multiple of stepSize
  const adjusted = Math.floor(qty / step) * step;
  
  // Format to the correct precision to avoid floating point inaccuracies
  return parseFloat(adjusted.toFixed(precision));
};

// Tasa de comisión de Binance (0.1%)
const BINANCE_FEE_RATE = 0.001;


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

    // 1. Obtener todas las operaciones activas (manuales y de señales)
    const { data: manualTrades, error: manualTradesError } = await supabaseAdmin
      .from('manual_trades')
      .select('id, user_id, pair, asset_amount, purchase_price, target_price')
      .eq('status', 'active');

    if (manualTradesError) {
      console.error(`[${functionName}] Error fetching active manual trades:`, manualTradesError);
      return new Response(JSON.stringify({ error: 'Error fetching active manual trades' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Obtener todas las operaciones de señales activas Y las que están esperando señal de compra
    const { data: signalTrades, error: signalTradesError } = await supabaseAdmin
      .from('signal_trades')
      .select('id, user_id, pair, usdt_amount, asset_amount, purchase_price, take_profit_percentage, target_price, status')
      .in('status', ['active', 'paused', 'awaiting_buy_signal']); // Incluir el nuevo estado

    if (signalTradesError) {
      console.error(`[${functionName}] Error fetching active/awaiting signal trades:`, signalTradesError);
      return new Response(JSON.stringify({ error: 'Error fetching active/awaiting signal trades' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const allActiveTrades = [...(manualTrades || []), ...(signalTrades || [])];

    if (!allActiveTrades || allActiveTrades.length === 0) {
      console.log(`[${functionName}] No active or awaiting trades to monitor. Exiting.`);
      return new Response(JSON.stringify({ message: 'No active or awaiting trades to monitor.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[${functionName}] Monitoring ${allActiveTrades.length} active/awaiting trades.`);

    for (const trade of allActiveTrades) {
      console.log(`[${functionName}] Processing trade ${trade.id} (${trade.pair}), current status: ${trade.status}`);
      try {
        const tableName = manualTrades?.some(t => t.id === trade.id) ? 'manual_trades' : 'signal_trades';

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

        if (trade.status === 'awaiting_buy_signal') {
          // Lógica para operaciones esperando señal de compra
          console.log(`[${functionName}] Trade ${trade.id} (${trade.pair}) is awaiting BUY signal.`);
          // Usar la función actualizada que obtiene datos de la API de Binance
          const mlSignal = await getMlSignalForAssetFromBinance(trade.pair);

          if (mlSignal.signal === 'BUY' && mlSignal.confidence >= 70) {
            console.log(`[${functionName}] BUY signal detected for ${trade.pair} with ${mlSignal.confidence.toFixed(1)}% confidence. Initiating buy order.`);

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
              throw new Error(`Error de Binance al comprar: ${orderResult.msg || 'Error desconocido'}`);
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
                binance_order_id_buy: orderResult.orderId.toString(),
                created_at: new Date().toISOString(), // Set creation time when it becomes active
              })
              .eq('id', trade.id);

            if (updateToActiveError) {
              console.error(`[${functionName}] Error updating trade ${trade.id} to 'active' status:`, updateToActiveError);
              throw new Error(`Error al actualizar la operación a activa en DB: ${updateToActiveError.message}`);
            }
            console.log(`[${functionName}] Trade ${trade.id} activated and buy order placed successfully.`);

          } else {
            console.log(`[${functionName}] No BUY signal (>=70% confidence) for ${trade.pair}. Current signal: ${mlSignal.signal}, Confidence: ${mlSignal.confidence.toFixed(1)}%. Continuing to await.`);
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

          console.log(`[${functionName}] Trade ${trade.id} (${trade.pair}): Current Price = ${currentPrice}, Target Price = ${trade.target_price}`);

          if (currentPrice >= trade.target_price) {
            console.log(`[${functionName}] Target price reached for trade ${trade.id}. Executing sell order.`);

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
                
                // Add a small safety margin to avoid "insufficient balance" errors due to tiny discrepancies or race conditions
                // This might leave a small amount of dust, but increases reliability of the sell order.
                // Only apply if quantityToSell is not already very small.
                if (quantityToSell > 0.00000001) { // Avoid reducing already tiny amounts to zero
                    quantityToSell *= 0.999; // Reduce by 0.1%
                }
            }

            if (quantityToSell === 0) {
              console.warn(`[${functionName}] No hay saldo disponible de ${baseAsset} para vender o la cantidad es demasiado pequeña para ${trade.pair}. Marking as error.`);
              // Marcar como error si no hay activos para vender cuando debería haberlos
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `No hay saldo disponible de ${baseAsset} para vender o la cantidad es demasiado pequeña.` })
                .eq('id', trade.id);
              continue;
            }

            let adjustedQuantity = adjustQuantity(quantityToSell, stepSize); // Usar 0 como fallback si quantityToSell es undefined/null
            console.log(`[${functionName}] Calculated quantity to sell for ${trade.pair}: ${quantityToSell}, Adjusted: ${adjustedQuantity}`);

            if (adjustedQuantity < minQty) {
              console.warn(`[${functionName}] La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${trade.pair}. No se realizará la venta. Marking as error.`);
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `Cantidad de venta (${adjustedQuantity}) menor que la mínima (${minQty}).` })
                .eq('id', trade.id);
              continue;
            }

            const notionalValue = adjustedQuantity * currentPrice;
            if (notionalValue < minNotional) {
              console.warn(`[${functionName}] El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${trade.pair}. No se realizará la venta. Marking as error.`);
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `Valor nocional de venta (${notionalValue.toFixed(8)}) menor que el mínimo (${minNotional}).` })
                .eq('id', trade.id);
              continue;
            }

            const sellQueryString = `symbol=${trade.pair}&side=SELL&type=MARKET&quantity=${adjustedQuantity}&timestamp=${Date.now()}`;
            const sellSignature = new HmacSha256(api_secret).update(sellQueryString).toString();
            const orderUrl = `https://api.binance.com/api/v3/order?${sellQueryString}&signature=${sellSignature}`;
            console.log(`[${functionName}] Sending SELL order for ${trade.pair} with quantity ${adjustedQuantity}.`);

            const orderResponse = await fetch(orderUrl, {
              method: 'POST',
              headers: { 'X-MBX-APIKEY': api_key },
            });

            const orderData = await orderResponse.json();

            if (!orderResponse.ok) {
              console.error(`[${functionName}] Binance SELL order error for ${trade.pair}: ${orderData.msg || 'Unknown error'}`, orderData);
              throw new Error(`Binance sell order error: ${orderData.msg || 'Unknown error'}`);
            }
            console.log(`[${functionName}] Binance SELL order successful for ${trade.pair}. Order ID: ${orderData.orderId}`);


            // Si la operación es manual, se marca como completada y no se reinicia.
            // Si es de señal, se reinicia para el siguiente ciclo de monitoreo.
            if (tableName === 'manual_trades') {
              const { error: updateManualError } = await supabaseAdmin
                .from(tableName)
                .update({
                  status: 'completed',
                  binance_order_id_sell: orderData.orderId.toString(),
                  completed_at: new Date().toISOString(),
                })
                .eq('id', trade.id);
              if (updateManualError) {
                console.error(`[${functionName}] Error updating manual trade ${trade.id} to 'completed' status:`, updateManualError);
                throw new Error(`Error al actualizar la operación manual a completada en DB: ${updateManualError.message}`);
              }
              console.log(`[${functionName}] Manual trade ${trade.id} completed successfully.`);
            } else { // tableName === 'signal_trades'
              const { error: updateSignalError } = await supabaseAdmin
                .from(tableName)
                .update({
                  status: 'awaiting_buy_signal', // Reiniciar para monitoreo recurrente
                  binance_order_id_sell: orderData.orderId.toString(),
                  completed_at: new Date().toISOString(), // Mantener el registro de cuándo se completó el ciclo
                  asset_amount: null,
                  purchase_price: null,
                  target_price: null,
                  binance_order_id_buy: null,
                  error_message: null,
                  // created_at se mantiene para saber cuándo se inició el monitoreo original
                })
                .eq('id', trade.id);
              if (updateSignalError) {
                console.error(`[${functionName}] Error updating signal trade ${trade.id} to 'awaiting_buy_signal' status:`, updateSignalError);
                throw new Error(`Error al actualizar la operación de señal a esperando compra en DB: ${updateSignalError.message}`);
              }
              console.log(`[${functionName}] Signal trade ${trade.id} completed and reset to 'awaiting_buy_signal' for recurrence.`);
            }
          }
        }
      } catch (tradeError: any) {
        console.error(`[${functionName}] Error processing trade ${trade.id}:`, tradeError);
        const tableName = manualTrades?.some(t => t.id === trade.id) ? 'manual_trades' : 'signal_trades';
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