"use client";

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, TrendingDown, PauseCircle, Play, Trash2 } from "lucide-react";
import { showError, showSuccess } from '@/utils/toast';
import { useAuth } from '@/context/AuthProvider';
import ActiveSignalTrades from '@/components/ActiveSignalTrades';
import MinutePriceCollectorStatus from '@/components/MinutePriceCollectorStatus';
import SignalSourceToggle from '@/components/SignalSourceToggle'; // Importar el nuevo componente
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

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
  klinesSource?: string; // Nuevo campo para mostrar la fuente de los klines
}

interface SignalTrade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number | null;
  purchase_price: number | null;
  target_price: number | null;
  take_profit_percentage: number;
  created_at: string;
  status: 'active' | 'paused' | 'completed' | 'error' | 'awaiting_buy_signal';
}

const formSchema = z.object({
  usdtAmount: z.coerce.number().positive("La cantidad debe ser mayor que 0."),
  takeProfitPercentage: z.coerce.number().positive("El porcentaje debe ser mayor que 0."),
  selectedAssets: z.array(z.string()).min(1, "Debes seleccionar al menos un activo."),
});

const fetchMlSignals = async (source: 'binance-api' | 'supabase-db'): Promise<SignalData[]> => {
  const { data, error } = await supabase.functions.invoke('get-ml-signals', {
    body: { source },
  });
  if (error) throw new Error(data?.error || error.message);
  return data as SignalData[];
};

const fetchUserSignalTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('signal_trades')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'paused', 'awaiting_buy_signal'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
};

const SignalsTrading = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmittingBulkTrades, setIsSubmittingBulkTrades] = useState(false);
  const [signalSource, setSignalSource] = useState<'binance-api' | 'supabase-db'>(() => {
    // Leer la preferencia del localStorage o usar 'supabase-db' como predeterminado
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('signalSource') as 'binance-api' | 'supabase-db') || 'supabase-db';
    }
    return 'supabase-db';
  });

  const handleSourceChange = (newSource: 'binance-api' | 'supabase-db') => {
    setSignalSource(newSource);
    localStorage.setItem('signalSource', newSource);
    queryClient.invalidateQueries({ queryKey: ['mlSignals'] }); // Invalidar para recargar con la nueva fuente
  };

  const { data: signals, isLoading, isError } = useQuery<SignalData[], Error>({
    queryKey: ['mlSignals', signalSource], // Incluir signalSource en la clave de la query
    queryFn: () => fetchMlSignals(signalSource),
    refetchInterval: 15000,
  });

  const { data: userSignalTrades, isLoading: isLoadingUserTrades } = useQuery<SignalTrade[], Error>({
    queryKey: ['userSignalTrades'],
    queryFn: () => fetchUserSignalTrades(user!.id),
    enabled: !!user,
    refetchInterval: 10000,
  });

  const userTradesMap = React.useMemo(() => {
    const map = new Map<string, SignalTrade>();
    userSignalTrades?.forEach(trade => {
      map.set(trade.pair, trade);
    });
    return map;
  }, [userSignalTrades]);

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
      const { data: results, error: functionError } = await supabase.functions.invoke('setup-signal-monitoring', {
        body: {
          usdtAmount: values.usdtAmount,
          takeProfitPercentage: values.takeProfitPercentage,
          selectedAssets: values.selectedAssets,
        },
      });

      if (functionError) throw functionError;

      let successCount = 0;
      let errorMessages: string[] = [];

      results.forEach((res: any) => {
        if (res.status === 'success') {
          successCount++;
        } else if (res.status === 'error') {
          errorMessages.push(`${res.asset}: ${res.message}`);
        }
      });

      if (successCount > 0) {
        showSuccess(`Se configuró el monitoreo para ${successCount} activos.`);
      }
      if (errorMessages.length > 0) {
        showError(`Errores al configurar el monitoreo: ${errorMessages.join('; ')}`);
      }

      queryClient.invalidateQueries({ queryKey: ['activeSignalTrades'] });
      queryClient.invalidateQueries({ queryKey: ['userSignalTrades'] });
      setIsDialogOpen(false);
      form.reset();
    } catch (error: any) {
      showError(`Error general al configurar el monitoreo de señales: ${error.message}`);
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

  if (isLoading || isLoadingUserTrades) {
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

  const allSignalsForDisplay = signals || [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 space-y-4 md:space-y-0">
        <div className="text-left">
          <h2 className="text-4xl font-bold mb-4 text-yellow-400">
            Trading por Señales de ML
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl">
            Análisis de mercado en tiempo real y predicciones de Machine Learning para ayudarte a tomar decisiones.
          </p>
        </div>
        <div className="flex flex-col space-y-4 md:space-y-0 md:flex-row md:space-x-4 items-end">
          <SignalSourceToggle onSourceChange={handleSourceChange} currentSource={signalSource} />
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all duration-200 ease-in-out transform hover:scale-105">
                <Play className="mr-2 h-5 w-5" />
                Configurar Monitoreo de Señales
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-gray-800 text-white border-gray-700">
              <DialogHeader>
                <DialogTitle className="text-yellow-400">Configurar Monitoreo de Operaciones por Señal</DialogTitle>
                <DialogDescription className="text-gray-400">
                  Selecciona los activos que deseas monitorear. El sistema iniciará automáticamente una operación de compra
                  cuando se detecte una señal de COMPRA con 70% o más de confianza para el activo seleccionado.
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
                    render={({ field: innerField }) => (
                      <FormItem>
                        <FormLabel className="text-gray-300">Activos para Monitorear</FormLabel>
                        <div className="grid grid-cols-2 gap-2 mt-2 max-h-48 overflow-y-auto pr-2">
                          {allSignalsForDisplay.length > 0 ? (
                            allSignalsForDisplay.map((signal) => (
                              <FormField
                                key={signal.asset}
                                control={form.control}
                                name="selectedAssets"
                                render={({ field }) => {
                                  return (
                                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                      <FormControl>
                                        <Checkbox
                                          checked={field.value?.includes(signal.asset)}
                                          onCheckedChange={(checked) => {
                                            return checked
                                              ? field.onChange([...field.value, signal.asset])
                                              : field.onChange(
                                                  field.value?.filter(
                                                    (value) => value !== signal.asset
                                                  )
                                                );
                                          }}
                                          className="border-gray-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-gray-900"
                                        />
                                      </FormControl>
                                      <FormLabel className="font-normal text-gray-300">
                                        {signal.asset} ({signal.signal} - {signal.confidence.toFixed(1)}%)
                                      </FormLabel>
                                    </FormItem>
                                  );
                                }}
                              />
                            ))
                          ) : (
                            <p className="text-gray-500 col-span-2">No hay activos disponibles para monitorear en este momento.</p>
                          )}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter className="mt-4">
                    <Button type="submit" disabled={isSubmittingBulkTrades} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
                      {isSubmittingBulkTrades ? 'Configurando Monitoreo...' : 'Configurar Monitoreo'}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <MinutePriceCollectorStatus />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {allSignalsForDisplay?.map((signal) => {
          return (
            <Card key={signal.asset} className="bg-gray-800 border-gray-700 text-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-2xl text-yellow-400 flex items-center justify-between">
                  {signal.asset}
                  <span className={`text-sm px-3 py-1 rounded-full font-semibold ${
                    signal.confidence >= 70 ? 'bg-green-600 text-white' : 
                    signal.confidence >= 50 ? 'bg-yellow-500 text-gray-900' : 
                    'bg-gray-600 text-gray-300'
                  }`}>
                    {signal.confidence.toFixed(1)}% Confianza
                  </span>
                </CardTitle>
                <CardDescription className={`flex items-center text-xl font-bold ${getSignalColor(signal.signal)} mt-1`}>
                  {getSignalIcon(signal.signal)}
                  {signal.signal}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p className="text-gray-400">Precio Actual: <span className="text-white font-semibold">${signal.price.toFixed(4)}</span></p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <p className="text-gray-400">RSI: <span className="text-white font-semibold">{signal.rsi.toFixed(2)}</span></p>
                  <p className="text-gray-400">Volatilidad: <span className="text-white font-semibold">{signal.volatility.toFixed(2)}%</span></p>
                  <p className="text-gray-400">MA20: <span className="text-white font-semibold">${signal.ma20.toFixed(4)}</span></p>
                  <p className="text-gray-400">MA50: <span className="text-white font-semibold">${signal.ma50.toFixed(4)}</span></p>
                  <p className="text-gray-400">MACD: <span className="text-white font-semibold">{signal.macd.toFixed(3)}</span></p>
                  <p className="text-gray-400">MACD Señal: <span className="text-white font-semibold">{signal.macdSignal.toFixed(3)}</span></p>
                  <p className="text-gray-400">Hist. MACD: <span className="text-white font-semibold">{signal.histMacd.toFixed(3)}</span></p>
                  <p className="text-gray-400">Banda Superior: <span className="text-white font-semibold">${signal.upperBand.toFixed(4)}</span></p>
                  <p className="text-gray-400">Banda Inferior: <span className="text-white font-semibold">${signal.lowerBand.toFixed(4)}</span></p>
                </div>
                <p className="text-gray-500 text-xs mt-2">Última actualización: {signal.lastUpdate}</p>
                <p className="text-gray-500 text-xs">Fuente de Klines: {signal.klinesSource}</p>
              </CardContent>
            </Card>
          );
        })}
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