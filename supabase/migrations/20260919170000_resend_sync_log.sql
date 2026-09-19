-- Audit trail for Resend contact/segment upserts (paid Stripe + Marshall comps).
-- Contact sync must never send mail. Failures are persisted here so they stay
-- visible without failing the grant/webhook that triggered the sync.

CREATE TABLE IF NOT EXISTS public.resend_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  segment TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'skipped', 'failed')),
  contact_id TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resend_sync_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_resend_sync_log_created
  ON public.resend_sync_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resend_sync_log_email
  ON public.resend_sync_log (lower(email));

CREATE INDEX IF NOT EXISTS idx_resend_sync_log_status_created
  ON public.resend_sync_log (status, created_at DESC);

DO $$ BEGIN
  CREATE POLICY "Service role can read resend sync log"
    ON public.resend_sync_log FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert resend sync log"
    ON public.resend_sync_log FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read resend sync log"
    ON public.resend_sync_log FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
