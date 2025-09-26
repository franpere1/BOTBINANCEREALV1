CREATE TABLE public.user_strategy_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    strategy_name text NOT NULL,
    usdt_amount numeric NOT NULL,
    take_profit_percentage numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_strategy_configs_pkey PRIMARY KEY (id),
    CONSTRAINT user_strategy_configs_user_id_strategy_name_key UNIQUE (user_id, strategy_name),
    CONSTRAINT user_strategy_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.user_strategy_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own strategy configs."
  ON public.user_strategy_configs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own strategy configs."
  ON public.user_strategy_configs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own strategy configs."
  ON public.user_strategy_configs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own strategy configs."
  ON public.user_strategy_configs FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger para actualizar 'updated_at'
CREATE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_user_strategy_configs_updated_at
BEFORE UPDATE ON public.user_strategy_configs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();