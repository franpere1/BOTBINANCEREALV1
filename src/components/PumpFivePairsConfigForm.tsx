"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { showError, showSuccess } from '@/utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Rocket, Loader2 } from 'lucide-react';

const formSchema = z.object({
  usdtAmount: z.coerce.number().positive("La cantidad debe ser mayor que 0."),
  takeProfitPercentage: z.coerce.number().positive("El porcentaje de ganancia debe ser mayor que 0."),
});

const PumpFivePairsConfigForm = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false); // Para saber si ya hay una configuración guardada

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      usdtAmount: 10,
      takeProfitPercentage: 2, // Un objetivo de ganancia razonable para esta estrategia
    },
  });

  // Cargar configuración existente al inicio
  React.useEffect(() => {
    const fetchConfig = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from('user_strategy_configs')
        .select('usdt_amount, take_profit_percentage')
        .eq('user_id', user.id)
        .eq('strategy_name', 'pump_five_pairs')
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
        console.error('Error fetching pump_five_pairs config:', error);
        showError('Error al cargar la configuración de la estrategia.');
      }

      if (data) {
        form.reset({
          usdtAmount: data.usdt_amount,
          takeProfitPercentage: data.take_profit_percentage,
        });
        setIsConfigured(true);
      } else {
        setIsConfigured(false);
      }
    };
    fetchConfig();
  }, [user, form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) {
      showError("Debes iniciar sesión para configurar la estrategia.");
      return;
    }
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('user_strategy_configs')
        .upsert({
          user_id: user.id,
          strategy_name: 'pump_five_pairs',
          usdt_amount: values.usdtAmount,
          take_profit_percentage: values.takeProfitPercentage,
          // Otros parámetros de la estrategia se pueden añadir aquí si son configurables
        }, { onConflict: 'user_id, strategy_name' });

      if (error) {
        throw new Error(error.message);
      }

      showSuccess(`Estrategia 'Pump 5 Pares' ${isConfigured ? 'actualizada' : 'configurada'} con éxito.`);
      setIsConfigured(true);
      queryClient.invalidateQueries({ queryKey: ['userStrategyConfigs'] }); // Invalidar para refrescar cualquier otro componente que use esto
    } catch (error: any) {
      showError(`Error al configurar la estrategia: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
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
        <Button type="submit" disabled={isSubmitting} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Rocket className="mr-2 h-4 w-4" />
              {isConfigured ? 'Actualizar Configuración' : 'Guardar Configuración'}
            </>
          )}
        </Button>
      </form>
    </Form>
  );
};

export default PumpFivePairsConfigForm;