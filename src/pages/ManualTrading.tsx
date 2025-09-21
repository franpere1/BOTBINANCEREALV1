"use client";

import React, { useState } from 'react';
import ManualTradeForm from '@/components/ManualTradeForm';
import ActiveTrades from '@/components/ActiveTrades';
import PriceChart from '@/components/PriceChart'; // Importar el nuevo componente de gráfico
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const topPairs = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
  'DOGEUSDT', 'ADAUSDT', 'SHIBUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT'
];

const ManualTrading = () => {
  const [selectedPair, setSelectedPair] = useState<string>(topPairs[0]); // Estado para el par seleccionado

  return (
    <div className="space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Trading Manual</CardTitle>
          <CardDescription className="text-gray-400">
            Crea una orden de compra y establece un objetivo de ganancia. El sistema venderá automáticamente cuando se alcance el objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManualTradeForm selectedPair={selectedPair} onPairChange={setSelectedPair} />
        </CardContent>
      </Card>

      {/* Nuevo componente de gráfico */}
      <PriceChart pair={selectedPair} lookbackMinutes={60} />

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones Activas</CardTitle>
        </CardHeader>
        <CardContent>
          <ActiveTrades strategyType="manual" />
        </CardContent>
      </Card>
    </div>
  );
};

export default ManualTrading;