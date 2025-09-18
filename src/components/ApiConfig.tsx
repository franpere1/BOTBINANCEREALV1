"use client";

import React, { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { showSuccess } from '@/utils/toast';

const ApiConfig = () => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Por ahora, solo mostraremos un mensaje de éxito.
    // En un futuro, guardaremos estas claves de forma segura.
    console.log('API Key:', apiKey);
    console.log('API Secret:', apiSecret);
    showSuccess('¡Claves guardadas con éxito!');
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Configuración de API de Binance</CardTitle>
        <CardDescription className="text-gray-400">
          Introduce tus claves de API para conectar tu cuenta.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key" className="text-gray-300">API Key</Label>
            <Input
              id="api-key"
              type="text"
              placeholder="Tu API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-secret" className="text-gray-300">API Secret</Label>
            <Input
              id="api-secret"
              type="password"
              placeholder="Tu API Secret"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white"
              required
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold">
            Guardar Claves
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default ApiConfig;