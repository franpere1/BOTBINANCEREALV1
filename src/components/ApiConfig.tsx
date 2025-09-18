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
import { CheckCircle, Edit } from 'lucide-react';

const ApiConfig = () => {
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasExistingKeys, setHasExistingKeys] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const fetchKeys = async () => {
      if (!user) return;

      setIsLoading(true);
      const { data, error } = await supabase
        .from('api_keys')
        .select('api_key')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching API keys:', error);
        showError('Error al cargar las claves de API.');
      }

      if (data) {
        setApiKey(data.api_key);
        setApiSecret('');
        setHasExistingKeys(true);
        setIsEditing(false); // Claves existen, mostrar vista de confirmación
      } else {
        setHasExistingKeys(false);
        setIsEditing(true); // No hay claves, ir directo al formulario
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
      ({ error } = await supabase.from('api_keys').upsert({
        user_id: user.id,
        api_key: apiKey,
        api_secret: apiSecret,
      }));
    } else if (hasExistingKeys) {
      ({ error } = await supabase.from('api_keys').update({
        api_key: apiKey,
      }).eq('user_id', user.id));
    } else {
      showError('El API Secret es obligatorio la primera vez que guardas.');
      setIsSaving(false);
      return;
    }

    if (error) {
      console.error('Error saving API keys:', error);
      showError('Hubo un error al guardar las claves.');
    } else {
      showSuccess('¡Claves guardadas con éxito!');
      setApiSecret('');
      setHasExistingKeys(true);
      setIsEditing(false); // Volver a la vista de confirmación
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
        <CardContent>
          <Skeleton className="h-20 w-full" />
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
          {isEditing
            ? (hasExistingKeys ? "Actualiza tus claves de API aquí." : "Introduce tus claves para conectar tu cuenta.")
            : "Tu cuenta de Binance está conectada."
          }
        </CardDescription>
      </CardHeader>
      
      {isEditing ? (
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
          <CardFooter className="flex flex-col sm:flex-row sm:justify-end sm:space-x-2 space-y-2 sm:space-y-0">
            {hasExistingKeys && (
              <Button type="button" variant="outline" onClick={() => setIsEditing(false)} disabled={isSaving} className="w-full sm:w-auto">
                Cancelar
              </Button>
            )}
            <Button type="submit" className="w-full sm:w-auto bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold" disabled={isSaving}>
              {isSaving ? 'Guardando...' : 'Guardar Claves'}
            </Button>
          </CardFooter>
        </form>
      ) : (
        <>
          <CardContent>
            <div className="flex items-center p-4 bg-green-900/50 rounded-md border border-green-700">
              <CheckCircle className="h-6 w-6 text-green-400 mr-4 flex-shrink-0" />
              <p className="text-green-300">Tus claves de API están configuradas y activas.</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={() => setIsEditing(true)} className="w-full bg-gray-600 hover:bg-gray-700">
              <Edit className="mr-2 h-4 w-4" />
              Editar Claves de API
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
};

export default ApiConfig;