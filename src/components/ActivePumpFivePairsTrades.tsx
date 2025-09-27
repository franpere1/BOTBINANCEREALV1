"use client";

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider'; // ¡Ruta de importación corregida y verificada!
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

interface PumpTrade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number | null;
  purchase_price: number | null;
  target_price: number | null;
  take_profit_percentage: number;
  created_at: string;
  status: 'active' | 'pending' | 'error'; // 'pending' si está esperando condiciones de entrada
  strategy_type: 'pump_five_pairs'; // Tipo específico para esta estrategia
  error_message: string | null;
}

const fetchActivePumpTrades = async (userId: string) => {
  console.log(`[fetchActivePumpTrades] Fetching for userId: ${userId}, strategy_type: 'pump_five_pairs'`); // ADDED LOG
  const { data, error } = await supabase
    .from('signal_trades') // Reutilizamos signal_trades
    .select('*')
    .eq('user_id', userId)
    .eq('strategy_type', 'pump_five_pairs') // Filtrar por el nuevo strategy_type
    .in('status', ['active', 'pending']) // 'pending' si está esperando condiciones de entrada
    .order('created_at', { ascending: false });

  if (error) {
    // Si no se encontraron filas, tratar como datos vacíos, no como un error real
    if (error.code === 'PGRST116') {
      console.log(`[fetchActivePumpTrades] No rows found for userId: ${userId}, strategy_type: 'pump_five_pairs'`); // ADDED LOG
      return [];
    }
    console.error(`[fetchActivePumpTrades] Error:`, error); // ADDED LOG
    throw new Error(error.message);
  }
  console.log(`[fetchActivePumpTrades] Data received:`, data); // ADDED LOG
  return data;
};

const fetchTickerPrice = async (pair: string): Promise<number> => {
  try {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.msg || 'Error al obtener el precio desde Binance.');
    }
    return parseFloat(data.price);
  } catch (error: any) {
    console.error(`Error fetching price for ${pair}:`, error.message);
    throw new Error(`Error al obtener el precio para ${pair}: ${error.message}`);
  }
};

const editFormSchema = z.object({
  takeProfitPercentage: z.coerce.number().positive("El porcentaje debe ser mayor que 0."),
});

const ActivePumpTradeRow = ({ trade }: { trade: PumpTrade }) => {
  const queryClient = useQueryClient();
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const isPendingEntry = trade.status === 'pending';

  const { data: currentPrice, isLoading: isLoadingPrice, isError: isPriceError } = useQuery<number, Error>({
    queryKey: ['tickerPrice', trade.pair],
    queryFn: () => fetchTickerPrice(trade.pair),
    enabled: true,
    refetchInterval: 5000,
  });

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      takeProfitPercentage: trade.take_profit_percentage,
    },
  });

  const handleEditSubmit = async (values: z.infer<typeof editFormSchema>) => {
    setIsActionLoading(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('update-signal-trade', { // Reutilizamos update-signal-trade
        body: {
          tradeId: trade.id,
          takeProfitPercentage: values.takeProfitPercentage,
          // usdtAmount no se puede cambiar si ya está activa, y si está pendiente, se cambia en la configuración global
        },
      });

      if (functionError) throw functionError;
      if (data.error) throw new Error(data.error);

      showSuccess(`Operación de ${trade.pair} actualizada con éxito.`);
      queryClient.invalidateQueries({ queryKey: ['activePumpTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
      setIsEditDialogOpen(false);
    } catch (error: any) {
      showError(`Error al actualizar la operación de ${trade.pair}: ${error.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeleteOrClose = async () => {
    setIsActionLoading(true);
    try {
      if (isPendingEntry) {
        // Eliminar la operación pendiente
        const { data, error: functionError } = await supabase.functions.invoke('delete-signal-trade', { // Reutilizamos delete-signal-trade
          body: { tradeId: trade.id },
        });
        if (functionError) throw functionError;
        
        if (data.binanceError) {
          showError(`Operación de ${trade.pair} eliminada, pero hubo un error al intentar vender activos en Binance: ${data.binanceError}`);
        } else {
          showSuccess(`Operación de ${trade.pair} eliminada con éxito.`);
        }
      } else {
        // Cerrar trade activo
        const { data, error: functionError } = await supabase.functions.invoke('close-trade', {
          body: { tradeId: trade.id, tradeType: 'signal' }, // Usamos 'signal' como tipo genérico para signal_trades
        });
        if (functionError) throw functionError;
        
        if (data.binanceError) {
          showError(`Operación de ${trade.pair} marcada como completada, pero hubo un error al vender activos en Binance: ${data.binanceError}`);
        } else {
          showSuccess(`Operación de ${trade.pair} cerrada con éxito.`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['activePumpTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
      queryClient.invalidateQueries({ queryKey: ['completedTrades'] });
    } catch (error: any) {
      showError(`Error al procesar la acción para ${trade.pair}: ${error.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

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
        ) : isPendingEntry ? (
          'N/A'
        ) : (
          typeof currentPrice === 'number' ? `${pnl.toFixed(2)}%` : 'N/A'
        )}
      </TableCell>
      <TableCell className={`font-bold ${
        trade.status === 'active' ? 'text-green-400' : 
        trade.status === 'pending' ? 'text-blue-400' : // Color azul para 'pending'
        'text-red-400' // 'error'
      }`}>
        {trade.status === 'active' ? 'Activa' : trade.status === 'pending' ? 'Pendiente' : 'Error'}
        {trade.error_message && ( // Mostrar el mensaje de error/razón de espera
            <div className="flex items-center text-red-400 text-xs mt-1">
              <AlertCircle className="h-3 w-3 mr-1" />
              {trade.error_message}
            </div>
          )}
      </TableCell>
      <TableCell className="text-right flex items-center justify-end space-x-2">
        {!isPendingEntry && ( // Solo permitir editar TP si la operación está activa
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isActionLoading} className="text-gray-300 border-gray-600 hover:bg-gray-700">
                <Edit className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
              <DialogHeader>
                <DialogTitle className="text-yellow-400">Editar Operación de {trade.pair}</DialogTitle>
                <DialogDescription className="text-gray-400">
                  Actualiza el porcentaje de ganancia objetivo para esta operación.
                </DialogDescription>
              </DialogHeader>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="grid gap-4 py-4">
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
                {isPendingEntry ? 'Confirmar Eliminación de Operación Pendiente' : 'Confirmar Cierre de Operación'}
              </DialogTitle>
              <DialogDescription className="text-gray-400">
                {isPendingEntry
                  ? `¿Estás seguro de que quieres eliminar esta operación pendiente para ${trade.pair}? Esto detendrá la búsqueda de entrada para este activo.`
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
                  : (isPendingEntry ? 'Eliminar Pendiente' : 'Cerrar Trade')
                }
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
};

const ActivePumpFivePairsTrades = () => {
  const { user } = useAuth();
  const { data: trades, isLoading, isError, error } = useQuery({
    queryKey: ['activePumpTrades'],
    queryFn: () => fetchActivePumpTrades(user!.id),
    enabled: !!user,
    refetchInterval: 10000,
  });

  // ADDED EFFECT FOR LOGGING
  React.useEffect(() => {
    if (trades) {
      console.log(`[ActivePumpFivePairsTrades] Rendered with trades:`, trades);
    }
    if (isError) {
      console.error(`[ActivePumpFivePairsTrades] Rendered with error:`, error);
    }
  }, [trades, isError, error]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // Manejo de errores: si es un error de "no filas", mostrar el mensaje de no operaciones.
  // De lo contrario, mostrar la tarjeta de error.
  if (isError) {
    const errorMessage = error?.message || "Error desconocido.";
    const isNoRowsFoundError = errorMessage.includes('PGRST116') || errorMessage.includes('no rows found') || errorMessage.includes('No data');

    if (isNoRowsFoundError) {
      return <p className="text-center text-gray-400">No tienes operaciones de 'Pump 5 Pares' activas o pendientes en este momento.</p>;
    }

    return (
      <div className="flex items-center p-4 bg-red-900/50 rounded-md border border-red-700">
        <AlertCircle className="h-6 w-6 text-red-400 mr-4 flex-shrink-0" />
        <div>
          <h4 className="font-bold text-red-300">Error</h4>
          <p className="text-sm text-red-400 mt-1">Error al cargar las operaciones de 'Pump 5 Pares' activas: {errorMessage}</p>
        </div>
      </div>
    );
  }

  // Si no hay trades (y no hubo un error real), mostrar el mensaje de "no hay operaciones"
  if (!trades || trades.length === 0) {
    return <p className="text-center text-gray-400">No tienes operaciones de 'Pump 5 Pares' activas o pendientes en este momento.</p>;
  }

  return (
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
            <TableHead className="text-right text-white">Acción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <ActivePumpTradeRow key={trade.id} trade={trade} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default ActivePumpFivePairsTrades;