-- Durable Hub → Resend contact-sync outcomes.
-- email_send_log is for outbound mail (pending/sent/failed/…); this table is
-- contact upsert observability only. No mail is sent from this path.

CREATE TABLE IF NOT EXISTS public.resend_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('stripe_webhook', 'public_capture', 'backfill')),
  segment TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('ok', 'skip', 'fail')),
  reason TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resend_sync_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.resend_sync_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.resend_sync_log TO service_role;

DROP POLICY IF EXISTS "Service role manages resend sync log"
  ON public.resend_sync_log;
CREATE POLICY "Service role manages resend sync log"
  ON public.resend_sync_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_resend_sync_log_created
  ON public.resend_sync_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resend_sync_log_status_created
  ON public.resend_sync_log (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resend_sync_log_email
  ON public.resend_sync_log (email);
CREATE INDEX IF NOT EXISTS idx_resend_sync_log_stripe_subscription
  ON public.resend_sync_log (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
