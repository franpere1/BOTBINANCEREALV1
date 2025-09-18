import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Aquí se simularía la lógica para obtener datos de un modelo ML o una API externa.
    // Por ahora, devolvemos los datos hardcodeados que proporcionaste.
    const signalsData = [
      {
        asset: "BTCUSDT",
        prediction: "BTCUSDT",
        signal: "SELL",
        confidence: 32.0,
        price: 116713.97,
        rsi: 44.10,
        ma20: 116739.39,
        ma50: 116742.33,
        macd: -6.445,
        macdSignal: -3.444,
        histMacd: -3.001,
        upperBand: 116799.89,
        lowerBand: 116678.89,
        volatility: 3024.96,
        lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
      {
        asset: "ETHUSDT",
        prediction: "ETHUSDT",
        signal: "SELL",
        confidence: 32.0,
        price: 4498.78,
        rsi: 40.05,
        ma20: 4501.12,
        ma50: 4503.93,
        macd: -1.530,
        macdSignal: -1.468,
        histMacd: -0.062,
        upperBand: 4504.42,
        lowerBand: 4497.81,
        volatility: 165.16,
        lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
      {
        asset: "SOLUSDT",
        prediction: "SOLUSDT",
        signal: "HOLD",
        confidence: 44.0,
        price: 236.35,
        rsi: 34.93,
        ma20: 236.75,
        ma50: 237.22,
        macd: -0.211,
        macdSignal: -0.197,
        histMacd: -0.015,
        upperBand: 237.10,
        lowerBand: 236.40,
        volatility: 17.47,
        lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
      {
        asset: "ADAUSDT",
        prediction: "ADAUSDT",
        signal: "SELL",
        confidence: 32.0,
        price: 0.88,
        rsi: 43.60,
        ma20: 0.88,
        ma50: 0.88,
        macd: 0.000,
        macdSignal: 0.000,
        histMacd: 0.000,
        upperBand: 0.88,
        lowerBand: 0.88,
        volatility: 0.03,
        lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
      {
        asset: "BNBUSDT",
        prediction: "BNBUSDT",
        signal: "HOLD",
        confidence: 50.0,
        price: 954.37,
        rsi: 35.69,
        ma20: 955.76,
        ma50: 955.10,
        macd: 0.009,
        macdSignal: 0.223,
        histMacd: -0.213,
        upperBand: 957.10,
        lowerBand: 954.42,
        volatility: 67.24,
        lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
      {
        asset: "USDCUSDT",
        prediction: "USDCUSDT",
        signal: "SELL",
        confidence: 38.0,
        price: 1.00,
        rsi: 45.97,
        ma20: 1.00,
        ma50: 1.00,
        macd: 0.000,
        macdSignal: 0.000,
        histMacd: 0.000,
        upperBand: 1.00,
        lowerBand: 1.00,
        volatility: 0.00,
        lastUpdate: new Date().toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ];

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