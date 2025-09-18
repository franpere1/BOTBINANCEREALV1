"use client";

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from "@/components/ui/skeleton";
import { showError, showSuccess } from '@/utils/toast';
import { KeyRound, ShieldCheck, ShieldX } from 'lucide-react';

const BalanceDisplay = () => {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  const runApiKeysTest = async () => {
    if (!session) {
      showError("Debes iniciar sesión para realizar la prueba.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setTestResult(null);

    const { data, error: functionError } = await supabase.functions.invoke('get-binance-balance');

    setIsLoading(false);

    if (functionError) {
      console.error('Error invoking API keys test function:', functionError);
      const rawErrorString = JSON.stringify(functionError, null, 2);
      setError(`Error técnico en la prueba de claves API: ${rawErrorString}`);
      showError('La prueba de claves API falló. Revisa los detalles.');
    } else if (data.error) {
      console.error('API keys test failed on server:', data.details);
      const errorMessage = data.details ? (data.details.message || JSON.stringify(data.details)) : 'Error desconocido';
      setError(`El servidor reportó un fallo en la obtención de claves: ${errorMessage}`);
      showError('La prueba de claves API falló en el servidor.');
    }
    else {
      setTestResult(data);
      showSuccess('¡Prueba de obtención de claves API exitosa!');
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Diagnóstico: Obtención de Claves API</CardTitle>
        <CardDescription className="text-gray-400">
          Verificando el acceso a las claves API guardadas en la base de datos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={runApiKeysTest} disabled={isLoading} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          <KeyRound className="mr-2 h-4 w-4" />
          {isLoading ? 'Obteniendo claves...' : 'Iniciar Prueba de Claves API'}
        </Button>

        {isLoading && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div className="mt-4 flex items-start p-4 bg-red-900/50 rounded-md border border-red-700">
            <ShieldX className="h-6 w-6 text-red-400 mr-4 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-red-300">Fallo en la prueba</h4>
              <p className="font-mono text-xs whitespace-pre-wrap mt-2">{error}</p>
            </div>
          </div>
        )}

        {testResult && !isLoading && (
          <div className="mt-4 flex items-start p-4 bg-green-900/50 rounded-md border border-green-700">
            <ShieldCheck className="h-6 w-6 text-green-400 mr-4 flex-shrink-0" />
            <div>
                <h4 className="font-bold text-green-300">Prueba Exitosa</h4>
                <p className="text-green-300 text-sm mt-1">{testResult.message}</p>
                <p className="font-mono text-xs text-gray-400 mt-2">Clave encontrada: {testResult.apiKeyFound}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BalanceDisplay;