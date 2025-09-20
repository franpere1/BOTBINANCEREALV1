"use client";

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/utils/toast';
import { useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface Trade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number | null; // Puede ser null para awaiting_dip_signal
  purchase_price: number | null; // Puede ser null para awaiting_dip_signal
  target_price: number | null; // Puede ser null para awaiting_dip_signal
  take_profit_percentage: number;
  created_at: string;
  status: 'active' | 'awaiting_dip_signal'; // Añadir el nuevo estado
  strategy_type: 'manual' | 'strategic'; // Nuevo campo para diferenciar
  dip_percentage: number | null; // Para trades estratégicos
  lookback_minutes: number | null; // Para trades estratégicos
  error_message: string | null; // Para mostrar la razón de 'awaiting_dip_signal'
}

const fetchActiveTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('manual_trades')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'awaiting_dip_signal']) // Incluir el nuevo estado
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

const ActiveTradeRow = ({ trade }: { trade: Trade }) => {
  const queryClient = useQueryClient();
  const [isActionLoading, setIsActionLoading] = useState(false);
  
  const isAwaitingDipSignal = trade.status === 'awaiting_dip_signal';

  const { data: currentPrice, isLoading: isLoadingPrice } = useQuery({
    queryKey: ['tickerPrice', trade.pair],
    queryFn: () => fetchTickerPrice(trade.pair),
    enabled: !isAwaitingDipSignal, // Solo cargar precio si no está esperando señal
    refetchInterval: 5000, // Consultar el precio cada 5 segundos
  });

  const handleCloseOrDeleteTrade = async () => {
    setIsActionLoading(true);
    try {
      if (isAwaitingDipSignal) {
        // Eliminar la operación estratégica pendiente
        const { data, error: functionError } = await supabase.functions.invoke('delete-manual-trade', {
          body: { tradeId: trade.id },
        });
        if (functionError) throw functionError;
        
        if (data.binanceError) {
          showError(`Monitoreo de ${trade.pair} eliminado, pero hubo un error al intentar vender activos en Binance: ${data.binanceError}`);
        } else {
          showSuccess(`Monitoreo de ${trade.pair} eliminado con éxito.`);
        }
      } else {
        // Cerrar la operación manual activa
        const { data, error: functionError } = await supabase.functions.invoke('close-trade', {
          body: {
            tradeId: trade.id,
            tradeType: 'manual',
          },
        });

        if (functionError) throw functionError;
        
        if (data.binanceError) {
          showError(`Operación de ${trade.pair} marcada como completada, pero hubo un error al vender activos en Binance: ${data.binanceError}`);
        } else {
          showSuccess(`¡Operación de ${trade.pair} cerrada manualmente!`);
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ['activeTrades'] });
      queryClient.invalidateQueries({ queryKey: ['activeTradesForSummary'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
      queryClient.invalidateQueries({ queryKey: ['completedTrades'] });
    } catch (error: any) {
      showError(`Error al procesar la acción para ${trade.pair}: ${error.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const pnl = (currentPrice && trade.purchase_price) ? ((currentPrice - trade.purchase_price) / trade.purchase_price) * 100 : 0;
  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <TableRow className="border-gray-700">
      <TableCell className="font-medium text-white">{trade.pair}</TableCell>
      <TableCell className="text-gray-300">{new Date(trade.created_at).toLocaleString()}</TableCell>
      <TableCell className="text-gray-300">{trade.purchase_price?.toFixed(4) || 'N/A'}</TableCell>
      <TableCell className="text-yellow-400">{trade.target_price?.toFixed(4) || 'N/A'}</TableCell>
      <TableCell className="text-gray-300">{trade.take_profit_percentage.toFixed(2)}%</TableCell>
      <TableCell className="text-white">
        {isLoadingPrice || isAwaitingDipSignal ? <Skeleton className="h-4 w-16" /> : currentPrice?.toFixed(4)}
      </TableCell>
      <TableCell className={pnlColor}>{isAwaitingDipSignal ? 'N/A' : `${pnl.toFixed(2)}%`}</TableCell>
      <TableCell className={`font-bold ${
        isAwaitingDipSignal ? 'text-blue-400' : 'text-green-400'
      }`}>
        {isAwaitingDipSignal ? 'Esperando Dip' : 'Activa'}
      </TableCell>
      <TableCell className="text-gray-300">
        {trade.strategy_type === 'strategic' ? (
          <>
            Dip: {trade.dip_percentage?.toFixed(1)}% / 
            Lookback: {trade.lookback_minutes} min
            {trade.error_message && (
              <div className="flex items-center text-red-400 text-xs mt-1">
                <AlertCircle className="h-3 w-3 mr-1" />
                {trade.error_message}
              </div>
            )}
          </>
        ) : 'N/A'}
      </TableCell>
      <TableCell className="text-right">
        <Dialog>
          <DialogTrigger asChild>
            <Button 
              variant="destructive" 
              size="sm" 
              disabled={isActionLoading}
            >
              {isActionLoading ? 'Cargando...' : <Trash2 className="h-4 w-4" />}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-red-400">
                {isAwaitingDipSignal ? 'Confirmar Cancelación de Estrategia' : 'Confirmar Cierre de Operación'}
              </DialogTitle>
              <DialogDescription className="text-gray-400">
                {isAwaitingDipSignal
                  ? `¿Estás seguro de que quieres cancelar la estrategia de compra para ${trade.pair}? Esto eliminará el monitoreo de dip.`
                  : `¿Estás seguro de que quieres cerrar la operación manual de ${trade.pair}? Si la operación está activa, se intentarán vender los activos restantes en Binance.`
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsActionLoading(false)} disabled={isActionLoading} className="text-gray-300 border-gray-600 hover:bg-gray-700">
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleCloseOrDeleteTrade} disabled={isActionLoading}>
                {isActionLoading 
                  ? 'Procesando...' 
                  : (isAwaitingDipSignal ? 'Cancelar Estrategia' : 'Cerrar Trade')
                }
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
};

const ActiveTrades = () => {
  const { user } = useAuth();
  const { data: trades, isLoading, isError } = useQuery({
    queryKey: ['activeTrades'],
    queryFn: () => fetchActiveTrades(user!.id),
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
    return <p className="text-red-400">Error al cargar las operaciones activas.</p>;
  }

  if (!trades || trades.length === 0) {
    return <p className="text-center text-gray-400">No tienes operaciones activas o estratégicas pendientes en este momento.</p>;
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
          <TableHead className="text-white">Estado</TableHead>
          <TableHead className="text-white">Detalles Estrategia</TableHead>
          <TableHead className="text-right text-white">Acción</TableHead>
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