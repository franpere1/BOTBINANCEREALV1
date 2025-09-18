import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Tasa de comisión de Binance (0.1%)
const BINANCE_FEE_RATE = 0.001;

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
  // 1. Get current ticker price
  const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${asset}`;
  const tickerResponse = await fetch(tickerPriceUrl);
  const tickerData = await tickerResponse.json();
  if (!tickerResponse.ok || tickerData.code) {
    throw new Error(`Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`);
  }
  const currentPrice = parseFloat(tickerData.price);

  // 2. Get historical Klines for indicator calculations
  const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1h&limit=100`;
  const klinesResponse = await fetch(klinesUrl);
  const klinesData = await klinesResponse.json();

  if (!klinesResponse.ok || klinesData.code) {
    throw new Error(`Error fetching klines for ${asset}: ${klinesData.msg || 'Unknown error'}`);
  }

  const closes = klinesData.map((k: any) => parseFloat(k[4])); // Closing prices

  if (closes.length < 50) { // Minimum for MA50
    return { asset, signal: 'HOLD', confidence: 0, price: currentPrice };
  }

  // Calculate Indicators
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

    // Parámetros de la solicitud
    const { usdtAmount, takeProfitPercentage, selectedAssets } = await req.json();
    if (!usdtAmount || !takeProfitPercentage || !selectedAssets || selectedAssets.length === 0) {
      throw new Error('Los parámetros "usdtAmount", "takeProfitPercentage" y "selectedAssets" son obligatorios.');
    }

    const results: { asset: string; status: string; message: string; tradeId?: string }[] = [];

    for (const asset of selectedAssets) {
      try {
        // 1. Obtener la señal de ML en tiempo real para el activo
        const signalData = await getMlSignalForAsset(asset);

        // 2. Verificar la condición de BUY >= 70% de confianza
        if (signalData.signal === 'BUY' && signalData.confidence >= 70) {
          // 3. Insertar la operación en la base de datos con estado 'pending'
          const { data: trade, error: insertError } = await supabaseAdmin
            .from('signal_trades')
            .insert({
              user_id: user.id,
              pair: asset,
              usdt_amount: usdtAmount,
              take_profit_percentage: takeProfitPercentage,
              status: 'pending',
            })
            .select()
            .single();

          if (insertError) {
            throw new Error(`Error al crear la operación en DB para ${asset}: ${insertError.message}`);
          }

          // 4. Invocar la Edge Function para ejecutar la compra en Binance
          let queryString = `symbol=${asset}&side=BUY&type=MARKET&quoteOrderQty=${usdtAmount}&timestamp=${Date.now()}`;
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
            throw new Error(`Error de Binance al comprar ${asset}: ${orderResult.msg || 'Error desconocido'}`);
          }

          // 5. Calcular precio de compra y precio objetivo
          const executedQty = parseFloat(orderResult.executedQty);
          const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
          const purchasePrice = cummulativeQuoteQty / executedQty;
          
          // Ajustar el precio objetivo para incluir la comisión de venta
          const targetPrice = (purchasePrice * (1 + takeProfitPercentage / 100)) / (1 - BINANCE_FEE_RATE);

          // 6. Actualizar la operación en la DB con los detalles de la compra
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
            throw new Error(`Error al actualizar la operación en DB para ${asset}: ${updateError.message}`);
          }

          results.push({ asset, status: 'success', message: 'Operación iniciada con éxito', tradeId: trade.id });
        } else {
          results.push({ asset, status: 'skipped', message: `Señal no cumple criterios (BUY >= 70% confianza). Señal: ${signalData.signal}, Confianza: ${signalData.confidence.toFixed(1)}%` });
        }
      } catch (tradeError: any) {
        console.error(`Error al procesar trade para ${asset}:`, tradeError);
        results.push({ asset, status: 'error', message: tradeError.message });
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error en la Edge Function bulk-initiate-signal-trades:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});