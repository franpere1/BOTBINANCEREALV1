"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Rocket } from 'lucide-react';
import PumpFivePairsConfigForm from '@/components/PumpFivePairsConfigForm';
import ActivePumpFivePairsTrades from '@/components/ActivePumpFivePairsTrades';
import HourlyPriceMonitor from '@/components/HourlyPriceMonitor';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { showError } from '@/utils/toast';

// Función para obtener los top 5 pares dinámicamente
const fetchTopPumpPairs = async (): Promise<string[]> => {
  const { data, error } = await supabase.functions.invoke('get-top-pump-pairs');
  if (error) throw new Error(data?.error || error.message);
  return data as string[];
};

const PumpFivePairs = () => {
  const { data: topPumpPairs, isLoading: isLoadingTopPairs, isError: isErrorTopPairs, error: topPairsError } = useQuery<string[], Error>({
    queryKey: ['topPumpPairs'],
    queryFn: fetchTopPumpPairs,
    refetchInterval: 60000, // Refrescar la lista de top pairs cada minuto
  });

  if (isErrorTopPairs) {
    showError(`Error al cargar los top 5 pares para monitoreo: ${topPairsError?.message}`);
    return (
      <Card className="w-full bg-red-900/50 border-red-700 text-center">
        <CardHeader>
          <CardTitle className="text-red-400 text-2xl flex items-center justify-center">
            <AlertCircle className="h-6 w-6 mr-2" /> Error de Carga
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300">No se pudieron cargar los top 5 pares para el monitoreo.</p>
          <p className="text-red-400 text-sm mt-1">{topPairsError?.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl flex items-center">
            <Rocket className="h-6 w-6 mr-2" />
            Estrategia: Pump 5 Pares
          </CardTitle>
          <CardDescription className="text-gray-400">
            Configura tu estrategia de trading automático para identificar y operar los 5 pares USDT con mayor impulso alcista.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PumpFivePairsConfigForm />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {isLoadingTopPairs ? (
          <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
            <CardHeader>
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-full mt-2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ) : (
          <HourlyPriceMonitor signalAssets={topPumpPairs || []} />
        )}
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones Activas (Pump 5 Pares)</CardTitle>
          <CardDescription className="text-gray-400">
            Operaciones iniciadas por la estrategia 'Pump 5 Pares' que están activas o pendientes de entrada, esperando alcanzar su objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivePumpFivePairsTrades />
        </CardContent>
      </Card>
    </div>
  );
};

export default PumpFivePairs;