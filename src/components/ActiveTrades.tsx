"use client";

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/utils/toast';
import { AlertCircle, Trash2, Edit } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface Trade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number | null;
  purchase_price: number | null;
  target_price: number | null;
  take_profit_percentage: number;
  created_at: string;
  status: 'active' | 'awaiting_dip_signal';
  strategy_type: 'manual' | 'strategic'; // Ahora es obligatorio
  dip_percentage: number | null;
  lookback_minutes: number | null;
  error_message: string | null;
}

const fetchActiveTrades = async (userId: string, strategyType: 'manual' | 'strategic') => {
  const { data, error } = await supabase
    .from('manual_trades')
    .select('*')
    .eq('user_id', userId)
    .eq('strategy_type', strategyType) // Filtrar por strategy_type
    .in('status', ['active', 'awaiting_dip_signal'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
};

const fetchTickerPrice = async (pair: string): Promise<number> => {
  console.log(`[fetchTickerPrice] Fetching price for ${pair}`);
  const { data, error: functionError } = await supabase.functions.invoke('get-ticker-price', {
    body: { pair },
  });

  if (functionError) {
    console.error(`[fetchTickerPrice] Error invoking get-ticker-price for ${pair}:`, functionError);
    throw new Error(functionError.message || `Failed to invoke get-ticker-price for ${pair}`);
  }

  // Check if the Edge Function itself returned an error in its body
  if (data && typeof data === 'object' && 'error' in data) {
    console.error(`[fetchTickerPrice] Edge Function returned error for ${pair}:`, data.error);
    throw new Error(data.error as string || `Edge Function error for ${pair}`);
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

const editStrategicFormSchema = z.object({
  usdtAmount: z.coerce.number().positive("La cantidad debe ser mayor que 0."),
  takeProfitPercentage: z.coerce.number().positive("El porcentaje de ganancia debe ser mayor que 0."),
  dipPercentage: z.coerce.number().min(0.1, "El porcentaje de caída debe ser al menos 0.1%.").max(10, "El porcentaje de caída no puede ser mayor al 10%."),
  lookbackMinutes: z.coerce.number().min(5, "El período de búsqueda debe ser al menos 5 minutos.").max(60, "El período de búsqueda no puede ser mayor a 60 minutos."),
});

const ActiveTradeRow = ({ trade }: { trade: Trade }) => {
  const queryClient = useQueryClient();
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const isAwaitingDipSignal = trade.status === 'awaiting_dip_signal';
  const isStrategicTrade = trade.strategy_type === 'strategic';

  const { data: currentPrice, isLoading: isLoadingPrice, isError: isPriceError } = useQuery<number, Error>({
    queryKey: ['tickerPrice', trade.pair],
    queryFn: () => fetchTickerPrice(trade.pair),
    enabled: true, // Siempre cargar el precio actual
    refetchInterval: 5000,
  });

  React.useEffect(() => {
    console.log(`[ActiveTradeRow - ${trade.pair}] currentPrice:`, currentPrice);
    console.log(`[ActiveTradeRow - ${trade.pair}] isLoadingPrice:`, isLoadingPrice);
    console.log(`[ActiveTradeRow - ${trade.pair}] isPriceError:`, isPriceError);
    console.log(`[ActiveTradeRow - ${trade.pair}] isAwaitingDipSignal:`, isAwaitingDipSignal);
  }, [currentPrice, isLoadingPrice, isPriceError, isAwaitingDipSignal, trade.pair]);

  const editForm = useForm<z.infer<typeof editStrategicFormSchema>>({
    resolver: zodResolver(editStrategicFormSchema),
    defaultValues: {
      usdtAmount: trade.usdt_amount,
      takeProfitPercentage: trade.take_profit_percentage,
      dipPercentage: trade.dip_percentage || 0.5,
      lookbackMinutes: trade.lookback_minutes || 15,
    },
  });

  const handleEditStrategicTrade = async (values: z.infer<typeof editStrategicFormSchema>) => {
    setIsActionLoading(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('update-manual-trade', {
        body: {
          tradeId: trade.id,
          usdtAmount: values.usdtAmount,
          takeProfitPercentage: values.takeProfitPercentage,
          dipPercentage: values.dipPercentage,
          lookbackMinutes: values.lookbackMinutes,
        },
      });

      if (functionError) throw functionError;
      if (data.error) throw new Error(data.error);

      showSuccess(`Estrategia para ${trade.pair} actualizada con éxito.`);
      queryClient.invalidateQueries({ queryKey: ['activeTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
      setIsEditDialogOpen(false);
    } catch (error: any) {
      showError(`Error al actualizar la estrategia para ${trade.pair}: ${error.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCloseOrDeleteTrade = async () => {
    setIsActionLoading(true);
    try {
      if (isAwaitingDipSignal) {
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

  // Calcular PnL de forma segura
  const pnl = (typeof currentPrice === 'number' && typeof trade.purchase_price === 'number')
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
        ) : isPriceError ? (
          <span className="text-red-400">Error</span>
        ) : (
          typeof currentPrice === 'number' ? currentPrice.toFixed(4) : 'N/A'
        )}
      </TableCell>
      <TableCell className={pnlColor}>
        {isLoadingPrice ? (
          <Skeleton className="h-4 w-16" />
        ) : isPriceError ? (
          <span className="text-red-400">Error</span>
        ) : isAwaitingDipSignal ? (
          'N/A'
        ) : (
          typeof currentPrice === 'number' ? `${pnl.toFixed(2)}%` : 'N/A'
        )}
      </TableCell>
      <TableCell className={`font-bold ${
        isAwaitingDipSignal ? 'text-blue-400' : 'text-green-400'
      }`}>
        {isAwaitingDipSignal ? 'Esperando Dip' : 'Activa'}
      </TableCell>
      {isStrategicTrade && ( // Mostrar solo para operaciones estratégicas
        <TableCell className="text-gray-300">
          Dip: {trade.dip_percentage?.toFixed(1)}% / 
          Lookback: {trade.lookback_minutes} min
          {trade.error_message && (
            <div className="flex items-center text-red-400 text-xs mt-1">
              <AlertCircle className="h-3 w-3 mr-1" />
              {trade.error_message}
            </div>
          )}
        </TableCell>
      )}
      <TableCell className="text-right flex items-center justify-end space-x-2">
        {isStrategicTrade && isAwaitingDipSignal && ( // Botón de edición solo para estratégicas pendientes
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isActionLoading} className="text-gray-300 border-gray-600 hover:bg-gray-700">
                <Edit className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
              <DialogHeader>
                <DialogTitle className="text-yellow-400">Editar Estrategia de {trade.pair}</DialogTitle>
                <DialogDescription className="text-gray-400">
                  Actualiza los parámetros de tu estrategia de compra en dip.
                </DialogDescription>
              </DialogHeader>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(handleEditStrategicTrade)} className="grid gap-4 py-4">
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
                  <FormField
                    control={editForm.control}
                    name="dipPercentage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-300">Caída a Buscar (%)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.1" {...field} className="bg-gray-700 border-gray-600 text-white" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="lookbackMinutes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-300">Período de Búsqueda (min)</FormLabel>
                        <FormControl>
                          <Input type="number" step="1" {...field} className="bg-gray-700 border-gray-600 text-white" />
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

interface ActiveTradesProps {
  strategyType: 'manual' | 'strategic';
}

const ActiveTrades = ({ strategyType }: ActiveTradesProps) => {
  const { user } = useAuth();
  const { data: trades, isLoading, isError } = useQuery({
    queryKey: ['activeTrades', strategyType], // Incluir strategyType en la clave de la query
    queryFn: () => fetchActiveTrades(user!.id, strategyType),
    enabled: !!user,
    refetchInterval: 10000,
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
    return <p className="text-center text-gray-400">No tienes operaciones {strategyType === 'manual' ? 'manuales' : 'estratégicas'} activas o pendientes en este momento.</p>;
  }

  return (
    // Añadido para permitir el desplazamiento horizontal
    <div className="overflow-x-auto"> 
      <Table>
        <TableHeader>
          <TableRow className="border-gray-700 hover:bg-gray-800">
            <TableHead className="text-white">Par</TableHead>
            <TableHead className="text-white">Fecha Apertura</TableHead>
            <TableHead className="text-white">Precio Compra</TableHead>
            <TableHead className="text-white">Precio Objetivo</TableHead>
            <TableHead className="text-white">Objetivo (%)</TableHead>
            <TableHead className="text-white min-w-[80px]">Precio Actual</TableHead>
            <TableHead className="text-white">Ganancia/Pérdida</TableHead>
            <TableHead className="text-white">Estado</TableHead>
            {strategyType === 'strategic' && (
              <TableHead className="text-white min-w-[150px]">Detalles Estrategia</TableHead>
            )}
            <TableHead className="text-right text-white">Acción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <ActiveTradeRow key={trade.id} trade={trade} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default ActiveTrades;