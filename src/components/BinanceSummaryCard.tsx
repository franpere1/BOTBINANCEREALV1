"use client";

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { showError } from '@/utils/toast';

interface Balance {
  asset: string;
  free: string;
  locked: string;
}

interface TickerPrice {
  symbol: string;
  price: string;
}

interface ActiveTrade {
  id: string;
  pair: string;
  usdt_amount: number;
  asset_amount: number;
  purchase_price: number;
  target_price: number;
  created_at: string;
}

const fetchBinanceAccountSummary = async () => {
  const { data, error } = await supabase.functions.invoke('get-binance-account-summary');
  if (error) throw new Error(data?.error || error.message);
  return data;
};

const fetchActiveTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('manual_trades')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  return data;
};

const BinanceSummaryCard = () => {
  const { user } = useAuth();

  const { data: summaryData, isLoading: isLoadingSummary, isError: isErrorSummary } = useQuery({
    queryKey: ['binanceAccountSummary'],
    queryFn: fetchBinanceAccountSummary,
    enabled: !!user,
    refetchInterval: 30000, // Actualizar cada 30 segundos
  });

  const { data: activeTrades, isLoading: isLoadingTrades, isError: isErrorTrades } = useQuery({
    queryKey: ['activeTradesForSummary'],
    queryFn: () => fetchActiveTrades(user!.id),
    enabled: !!user,
    refetchInterval: 30000, // Actualizar cada 30 segundos
  });

  if (isErrorSummary) {
    showError(`Error al cargar el resumen de Binance: ${summaryData?.error || 'Error desconocido'}`);
  }
  if (isErrorTrades) {
    showError(`Error al cargar las operaciones activas para el resumen.`);
  }

  if (isLoadingSummary || isLoadingTrades || !user) {
    return (
      <Card className="w-full max-w-[300px] bg-gray-800 border-gray-700 text-white">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-3/4" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  const balances: Balance[] = summaryData?.balances || [];
  const tickerPrices: TickerPrice[] = summaryData?.tickerPrices || [];
  const trades: ActiveTrade[] = activeTrades || [];

  const getPrice = (symbol: string): number => {
    const ticker = tickerPrices.find(t => t.symbol === symbol);
    return ticker ? parseFloat(ticker.price) : 0;
  };

  let usdtBalance = 0;
  let totalEquity = 0;
  let capitalUsed = 0;
  let floatingPnL = 0;

  // Calcular Saldo USDT y Equidad Total
  balances.forEach(b => {
    const free = parseFloat(b.free);
    const locked = parseFloat(b.locked);
    const totalAsset = free + locked;

    if (b.asset === 'USDT') {
      usdtBalance = free;
      totalEquity += totalAsset; // USDT contribuye directamente a la equidad
    } else if (totalAsset > 0) {
      const pair = `${b.asset}USDT`;
      const price = getPrice(pair);
      totalEquity += totalAsset * price;
    }
  });

  // Calcular Capital Usado y P/L Flotante de operaciones activas
  trades.forEach(trade => {
    capitalUsed += trade.usdt_amount;
    const currentPrice = getPrice(trade.pair);
    if (currentPrice > 0 && trade.asset_amount && trade.purchase_price) {
      floatingPnL += (currentPrice - trade.purchase_price) * trade.asset_amount;
    }
  });

  const availableCapital = totalEquity - capitalUsed;
  const pnlColor = floatingPnL >= 0 ? 'text-green-400' : 'text-red-400';
  const PnLIcon = floatingPnL >= 0 ? TrendingUp : TrendingDown;

  const floatingPnLPercentage = capitalUsed > 0 ? (floatingPnL / capitalUsed) * 100 : 0;

  return (
    <Card className="w-full max-w-[300px] bg-gray-800 border-gray-700 text-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-yellow-400 flex items-center">
          <Wallet className="h-5 w-5 mr-2" />
          Resumen de Binance
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        <p className="text-gray-400">Saldo Disponible USDT: <span className="text-white font-semibold">${usdtBalance.toFixed(2)}</span></p>
        <p className="text-gray-400">Equidad Actual: <span className="text-white font-semibold">${totalEquity.toFixed(2)}</span></p>
        <p className="text-gray-400">Capital Usado: <span className="text-white font-semibold">${capitalUsed.toFixed(2)}</span></p>
        <p className="text-gray-400">Capital Disponible: <span className="text-white font-semibold">${availableCapital.toFixed(2)}</span></p>
        <p className={`flex items-center ${pnlColor}`}>
          <PnLIcon className="h-4 w-4 mr-1" />
          P/L Flotante: <span className="font-semibold ml-1">${floatingPnL.toFixed(2)}</span>
          {capitalUsed > 0 && (
            <span className="ml-1 text-xs">({floatingPnLPercentage.toFixed(2)}%)</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
};

export default BinanceSummaryCard;