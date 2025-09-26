"use client";

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, TrendingUp, TrendingDown, PauseCircle, Loader2, AlertCircle } from 'lucide-react';
import { showError } from '@/utils/toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerTitle,
  DrawerDescription,
  DrawerHeader,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';

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
  klinesSource?: string;
}

const topPairs = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'SHIBUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT'
];

const fetchMlSignalForAsset = async (asset: string): Promise<SignalData> => {
  const { data, error } = await supabase.functions.invoke('get-ml-signals', {
    body: { asset },
  });
  if (error) throw new Error(data?.error || error.message);
  // The Edge Function returns an array, we expect one signal for the requested asset
  if (!data || data.length === 0) throw new Error(`No signal data found for ${asset}`);
  return data[0] as SignalData;
};

const MarketAdvisor = () => {
  const [selectedAsset, setSelectedAsset] = useState<string>('BTCUSDT');
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const { data: signal, isLoading, isError, error } = useQuery<SignalData, Error>({
    queryKey: ['marketAdvisorSignal', selectedAsset],
    queryFn: () => fetchMlSignalForAsset(selectedAsset),
    refetchInterval: 15000, // Refresh every 15 seconds
    enabled: !!selectedAsset,
  });

  if (isError) {
    showError(`Error al cargar la señal para ${selectedAsset}: ${error?.message}`);
  }

  const getSignalDisplay = (signalType: SignalData['signal']) => {
    switch (signalType) {
      case 'BUY': return { icon: <TrendingUp className="h-8 w-8 text-green-400" />, message: "¡Señal de COMPRA! El mercado parece favorable para este activo." };
      case 'SELL': return { icon: <TrendingDown className="h-8 w-8 text-red-400" />, message: "¡Señal de VENTA! Considera tomar ganancias o reducir exposición." };
      case 'HOLD': return { icon: <PauseCircle className="h-8 w-8 text-yellow-400" />, message: "¡Señal de MANTENER! El mercado está indeciso, espera una dirección clara." };
      default: return { icon: <Bot className="h-8 w-8 text-gray-400" />, message: "Analizando el mercado..." };
    }
  };

  const renderSelect = (fieldValue: string, onValueChange: (value: string) => void) => (
    <Select onValueChange={onValueChange} defaultValue={fieldValue}>
      <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
        <SelectValue placeholder="Selecciona un activo" />
      </SelectTrigger>
      <SelectContent className="bg-gray-700 border-gray-600 text-white">
        {topPairs.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const renderDrawerSelect = (fieldValue: string, onValueChange: (value: string) => void) => (
    <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" className="w-full justify-between bg-gray-700 border-gray-600 text-white">
          {fieldValue ? fieldValue : "Selecciona un activo"}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-chevrons-up-down ml-2 h-4 w-4 shrink-0 opacity-50"
          >
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </svg>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="bg-gray-800 text-white border-gray-700">
        <DrawerHeader>
          <DrawerTitle className="text-yellow-400">Selecciona un Activo</DrawerTitle>
          <DrawerDescription className="text-gray-400">
            Elige el activo que el asesor debe monitorear.
          </DrawerDescription>
        </DrawerHeader>
        <div className="p-4 overflow-y-auto max-h-[70vh]">
          {topPairs.map(p => (
            <div
              key={p}
              className="flex items-center p-3 mb-2 rounded-md cursor-pointer hover:bg-gray-700 transition-colors"
              onClick={() => {
                onValueChange(p);
                setIsDrawerOpen(false);
              }}
            >
              <span className="text-white">{p}</span>
            </div>
          ))}
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline" className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
              Cerrar
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );

  const currentSignalDisplay = signal ? getSignalDisplay(signal.signal) : getSignalDisplay('HOLD');

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700 text-white">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-2xl font-bold text-yellow-400 flex items-center">
          <Bot className="h-6 w-6 mr-2" />
          Asesor de Mercado
        </CardTitle>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : isError ? (
          <AlertCircle className="h-5 w-5 text-red-400" />
        ) : (
          <span className={`text-sm px-3 py-1 rounded-full font-semibold ${
            signal && signal.confidence >= 70 ? 'bg-green-600 text-white' :
            signal && signal.confidence >= 50 ? 'bg-yellow-500 text-gray-900' :
            'bg-gray-600 text-gray-300'
          }`}>
            {signal?.confidence.toFixed(1) || 'N/A'}% Confianza
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-center flex-col text-center">
          {isLoading ? (
            <Skeleton className="h-16 w-16 rounded-full mb-4" />
          ) : (
            <div className="mb-4">{currentSignalDisplay.icon}</div>
          )}
          {isLoading ? (
            <Skeleton className="h-6 w-3/4 mb-2" />
          ) : (
            <p className="text-xl font-semibold text-white mb-2">{currentSignalDisplay.message}</p>
          )}
          {isLoading ? (
            <Skeleton className="h-5 w-1/2" />
          ) : (
            <p className="text-lg text-gray-300">
              {signal?.asset}: <span className="font-bold">${signal?.price.toFixed(4) || 'N/A'}</span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-gray-300 text-sm">Activo monitoreado:</p>
          {isMobile ? renderDrawerSelect(selectedAsset, setSelectedAsset) : renderSelect(selectedAsset, setSelectedAsset)}
        </div>
        {!isLoading && signal && (
          <p className="text-gray-500 text-xs text-center">Última actualización: {signal.lastUpdate}</p>
        )}
      </CardContent>
    </Card>
  );
};

export default MarketAdvisor;