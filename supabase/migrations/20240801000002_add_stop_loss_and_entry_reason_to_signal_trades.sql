ALTER TABLE public.signal_trades
ADD COLUMN stop_loss_price numeric,
ADD COLUMN entry_reason text;