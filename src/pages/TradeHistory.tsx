"use client";

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { History, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Trade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number | null;
  purchase_price: number | null;
  target_price: number | null;
  sell_price: number | null;
  take_profit_percentage: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  status: string;
  profit_loss_usdt: number | null;
}

const fetchCompletedTrades = async (userId: string) => {
  // Fetch from manual_trades
  const { data: manualTrades, error: manualError } = await supabase
    .from('manual_trades')
    .select('*, sell_price, profit_loss_usdt')
    .eq('user_id', userId)
    .in('status', ['completed', 'error']);
  if (manualError) throw new Error(manualError.message);

  // Fetch from signal_trades
  const { data: signalTrades, error: signalError } = await supabase
    .from('signal_trades')
    .select('*, sell_price, profit_loss_usdt')
    .eq('user_id', userId)
    .in('status', ['completed', 'error']);
  if (signalError) throw new Error(signalError.message);

  // Combine and sort all trades by completed_at in descending order
  const allTrades = [...(manualTrades || []), ...(signalTrades || [])];
  
  allTrades.sort((a, b) => {
    const dateA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
    const dateB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
    return dateB - dateA; // Descending order
  });

  return allTrades;
};

const TradeHistory = () => {
  const { user } = useAuth();
  const [displayLimit, setDisplayLimit] = useState(4);
  
  const { data: allSortedTrades, isLoading, isError } = useQuery<Trade[], Error>({
    queryKey: ['completedTrades'],
    queryFn: () => fetchCompletedTrades(user!.id),
    enabled: !!user,
  });

  const tradesToDisplay = allSortedTrades ? allSortedTrades.slice(0, displayLimit) : [];
  const hasMore = allSortedTrades && allSortedTrades.length > displayLimit;

  const handleLoadMore = () => {
    setDisplayLimit(prevLimit => prevLimit + 10);
  };

  // Calcular el resumen de rendimiento
  const totalProfitLoss = allSortedTrades?.reduce((sum, trade) => sum + (trade.profit_loss_usdt || 0), 0) || 0;
  const winningTrades = allSortedTrades?.filter(trade => (trade.profit_loss_usdt || 0) > 0).length || 0;
  const losingTrades = allSortedTrades?.filter(trade => (trade.profit_loss_usdt || 0) < 0).length || 0;
  const neutralTrades = allSortedTrades?.filter(trade => (trade.profit_loss_usdt || 0) === 0 && trade.status === 'completed').length || 0;
  const errorTrades = allSortedTrades?.filter(trade => trade.status === 'error').length || 0;
  const totalCapitalUsed = allSortedTrades?.reduce((sum, trade) => sum + (trade.usdt_amount || 0), 0) || 0;

  const totalProfitLossColor = totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400';
  const TotalPnLIcon = totalProfitLoss >= 0 ? TrendingUp : TrendingDown;
  const totalProfitLossPercentage = totalCapitalUsed > 0 ? (totalProfitLoss / totalCapitalUsed) * 100 : 0;


  if (isLoading) {
    return (
      <div className="space-y-8">
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-3/4 mt-2" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-3/4 mt-2" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return <p className="text-red-400">Error al cargar el historial de operaciones.</p>;
  }

  if (!allSortedTrades || allSortedTrades.length === 0) {
    return (
      <Card className="w-full max-w-lg mx-auto bg-gray-800 border-gray-700 text-center">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Historial de Operaciones</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center p-8">
          <History className="h-16 w-16 text-gray-500 mb-4" />
          <p className="text-xl text-gray-300">
            No tienes operaciones completadas en tu historial.
          </p>
          <p className="text-gray-400 mt-2">
            Las operaciones cerradas aparecerán aquí.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl flex items-center">
            <DollarSign className="h-6 w-6 mr-2" />
            Resumen de Rendimiento
          </CardTitle>
          <CardDescription className="text-gray-400">
            Un vistazo rápido al rendimiento general de tus operaciones.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
            <span className="text-gray-300">Ganancia/Pérdida Total:</span>
            <span className={`font-bold flex items-center ${totalProfitLossColor}`}>
              <TotalPnLIcon className="h-4 w-4 mr-1" />
              ${totalProfitLoss.toFixed(2)}
              {totalCapitalUsed > 0 && (
                <span className="ml-1 text-xs">({totalProfitLossPercentage.toFixed(2)}%)</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
            <span className="text-gray-300">Capital Usado Total:</span>
            <span className="font-bold text-white">${totalCapitalUsed.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
            <span className="text-gray-300">Operaciones Ganadoras:</span>
            <span className="font-bold text-green-400">{winningTrades}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
            <span className="text-gray-300">Operaciones Perdedoras:</span>
            <span className="font-bold text-red-400">{losingTrades}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
            <span className="text-gray-300">Operaciones Neutras:</span>
            <span className="font-bold text-yellow-400">{neutralTrades}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
            <span className="text-gray-300">Operaciones con Error:</span>
            <span className="font-bold text-red-400">{errorTrades}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-700 rounded-md">
            <span className="text-gray-300">Total de Operaciones:</span>
            <span className="font-bold text-white">{allSortedTrades.length}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Historial de Operaciones</CardTitle>
          <CardDescription className="text-gray-400">
            Revisa tus operaciones de trading manual y por señales completadas y con errores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700 hover:bg-gray-800">
                  <TableHead className="text-white">Par</TableHead>
                  <TableHead className="text-white">Inversión (USDT)</TableHead>
                  <TableHead className="text-white">Precio Compra</TableHead>
                  <TableHead className="text-white">Precio Venta</TableHead>
                  <TableHead className="text-white">Precio Objetivo</TableHead>
                  <TableHead className="text-white">Fecha Apertura</TableHead>
                  <TableHead className="text-white">Fecha Cierre</TableHead>
                  <TableHead className="text-white">Estado</TableHead>
                  <TableHead className="text-white">Ganancia/Pérdida</TableHead>
                  <TableHead className="text-white">Mensaje Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tradesToDisplay.map((trade) => {
                  const pnlPercentage = (trade.purchase_price && trade.sell_price)
                    ? ((trade.sell_price - trade.purchase_price) / trade.purchase_price) * 100
                    : null;
                  const pnlColor = (trade.profit_loss_usdt || 0) >= 0 ? 'text-green-400' : 'text-red-400';
                  
                  return (
                    <TableRow key={trade.id} className="border-gray-700">
                      <TableCell className="font-medium text-white">{trade.pair}</TableCell>
                      <TableCell className="text-gray-300">{trade.usdt_amount.toFixed(2)}</TableCell>
                      <TableCell className="text-gray-300">{trade.purchase_price?.toFixed(4) || 'N/A'}</TableCell>
                      <TableCell className="text-gray-300">{trade.sell_price?.toFixed(4) || 'N/A'}</TableCell>
                      <TableCell className="text-yellow-400">{trade.target_price?.toFixed(4) || 'N/A'}</TableCell>
                      <TableCell className="text-gray-300">{new Date(trade.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-gray-300">
                        {trade.completed_at ? new Date(trade.completed_at).toLocaleString() : 'N/A'}
                      </TableCell>
                      <TableCell className={`font-bold ${trade.status === 'completed' ? 'text-green-400' : 'text-red-400'}`}>
                        {trade.status === 'completed' ? 'Completada' : 'Error'}
                      </TableCell>
                      <TableCell className={pnlColor}>
                        {trade.profit_loss_usdt !== null ? `$${trade.profit_loss_usdt.toFixed(2)}` : 'N/A'}
                        {pnlPercentage !== null && ` (${pnlPercentage.toFixed(2)}%)`}
                      </TableCell>
                      <TableCell className="text-red-400">{trade.error_message || 'N/A'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {hasMore && (
            <div className="text-center mt-6">
              <Button onClick={handleLoadMore} disabled={isLoading} className="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
                Ver más (10 en 10)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TradeHistory;