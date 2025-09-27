-- Crear la tabla user_strategy_configs
CREATE TABLE public.user_strategy_configs (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_name TEXT NOT NULL,
  usdt_amount NUMERIC NOT NULL,
  take_profit_percentage NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, strategy_name)
);

-- Habilitar Row Level Security (RLS) para la tabla (¡IMPORTANTE para la seguridad!)
ALTER TABLE public.user_strategy_configs ENABLE ROW LEVEL SECURITY;

-- Política para que los usuarios puedan ver sus propias configuraciones
CREATE POLICY "Users can view their own strategy configs" ON public.user_strategy_configs
FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Política para que los usuarios puedan insertar sus propias configuraciones
CREATE POLICY "Users can insert their own strategy configs" ON public.user_strategy_configs
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Política para que los usuarios puedan actualizar sus propias configuraciones
CREATE POLICY "Users can update their own strategy configs" ON public.user_strategy_configs
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Política para que los usuarios puedan eliminar sus propias configuraciones
CREATE POLICY "Users can delete their own strategy configs" ON public.user_strategy_configs
FOR DELETE TO authenticated USING (auth.uid() = user_id);