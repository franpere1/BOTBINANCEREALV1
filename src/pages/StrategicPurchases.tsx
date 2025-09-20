"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DollarSign, RefreshCcw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { showError } from '@/utils/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import MinutePriceMonitor from '@/components/MinutePriceMonitor';
import StrategicPurchaseForm from '@/components/StrategicPurchaseForm'; // Importar el nuevo formulario
import ActiveTrades from '@/components/ActiveTrades'; // Reutilizar ActiveTrades para mostrar las compras estratégicas

const topPairs = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'SHIBUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT'
];

interface OrderBook {
  lastUpdateId: number;
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][]; // [price, quantity]
}

const fetchOrderBook = async (symbol: string): Promise<OrderBook> => {
  if (!symbol) return { lastUpdateId: 0, bids: [], asks: [] };
  const { data, error } = await supabase.functions.invoke('get-order-book', {
    body: { symbol, limit: 10 }, // Fetch top 10 bids/asks
  });
  if (error) throw new Error(data?.error || error.message);
  return data;
};

const StrategicPurchases = () => {
  const [selectedPair, setSelectedPair] = useState<string>('BTCUSDT');

  const { data: orderBook, isLoading, isError, refetch } = useQuery<OrderBook, Error>({
    queryKey: ['orderBook', selectedPair],
    queryFn: () => fetchOrderBook(selectedPair),
    enabled: !!selectedPair,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  if (isError) {
    showError(`Error al cargar el libro de órdenes para ${selectedPair}.`);
  }

  return (
    <div className="space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl flex items-center">
            <DollarSign className="h-6 w-6 mr-2" />
            Compras Estratégicas
          </CardTitle>
          <CardDescription className="text-gray-400">
            Configura una estrategia de compra automática basada en dips de precio y monitorea la profundidad del mercado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StrategicPurchaseForm />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-yellow-400 text-2xl">Libro de Órdenes</CardTitle>
            <CardDescription className="text-gray-400">
              Monitorea las ofertas de compra y venta en tiempo real para {selectedPair}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-4 mb-6">
              <div className="flex-1 w-full">
                <Label htmlFor="pair-select" className="text-gray-300">Selecciona un Par</Label>
                <Select onValueChange={setSelectedPair} defaultValue={selectedPair}>
                  {/* Eliminado FormControl, ya que no es necesario para un Select simple */}
                  <SelectTrigger id="pair-select" className="w-full bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="Selecciona un par" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600 text-white">
                    {topPairs.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => refetch()} disabled={isLoading} className="w-full sm:w-auto bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold mt-auto">
                <RefreshCcw className="mr-2 h-4 w-4" />
                {isLoading ? 'Cargando...' : 'Actualizar'}
              </Button>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-gray-700 border-gray-600">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-green-400 text-xl">Ofertas de Compra (Bids)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-600">
                          <TableHead className="text-white">Precio</TableHead>
                          <TableHead className="text-right text-white">Cantidad</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderBook?.bids.length > 0 ? (
                          orderBook.bids.map(([price, quantity], index) => (
                            <TableRow key={index} className="border-gray-700">
                              <TableCell className="text-green-300">{parseFloat(price).toFixed(4)}</TableCell>
                              <TableCell className="text-right text-gray-300">{parseFloat(quantity).toFixed(4)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={2} className="text-center text-gray-400">No hay ofertas de compra.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="bg-gray-700 border-gray-600">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-red-400 text-xl">Ofertas de Venta (Asks)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-600">
                          <TableHead className="text-white">Precio</TableHead>
                          <TableHead className="text-right text-white">Cantidad</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderBook?.asks.length > 0 ? (
                          orderBook.asks.map(([price, quantity], index) => (
                            <TableRow key={index} className="border-gray-700">
                              <TableCell className="text-red-300">{parseFloat(price).toFixed(4)}</TableCell>
                              <TableCell className="text-right text-gray-300">{parseFloat(quantity).toFixed(4)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={2} className="text-center text-gray-400">No hay ofertas de venta.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>

        <MinutePriceMonitor strategicAssets={topPairs} />
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones Estratégicas Activas</CardTitle>
          <CardDescription className="text-gray-400">
            Operaciones iniciadas por estrategias de compra que están esperando alcanzar su objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActiveTrades /> {/* Reutilizamos este componente para mostrar las operaciones estratégicas */}
        </CardContent>
      </Card>
    </div>
  );
};

export default StrategicPurchases;