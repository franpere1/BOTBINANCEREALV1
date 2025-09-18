"use client";

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/utils/toast';
import { useState } from 'react';
import { AlertCircle, Edit, Trash2, Pause, Play } from 'lucide-react';
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
  asset_amount: number;
  purchase_price: number;
  target_price: number;
  take_profit_percentage: number;
  created_at: string;
  status: 'active' | 'paused' | 'completed' | 'error';
}

const fetchActiveSignalTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('signal_trades')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'paused']) // Incluir también operaciones pausadas
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

const editFormSchema = z.object({
  takeProfitPercentage: z.coerce.number().positive("El porcentaje debe ser mayor que 0."),
});

const ActiveSignalTradeRow = ({ trade }: { trade: SignalTrade }) => {
  const queryClient = useQueryClient();
  const [isClosing, setIsClosing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const { data: currentPrice, isLoading: isLoadingPrice } = useQuery({
    queryKey: ['tickerPrice', trade.pair],
    queryFn: () => fetchTickerPrice(trade.pair),
    refetchInterval: 5000, // Consultar el precio cada 5 segundos
  });

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      takeProfitPercentage: trade.take_profit_percentage,
    },
  });

  const handleEditSubmit = async (values: z.infer<typeof editFormSchema>) => {
    setIsUpdatingStatus(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('update-signal-trade', {
        body: {
          tradeId: trade.id,
          takeProfitPercentage: values.takeProfitPercentage,
        },
      });

      if (functionError) throw functionError;
      if (data.error) throw new Error(data.error);

      showSuccess(`¡Operación de ${trade.pair} actualizada con éxito!`);
      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
      setIsEditing(false);
    } catch (error: any) {
      showError(`Error al actualizar la operación de ${trade.pair}: ${error.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleToggleStatus = async () => {
    setIsUpdatingStatus(true);
    const newStatus = trade.status === 'active' ? 'paused' : 'active';
    try {
      const { data, error: functionError } = await supabase.functions.invoke('update-signal-trade', {
        body: {
          tradeId: trade.id,
          status: newStatus,
        },
      });

      if (functionError) throw functionError;
      if (data.error) throw new Error(data.error);

      showSuccess(`¡Operación de ${trade.pair} ${newStatus === 'active' ? 'reanudada' : 'pausada'}!`);
      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
    } catch (error: any) {
      showError(`Error al cambiar el estado de la operación de ${trade.pair}: ${error.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDeleteTrade = async () => {
    setIsDeleting(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('delete-signal-trade', {
        body: {
          tradeId: trade.id,
        },
      });

      if (functionError) throw functionError;
      if (data.error) throw new Error(data.error);

      showSuccess(`¡Operación de ${trade.pair} eliminada con éxito!`);
      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
    } catch (error: any) {
      showError(`Error al eliminar la operación de ${trade.pair}: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const pnl = currentPrice && trade.purchase_price ? ((currentPrice - trade.purchase_price) / trade.purchase_price) * 100 : 0;
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
      <TableCell className={`font-bold ${trade.status === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>
        {trade.status === 'active' ? 'Activa' : 'Pausada'}
      </TableCell>
      <TableCell className="text-right flex space-x-2 justify-end">
        <Dialog open={isEditing} onOpenChange={setIsEditing}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-blue-400 border-blue-400 hover:bg-blue-900" disabled={isUpdatingStatus}>
              <Edit className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-yellow-400">Editar Operación de Señal</DialogTitle>
              <DialogDescription className="text-gray-400">
                Modifica el porcentaje de ganancia para {trade.pair}.
              </DialogDescription>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="grid gap-4 py-4">
                <FormField
                  control={editForm.control}
                  name="takeProfitPercentage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-300">Nuevo Ganancia Objetivo (%)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" {...field} className="bg-gray-700 border-gray-600 text-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter className="mt-4">
                  <Button type="submit" disabled={isUpdatingStatus} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
                    {isUpdatingStatus ? 'Guardando...' : 'Guardar Cambios'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Button 
          variant={trade.status === 'active' ? 'secondary' : 'default'} 
          size="sm" 
          onClick={handleToggleStatus} 
          disabled={isUpdatingStatus}
          className={trade.status === 'active' ? "bg-yellow-600 hover:bg-yellow-700 text-white" : "bg-green-600 hover:bg-green-700 text-white"}
        >
          {isUpdatingStatus ? 'Cargando...' : (trade.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />)}
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isDeleting}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-red-400">Confirmar Eliminación</DialogTitle>
              <DialogDescription className="text-gray-400">
                ¿Estás seguro de que quieres eliminar la operación de {trade.pair}?
                Si la operación está activa, se intentarán vender los activos restantes en Binance.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleting(false)} disabled={isDeleting} className="text-gray-300 border-gray-600 hover:bg-gray-700">
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDeleteTrade} disabled={isDeleting}>
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
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