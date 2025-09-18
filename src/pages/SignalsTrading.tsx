"use client";

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, TrendingDown, PauseCircle, Play } from "lucide-react";
import { showError, showSuccess } from '@/utils/toast';
import { useAuth } from '@/context/AuthProvider';
import ActiveSignalTrades from '@/components/ActiveSignalTrades';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useState } from 'react';

interface SignalData {
  asset: string;
  prediction: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price: number;
  rsi: number;
  ma20: number;
  ma50: number;
  macd: number;
  macdSignal: number;
  histMacd: number;
  upperBand: number;
  lowerBand: number;
  volatility: number;
  lastUpdate: string;
}

const formSchema = z.object({
  usdtAmount: z.coerce.number().positive("La cantidad debe ser mayor que 0."),
  takeProfitPercentage: z.coerce.number().positive("El porcentaje debe ser mayor que 0."),
  selectedAssets: z.array(z.string()).min(1, "Debes seleccionar al menos un activo."),
});

const fetchMlSignals = async (): Promise<SignalData[]> => {
  const { data, error } = await supabase.functions.invoke('get-ml-signals');
  if (error) throw new Error(data?.error || error.message);
  return data as SignalData[];
};

const SignalsTrading = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmittingBulkTrades, setIsSubmittingBulkTrades] = useState(false);

  const { data: signals, isLoading, isError } = useQuery<SignalData[], Error>({
    queryKey: ['mlSignals'],
    queryFn: fetchMlSignals,
    refetchInterval: 15000, // Refrescar cada 15 segundos
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      usdtAmount: 10,
      takeProfitPercentage: 5,
      selectedAssets: [],
    },
  });

  const handleBulkTradeSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      showError("Debes iniciar sesión para operar.");
      return;
    }
    setIsSubmittingBulkTrades(true);

    try {
      const { data: results, error: functionError } = await supabase.functions.invoke('bulk-initiate-signal-trades', {
        body: {
          usdtAmount: values.usdtAmount,
          takeProfitPercentage: values.takeProfitPercentage,
          selectedAssets: values.selectedAssets,
        },
      });

      if (functionError) throw functionError;

      let successCount = 0;
      let errorMessages: string[] = [];
      let skippedCount = 0;

      results.forEach((res: any) => {
        if (res.status === 'success') {
          successCount++;
        } else if (res.status === 'error') {
          errorMessages.push(`${res.asset}: ${res.message}`);
        } else if (res.status === 'skipped') {
          skippedCount++;
        }
      });

      if (successCount > 0) {
        showSuccess(`Se iniciaron ${successCount} operaciones con éxito.`);
      }
      if (skippedCount > 0) {
        showError(`Se omitieron ${skippedCount} operaciones porque no cumplían los criterios de señal en el momento de la ejecución.`);
      }
      if (errorMessages.length > 0) {
        showError(`Errores al iniciar operaciones: ${errorMessages.join('; ')}`);
      }

      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] });
      setIsDialogOpen(false);
      form.reset();
    } catch (error: any) {
      showError(`Error general al iniciar operaciones por señal: ${error.message}`);
    } finally {
      setIsSubmittingBulkTrades(false);
    }
  };

  if (isError) {
    showError(`Error al cargar las señales de trading: ${isError.message}`);
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-lg bg-red-900/50 border-red-700 text-center">
          <CardHeader>
            <CardTitle className="text-red-400 text-2xl flex items-center justify-center">
              <AlertCircle className="h-6 w-6 mr-2" /> Error al cargar señales
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <p className="text-xl text-red-300">
              Hubo un problema al obtener los datos de trading por señales.
            </p>
            <p className="text-red-400 mt-2">
              Por favor, inténtalo de nuevo más tarde.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="bg-gray-800 border-gray-700">
              <CardHeader className="pb-2">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-1" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const getSignalColor = (signal: SignalData['signal']) => {
    switch (signal) {
      case 'BUY': return 'text-green-400';
      case 'SELL': return 'text-red-400';
      case 'HOLD': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const getSignalIcon = (signal: SignalData['signal']) => {
    switch (signal) {
      case 'BUY': return <TrendingUp className="h-5 w-5 mr-2" />;
      case 'SELL': return <TrendingDown className="h-5 w-5 mr-2" />;
      case 'HOLD': return <PauseCircle className="h-5 w-5 mr-2" />;
      default: return null;
    }
  };

  const buySignals70Plus = signals?.filter(s => s.signal === 'BUY' && s.confidence >= 70) || [];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center mb-8">
        <div className="text-left">
          <h2 className="text-4xl font-bold mb-4 text-yellow-400">
            Trading por Señales de ML
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl">
            Análisis de mercado en tiempo real y predicciones de Machine Learning para ayudarte a tomar decisiones.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all duration-200 ease-in-out transform hover:scale-105">
              <Play className="mr-2 h-5 w-5" />
              Iniciar Trades por Señal
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-yellow-400">Iniciar Operaciones por Señal</DialogTitle>
              <DialogDescription className="text-gray-400">
                Configura los parámetros para iniciar operaciones de compra basadas en señales de ML.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleBulkTradeSubmit)} className="grid gap-4 py-4">
                <FormField
                  control={form.control}
                  name="usdtAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-300">Cantidad por Trade (USDT)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} className="bg-gray-700 border-gray-600 text-white" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
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
                  control={form.control}
                  name="selectedAssets"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-300">Activos para Operar (BUY >= 70% Confianza)</FormLabel>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {buySignals70Plus.length > 0 ? (
                          buySignals70Plus.map((signal) => (
                            <FormField
                              key={signal.asset}
                              control={form.control}
                              name="selectedAssets"
                              render={({ field: innerField }) => {
                                return (
                                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                    <FormControl>
                                      <Checkbox
                                        checked={innerField.value?.includes(signal.asset)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? innerField.onChange([...innerField.value, signal.asset])
                                            : innerField.onChange(
                                                innerField.value?.filter(
                                                  (value) => value !== signal.asset
                                                )
                                              );
                                        }}
                                        className="border-gray-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-gray-900"
                                      />
                                    </FormControl>
                                    <FormLabel className="font-normal text-gray-300">
                                      {signal.asset} ({signal.confidence.toFixed(1)}%)
                                    </FormLabel>
                                  </FormItem>
                                );
                              }}
                            />
                          ))
                        ) : (
                          <p className="text-gray-500 col-span-2">No hay activos con señal de COMPRA >= 70% de confianza en este momento.</p>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter className="mt-4">
                  <Button type="submit" disabled={isSubmittingBulkTrades} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
                    {isSubmittingBulkTrades ? 'Iniciando Trades...' : 'Iniciar Trades'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {signals?.map((signal) => (
          <Card key={signal.asset} className="bg-gray-800 border-gray-700 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl text-yellow-400">{signal.asset}</CardTitle>
              <CardDescription className="flex items-center text-lg font-semibold">
                {getSignalIcon(signal.signal)}
                <span className={getSignalColor(signal.signal)}>{signal.signal}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p className="text-gray-400">Confianza: <span className="text-white font-semibold">{signal.confidence.toFixed(1)}%</span></p>
              <p className="text-gray-400">Precio: <span className="text-white font-semibold">${signal.price.toFixed(4)}</span></p>
              <p className="text-gray-400">RSI: <span className="text-white font-semibold">{signal.rsi.toFixed(2)}</span></p>
              <p className="text-gray-400">MA20: <span className="text-white font-semibold">${signal.ma20.toFixed(4)}</span></p>
              <p className="text-gray-400">MA50: <span className="text-white font-semibold">${signal.ma50.toFixed(4)}</span></p>
              <p className="text-gray-400">MACD: <span className="text-white font-semibold">{signal.macd.toFixed(3)}</span></p>
              <p className="text-gray-400">MACD Señal: <span className="text-white font-semibold">{signal.macdSignal.toFixed(3)}</span></p>
              <p className="text-gray-400">Hist. MACD: <span className="text-white font-semibold">{signal.histMacd.toFixed(3)}</span></p>
              <p className="text-gray-400">Banda Superior: <span className="text-white font-semibold">${signal.upperBand.toFixed(4)}</span></p>
              <p className="text-gray-400">Banda Inferior: <span className="text-white font-semibold">${signal.lowerBand.toFixed(4)}</span></p>
              <p className="text-gray-400">Volatilidad: <span className="text-white font-semibold">{signal.volatility.toFixed(2)}%</span></p>
              <p className="text-gray-500 text-xs mt-2">Última actualización: {signal.lastUpdate}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones de Señales Activas</CardTitle>
          <CardDescription className="text-gray-400">
            Operaciones iniciadas automáticamente por señales de ML que están esperando alcanzar su objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActiveSignalTrades />
        </CardContent>
      </Card>
    </div>
  );
};

export default SignalsTrading;