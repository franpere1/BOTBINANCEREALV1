"use client";

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/utils/toast';
import { useState } from 'react';
import { AlertCircle } from 'lucide-react';

interface SignalTrade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number;
  purchase_price: number;
  target_price: number;
  take_profit_percentage: number;
  created_at: string;
}

const fetchActiveSignalTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('signal_trades')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
};

const fetchTickerPrice = async (pair: string) => {
  const { data, error } = await supabase.functions.invoke('get-ticker-price', {
    body: { pair },
  });
  if (error) throw new Error(data?.error || error.message);
  return parseFloat(data.price);
};

const ActiveSignalTradeRow = ({ trade }: { trade: SignalTrade }) => {
  const queryClient = useQueryClient();
  const [isClosing, setIsClosing] = useState(false);
  const { data: currentPrice, isLoading: isLoadingPrice } = useQuery({
    queryKey: ['tickerPrice', trade.pair],
    queryFn: () => fetchTickerPrice(trade.pair),
    refetchInterval: 5000, // Consultar el precio cada 5 segundos
  });

  const handleCloseTrade = async () => {
    setIsClosing(true);
    try {
      // Llamar a la nueva función Edge close-trade
      const { data, error: functionError } = await supabase.functions.invoke('close-trade', {
        body: {
          tradeId: trade.id,
          tradeType: 'signal',
        },
      });

      if (functionError) {
        throw functionError;
      }
      if (data.error) { // Verificar si la función Edge devolvió un error en el cuerpo
        throw new Error(data.error);
      }

      showSuccess(`¡Operación de ${trade.pair} cerrada manualmente!`);
      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] }); // Invalidar también el resumen
    } catch (error: any) {
      showError(`Error al cerrar la operación de ${trade.pair}: ${error.message}`);
    } finally {
      setIsClosing(false);
    }
  };

  const pnl = currentPrice ? ((currentPrice - trade.purchase_price) / trade.purchase_price) * 100 : 0;
  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <TableRow className="border-gray-700">
      <TableCell className="font-medium text-white">{trade.pair}</TableCell>
      <TableCell className="text-gray-300">{new Date(trade.created_at).toLocaleString()}</TableCell>
      <TableCell className="text-gray-300">{trade.purchase_price.toFixed(4)}</TableCell>
      <TableCell className="text-yellow-400">{trade.target_price.toFixed(4)}</TableCell>
      <TableCell className="text-gray-300">{trade.take_profit_percentage.toFixed(2)}%</TableCell>
      <TableCell className="text-white">
        {isLoadingPrice ? <Skeleton className="h-4 w-16" /> : currentPrice?.toFixed(4)}
      </TableCell>
      <TableCell className={pnlColor}>{pnl.toFixed(2)}%</TableCell>
      <TableCell className="text-right">
        <Button 
          variant="destructive" 
          size="sm" 
          onClick={handleCloseTrade} 
          disabled={isClosing}
        >
          {isClosing ? 'Cerrando...' : 'Cerrar'}
        </Button>
      </TableCell>
    </TableRow>
  );
};

const ActiveSignalTrades = () => {
  const { user } = useAuth();
  const { data: trades, isLoading, isError } = useQuery({
    queryKey: ['activeSignalTrades'],
    queryFn: () => fetchActiveSignalTrades(user!.id),
    enabled: !!user,
    refetchInterval: 10000, // Refrescar la lista de trades activos cada 10 segundos
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center p-4 bg-red-900/50 rounded-md border border-red-700">
        <AlertCircle className="h-6 w-6 text-red-400 mr-4 flex-shrink-0" />
        <div>
          <h4 className="font-bold text-red-300">Error</h4>
          <p className="text-sm text-red-400 mt-1">Error al cargar las operaciones de señales activas.</p>
        </div>
      </div>
    );
  }

  if (!trades || trades.length === 0) {
    return <p className="text-center text-gray-400">No tienes operaciones de señales activas en este momento.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-gray-700 hover:bg-gray-800">
          <TableHead className="text-white">Par</TableHead>
          <TableHead className="text-white">Fecha Apertura</TableHead>
          <TableHead className="text-white">Precio Compra</TableHead>
          <TableHead className="text-white">Precio Objetivo</TableHead>
          <TableHead className="text-white">Objetivo (%)</TableHead>
          <TableHead className="text-white">Precio Actual</TableHead>
          <TableHead className="text-white">Ganancia/Pérdida</TableHead>
          <TableHead className="text-right text-white">Acción</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <ActiveSignalTradeRow key={trade.id} trade={trade} />
        ))}
      </TableBody>
    </Table>
  );
};

export default ActiveSignalTrades;