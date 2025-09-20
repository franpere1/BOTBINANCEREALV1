"use client";

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock } from 'lucide-react';
import { showError } from '@/utils/toast';

interface MinutePrice {
  id: string;
  asset: string;
  close_price: number;
  created_at: string;
}

interface AssetMonitoringStatus {
  asset: string;
  latestPrice: MinutePrice | null;
  count: number;
  targetCount: number; // 300 minutes (5 hours)
  deleteThreshold: number; // 350 minutes
}

interface MinutePriceMonitorProps {
  strategicAssets: string[]; // Prop para los activos estratégicos
}

const fetchAssetMonitoringStatus = async (assets: string[]): Promise<AssetMonitoringStatus[]> => {
  if (assets.length === 0) return [];

  const results: AssetMonitoringStatus[] = [];
  for (const asset of assets) {
    // Fetch latest price for the asset
    const { data: latestPriceData, error: priceError } = await supabase
      .from('minute_prices')
      .select('close_price, created_at')
      .eq('asset', asset)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Fetch total count of records for the asset
    const { count, error: countError } = await supabase
      .from('minute_prices')
      .select('id', { count: 'exact' })
      .eq('asset', asset);

    if (priceError && priceError.code !== 'PGRST116') { // PGRST116 means no rows found
      console.error(`Error fetching latest minute price for ${asset}:`, priceError);
    }
    if (countError) {
      console.error(`Error fetching minute price count for ${asset}:`, countError);
    }

    results.push({
      asset,
      latestPrice: latestPriceData ? { id: '', asset, close_price: latestPriceData.close_price, created_at: latestPriceData.created_at } : null,
      count: count || 0,
      targetCount: 300, // 5 hours
      deleteThreshold: 350,
    });
  }
  return results;
};

const MinutePriceMonitor = ({ strategicAssets }: MinutePriceMonitorProps) => {
  const { data: assetMonitoringStatus, isLoading, isError } = useQuery<AssetMonitoringStatus[], Error>({
    queryKey: ['minutePricesMonitoring', strategicAssets], // Key depends on strategicAssets
    queryFn: () => fetchAssetMonitoringStatus(strategicAssets),
    enabled: strategicAssets.length > 0, // Only run query if there are assets to monitor
    refetchInterval: 10000, // Update every 10 seconds
  });

  if (isError) {
    showError("Error al cargar el estado de monitoreo de precios por minuto.");
    return (
      <Card className="w-full max-w-md mx-auto bg-red-900/50 border-red-700 text-center">
        <CardHeader>
          <CardTitle className="text-red-400 text-2xl">Error de Carga</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300">No se pudo cargar el estado de monitoreo de precios por minuto.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400 flex items-center">
          <Clock className="mr-2 h-5 w-5" />
          Monitoreo de Precios por Minuto
        </CardTitle>
        <CardDescription className="text-gray-400">
          Estado de la recolección de precios por minuto para el análisis de microtendencias. Se mantienen las últimas 5 horas de datos.
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
                        {status.count} de {status.targetCount} minutos
                      </TableCell>
                      <TableCell className="text-right text-gray-300">
                        {status.latestPrice ? status.latestPrice.close_price.toFixed(4) : 'N/A'}
                      </TableCell>
                      <TableCell className="text-right text-gray-300">
                        {status.latestPrice ? new Date(status.latestPrice.created_at).toLocaleString() : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-gray-400">No hay activos estratégicos para monitorear o no se han recolectado datos aún.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default MinutePriceMonitor;