"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DollarSign } from 'lucide-react';

const StrategicPurchases = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] p-4">
      <Card className="w-full max-w-2xl bg-gray-800 border-gray-700 text-white text-center">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-3xl flex items-center justify-center">
            <DollarSign className="h-8 w-8 mr-3" />
            Compras Estratégicas
          </CardTitle>
          <CardDescription className="text-gray-400 mt-2 text-lg">
            Esta sección está en desarrollo. Aquí podrás configurar y monitorear tus estrategias de compra automatizadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-gray-300 text-base">
            Próximamente: Análisis de microtendencias, modelo predictivo de IA, stop loss y take profit dinámicos, y un dashboard completo para maximizar tus ganancias en USDT.
          </p>
          <p className="text-gray-500 text-sm mt-4">
            ¡Mantente atento a las actualizaciones!
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default StrategicPurchases;