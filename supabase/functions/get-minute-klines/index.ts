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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const functionName = 'get-minute-klines';

  try {
    const { pair, lookbackMinutes = 60 } = await req.json(); // Default to 60 minutes
    if (!pair) {
      throw new Error('El parámetro "pair" es obligatorio.');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch minute prices from the database
    const { data: minutePrices, error: pricesError } = await supabaseAdmin
      .from('minute_prices')
      .select('open_price, high_price, low_price, close_price, volume, created_at')
      .eq('asset', pair)
      .order('created_at', { ascending: true }) // Order ascending for indicator calculation
      .limit(lookbackMinutes);

    if (pricesError) {
      console.error(`[${functionName}] Error fetching minute prices for ${pair}:`, pricesError);
      throw new Error(`Error al obtener precios por minuto: ${pricesError.message}`);
    }

    if (!minutePrices || minutePrices.length === 0) {
      return new Response(JSON.stringify({ klines: [], indicators: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const klines = minutePrices.map(p => ({
      time: new Date(p.created_at).getTime() / 1000, // Unix timestamp in seconds
      open: p.open_price,
      high: p.high_price,
      low: p.low_price,
      close: p.close_price,
      volume: p.volume,
      date: p.created_at, // Keep original date string for display
    }));

    const closes = minutePrices.map(p => p.close_price);

    // Calculate Indicators
    const ma20 = closes.length >= 20 ? calculateSMA(closes, 20) : 0;
    const ma50 = closes.length >= 50 ? calculateSMA(closes, 50) : 0;
    const rsi = closes.length >= 14 ? calculateRSI(closes, 14) : 0;

    const ema12Series = calculateEMASeries(closes, 12);
    const ema26Series = calculateEMASeries(closes, 26);
    const macdLineData = ema12Series.slice(ema12Series.length - ema26Series.length).map((e12, i) => e12 - ema26Series[i]);
    const macdSignalLineSeries = calculateEMASeries(macdLineData, 9);

    const macd = macdLineData.length > 0 ? macdLineData[macdLineData.length - 1] : 0;
    const macdSignal = macdSignalLineSeries.length > 0 ? macdSignalLineSeries[macdSignalLineSeries.length - 1] : 0;
    const histMacd = macd - macdSignal;

    const bbPeriod = 20;
    const bbMiddleBand = closes.length >= bbPeriod ? calculateSMA(closes, bbPeriod) : 0;
    const stdDev = closes.length >= bbPeriod ? calculateStdDev(closes, bbPeriod) : 0;
    const upperBand = bbMiddleBand + (stdDev * 2);
    const lowerBand = bbMiddleBand - (stdDev * 2);

    const currentPrice = closes.length > 0 ? closes[closes.length - 1] : 0;
    const volatility = (stdDev / currentPrice) * 100;


    return new Response(JSON.stringify({
      klines,
      indicators: {
        ma20: ma20.toFixed(4),
        ma50: ma50.toFixed(4),
        rsi: rsi.toFixed(2),
        macd: macd.toFixed(3),
        macdSignal: macdSignal.toFixed(3),
        histMacd: histMacd.toFixed(3),
        upperBand: upperBand.toFixed(4),
        lowerBand: lowerBand.toFixed(4),
        volatility: volatility.toFixed(2),
      },
    }), {
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