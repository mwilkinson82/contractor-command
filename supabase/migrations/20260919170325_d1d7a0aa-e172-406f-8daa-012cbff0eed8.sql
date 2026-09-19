CREATE TABLE public.resend_sync_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  source text NOT NULL CHECK (source IN ('stripe_webhook','public_capture','backfill')),
  segment text,
  status text NOT NULL CHECK (status IN ('ok','skip','fail')),
  reason text,
  stripe_subscription_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX resend_sync_log_email_idx ON public.resend_sync_log (lower(email), created_at DESC);
CREATE INDEX resend_sync_log_created_at_idx ON public.resend_sync_log (created_at DESC);

GRANT SELECT ON public.resend_sync_log TO authenticated;
GRANT ALL ON public.resend_sync_log TO service_role;

ALTER TABLE public.resend_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read resend sync log"
  ON public.resend_sync_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));