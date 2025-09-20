"use client";

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock } from 'lucide-react';
import { showError } from '@/utils/toast';

interface HourlyPrice {
  id: string;
  asset: string;
  price: number;
  timestamp: string;
}

const fetchLatestHourlyPrices = async (): Promise<HourlyPrice[]> => {
  const { data, error } = await supabase
    .from('hourly_prices')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100); // Obtener los últimos 100 registros para mostrar

  if (error) throw new Error(error.message);

  // Filtrar para obtener solo el registro más reciente de cada activo
  const latestPricesMap = new Map<string, HourlyPrice>();
  data.forEach(price => {
    if (!latestPricesMap.has(price.asset)) {
      latestPricesMap.set(price.asset, price);
    }
  });
  return Array.from(latestPricesMap.values());
};

const HourlyPriceMonitor = () => {
  const { data: hourlyPrices, isLoading, isError } = useQuery<HourlyPrice[], Error>({
    queryKey: ['hourlyPrices'],
    queryFn: fetchLatestHourlyPrices,
    refetchInterval: 60000, // Actualizar cada minuto para ver los cambios
  });

  if (isError) {
    showError("Error al cargar los precios por hora.");
    return (
      <Card className="w-full max-w-md mx-auto bg-red-900/50 border-red-700 text-center">
        <CardHeader>
          <CardTitle className="text-red-400 text-2xl">Error de Carga</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300">No se pudieron cargar los precios por hora.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400 flex items-center">
          <Clock className="mr-2 h-5 w-5" />
          Precios por Hora Recolectados
        </CardTitle>
        <CardDescription className="text-gray-400">
          Últimos precios de activos recolectados automáticamente cada hora.
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
            {hourlyPrices && hourlyPrices.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-700">
                    <TableHead className="text-white">Activo</TableHead>
                    <TableHead className="text-right text-white">Precio</TableHead>
                    <TableHead className="text-right text-white">Última Actualización</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hourlyPrices.map((price) => (
                    <TableRow key={price.id} className="border-gray-700">
                      <TableCell className="font-medium text-white">{price.asset}</TableCell>
                      <TableCell className="text-right text-gray-300">{price.price.toFixed(4)}</TableCell>
                      <TableCell className="text-right text-gray-300">
                        {new Date(price.timestamp).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-gray-400">No hay datos de precios por hora aún.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default HourlyPriceMonitor;