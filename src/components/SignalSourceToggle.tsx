"use client";

import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface SignalSourceToggleProps {
  onSourceChange: (source: 'binance-api' | 'supabase-db') => void;
  currentSource: 'binance-api' | 'supabase-db';
}

const SignalSourceToggle = ({ onSourceChange, currentSource }: SignalSourceToggleProps) => {
  const isSupabaseDb = currentSource === 'supabase-db';

  const handleToggle = (checked: boolean) => {
    onSourceChange(checked ? 'supabase-db' : 'binance-api');
  };

  return (
    <div className="flex items-center space-x-2 p-3 bg-gray-700 rounded-md border border-gray-600">
      <Label htmlFor="signal-source-toggle" className="text-gray-300 font-medium">
        Fuente de Señales:
      </Label>
      <span className={`text-sm ${!isSupabaseDb ? 'text-yellow-400 font-semibold' : 'text-gray-400'}`}>
        Binance API
      </span>
      <Switch
        id="signal-source-toggle"
        checked={isSupabaseDb}
        onCheckedChange={handleToggle}
        className="data-[state=checked]:bg-yellow-500 data-[state=unchecked]:bg-gray-500"
      />
      <span className={`text-sm ${isSupabaseDb ? 'text-yellow-400 font-semibold' : 'text-gray-400'}`}>
        Supabase DB
      </span>
    </div>
  );
};

export default SignalSourceToggle;