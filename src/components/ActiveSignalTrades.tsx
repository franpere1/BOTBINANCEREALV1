"use client";

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/utils/toast';
import { useState } from 'react';
import { AlertCircle, Trash2, Edit } from 'lucide-react'; // Importar el icono Edit
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface SignalTrade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number | null; // Puede ser null si está awaiting_buy_signal
  purchase_price: number | null; // Puede ser null si está awaiting_buy_signal
  target_price: number | null; // Puede ser null si está awaiting_buy_signal
  take_profit_percentage: number;
  created_at: string;
  status: 'active' | 'paused' | 'completed' | 'error' | 'awaiting_buy_signal'; // Nuevo estado
}

const fetchActiveSignalTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('signal_trades')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'paused', 'awaiting_buy_signal']) // Incluir también operaciones pausadas y esperando señal
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
};

const fetchTickerPrice = async (pair: string): Promise<number> => {
  console.log(`[fetchTickerPrice] Fetching price for ${pair}`);
  const { data, error } = await supabase.functions.invoke('get-ticker-price', {
    body: { pair },
  });

  if (error) {
    console.error(`[fetchTickerPrice] Error invoking get-ticker-price for ${pair}:`, error);
    throw new Error(data?.error || error.message || `Failed to fetch ticker price for ${pair}`);
  }

  console.log(`[fetchTickerPrice] Raw data from Edge Function for ${pair}:`, data);

  // Ensure data is an object and has a 'price' property
  if (!data || typeof data !== 'object' || typeof data.price === 'undefined') {
    console.warn(`[fetchTickerPrice] Unexpected data structure or missing price for ${pair}. Data:`, data);
    throw new Error(`Unexpected price data received for ${pair}`);
  }

  const price = parseFloat(data.price);
  if (isNaN(price)) {
    console.error(`[fetchTickerPrice] Invalid price received for ${pair}: '${data.price}'`);
    throw new Error(`Invalid price data for ${pair}: ${data.price}`);
  }
  console.log(`[fetchTickerPrice] Parsed price for ${pair}: ${price}`);
  return price;
};

const editFormSchema = z.object({
  usdtAmount: z.coerce.number().positive("La cantidad debe ser mayor que 0."),
  takeProfitPercentage: z.coerce.number().positive("El porcentaje debe ser mayor que 0."),
});

const ActiveSignalTradeRow = ({ trade }: { trade: SignalTrade }) => {
  const queryClient = useQueryClient();
  const [isActionLoading, setIsActionLoading] = useState(false); // Para el estado de carga del botón de acción
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const isAwaitingSignal = trade.status === 'awaiting_buy_signal';

  const { data: currentPrice, isLoading: isLoadingPrice, isError: isPriceError } = useQuery<number, Error>({
    queryKey: ['tickerPrice', trade.pair],
    queryFn: () => fetchTickerPrice(trade.pair),
    enabled: !isAwaitingSignal, // Solo cargar precio si no está esperando señal
    refetchInterval: 5000, // Consultar el precio cada 5 segundos
  });

  React.useEffect(() => {
    console.log(`[ActiveSignalTradeRow - ${trade.pair}] currentPrice:`, currentPrice);
    console.log(`[ActiveSignalTradeRow - ${trade.pair}] isLoadingPrice:`, isLoadingPrice);
    console.log(`[ActiveSignalTradeRow - ${trade.pair}] isPriceError:`, isPriceError);
    console.log(`[ActiveSignalTradeRow - ${trade.pair}] isAwaitingSignal:`, isAwaitingSignal);
  }, [currentPrice, isLoadingPrice, isPriceError, isAwaitingSignal, trade.pair]);

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      usdtAmount: trade.usdt_amount,
      takeProfitPercentage: trade.take_profit_percentage,
    },
  });

  const handleEditSubmit = async (values: z.infer<typeof editFormSchema>) => {
    setIsActionLoading(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('update-signal-trade', {
        body: {
          tradeId: trade.id,
          usdtAmount: values.usdtAmount,
          takeProfitPercentage: values.takeProfitPercentage,
        },
      });

      if (functionError) throw functionError;
      if (data.error) throw new Error(data.error);

      showSuccess(`Monitoreo de ${trade.pair} actualizado con éxito.`);
      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['userSignalTrades'] });
      setIsEditDialogOpen(false);
    } catch (error: any) {
      showError(`Error al actualizar el monitoreo de ${trade.pair}: ${error.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeleteOrClose = async () => {
    setIsActionLoading(true);
    try {
      if (isAwaitingSignal) {
        // Eliminar monitoreo
        const { data, error: functionError } = await supabase.functions.invoke('delete-signal-trade', {
          body: { tradeId: trade.id },
        });
        if (functionError) throw functionError;
        
        // Verificar si la función Edge devolvió un error en el cuerpo (binanceError)
        if (data.binanceError) {
          showError(`Monitoreo de ${trade.pair} eliminado, pero hubo un error al intentar vender activos en Binance: ${data.binanceError}`);
        } else {
          showSuccess(`Monitoreo de ${trade.pair} eliminado con éxito.`);
        }
      } else {
        // Cerrar trade (activo o pausado)
        const { data, error: functionError } = await supabase.functions.invoke('close-trade', {
          body: { tradeId: trade.id, tradeType: 'signal' },
        });
        if (functionError) throw functionError;
        
        // Verificar si la función Edge devolvió un error en el cuerpo (binanceError)
        if (data.binanceError) {
          showError(`Operación de ${trade.pair} marcada como completada, pero hubo un error al vender activos en Binance: ${data.binanceError}`);
        } else {
          showSuccess(`Operación de ${trade.pair} cerrada con éxito.`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['userSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
      queryClient.invalidateQueries({ queryKey: ['completedTrades'] }); // Invalidar historial para que aparezca
    } catch (error: any) {
      showError(`Error al procesar la acción para ${trade.pair}: ${error.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const pnl = (typeof currentPrice === 'number' && trade.purchase_price !== null)
    ? ((currentPrice - trade.purchase_price) / trade.purchase_price) * 100
    : 0;

  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <TableRow className="border-gray-700">
      <TableCell className="font-medium text-white">{trade.pair}</TableCell>
      <TableCell className="text-gray-300">{new Date(trade.created_at).toLocaleString()}</TableCell>
      <TableCell className="text-gray-300">{trade.purchase_price?.toFixed(4) || 'N/A'}</TableCell>
      <TableCell className="text-yellow-400">{trade.target_price?.toFixed(4) || 'N/A'}</TableCell>
      <TableCell className="text-gray-300">{trade.take_profit_percentage.toFixed(2)}%</TableCell>
      <TableCell className="text-white">
        {isLoadingPrice ? (
          <Skeleton className="h-4 w-16" />
        ) : isAwaitingSignal || isPriceError ? (
          'N/A'
        ) : (
          typeof currentPrice === 'number' ? currentPrice.toFixed(4) : 'N/A'
        )}
      </TableCell>
      <TableCell className={pnlColor}>
        {isAwaitingSignal || isPriceError ? 'N/A' : (typeof currentPrice === 'number' ? `${pnl.toFixed(2)}%` : 'N/A')}
      </TableCell>
      <TableCell className={`font-bold ${
        trade.status === 'active' ? 'text-green-400' : 
        trade.status === 'paused' ? 'text-yellow-400' :
        'text-blue-400' // Color para awaiting_buy_signal
      }`}>
        {trade.status === 'active' ? 'Activa' : trade.status === 'paused' ? 'Pausada' : 'Esperando Señal'}
      </TableCell>
      <TableCell className="text-right flex items-center justify-end space-x-2">
        {isAwaitingSignal && (
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isActionLoading} className="text-gray-300 border-gray-600 hover:bg-gray-700">
                <Edit className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
              <DialogHeader>
                <DialogTitle className="text-yellow-400">Editar Monitoreo de {trade.pair}</DialogTitle>
                <DialogDescription className="text-gray-400">
                  Actualiza la cantidad de USDT a invertir y el porcentaje de ganancia objetivo para este monitoreo.
                </DialogDescription>
              </DialogHeader>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="grid gap-4 py-4">
                  <FormField
                    control={editForm.control}
                    name="usdtAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-300">Cantidad (USDT)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" {...field} className="bg-gray-700 border-gray-600 text-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="takeProfitPercentage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-300">Ganancia Objetivo (%)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.1" {...field} className="bg-gray-700 border-gray-600 text-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isActionLoading} className="text-gray-300 border-gray-600 hover:bg-gray-700">
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={isActionLoading} className="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
                      {isActionLoading ? 'Guardando...' : 'Guardar Cambios'}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isActionLoading}>
              {isActionLoading ? 'Cargando...' : <Trash2 className="h-4 w-4" />}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-red-400">
                {isAwaitingSignal ? 'Confirmar Eliminación de Monitoreo' : 'Confirmar Cierre de Operación'}
              </DialogTitle>
              <DialogDescription className="text-gray-400">
                {isAwaitingSignal
                  ? `¿Estás seguro de que quieres eliminar el monitoreo para ${trade.pair}? Esto detendrá la búsqueda de señales de compra para este activo.`
                  : `¿Estás seguro de que quieres cerrar la operación de ${trade.pair}? Si la operación está activa, se intentarán vender los activos restantes en Binance.`
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsActionLoading(false)} disabled={isActionLoading} className="text-gray-300 border-gray-600 hover:bg-gray-700">
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDeleteOrClose} disabled={isActionLoading}>
                {isActionLoading 
                  ? 'Procesando...' 
                  : (isAwaitingSignal ? 'Eliminar Monitoreo' : 'Cerrar Trade')
                }
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
    return <p className="text-center text-gray-400">No tienes operaciones de señales activas o en monitoreo en este momento.</p>;
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