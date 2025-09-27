"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { showError, showSuccess } from '@/utils/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Rocket, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface UserStrategyConfig {
  usdt_amount: number;
  take_profit_percentage: number;
}

const fetchUserPumpFivePairsConfig = async (userId: string): Promise<UserStrategyConfig | null> => {
  const { data, error } = await supabase
    .from('user_strategy_configs')
    .select('usdt_amount, take_profit_percentage')
    .eq('user_id', userId)
    .eq('strategy_name', 'pump_five_pairs')
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
    throw new Error(error.message);
  }
  return data;
};

const formSchema = z.object({
  selectedAssets: z.array(z.string()).min(1, "Debes seleccionar al menos un activo para iniciar la operación."),
});

interface PumpFivePairsInitiatorFormProps {
  topPumpPairs: string[];
}

const PumpFivePairsInitiatorForm = ({ topPumpPairs }: PumpFivePairsInitiatorFormProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: userConfig, isLoading: isLoadingConfig, isError: isErrorConfig, error: configError } = useQuery<UserStrategyConfig | null, Error>({
    queryKey: ['userPumpFivePairsConfig'],
    queryFn: () => fetchUserPumpFivePairsConfig(user!.id),
    enabled: !!user,
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      selectedAssets: [],
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      showError("Debes iniciar sesión para operar.");
      return;
    }
    if (!userConfig) {
      showError("Por favor, configura primero la estrategia 'Pump 5 Pares' en la sección superior.");
      return;
    }
    setIsSubmitting(true);

    try {
      const { data: results, error: functionError } = await supabase.functions.invoke('initiate-selected-pump-trades', {
        body: {
          selectedAssets: values.selectedAssets,
          usdtAmount: userConfig.usdt_amount,
          takeProfitPercentage: userConfig.take_profit_percentage,
        },
      });

      if (functionError) throw functionError;

      let successCount = 0;
      let pendingCount = 0;
      let errorMessages: string[] = [];

      results.forEach((res: any) => {
        if (res.status === 'success') {
          successCount++;
        } else if (res.status === 'pending') {
          pendingCount++;
          errorMessages.push(`${res.asset}: ${res.message}`);
        } else if (res.status === 'error') {
          errorMessages.push(`${res.asset}: ${res.message}`);
        }
      });

      if (successCount > 0) {
        showSuccess(`Se iniciaron ${successCount} operaciones de 'Pump 5 Pares' con éxito.`);
      }
      if (pendingCount > 0) {
        showSuccess(`Se registraron ${pendingCount} operaciones como pendientes (esperando señal o saldo).`);
      }
      if (errorMessages.length > 0) {
        showError(`Errores/Advertencias al iniciar operaciones: ${errorMessages.join('; ')}`);
      }

      queryClient.invalidateQueries({ queryKey: ['activePumpTrades'] }); // Refrescar la lista de operaciones
      queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] }); // Refrescar el resumen de Binance
      form.reset({ selectedAssets: [] }); // Limpiar las selecciones
    } catch (error: any) {
      showError(`Error general al iniciar operaciones de 'Pump 5 Pares': ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingConfig) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isErrorConfig || !userConfig) {
    return (
      <Card className="bg-red-900/50 border-red-700 text-center">
        <CardHeader>
          <CardTitle className="text-red-400 text-2xl flex items-center justify-center">
            <AlertCircle className="h-6 w-6 mr-2" /> Error de Configuración
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-300">
            {configError?.message || "No se pudo cargar la configuración de la estrategia 'Pump 5 Pares'."}
          </p>
          <p className="text-yellow-300 mt-2">
            Por favor, asegúrate de haber configurado la estrategia en la sección superior.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-800 border-gray-700 text-white">
      <CardHeader>
        <CardTitle className="text-yellow-400 text-2xl flex items-center">
          <Rocket className="h-6 w-6 mr-2" />
          Iniciar Operaciones Manualmente
        </CardTitle>
        <CardDescription className="text-gray-400">
          Selecciona los pares de la lista de "top pump pairs" para iniciar operaciones de compra.
          Se utilizará tu configuración actual: <span className="font-semibold text-white">${userConfig.usdt_amount.toFixed(2)} USDT</span> por operación y <span className="font-semibold text-white">{userConfig.take_profit_percentage.toFixed(2)}% de ganancia objetivo</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="selectedAssets"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">Pares Disponibles para Operar</FormLabel>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-2 max-h-60 overflow-y-auto pr-2">
                    {topPumpPairs.length > 0 ? (
                      topPumpPairs.map((asset) => (
                        <FormField
                          key={asset}
                          control={form.control}
                          name="selectedAssets"
                          render={({ field: innerField }) => {
                            return (
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={innerField.value?.includes(asset)}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? innerField.onChange([...innerField.value, asset])
                                        : innerField.onChange(
                                            innerField.value?.filter(
                                              (value) => value !== asset
                                            )
                                          );
                                    }}
                                    className="border-gray-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-gray-900"
                                  />
                                </FormControl>
                                <FormLabel className="font-normal text-white">
                                  {asset}
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      ))
                    ) : (
                      <p className="text-gray-500 col-span-full">No hay "top pump pairs" disponibles en este momento.</p>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isSubmitting || topPumpPairs.length === 0} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Iniciando Operaciones...
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Iniciar Operaciones Seleccionadas
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default PumpFivePairsInitiatorForm;