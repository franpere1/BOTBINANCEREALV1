"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { showError, showSuccess } from '@/utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerTitle,
  DrawerDescription,
  DrawerHeader,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import { DollarSign } from 'lucide-react';

const topPairs = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'SHIBUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT'
];

const formSchema = z.object({
  pair: z.string().min(1, "Debes seleccionar un par."),
  usdtAmount: z.coerce.number().positive("La cantidad debe ser mayor que 0."),
  takeProfitPercentage: z.coerce.number().positive("El porcentaje de ganancia debe ser mayor que 0."),
  dipPercentage: z.coerce.number().min(0.1, "El porcentaje de caída debe ser al menos 0.1%.").max(10, "El porcentaje de caída no puede ser mayor al 10%."),
  lookbackMinutes: z.coerce.number().min(5, "El período de búsqueda debe ser al menos 5 minutos.").max(60, "El período de búsqueda no puede ser mayor a 60 minutos."),
});

const StrategicPurchaseForm = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pair: 'BTCUSDT',
      usdtAmount: 10,
      takeProfitPercentage: 1.5, // Objetivo de ganancia más pequeño para estrategia de corto plazo
      dipPercentage: 0.5, // Buscar una caída del 0.5%
      lookbackMinutes: 15, // Analizar los últimos 15 minutos
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      showError("Debes iniciar sesión para operar.");
      return;
    }
    setIsSubmitting(true);

    try {
      const { data, error: functionError } = await supabase.functions.invoke('initiate-strategic-purchase', {
        body: {
          pair: values.pair,
          usdtAmount: values.usdtAmount,
          takeProfitPercentage: values.takeProfitPercentage,
          dipPercentage: values.dipPercentage,
          lookbackMinutes: values.lookbackMinutes,
        },
      });

      if (functionError) throw functionError;

      if (data.error) {
        showError(`Error en la estrategia: ${data.error}`);
      } else {
        showSuccess(data.message);
        queryClient.invalidateQueries({ queryKey: ['activeTrades'] }); // Refrescar trades manuales
        queryClient.invalidateQueries({ queryKey: ['binanceAccountSummary'] }); // Refrescar resumen de Binance
        form.reset({
          pair: values.pair, // Mantener el par seleccionado
          usdtAmount: 10,
          takeProfitPercentage: 1.5,
          dipPercentage: 0.5,
          lookbackMinutes: 15,
        });
      }
    } catch (error: any) {
      showError(`Error al ejecutar la estrategia: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderSelect = (field: any) => (
    <Select onValueChange={field.onChange} defaultValue={field.value}>
      <FormControl>
        <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
          <SelectValue placeholder="Selecciona un par" />
        </SelectTrigger>
      </FormControl>
      <SelectContent className="bg-gray-700 border-gray-600 text-white">
        {topPairs.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const renderDrawerSelect = (field: any) => (
    <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" className="w-full justify-between bg-gray-700 border-gray-600 text-white">
          {field.value ? field.value : "Selecciona un par"}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-chevrons-up-down ml-2 h-4 w-4 shrink-0 opacity-50"
          >
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </svg>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="bg-gray-800 text-white border-gray-700">
        <DrawerHeader>
          <DrawerTitle className="text-yellow-400">Selecciona un Par</DrawerTitle>
          <DrawerDescription className="text-gray-400">
            Elige el par de criptomonedas para tu operación estratégica.
          </DrawerDescription>
        </DrawerHeader>
        <div className="p-4 overflow-y-auto max-h-[70vh]">
          {topPairs.map(p => (
            <div
              key={p}
              className="flex items-center p-3 mb-2 rounded-md cursor-pointer hover:bg-gray-700 transition-colors"
              onClick={() => {
                field.onChange(p);
                setIsDrawerOpen(false);
              }}
            >
              <span className="text-white">{p}</span>
            </div>
          ))}
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline" className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
              Cerrar
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-end">
        <FormField
          control={form.control}
          name="pair"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Par</FormLabel>
              {isMobile ? renderDrawerSelect(field) : renderSelect(field)}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
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
          control={form.control}
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
        <Button type="submit" disabled={isSubmitting} className="w-full md:col-span-2 lg:col-span-3 xl:col-span-5 bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          <DollarSign className="mr-2 h-4 w-4" />
          {isSubmitting ? 'Ejecutando Estrategia...' : 'Ejecutar Compra Estratégica'}
        </Button>
      </form>
    </Form>
  );
};

export default StrategicPurchaseForm;