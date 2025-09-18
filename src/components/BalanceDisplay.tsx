"use client";

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from "@/components/ui/skeleton";
import { showError, showSuccess } from '@/utils/toast';
import { Wallet, CheckCircle } from 'lucide-react';

const BalanceDisplay = () => {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const runServerTest = async () => {
    if (!session) {
      showError("Debes iniciar sesión para realizar la prueba.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setTestMessage(null);

    const { data, error: functionError } = await supabase.functions.invoke('get-binance-balance');

    setIsLoading(false);

    if (functionError) {
      console.error('Error invoking test function:', functionError);
      const rawErrorString = JSON.stringify(functionError, null, 2);
      const detailedErrorMessage = `Error técnico en la prueba: ${rawErrorString}`;
      setError(detailedErrorMessage);
      showError('La prueba de conexión falló. Revisa los detalles.');
    } else {
      setTestMessage(data.message);
      showSuccess('¡Prueba de conexión exitosa!');
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Diagnóstico del Servidor</CardTitle>
        <CardDescription className="text-gray-400">
          Ejecuta una prueba de conexión con el servidor para verificar el estado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={runServerTest} disabled={isLoading} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          <Wallet className="mr-2 h-4 w-4" />
          {isLoading ? 'Ejecutando prueba...' : 'Iniciar Prueba de Conexión'}
        </Button>

        {isLoading && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div className="mt-4 text-left text-red-400 bg-red-900/50 p-3 rounded-md overflow-auto">
            <p className="font-mono text-xs whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {testMessage && !isLoading && (
          <div className="mt-4 flex items-center p-4 bg-green-900/50 rounded-md border border-green-700">
            <CheckCircle className="h-6 w-6 text-green-400 mr-4 flex-shrink-0" />
            <p className="text-green-300">{testMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BalanceDisplay;