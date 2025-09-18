"use client";

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, TrendingDown, PauseCircle } from "lucide-react";
import { showError, showSuccess } from '@/utils/toast';
import { useAuth } from '@/context/AuthProvider';
import ActiveSignalTrades from '@/components/ActiveSignalTrades';

interface SignalData {
  asset: string;
  prediction: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price: number;
  rsi: number;
  ma20: number;
  ma50: number;
  macd: number;
  macdSignal: number;
  histMacd: number;
  upperBand: number;
  lowerBand: number;
  volatility: number;
  lastUpdate: string;
}

const fetchMlSignals = async (): Promise<SignalData[]> => {
  const { data, error } = await supabase.functions.invoke('get-ml-signals');
  if (error) throw new Error(data?.error || error.message);
  return data as SignalData[];
};

const SignalsTrading = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: signals, isLoading, isError } = useQuery<SignalData[], Error>({
    queryKey: ['mlSignals'],
    queryFn: fetchMlSignals,
    refetchInterval: 15000, // Refrescar cada 15 segundos
  });

  if (isError) {
    showError(`Error al cargar las señales de trading: ${isError.message}`);
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-lg bg-red-900/50 border-red-700 text-center">
          <CardHeader>
            <CardTitle className="text-red-400 text-2xl flex items-center justify-center">
              <AlertCircle className="h-6 w-6 mr-2" /> Error al cargar señales
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <p className="text-xl text-red-300">
              Hubo un problema al obtener los datos de trading por señales.
            </p>
            <p className="text-red-400 mt-2">
              Por favor, inténtalo de nuevo más tarde.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2 mt-1" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const getSignalColor = (signal: SignalData['signal']) => {
    switch (signal) {
      case 'BUY': return 'text-green-400';
      case 'SELL': return 'text-red-400';
      case 'HOLD': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const getSignalIcon = (signal: SignalData['signal']) => {
    switch (signal) {
      case 'BUY': return <TrendingUp className="h-5 w-5 mr-2" />;
      case 'SELL': return <TrendingDown className="h-5 w-5 mr-2" />;
      case 'HOLD': return <PauseCircle className="h-5 w-5 mr-2" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-4xl font-bold mb-4 text-yellow-400">
          Trading por Señales de ML
        </h2>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto">
          Análisis de mercado en tiempo real y predicciones de Machine Learning para ayudarte a tomar decisiones.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {signals?.map((signal) => (
          <Card key={signal.asset} className="bg-gray-800 border-gray-700 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl text-yellow-400">{signal.asset}</CardTitle>
              <CardDescription className="flex items-center text-lg font-semibold">
                {getSignalIcon(signal.signal)}
                <span className={getSignalColor(signal.signal)}>{signal.signal}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p className="text-gray-400">Confianza: <span className="text-white font-semibold">{signal.confidence.toFixed(1)}%</span></p>
              <p className="text-gray-400">Precio: <span className="text-white font-semibold">${signal.price.toFixed(4)}</span></p> {/* Ajustado a 4 decimales */}
              <p className="text-gray-400">RSI: <span className="text-white font-semibold">{signal.rsi.toFixed(2)}</span></p>
              <p className="text-gray-400">MA20: <span className="text-white font-semibold">${signal.ma20.toFixed(4)}</span></p>
              <p className="text-gray-400">MA50: <span className="text-white font-semibold">${signal.ma50.toFixed(4)}</span></p>
              <p className="text-gray-400">MACD: <span className="text-white font-semibold">{signal.macd.toFixed(3)}</span></p>
              <p className="text-gray-400">MACD Señal: <span className="text-white font-semibold">{signal.macdSignal.toFixed(3)}</span></p>
              <p className="text-gray-400">Hist. MACD: <span className="text-white font-semibold">{signal.histMacd.toFixed(3)}</span></p>
              <p className="text-gray-400">Banda Superior: <span className="text-white font-semibold">${signal.upperBand.toFixed(4)}</span></p>
              <p className="text-gray-400">Banda Inferior: <span className="text-white font-semibold">${signal.lowerBand.toFixed(4)}</span></p>
              <p className="text-gray-400">Volatilidad: <span className="text-white font-semibold">{signal.volatility.toFixed(2)}%</span></p>
              <p className="text-gray-500 text-xs mt-2">Última actualización: {signal.lastUpdate}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones de Señales Activas</CardTitle>
          <CardDescription className="text-gray-400">
            Operaciones iniciadas automáticamente por señales de ML que están esperando alcanzar su objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActiveSignalTrades />
        </CardContent>
      </Card>
    </div>
  );
};

export default SignalsTrading;