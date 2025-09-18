"use client";

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { showError, showSuccess } from '@/utils/toast';
import { useEffect } from 'react';

interface Trade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number;
  purchase_price: number;
  target_price: number;
  take_profit_percentage: number;
}

const fetchActiveTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('manual_trades')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  return data;
};

const fetchTickerPrice = async (pair: string) => {
  const { data, error } = await supabase.functions.invoke('get-ticker-price', {
    body: { pair },
  });
  if (error) throw new Error(error.message);
  return parseFloat(data.price);
};

const ActiveTradeRow = ({ trade }: { trade: Trade }) => {
  const queryClient = useQueryClient();
  const { data: currentPrice, isLoading } = useQuery({
    queryKey: ['tickerPrice', trade.pair],
    queryFn: () => fetchTickerPrice(trade.pair),
    refetchInterval: 5000, // Consultar el precio cada 5 segundos
  });

  useEffect(() => {
    const checkTakeProfit = async () => {
      if (currentPrice && currentPrice >= trade.target_price) {
        try {
          // 1. Ejecutar la venta
          const { data: sellOrder, error: sellError } = await supabase.functions.invoke('place-market-order', {
            body: {
              pair: trade.pair,
              side: 'SELL',
              quantity: trade.asset_amount,
            },
          });
          if (sellError) throw sellError;

          // 2. Actualizar la operación a 'completed'
          const { error: updateError } = await supabase
            .from('manual_trades')
            .update({
              status: 'completed',
              binance_order_id_sell: sellOrder.orderId.toString(),
              completed_at: new Date().toISOString(),
            })
            .eq('id', trade.id);
          if (updateError) throw updateError;

          showSuccess(`¡Venta de ${trade.pair} ejecutada en ganancia!`);
          queryClient.invalidateQueries({ queryKey: ['activeTrades'] });
        } catch (error: any) {
          showError(`Error al vender ${trade.pair}: ${error.message}`);
        }
      }
    };

    checkTakeProfit();
  }, [currentPrice, trade, queryClient]);

  const pnl = currentPrice ? ((currentPrice - trade.purchase_price) / trade.purchase_price) * 100 : 0;
  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <TableRow className="border-gray-700">
      <TableCell className="font-medium text-white">{trade.pair}</TableCell>
      <TableCell className="text-gray-300">{trade.usdt_amount.toFixed(2)} USDT</TableCell>
      <TableCell className="text-gray-300">{trade.purchase_price.toFixed(4)}</TableCell>
      <TableCell className="text-yellow-400">{trade.target_price.toFixed(4)}</TableCell>
      <TableCell className="text-white">
        {isLoading ? <Skeleton className="h-4 w-16" /> : currentPrice?.toFixed(4)}
      </TableCell>
      <TableCell className={pnlColor}>{pnl.toFixed(2)}%</TableCell>
    </TableRow>
  );
};

const ActiveTrades = () => {
  const { user } = useAuth();
  const { data: trades, isLoading, isError } = useQuery({
    queryKey: ['activeTrades'],
    queryFn: () => fetchActiveTrades(user!.id),
    enabled: !!user,
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
    return <p className="text-red-400">Error al cargar las operaciones activas.</p>;
  }

  if (!trades || trades.length === 0) {
    return <p className="text-center text-gray-400">No tienes operaciones activas en este momento.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-gray-700 hover:bg-gray-800">
          <TableHead className="text-white">Par</TableHead>
          <TableHead className="text-white">Inversión</TableHead>
          <TableHead className="text-white">Precio Compra</TableHead>
          <TableHead className="text-white">Precio Objetivo</TableHead>
          <TableHead className="text-white">Precio Actual</TableHead>
          <TableHead className="text-white">Ganancia/Pérdida</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <ActiveTradeRow key={trade.id} trade={trade} />
        ))}
      </TableBody>
    </Table>
  );
};

export default ActiveTrades;