ALTER TABLE public.ask_threads
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_message_count integer NOT NULL DEFAULT 0;