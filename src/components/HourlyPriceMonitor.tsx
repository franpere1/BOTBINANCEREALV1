"use client";

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock } from 'lucide-react';
import { showError } from '@/utils/toast';
import { useAuth } from '@/context/AuthProvider'; // Importar useAuth para habilitar la query solo si hay usuario

interface LivePrice {
  asset: string;
  price: number;
  timestamp: string;
  error?: string;
}

interface HourlyPriceMonitorProps {
  signalAssets: string[]; // Prop para los activos de señales
}

const fetchLiveHourlyPrices = async (assets: string[]): Promise<LivePrice[]> => {
  if (assets.length === 0) return [];

  const { data, error } = await supabase.functions.invoke('get-latest-hourly-prices', {
    body: { assets },
  });
  if (error) throw new Error(data?.error || error.message);
  return data as LivePrice[];
};

const HourlyPriceMonitor = ({ signalAssets }: HourlyPriceMonitorProps) => {
  const { user } = useAuth(); // Obtener el usuario para habilitar la query
  const { data: livePrices, isLoading, isError, error } = useQuery<LivePrice[], Error>({
    queryKey: ['liveHourlyPrices', signalAssets], // Key depende de signalAssets
    queryFn: () => fetchLiveHourlyPrices(signalAssets),
    enabled: signalAssets.length > 0 && !!user, // Solo ejecutar si hay activos y el usuario está autenticado
    refetchInterval: 60000, // Actualizar cada minuto
  });

  if (isError) {
    showError(`Error al cargar los precios en tiempo real: ${error?.message}`);
    return (
      <Card className="w-full max-w-md mx-auto bg-red-900/50 border-red-700 text-center">
        <CardHeader>
          <CardTitle className="text-red-400 text-2xl">Error de Carga</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300">No se pudieron cargar los precios en tiempo real.</p>
          <p className="text-red-400 text-sm mt-1">{error?.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400 flex items-center">
          <Clock className="mr-2 h-5 w-5" />
          Monitoreo de Precios en Vivo
        </CardTitle>
        <CardDescription className="text-gray-400">
          Precios actuales de los activos monitoreados, obtenidos directamente de Binance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            {livePrices && livePrices.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-700">
                    <TableHead className="text-white">Activo</TableHead>
                    <TableHead className="text-right text-white">Precio Actual</TableHead>
                    <TableHead className="text-right text-white">Última Actualización</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {livePrices.map((priceData) => (
                    <TableRow key={priceData.asset} className="border-gray-700">
                      <TableCell className="font-medium text-white">{priceData.asset}</TableCell>
                      <TableCell className="text-right text-gray-300">
                        {priceData.error ? <span className="text-red-400">Error</span> : priceData.price.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right text-gray-300">
                        {new Date(priceData.timestamp).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-gray-400">No hay activos para monitorear o no se han podido obtener los precios.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default HourlyPriceMonitor;