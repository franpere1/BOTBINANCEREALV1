"use client";

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, AlertCircle } from 'lucide-react';

const ASSETS_TO_MONITOR = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'TRXUSDT'];
const RECORDS_TO_KEEP = 6000; // Cantidad de registros a mantener después de borrar (100 horas * 60 minutos)

interface MinutePriceCount {
  asset: string;
  count: number;
}

const fetchMinutePriceCounts = async (userId: string): Promise<MinutePriceCount[]> => {
  const counts: MinutePriceCount[] = [];
  for (const asset of ASSETS_TO_MONITOR) {
    const { count, error } = await supabase
      .from('minute_prices')
      .select('id', { count: 'exact', head: true })
      .eq('asset', asset);

    if (error) {
      console.error(`Error fetching count for ${asset}:`, error);
      counts.push({ asset, count: 0 }); // Report 0 or handle error as needed
    } else {
      counts.push({ asset, count: count || 0 });
    }
  }
  return counts;
};

const MinutePriceCollectorStatus = () => {
  const { user } = useAuth();
  const { data: priceCounts, isLoading, isError } = useQuery<MinutePriceCount[], Error>({
    queryKey: ['minutePriceCounts'],
    queryFn: () => fetchMinutePriceCounts(user!.id),
    enabled: !!user,
    refetchInterval: 60000, // Refrescar cada minuto
  });

  if (isLoading) {
    return (
      <Card className="w-full bg-gray-800 border-gray-700 text-white">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-3/4" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="w-full bg-red-900/50 border-red-700 text-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-red-400 text-lg flex items-center">
            <AlertCircle className="h-5 w-5 mr-2" /> Error de Recolección
          </CardTitle>
          <CardDescription className="text-red-300">
            No se pudo cargar el estado de la recolección de precios por minuto.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full bg-gray-800 border-gray-700 text-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-yellow-400 flex items-center">
          <Clock className="h-5 w-5 mr-2" />
          Estado de Recolección de Precios por Minuto
        </CardTitle>
        <CardDescription className="text-gray-400">
          Puntos de datos históricos recolectados para el análisis de señales.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
        {priceCounts?.map((item) => (
          <p key={item.asset} className="text-gray-400">
            {item.asset}: <span className="text-white font-semibold">{item.count} / {RECORDS_TO_KEEP}</span>
          </p>
        ))}
      </CardContent>
    </Card>
  );
};

export default MinutePriceCollectorStatus;