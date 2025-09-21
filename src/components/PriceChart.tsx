"use client";

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Line, Bar, Chart } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import 'chartjs-chart-financial'; // Import the financial chart plugin
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import { AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { showError } from '@/utils/toast';

// Register Chart.js components and financial plugin
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  CandlestickController,
  CandlestickElement
);

interface KlineData {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string; // Original date string
}

interface Indicators {
  ma20: string;
  ma50: string;
  rsi: string;
  macd: string;
  macdSignal: string;
  histMacd: string;
  upperBand: string;
  lowerBand: string;
  volatility: string;
}

interface PriceChartData {
  klines: KlineData[];
  indicators: Indicators;
}

interface PriceChartProps {
  pair: string;
  lookbackMinutes?: number;
}

const fetchMinuteKlines = async (pair: string, lookbackMinutes: number): Promise<PriceChartData> => {
  const { data, error } = await supabase.functions.invoke('get-minute-klines', {
    body: { pair, lookbackMinutes },
  });
  if (error) throw new Error(data?.error || error.message);
  return data as PriceChartData;
};

const PriceChart = ({ pair, lookbackMinutes = 60 }: PriceChartProps) => {
  const { data, isLoading, isError, error } = useQuery<PriceChartData, Error>({
    queryKey: ['minuteKlines', pair, lookbackMinutes],
    queryFn: () => fetchMinuteKlines(pair, lookbackMinutes),
    enabled: !!pair,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  if (isError) {
    showError(`Error al cargar los datos del gráfico para ${pair}: ${error?.message}`);
    return (
      <Card className="w-full bg-red-900/50 border-red-700 text-center">
        <CardHeader>
          <CardTitle className="text-red-400 text-2xl flex items-center justify-center">
            <AlertCircle className="h-6 w-6 mr-2" /> Error de Carga
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300">No se pudieron cargar los datos del gráfico para {pair}.</p>
          <p className="text-red-400 text-sm mt-1">{error?.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card className="w-full bg-gray-800 border-gray-700">
        <CardHeader className="pb-2">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const { klines, indicators } = data;

  if (klines.length === 0) {
    return (
      <Card className="w-full bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Gráfico de {pair}</CardTitle>
          <CardDescription className="text-gray-400">
            Datos de precios por minuto e indicadores técnicos.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-gray-400 p-8">
          No hay datos históricos disponibles para {pair} en los últimos {lookbackMinutes} minutos.
        </CardContent>
      </Card>
    );
  }

  const chartData = {
    labels: klines.map(k => new Date(k.date).toLocaleTimeString()),
    datasets: [
      {
        label: 'Velas',
        type: 'candlestick',
        data: klines.map(k => ({
          x: new Date(k.date).toLocaleTimeString(),
          o: k.open,
          h: k.high,
          l: k.low,
          c: k.close,
        })),
        borderColor: 'rgba(255, 255, 255, 0.8)',
        borderWidth: 1,
        color: {
          up: 'rgba(75, 192, 192, 0.8)',
          down: 'rgba(255, 99, 132, 0.8)',
          unchanged: 'rgba(201, 203, 207, 0.8)'
        },
      },
      {
        label: 'MA20',
        type: 'line',
        data: klines.map((_, i) => {
          if (i < 19) return null; // MA20 needs 20 data points
          const slice = klines.slice(0, i + 1).map(k => k.close);
          return calculateSMA(slice, 20);
        }),
        borderColor: 'rgba(255, 206, 86, 1)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'MA50',
        type: 'line',
        data: klines.map((_, i) => {
          if (i < 49) return null; // MA50 needs 50 data points
          const slice = klines.slice(0, i + 1).map(k => k.close);
          return calculateSMA(slice, 50);
        }),
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const volumeData = {
    labels: klines.map(k => new Date(k.date).toLocaleTimeString()),
    datasets: [
      {
        label: 'Volumen',
        data: klines.map(k => k.volume),
        backgroundColor: klines.map(k => k.close >= k.open ? 'rgba(75, 192, 192, 0.5)' : 'rgba(255, 99, 132, 0.5)'),
        borderColor: klines.map(k => k.close >= k.open ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)'),
        borderWidth: 1,
      },
    ],
  };

  const rsiData = {
    labels: klines.map(k => new Date(k.date).toLocaleTimeString()),
    datasets: [
      {
        label: 'RSI',
        data: klines.map((_, i) => {
          if (i < 13) return null; // RSI needs 14 data points
          const slice = klines.slice(0, i + 1).map(k => k.close);
          return calculateRSI(slice, 14);
        }),
        borderColor: 'rgba(153, 102, 255, 1)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'Sobrecompra (70)',
        data: klines.map(() => 70),
        borderColor: 'rgba(255, 99, 132, 0.5)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'Sobrevendido (30)',
        data: klines.map(() => 30),
        borderColor: 'rgba(75, 192, 192, 0.5)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const macdData = {
    labels: klines.map(k => new Date(k.date).toLocaleTimeString()),
    datasets: [
      {
        label: 'MACD',
        data: klines.map((_, i) => {
          if (i < 25) return null; // MACD needs 26 data points for EMA26
          const closesSlice = klines.slice(0, i + 1).map(k => k.close);
          const ema12Series = calculateEMASeries(closesSlice, 12);
          const ema26Series = calculateEMASeries(closesSlice, 26);
          if (ema12Series.length > 0 && ema26Series.length > 0) {
            const macdLineData = ema12Series.slice(ema12Series.length - ema26Series.length).map((e12, idx) => e12 - ema26Series[idx]);
            return macdLineData[macdLineData.length - 1];
          }
          return null;
        }),
        borderColor: 'rgba(255, 159, 64, 1)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'Signal Line',
        data: klines.map((_, i) => {
          if (i < 33) return null; // Signal line needs 9 data points after MACD line (26 + 9 - 1)
          const closesSlice = klines.slice(0, i + 1).map(k => k.close);
          const ema12Series = calculateEMASeries(closesSlice, 12);
          const ema26Series = calculateEMASeries(closesSlice, 26);
          if (ema12Series.length > 0 && ema26Series.length > 0) {
            const macdLineData = ema12Series.slice(ema12Series.length - ema26Series.length).map((e12, idx) => e12 - ema26Series[idx]);
            const macdSignalLineSeries = calculateEMASeries(macdLineData, 9);
            return macdSignalLineSeries[macdSignalLineSeries.length - 1];
          }
          return null;
        }),
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: 'rgb(200, 200, 200)', // White color for legend text
        },
      },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            if (context.dataset.type === 'candlestick') {
              const { o, h, l, c } = context.raw;
              return [
                `Open: ${o.toFixed(4)}`,
                `High: ${h.toFixed(4)}`,
                `Low: ${l.toFixed(4)}`,
                `Close: ${c.toFixed(4)}`,
              ];
            }
            return `${context.dataset.label}: ${context.raw.toFixed(4)}`;
          }
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: 'rgb(150, 150, 150)', // Grey color for x-axis labels
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)', // Light grid lines
        },
      },
      y: {
        ticks: {
          color: 'rgb(150, 150, 150)', // Grey color for y-axis labels
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.1)', // Light grid lines
        },
      },
    },
  };

  const indicatorCardClass = "bg-gray-700 border-gray-600 p-3 rounded-md text-sm flex items-center justify-between";
  const indicatorValueClass = "font-semibold text-white";
  const indicatorLabelClass = "text-gray-300";

  return (
    <Card className="w-full bg-gray-800 border-gray-700 text-white">
      <CardHeader>
        <CardTitle className="text-yellow-400 text-2xl">Gráfico de {pair}</CardTitle>
        <CardDescription className="text-gray-400">
          Datos de precios por minuto e indicadores técnicos para {pair} en los últimos {lookbackMinutes} minutos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="h-[400px]">
          <Chart type='candlestick' data={chartData} options={chartOptions} />
        </div>
        <div className="h-[150px]">
          <Bar data={volumeData} options={chartOptions} />
        </div>
        <div className="h-[150px]">
          <Line data={rsiData} options={chartOptions} />
        </div>
        <div className="h-[150px]">
          <Line data={macdData} options={chartOptions} />
        </div>

        <h3 className="text-xl font-bold text-yellow-400 mt-8">Indicadores Actuales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>Precio Actual:</span>
            <span className={indicatorValueClass}>${klines[klines.length - 1]?.close.toFixed(4) || 'N/A'}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>RSI (14):</span>
            <span className={indicatorValueClass}>{indicators.rsi}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>MA20:</span>
            <span className={indicatorValueClass}>${indicators.ma20}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>MA50:</span>
            <span className={indicatorValueClass}>${indicators.ma50}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>MACD:</span>
            <span className={indicatorValueClass}>{indicators.macd}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>MACD Signal:</span>
            <span className={indicatorValueClass}>{indicators.macdSignal}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>Hist. MACD:</span>
            <span className={indicatorValueClass}>{indicators.histMacd}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>Banda Superior (BB):</span>
            <span className={indicatorValueClass}>${indicators.upperBand}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>Banda Inferior (BB):</span>
            <span className={indicatorValueClass}>${indicators.lowerBand}</span>
          </div>
          <div className={indicatorCardClass}>
            <span className={indicatorLabelClass}>Volatilidad:</span>
            <span className={indicatorValueClass}>{indicators.volatility}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PriceChart;

// Helper functions (copied from get-minute-klines for client-side calculation for chart rendering)
function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const sum = data.slice(-period).reduce((acc, val) => acc + val, 0);
  return sum / period;
}

function calculateEMASeries(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [];
  let currentEMA = calculateSMA(data.slice(0, period), period);
  emas.push(currentEMA);

  for (let i = period; i < data.length; i++) {
    currentEMA = (data[i] - currentEMA) * k + currentEMA;
    emas.push(currentEMA);
  }
  return emas;
}

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

  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}