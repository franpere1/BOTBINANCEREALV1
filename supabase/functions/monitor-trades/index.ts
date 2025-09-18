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

// Function to get ML signal for a single asset
async function getMlSignalForAsset(asset: string) {
  const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${asset}`;
  const tickerResponse = await fetch(tickerPriceUrl);
  const tickerData = await tickerResponse.json();
  if (!tickerResponse.ok || tickerData.code) {
    throw new Error(`Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`);
  }
  const currentPrice = parseFloat(tickerData.price);

  const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1h&limit=100`;
  const klinesResponse = await fetch(klinesUrl);
  const klinesData = await klinesResponse.json();

  if (!klinesResponse.ok || klinesData.code) {
    throw new Error(`Error fetching klines for ${asset}: ${klinesData.msg || 'Unknown error'}`);
  }

  const closes = klinesData.map((k: any) => parseFloat(k[4]));

  if (closes.length < 50) {
    return { asset, signal: 'HOLD', confidence: 0, price: currentPrice };
  }

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
    signal = 'HOLD';
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
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  return parseFloat(qty.toFixed(precision));
};

// Tasa de comisión de Binance (0.1%)
const BINANCE_FEE_RATE = 0.001;


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Obtener todas las operaciones activas (manuales y de señales)
    const { data: manualTrades, error: manualTradesError } = await supabaseAdmin
      .from('manual_trades')
      .select('id, user_id, pair, asset_amount, purchase_price, target_price')
      .eq('status', 'active');

    if (manualTradesError) {
      console.error('Error fetching active manual trades:', manualTradesError);
      return new Response(JSON.stringify({ error: 'Error fetching active manual trades' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Obtener todas las operaciones de señales activas Y las que están esperando señal de compra
    const { data: signalTrades, error: signalTradesError } = await supabaseAdmin
      .from('signal_trades')
      .select('id, user_id, pair, usdt_amount, asset_amount, purchase_price, take_profit_percentage, target_price, status')
      .in('status', ['active', 'awaiting_buy_signal']); // Incluir el nuevo estado

    if (signalTradesError) {
      console.error('Error fetching active/awaiting signal trades:', signalTradesError);
      return new Response(JSON.stringify({ error: 'Error fetching active/awaiting signal trades' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const allActiveTrades = [...(manualTrades || []), ...(signalTrades || [])];

    if (!allActiveTrades || allActiveTrades.length === 0) {
      return new Response(JSON.stringify({ message: 'No active or awaiting trades to monitor.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Monitoring ${allActiveTrades.length} active/awaiting trades.`);

    for (const trade of allActiveTrades) {
      try {
        const tableName = manualTrades?.some(t => t.id === trade.id) ? 'manual_trades' : 'signal_trades';

        // Obtener las claves de API del usuario para esta operación
        const { data: keys, error: keysError } = await supabaseAdmin
          .from('api_keys')
          .select('api_key, api_secret')
          .eq('user_id', trade.user_id)
          .single();

        if (keysError || !keys) {
          console.error(`API keys not found for user ${trade.user_id} for trade ${trade.id}. Skipping.`);
          await supabaseAdmin
            .from(tableName)
            .update({ status: 'error', error_message: 'API keys not found or invalid.' })
            .eq('id', trade.id);
          continue;
        }

        const { api_key, api_secret } = keys;

        if (trade.status === 'awaiting_buy_signal') {
          // Lógica para operaciones esperando señal de compra
          console.log(`Trade ${trade.id} (${trade.pair}) is awaiting BUY signal.`);
          const mlSignal = await getMlSignalForAsset(trade.pair);

          if (mlSignal.signal === 'BUY' && mlSignal.confidence >= 70) {
            console.log(`BUY signal detected for ${trade.pair} with ${mlSignal.confidence.toFixed(1)}% confidence. Initiating buy order.`);

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

            // Ejecutar la orden de compra en Binance
            let queryString = `symbol=${trade.pair}&side=BUY&type=MARKET&quoteOrderQty=${trade.usdt_amount}&timestamp=${Date.now()}`;
            const signature = new HmacSha256(api_secret).update(queryString).toString();
            const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;

            const response = await fetch(url, {
              method: 'POST',
              headers: { 'X-MBX-APIKEY': api_key },
            });

            const orderResult = await response.json();
            if (!response.ok) {
              throw new Error(`Error de Binance al comprar: ${orderResult.msg || 'Error desconocido'}`);
            }

            // Calcular precio de compra y precio objetivo
            const executedQty = parseFloat(orderResult.executedQty);
            const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
            const purchasePrice = cummulativeQuoteQty / executedQty;
            const targetPrice = (purchasePrice * (1 + trade.take_profit_percentage / 100)) / (1 - BINANCE_FEE_RATE);

            // Actualizar la operación en la DB a 'active'
            await supabaseAdmin
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
            console.log(`Trade ${trade.id} activated and buy order placed successfully.`);

          } else {
            console.log(`No BUY signal (>=70% confidence) for ${trade.pair}. Current signal: ${mlSignal.signal}, Confidence: ${mlSignal.confidence.toFixed(1)}%. Continuing to await.`);
          }

        } else if (trade.status === 'active') {
          // Lógica existente para operaciones activas (monitorear precio objetivo y vender)
          const tickerUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${trade.pair}`;
          const tickerResponse = await fetch(tickerUrl);
          const tickerData = await tickerResponse.json();

          if (!tickerResponse.ok) {
            throw new Error(tickerData.msg || `Error fetching ticker price for ${trade.pair}`);
          }
          const currentPrice = parseFloat(tickerData.price);

          console.log(`Trade ${trade.id} (${trade.pair}): Current Price = ${currentPrice}, Target Price = ${trade.target_price}`);

          if (currentPrice >= trade.target_price) {
            console.log(`Target price reached for trade ${trade.id}. Executing sell order.`);

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
              throw new Error(`Error al obtener el balance de la cuenta de Binance: ${accountData.msg || 'Error desconocido'}`);
            }

            const baseAsset = trade.pair.replace('USDT', '');
            const assetBalance = accountData.balances.find((b: any) => b.asset === baseAsset);
            
            if (!assetBalance || parseFloat(assetBalance.free) === 0) {
              console.warn(`[MONITOR-TRADES] No hay saldo disponible de ${baseAsset} para vender para el trade ${trade.id}.`);
              // Marcar como error si no hay activos para vender cuando debería haberlos
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `No hay saldo disponible de ${baseAsset} para vender.` })
                .eq('id', trade.id);
              continue;
            }
            let finalQuantity = parseFloat(assetBalance.free);
            let adjustedQuantity = adjustQuantity(finalQuantity, stepSize);

            if (adjustedQuantity < minQty) {
              console.warn(`[MONITOR-TRADES] La cantidad ajustada (${adjustedQuantity}) es menor que la cantidad mínima (${minQty}) para ${trade.pair}. No se realizará la venta.`);
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `Cantidad de venta (${adjustedQuantity}) menor que la mínima (${minQty}).` })
                .eq('id', trade.id);
              continue;
            }

            const notionalValue = adjustedQuantity * currentPrice;
            if (notionalValue < minNotional) {
              console.warn(`[MONITOR-TRADES] El valor nocional de la orden de venta (${notionalValue.toFixed(8)}) es menor que el mínimo nocional (${minNotional}) para ${trade.pair}. No se realizará la venta.`);
              await supabaseAdmin
                .from(tableName)
                .update({ status: 'error', error_message: `Valor nocional de venta (${notionalValue.toFixed(8)}) menor que el mínimo (${minNotional}).` })
                .eq('id', trade.id);
              continue;
            }

            const sellQueryString = `symbol=${trade.pair}&side=SELL&type=MARKET&quantity=${adjustedQuantity}&timestamp=${Date.now()}`;
            const sellSignature = new HmacSha256(api_secret).update(sellQueryString).toString();
            const orderUrl = `https://api.binance.com/api/v3/order?${sellQueryString}&signature=${sellSignature}`;

            const orderResponse = await fetch(orderUrl, {
              method: 'POST',
              headers: { 'X-MBX-APIKEY': api_key },
            });

            const orderData = await orderResponse.json();

            if (!orderResponse.ok) {
              throw new Error(`Binance sell order error: ${orderData.msg || 'Unknown error'}`);
            }

            await supabaseAdmin
              .from(tableName)
              .update({
                status: 'completed',
                binance_order_id_sell: orderData.orderId.toString(),
                completed_at: new Date().toISOString(),
              })
              .eq('id', trade.id);
            console.log(`Trade ${trade.id} completed successfully.`);
          }
        }
      } catch (tradeError: any) {
        console.error(`Error processing trade ${trade.id}:`, tradeError);
        const tableName = manualTrades?.some(t => t.id === trade.id) ? 'manual_trades' : 'signal_trades';
        await supabaseAdmin
          .from(tableName)
          .update({ status: 'error', error_message: tradeError.message })
          .eq('id', trade.id);
      }
    }

    return new Response(JSON.stringify({ message: 'Trade monitoring completed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Unhandled error in monitor-trades Edge Function:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});