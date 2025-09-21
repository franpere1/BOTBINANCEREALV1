"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DollarSign } from 'lucide-react';
import MinutePriceMonitor from '@/components/MinutePriceMonitor';
import StrategicPurchaseForm from '@/components/StrategicPurchaseForm';
import ActiveTrades from '@/components/ActiveTrades'; // Reutilizar ActiveTrades para mostrar las compras estratégicas

const topPairs = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'SHIBUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT'
];

const StrategicPurchases = () => {
  return (
    <div className="space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl flex items-center">
            <DollarSign className="h-6 w-6 mr-2" />
            Compras Estratégicas
          </CardTitle>
          <CardDescription className="text-gray-400">
            Configura una estrategia de compra automática basada en dips de precio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StrategicPurchaseForm />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* El MinutePriceMonitor se mantiene ya que es relevante para la estrategia de dip */}
        <MinutePriceMonitor strategicAssets={topPairs} />
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones Estratégicas Activas</CardTitle>
          <CardDescription className="text-gray-400">
            Operaciones iniciadas por estrategias de compra que están esperando alcanzar su objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActiveTrades strategyType="strategic" /> {/* Pasar strategyType="strategic" */}
        </CardContent>
      </Card>
    </div>
  );
};

export default StrategicPurchases;