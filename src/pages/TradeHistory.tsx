"use client";

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { History } from 'lucide-react';

interface Trade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number | null; // Puede ser null
  purchase_price: number | null; // Puede ser null
  target_price: number | null; // Puede ser null
  take_profit_percentage: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  status: string;
}

const fetchCompletedTrades = async (userId: string) => {
  // Fetch from manual_trades
  const { data: manualTrades, error: manualError } = await supabase
    .from('manual_trades')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['completed', 'error']);
  if (manualError) throw new Error(manualError.message);

  // Fetch from signal_trades
  const { data: signalTrades, error: signalError } = await supabase
    .from('signal_trades')
    .select('*')
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
  const { data: trades, isLoading, isError } = useQuery<Trade[], Error>({
    queryKey: ['completedTrades'],
    queryFn: () => fetchCompletedTrades(user!.id),
    enabled: !!user,
  });

  if (isLoading) {
    return (
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
    );
  }

  if (isError) {
    return <p className="text-red-400">Error al cargar el historial de operaciones.</p>;
  }

  if (!trades || trades.length === 0) {
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
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400 text-2xl">Historial de Operaciones</CardTitle>
        <CardDescription className="text-gray-400">
          Revisa tus operaciones de trading manual y por señales completadas y con errores.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-gray-700 hover:bg-gray-800">
              <TableHead className="text-white">Par</TableHead>
              <TableHead className="text-white">Inversión (USDT)</TableHead>
              <TableHead className="text-white">Precio Compra</TableHead>
              <TableHead className="text-white">Precio Objetivo</TableHead>
              <TableHead className="text-white">Fecha Apertura</TableHead>
              <TableHead className="text-white">Fecha Cierre</TableHead>
              <TableHead className="text-white">Estado</TableHead>
              <TableHead className="text-white">Mensaje Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id} className="border-gray-700">
                <TableCell className="font-medium text-white">{trade.pair}</TableCell>
                <TableCell className="text-gray-300">{trade.usdt_amount.toFixed(2)}</TableCell>
                <TableCell className="text-gray-300">{trade.purchase_price?.toFixed(4) || 'N/A'}</TableCell>
                <TableCell className="text-yellow-400">{trade.target_price?.toFixed(4) || 'N/A'}</TableCell>
                <TableCell className="text-gray-300">{new Date(trade.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-gray-300">
                  {trade.completed_at ? new Date(trade.completed_at).toLocaleString() : 'N/A'}
                </TableCell>
                <TableCell className={`font-bold ${trade.status === 'completed' ? 'text-green-400' : 'text-red-400'}`}>
                  {trade.status === 'completed' ? 'Completada' : 'Error'}
                </TableCell>
                <TableCell className="text-red-400">{trade.error_message || 'N/A'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default TradeHistory;