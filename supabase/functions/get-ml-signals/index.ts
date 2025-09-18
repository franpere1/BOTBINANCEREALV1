import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

  try {
    const assets = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'USDCUSDT'];
    const signalsData = [];

    for (const asset of assets) {
      // 1. Get current ticker price
      const tickerPriceUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${asset}`;
      const tickerResponse = await fetch(tickerPriceUrl);
      const tickerData = await tickerResponse.json();
      if (!tickerResponse.ok || tickerData.code) {
        console.error(`Error fetching ticker price for ${asset}:`, tickerData);
        throw new Error(`Error fetching ticker price for ${asset}: ${tickerData.msg || 'Unknown error'}`);
      }
      const currentPrice = parseFloat(tickerData.price);

      // 2. Get historical Klines for indicator calculations
      // Fetch enough data for MA50 and other indicators (e.g., 100 1-hour candles)
      const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1h&limit=100`;
      const klinesResponse = await fetch(klinesUrl);
      const klinesData = await klinesResponse.json();

      if (!klinesResponse.ok || klinesData.code) {
        console.error(`Error fetching klines for ${asset}:`, klinesData);
        throw new Error(`Error fetching klines for ${asset}: ${klinesData.msg || 'Unknown error'}`);
      }

      const closes = klinesData.map((k: any) => parseFloat(k[4])); // Closing prices

      // Ensure we have enough data points
      if (closes.length < 50) { // Minimum for MA50
        console.warn(`Not enough klines data for ${asset}. Skipping indicator calculations.`);
        signalsData.push({
          asset: asset,
          prediction: asset,
          signal: 'HOLD', // Default signal
          confidence: 0,
          price: currentPrice,
          rsi: 0, ma20: 0, ma50: 0, macd: 0, macdSignal: 0, histMacd: 0,
          upperBand: 0, lowerBand: 0, volatility: 0,
          lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });
        continue;
      }

      // Calculate Indicators
      const ma20 = calculateSMA(closes, 20);
      const ma50 = calculateSMA(closes, 50);

      const rsi = calculateRSI(closes, 14); // 14-period RSI

      // MACD
      const ema12Series = calculateEMASeries(closes, 12);
      const ema26Series = calculateEMASeries(closes, 26);
      
      // Align MACD line calculation to the shorter EMA series
      const macdLineData = ema12Series.slice(ema12Series.length - ema26Series.length).map((e12, i) => e12 - ema26Series[i]);
      const macdSignalLineSeries = calculateEMASeries(macdLineData, 9);

      const macd = macdLineData.length > 0 ? macdLineData[macdLineData.length - 1] : 0;
      const macdSignal = macdSignalLineSeries.length > 0 ? macdSignalLineSeries[macdSignalLineSeries.length - 1] : 0;
      const histMacd = macd - macdSignal;

      // Bollinger Bands (using 20-period SMA and 2 standard deviations)
      const bbPeriod = 20;
      const bbMiddleBand = calculateSMA(closes, bbPeriod);
      const stdDev = calculateStdDev(closes, bbPeriod);
      const upperBand = bbMiddleBand + (stdDev * 2);
      const lowerBand = bbMiddleBand - (stdDev * 2);

      // Volatility (using standard deviation of recent closing prices)
      const volatility = (stdDev / currentPrice) * 100; // Percentage volatility

      // --- Dynamic Signal and Confidence Logic ---
      let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      let confidence = 0;
      let rawScore = 0; // Ranges from -100 (strong sell) to 100 (strong buy)

      // RSI scoring (more extreme RSI values give higher scores)
      if (rsi < 30) rawScore += 30; // Very oversold
      else if (rsi < 40) rawScore += 15; // Moderately oversold
      else if (rsi > 70) rawScore -= 30; // Very overbought
      else if (rsi > 60) rawScore -= 15; // Moderately overbought

      // MACD scoring (crossover and histogram direction)
      if (macd > macdSignal && histMacd > 0) rawScore += 25; // Bullish crossover with positive momentum
      else if (macd < macdSignal && histMacd < 0) rawScore -= 25; // Bearish crossover with negative momentum

      // Price vs MA20
      if (currentPrice > ma20) rawScore += 20;
      else if (currentPrice < ma20) rawScore -= 20;

      // Price vs MA50
      if (currentPrice > ma50) rawScore += 15;
      else if (currentPrice < ma50) rawScore -= 15;

      // Bollinger Bands
      if (currentPrice < lowerBand) rawScore += 10; // Price below lower band (potential bounce up)
      else if (currentPrice > upperBand) rawScore -= 10; // Price above upper band (potential pullback)

      // Determine signal based on rawScore thresholds
      if (rawScore >= 20) { // A positive score threshold for BUY
        signal = 'BUY';
      } else if (rawScore <= -20) { // A negative score threshold for SELL
        signal = 'SELL';
      } else {
        signal = 'HOLD';
      }

      // Map rawScore to confidence [0-100] based on the determined signal
      if (signal === 'BUY') {
        // Scale rawScore from [20, 100] to confidence [50, 100]
        // Ensure minimum confidence for a BUY signal is 50
        confidence = 50 + Math.max(0, (rawScore - 20) / 80) * 50;
      } else if (signal === 'SELL') {
        // Scale rawScore from [-100, -20] to confidence [0, 49.9]
        // Ensure maximum confidence for a SELL signal is 49.9
        confidence = 49.9 - Math.max(0, (Math.abs(rawScore) - 20) / 80) * 49.9;
      } else { // HOLD
        // Scale rawScore from [-20, 20] to confidence [40, 60] (centered around 50)
        confidence = 50 + (rawScore / 20) * 10;
      }

      // Final capping to ensure confidence is within [0, 100]
      confidence = Math.max(0, Math.min(100, confidence));

      signalsData.push({
        asset: asset,
        prediction: asset, // Placeholder
        signal: signal,
        confidence: confidence,
        price: currentPrice,
        rsi: rsi,
        ma20: ma20,
        ma50: ma50,
        macd: macd,
        macdSignal: macdSignal,
        histMacd: histMacd,
        upperBand: upperBand,
        lowerBand: lowerBand,
        volatility: volatility,
        lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      });
    }

    return new Response(JSON.stringify(signalsData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Unhandled error in get-ml-signals Edge Function:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});