ALTER TABLE public.signal_trades
ADD COLUMN strategy_type TEXT DEFAULT 'ml_signal';

-- Actualizar las políticas RLS para incluir la nueva columna si es necesario,
-- o asegurarse de que las políticas existentes no la restrinjan.
-- Por ejemplo, si tienes una política de INSERT, asegúrate de que permita el nuevo campo.
-- Si ya tienes políticas que usan 'auth.uid() = user_id', no necesitarás cambios adicionales
-- a menos que quieras restringir el acceso basado en 'strategy_type'.
-- Para este caso, asumimos que las políticas existentes son suficientes o se ajustarán automáticamente.

-- Ejemplo de cómo podrías actualizar una política de INSERT si fuera necesario:
-- DROP POLICY IF EXISTS "Users can only insert their own signal trades" ON public.signal_trades;
-- CREATE POLICY "Users can only insert their own signal trades" ON public.signal_trades
-- FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Asegurémonos de que las políticas existentes cubran la nueva columna.
-- Si las políticas son genéricas (e.g., `USING (auth.uid() = user_id)`), no necesitan modificación.
-- Si fueran más específicas, tendríamos que ajustarlas.
-- Basado en tu esquema, las políticas existentes para `signal_trades` son:
-- "Users can only insert their own signal trades"
-- "Users can only see their own signal trades"
-- "Users can only update their own signal trades"
-- "Users can only delete their own signal trades"
-- Estas políticas ya usan `auth.uid() = user_id`, por lo que no necesitan cambios para la nueva columna.