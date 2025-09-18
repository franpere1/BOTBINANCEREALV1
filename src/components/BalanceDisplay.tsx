"use client";

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from "@/components/ui/skeleton";
import { showError, showSuccess } from '@/utils/toast';
import { Wallet, AlertCircle } from 'lucide-react';

interface Balance {
  asset: string;
  free: string;
  locked: string;
}

const BalanceDisplay = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);

  const fetchBalance = async () => {
    setIsLoading(true);
    setError(null);
    setBalances(null);

    const { data, error: functionError } = await supabase.functions.invoke('get-binance-balance');

    setIsLoading(false);

    if (functionError) {
      console.error('Error invoking function:', functionError);
      const errorMessage = data?.error || functionError.message;
      
      let displayError = `Error al obtener el balance: ${errorMessage}`;
      if (errorMessage && errorMessage.includes('restricted location')) {
        displayError = "Error de Ubicación Restringida: Binance está bloqueando las solicitudes desde la región del servidor actual (EE. UU.). Para solucionar esto, el proyecto de Supabase debe estar en una región no restringida, como Europa o Asia.";
      }
      
      setError(displayError);
      showError('No se pudo obtener el balance.');
    } else {
      setBalances(data);
      showSuccess('¡Balance actualizado con éxito!');
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Balance de la Cuenta de Binance</CardTitle>
        <CardDescription className="text-gray-400">
          Consulta los saldos de tus activos directamente desde Binance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={fetchBalance} disabled={isLoading} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          <Wallet className="mr-2 h-4 w-4" />
          {isLoading ? 'Consultando...' : 'Consultar Balance'}
        </Button>

        {isLoading && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div className="mt-4 flex items-start p-4 bg-red-900/50 rounded-md border border-red-700">
            <AlertCircle className="h-6 w-6 text-red-400 mr-4 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-red-300">Error</h4>
              <p className="text-sm text-red-400 mt-1">{error}</p>
            </div>
          </div>
        )}

        {balances && !isLoading && (
          <div className="mt-4">
            {balances.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-white">Activo</TableHead>
                    <TableHead className="text-right text-white">Disponible</TableHead>
                    <TableHead className="text-right text-white">Bloqueado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((balance) => (
                    <TableRow key={balance.asset}>
                      <TableCell className="font-medium">{balance.asset}</TableCell>
                      <TableCell className="text-right">{parseFloat(balance.free).toFixed(8)}</TableCell>
                      <TableCell className="text-right">{parseFloat(balance.locked).toFixed(8)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-gray-400 mt-4">No se encontraron activos con balance.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BalanceDisplay;