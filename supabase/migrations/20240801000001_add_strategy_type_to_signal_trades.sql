ALTER TABLE public.signal_trades
ADD COLUMN strategy_type text DEFAULT 'ml_signal' NOT NULL;

-- Actualizar los registros existentes para que tengan el valor por defecto
UPDATE public.signal_trades
SET strategy_type = 'ml_signal'
WHERE strategy_type IS NULL;

-- Asegurarse de que la columna no pueda ser nula
ALTER TABLE public.signal_trades
ALTER COLUMN strategy_type SET NOT NULL;