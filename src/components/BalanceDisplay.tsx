"use client";

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from "@/components/ui/skeleton";
import { showError, showSuccess } from '@/utils/toast';
import { Network, Wifi, WifiOff } from 'lucide-react';

const BalanceDisplay = () => {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  const runConnectivityTest = async () => {
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
      console.error('Error al invocar la función de prueba de conectividad:', functionError);
      const rawErrorString = JSON.stringify(functionError, null, 2);
      setError(`Error técnico en la prueba de conectividad: ${rawErrorString}`);
      showError('La prueba de conectividad falló. Revisa los detalles.');
    } else if (data.error) {
      console.error('La prueba de conectividad falló en el servidor:', data.details);
      setError(`El servidor no pudo conectar con Binance: ${JSON.stringify(data.details)}`);
      showError('La prueba de conectividad falló en el servidor.');
    }
    else {
      setTestResult(data);
      showSuccess('¡Prueba de conectividad a Binance exitosa!');
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Diagnóstico Final: Conectividad de Red</CardTitle>
        <CardDescription className="text-gray-400">
          Verificando si el servidor puede establecer una comunicación básica con Binance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={runConnectivityTest} disabled={isLoading} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          <Network className="mr-2 h-4 w-4" />
          {isLoading ? 'Probando conexión...' : 'Iniciar Prueba de Conectividad'}
        </Button>

        {isLoading && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div className="mt-4 flex items-start p-4 bg-red-900/50 rounded-md border border-red-700">
            <WifiOff className="h-6 w-6 text-red-400 mr-4 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-red-300">Fallo de Conexión</h4>
              <p className="font-mono text-xs whitespace-pre-wrap mt-2">{error}</p>
            </div>
          </div>
        )}

        {testResult && !isLoading && (
          <div className="mt-4 flex items-start p-4 bg-green-900/50 rounded-md border border-green-700">
            <Wifi className="h-6 w-6 text-green-400 mr-4 flex-shrink-0" />
            <div>
                <h4 className="font-bold text-green-300">Conexión Exitosa</h4>
                <p className="text-green-300 text-sm mt-1">{testResult.message}</p>
                <p className="font-mono text-xs text-gray-400 mt-2">Hora del servidor de Binance: {testResult.binanceServerTime}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BalanceDisplay;