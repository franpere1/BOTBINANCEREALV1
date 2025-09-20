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

interface AssetMonitoringStatus {
  asset: string;
  latestPrice: HourlyPrice | null;
  count: number;
  targetCount: number; // 100 hours
  deleteThreshold: number; // 150 hours
}

interface HourlyPriceMonitorProps {
  signalAssets: string[]; // Prop para los activos de señales
}

const fetchAssetMonitoringStatus = async (assets: string[]): Promise<AssetMonitoringStatus[]> => {
  if (assets.length === 0) return [];

  const results: AssetMonitoringStatus[] = [];
  for (const asset of assets) {
    // Fetch latest price for the asset
    const { data: latestPriceData, error: priceError } = await supabase
      .from('hourly_prices')
      .select('*')
      .eq('asset', asset)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    // Fetch total count of records for the asset
    const { count, error: countError } = await supabase
      .from('hourly_prices')
      .select('id', { count: 'exact' })
      .eq('asset', asset);

    if (priceError && priceError.code !== 'PGRST116') { // PGRST116 means no rows found
      console.error(`Error fetching latest price for ${asset}:`, priceError);
      // We can still proceed with count if price fetch failed
    }
    if (countError) {
      console.error(`Error fetching count for ${asset}:`, countError);
      // We can still proceed with latest price if count fetch failed
    }

    results.push({
      asset,
      latestPrice: latestPriceData || null,
      count: count || 0,
      targetCount: 100,
      deleteThreshold: 150,
    });
  }
  return results;
};

const HourlyPriceMonitor = ({ signalAssets }: HourlyPriceMonitorProps) => {
  const { data: assetMonitoringStatus, isLoading, isError } = useQuery<AssetMonitoringStatus[], Error>({
    queryKey: ['hourlyPricesMonitoring', signalAssets], // Key depends on signalAssets
    queryFn: () => fetchAssetMonitoringStatus(signalAssets),
    enabled: signalAssets.length > 0, // Only run query if there are assets to monitor
    refetchInterval: 60000, // Update every minute
  });

  if (isError) {
    showError("Error al cargar el estado de monitoreo de precios por hora.");
    return (
      <Card className="w-full max-w-md mx-auto bg-red-900/50 border-red-700 text-center">
        <CardHeader>
          <CardTitle className="text-red-400 text-2xl">Error de Carga</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300">No se pudo cargar el estado de monitoreo de precios por hora.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400 flex items-center">
          <Clock className="mr-2 h-5 w-5" />
          Monitoreo de Precios por Hora (Señales)
        </CardTitle>
        <CardDescription className="text-gray-400">
          Estado de la recolección de precios para los activos de señales. Se mantienen las últimas 100 horas de datos, eliminando los 50 más antiguos al alcanzar 150.
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
            {assetMonitoringStatus && assetMonitoringStatus.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-700">
                    <TableHead className="text-white">Activo</TableHead>
                    <TableHead className="text-right text-white">Precios Recolectados</TableHead>
                    <TableHead className="text-right text-white">Último Precio</TableHead>
                    <TableHead className="text-right text-white">Última Actualización</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assetMonitoringStatus.map((status) => (
                    <TableRow key={status.asset} className="border-gray-700">
                      <TableCell className="font-medium text-white">{status.asset}</TableCell>
                      <TableCell className="text-right text-gray-300">
                        {status.count} de {status.targetCount} horas
                      </TableCell>
                      <TableCell className="text-right text-gray-300">
                        {status.latestPrice ? status.latestPrice.price.toFixed(4) : 'N/A'}
                      </TableCell>
                      <TableCell className="text-right text-gray-300">
                        {status.latestPrice ? new Date(status.latestPrice.timestamp).toLocaleString() : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-gray-400">No hay activos de señales para monitorear o no se han recolectado datos aún.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default HourlyPriceMonitor;