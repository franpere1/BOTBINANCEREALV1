"use client";

import { useState } from 'react';
import CryptoJS from 'crypto-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal, TriangleAlert, Wallet } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';

const DirectBalanceTest = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchBalanceDirectly = async () => {
    if (!user) {
      showError("Debes iniciar sesión para realizar la prueba.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      // 1. Obtener las claves de API (INSEGURO: el secreto viaja al cliente)
      const { data: keys, error: keysError } = await supabase
        .from('api_keys')
        .select('api_key, api_secret')
        .eq('user_id', user.id)
        .single();

      if (keysError || !keys) {
        throw new Error("No se pudieron obtener las claves de API. Asegúrate de que estén guardadas.");
      }

      const { api_key, api_secret } = keys;
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      
      // 2. Crear la firma HMAC-SHA256
      const signature = CryptoJS.HmacSHA256(queryString, api_secret).toString(CryptoJS.enc.Hex);
      
      const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;

      // 3. Realizar la llamada a la API de Binance
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': api_key,
        },
      });

      const responseData = await response.json();

      if (!response.ok) {
        // Si la API de Binance devuelve un error
        throw new Error(`Error de Binance: ${responseData.msg} (Código: ${responseData.code})`);
      }
      
      // Filtrar solo los balances que no son cero
      const balances = responseData.balances.filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
      setResult({ balances });
      showSuccess("¡Balance obtenido con éxito desde el navegador!");

    } catch (err: any) {
      console.error("Error en la prueba directa:", err);
      let errorMessage = err.message;
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        errorMessage = "Error de CORS. El navegador bloqueó la solicitud. Esto es esperado y confirma que la llamada debe hacerse desde un servidor.";
      }
      setError(errorMessage);
      showError("La prueba directa falló.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Diagnóstico Alternativo: Prueba Directa</CardTitle>
        <CardDescription className="text-gray-400">
          Este es un método de diagnóstico inseguro que llama a Binance desde tu navegador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive" className="mb-4">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Advertencia de Seguridad</AlertTitle>
          <AlertDescription>
            Esta prueba expone tu API Secret en el navegador. Úsala solo para diagnóstico y considera rotar tus claves después.
          </AlertDescription>
        </Alert>

        <Button onClick={fetchBalanceDirectly} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold">
          <Wallet className="mr-2 h-4 w-4" />
          {isLoading ? 'Obteniendo balance...' : 'Iniciar Prueba Directa (Inseguro)'}
        </Button>

        {error && !isLoading && (
          <div className="mt-4 p-4 bg-red-900/50 rounded-md border border-red-700">
            <h4 className="font-bold text-red-300">Fallo la Prueba Directa</h4>
            <p className="font-mono text-xs whitespace-pre-wrap mt-2 text-red-400">{error}</p>
          </div>
        )}

        {result && !isLoading && (
          <div className="mt-4 p-4 bg-green-900/50 rounded-md border border-green-700">
            <h4 className="font-bold text-green-300">Balance Obtenido</h4>
            <pre className="font-mono text-xs text-gray-300 mt-2 overflow-x-auto">
              {JSON.stringify(result.balances, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DirectBalanceTest;