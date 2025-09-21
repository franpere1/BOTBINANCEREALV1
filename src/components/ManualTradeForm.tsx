"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form'; // Corregido: de '@hookform/react-form' a 'react-hook-form'
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
import { useIsMobile } from '@/hooks/use-mobile'; // Import useIsMobile
import { // Import Drawer components
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerTitle,
  DrawerDescription,
  DrawerHeader,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'; 

const topPairs = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'SHIBUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT'
];

// Tasa de comisión de Binance (0.1%)
const BINANCE_FEE_RATE = 0.001;

const formSchema = z.object({
  pair: z.string().min(1, "Debes seleccionar un par."),
  usdtAmount: z.coerce.number().positive("La cantidad debe ser mayor que 0."),
  takeProfitPercentage: z.coerce.number().positive("El porcentaje debe ser mayor que 0."),
});

interface ManualTradeFormProps {
  selectedPair: string;
  onPairChange: (pair: string) => void;
}

const ManualTradeForm = ({ selectedPair, onPairChange }: ManualTradeFormProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMobile = useIsMobile(); // Use the hook
  const [isDrawerOpen, setIsDrawerOpen] = useState(false); // State for drawer

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pair: selectedPair, // Usar selectedPair del prop
      usdtAmount: 10,
      takeProfitPercentage: 5,
    },
  });

  // Actualizar el valor del formulario cuando selectedPair cambie desde el exterior
  React.useEffect(() => {
    form.setValue('pair', selectedPair);
  }, [selectedPair, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      showError("Debes iniciar sesión para operar.");
      return;
    }
    setIsSubmitting(true);

    // 1. Insertar la operación en la base de datos con estado 'pending'
    const { data: trade, error: insertError } = await supabase
      .from('manual_trades')
      .insert({
        user_id: user.id,
        pair: values.pair,
        usdt_amount: values.usdtAmount,
        take_profit_percentage: values.takeProfitPercentage,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      showError(`Error al crear la operación: ${insertError.message}`);
      setIsSubmitting(false);
      return;
    }

    // 2. Invocar la Edge Function para ejecutar la compra
    try {
      const { data: orderResult, error: functionError } = await supabase.functions.invoke('place-market-order', {
        body: {
          pair: values.pair,
          side: 'BUY',
          quoteOrderQty: values.usdtAmount,
        },
      });

      if (functionError) throw functionError;

      // 3. Actualizar la operación en la DB con los detalles de la compra
      const executedQty = parseFloat(orderResult.executedQty);
      const cummulativeQuoteQty = parseFloat(orderResult.cummulativeQuoteQty);
      const purchasePrice = cummulativeQuoteQty / executedQty;
      
      // Ajustar el precio objetivo para incluir la comisión de venta
      const targetPrice = (purchasePrice * (1 + values.takeProfitPercentage / 100)) / (1 - BINANCE_FEE_RATE);

      const { error: updateError } = await supabase
        .from('manual_trades')
        .update({
          status: 'active',
          asset_amount: executedQty,
          purchase_price: purchasePrice,
          target_price: targetPrice,
          binance_order_id_buy: orderResult.orderId.toString(),
        })
        .eq('id', trade.id);

      if (updateError) throw updateError;

      showSuccess(`¡Compra de ${values.pair} ejecutada con éxito!`);
      queryClient.invalidateQueries({ queryKey: ['activeTrades'] });
      form.reset({
        pair: values.pair, // Mantener el par seleccionado
        usdtAmount: 10,
        takeProfitPercentage: 5,
      });
    } catch (error: any) {
      // Si algo falla, marcar la operación como 'error'
      await supabase
        .from('manual_trades')
        .update({ status: 'error', error_message: error.message })
        .eq('id', trade.id);
      showError(`Error al ejecutar la orden: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <FormField
          control={form.control}
          name="pair"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Par</FormLabel>
              {isMobile ? (
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
                        Elige el par de criptomonedas para tu operación.
                      </DrawerDescription>
                    </DrawerHeader>
                    <div className="p-4 overflow-y-auto max-h-[70vh]">
                      {topPairs.map(p => (
                        <div
                          key={p}
                          className="flex items-center p-3 mb-2 rounded-md cursor-pointer hover:bg-gray-700 transition-colors"
                          onClick={() => {
                            field.onChange(p);
                            onPairChange(p); // Notificar el cambio al padre
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
              ) : (
                <Select onValueChange={(value) => { field.onChange(value); onPairChange(value); }} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                      <SelectValue placeholder="Selecciona un par" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="bg-gray-700 border-gray-600 text-white">
                    {topPairs.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
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
              <FormLabel className="text-gray-300">Ganancia (%)</FormLabel>
              <FormControl>
                <Input type="number" step="0.1" {...field} className="bg-gray-700 border-gray-600 text-white" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          {isSubmitting ? 'Comprando...' : 'Comprar'}
        </Button>
      </form>
    </Form>
  );
};

export default ManualTradeForm;