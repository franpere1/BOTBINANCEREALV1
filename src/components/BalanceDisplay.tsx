"use client";

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { showError, showSuccess } from '@/utils/toast';
import { Wallet } from 'lucide-react';

type Balance = {
  asset: string;
  free: string;
  locked: string;
};

const BalanceDisplay = () => {
  const { session } = useAuth();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchBalance = async () => {
    if (!session) {
      showError("Debes iniciar sesión para consultar tu saldo.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setHasFetched(true);

    const { data, error: functionError } = await supabase.functions.invoke('get-binance-balance');

    setIsLoading(false);

    if (functionError) {
      console.error('Error invoking function:', functionError);
      const rawErrorString = JSON.stringify(functionError, null, 2);
      const detailedErrorMessage = `Error técnico: ${rawErrorString}`;
      setError(detailedErrorMessage);
      showError('Error al obtener el saldo. Revisa los detalles en pantalla.');
      setBalances([]);
    } else if (data.error) {
        console.error('Binance API Error:', data.details);
        const errorMessage = `Error de Binance: ${data.details.msg} (Código: ${data.details.code})`;
        setError(errorMessage);
        showError('Hubo un problema con la API de Binance.');
        setBalances([]);
    }
    else {
      setBalances(data.balances);
      showSuccess('Saldo actualizado correctamente.');
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Saldo de la Cuenta</CardTitle>
        <CardDescription className="text-gray-400">
          Consulta el saldo de tu cuenta de Binance en tiempo real.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={fetchBalance} disabled={isLoading} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
          <Wallet className="mr-2 h-4 w-4" />
          {isLoading ? 'Consultando...' : 'Consultar Saldo'}
        </Button>

        {isLoading && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div className="mt-4 text-left text-red-400 bg-red-900/50 p-3 rounded-md overflow-auto">
            <p className="font-mono text-xs whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {!isLoading && !error && hasFetched && balances.length === 0 && (
            <div className="mt-4 text-center text-gray-400 bg-gray-900/50 p-3 rounded-md">
                <p>No se encontraron saldos o todas las monedas tienen balance cero.</p>
            </div>
        )}

        {!isLoading && !error && balances.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <Table className="text-white">
              <TableHeader>
                <TableRow className="border-gray-700 hover:bg-gray-700/50">
                  <TableHead className="text-yellow-400">Activo</TableHead>
                  <TableHead className="text-right text-yellow-400">Disponible</TableHead>
                  <TableHead className="text-right text-yellow-400">Bloqueado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((balance) => (
                  <TableRow key={balance.asset} className="border-gray-700 hover:bg-gray-700/50">
                    <TableCell className="font-medium">{balance.asset}</TableCell>
                    <TableCell className="text-right">{parseFloat(balance.free).toFixed(8)}</TableCell>
                    <TableCell className="text-right">{parseFloat(balance.locked).toFixed(8)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BalanceDisplay;