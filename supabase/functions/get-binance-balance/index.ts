import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Prueba de conectividad básica a un punto público de Binance
    const binanceTimeUrl = 'https://api.binance.com/api/v3/time';
    
    const response = await fetch(binanceTimeUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('Error en la prueba de conectividad a la API de Binance:', data);
        return new Response(JSON.stringify({ error: 'No se pudo conectar a la API de Binance', details: data }), {
            status: response.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Si tiene éxito, devuelve la hora del servidor
    return new Response(JSON.stringify({ 
        message: "Prueba de conectividad a Binance exitosa.",
        binanceServerTime: new Date(data.serverTime).toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Error no controlado en la función durante la prueba de conectividad:', error);
    const errorResponse = {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
    return new Response(JSON.stringify({ error: 'La prueba de conectividad falló a bajo nivel.', details: errorResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})