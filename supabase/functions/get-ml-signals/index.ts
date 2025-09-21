import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

  return {
    asset,
    prediction: asset, // Mantener por consistencia con la estructura original
    signal,
    confidence,
    price: currentPrice,
    rsi, ma20, ma50, macd, macdSignal, histMacd,
    upperBand, lowerBand, volatility,
    lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    klinesSource: 'Binance API (1h klines)',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let requestedAsset: string | undefined;
    try {
      const body = await req.json();
      requestedAsset = body.asset;
    } catch (jsonError: any) {
      // Si el parseo falla, significa que no hay cuerpo o es JSON inválido.
      // Para esta función, lo tratamos como si no se hubiera solicitado un activo específico.
      console.warn(`[get-ml-signals] No request body or invalid JSON: ${jsonError.message}`);
    }
    
    const assetsToProcess = requestedAsset ? [requestedAsset] : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'TRXUSDT'];
    const signalsData = [];

    for (const asset of assetsToProcess) {
      try {
        const signal = await getMlSignalForAssetFromBinance(asset);
        signalsData.push(signal);
      } catch (assetError: any) {
        console.error(`Error processing ML signal for ${asset}:`, assetError);
        signalsData.push({
          asset: asset,
          prediction: asset,
          signal: 'HOLD',
          confidence: 0,
          price: 0,
          rsi: 0, ma20: 0, ma50: 0, macd: 0, macdSignal: 0, histMacd: 0,
          upperBand: 0, lowerBand: 0, volatility: 0,
          lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          klinesSource: `Error: ${assetError.message}`,
        });
      }
    }

    return new Response(JSON.stringify(signalsData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Unhandled error in get-ml-signals Edge Function:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});