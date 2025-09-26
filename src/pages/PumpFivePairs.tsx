"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Rocket } from 'lucide-react'; // Icono para la estrategia
import PumpFivePairsConfigForm from '@/components/PumpFivePairsConfigForm';
import ActivePumpFivePairsTrades from '@/components/ActivePumpFivePairsTrades';
import HourlyPriceMonitor from '@/components/HourlyPriceMonitor'; // Reutilizar el monitor de precios por hora

const topPairsForSignals = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'TRXUSDT']; // Lista de activos que el monitor de precios por hora ya maneja

const PumpFivePairs = () => {
  return (
    <div className="space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl flex items-center">
            <Rocket className="h-6 w-6 mr-2" />
            Estrategia: Pump 5 Pares
          </CardTitle>
          <CardDescription className="text-gray-400">
            Configura tu estrategia de trading automático para identificar y operar los 5 pares USDT con mayor impulso alcista.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PumpFivePairsConfigForm />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* El HourlyPriceMonitor es relevante para esta estrategia ya que usa datos de 1h */}
        <HourlyPriceMonitor signalAssets={topPairsForSignals} />
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones Activas (Pump 5 Pares)</CardTitle>
          <CardDescription className="text-gray-400">
            Operaciones iniciadas por la estrategia 'Pump 5 Pares' que están esperando alcanzar su objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivePumpFivePairsTrades />
        </CardContent>
      </Card>
    </div>
  );
};

export default PumpFivePairs;