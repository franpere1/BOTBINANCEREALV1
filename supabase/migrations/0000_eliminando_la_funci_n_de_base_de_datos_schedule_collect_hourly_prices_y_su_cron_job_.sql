-- Eliminar el cron job si existe
SELECT cron.unschedule('collect-hourly-prices-job');

-- Eliminar la función si existe
DROP FUNCTION IF EXISTS public.schedule_collect_hourly_prices();