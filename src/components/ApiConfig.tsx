"use client";

import React, { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { showSuccess, showError } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { Skeleton } from "@/components/ui/skeleton";

const ApiConfig = () => {
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasExistingKeys, setHasExistingKeys] = useState(false);

  useEffect(() => {
    const fetchKeys = async () => {
      if (!user) return;

      setIsLoading(true);
      const { data, error } = await supabase
        .from('api_keys')
        .select('api_key')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
        console.error('Error fetching API keys:', error);
        showError('Error al cargar las claves de API.');
      }

      if (data) {
        setApiKey(data.api_key);
        setApiSecret(''); // No pre-llenar el secreto por seguridad
        setHasExistingKeys(true);
      }
      setIsLoading(false);
    };

    fetchKeys();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      showError('Debes iniciar sesión para guardar las claves.');
      return;
    }
    
    setIsSaving(true);

    let error;

    if (apiSecret) {
      // Si se proporciona un nuevo secreto, hacemos upsert para todo
      ({ error } = await supabase.from('api_keys').upsert({
        user_id: user.id,
        api_key: apiKey,
        api_secret: apiSecret,
      }));
    } else if (hasExistingKeys) {
      // Si existen claves y no se proporciona un nuevo secreto, solo actualizamos la API key
      ({ error } = await supabase.from('api_keys').update({
        api_key: apiKey,
      }).eq('user_id', user.id));
    } else {
      // Si no existen claves, el secreto es obligatorio
      showError('El API Secret es obligatorio la primera vez que guardas.');
      setIsSaving(false);
      return;
    }

    if (error) {
      console.error('Error saving API keys:', error);
      showError('Hubo un error al guardar las claves.');
    } else {
      showSuccess('¡Claves guardadas con éxito!');
      setApiSecret(''); // Limpiar el campo del secreto después de guardar
      if (!hasExistingKeys) setHasExistingKeys(true);
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
        <CardHeader>
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
        <CardFooter>
          <Skeleton className="h-10 w-full" />
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-yellow-400">Configuración de API de Binance</CardTitle>
        <CardDescription className="text-gray-400">
          {hasExistingKeys 
            ? "Tus claves están guardadas. Puedes actualizarlas aquí."
            : "Introduce tus claves de API para conectar tu cuenta."
          }
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
              placeholder={hasExistingKeys ? "Introduce un nuevo secreto para actualizar" : "Tu API Secret"}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white"
              required={!hasExistingKeys}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold" disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Guardar Claves'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default ApiConfig;