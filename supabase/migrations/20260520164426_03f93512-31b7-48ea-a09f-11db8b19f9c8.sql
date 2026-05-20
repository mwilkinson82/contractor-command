-- Tight security hardening pass for public webhook/storage/database surfaces.
-- Keep this migration narrow: no product schema refactors, only controls.

-- 1. Fix mutable search_path warnings on SECURITY DEFINER queue wrappers.
ALTER FUNCTION public.enqueue_email(TEXT, JSONB)
  SET search_path = public, pg_catalog, pgmq;

ALTER FUNCTION public.read_email_batch(TEXT, INT, INT)
  SET search_path = public, pg_catalog, pgmq;

ALTER FUNCTION public.delete_email(TEXT, BIGINT)
  SET search_path = public, pg_catalog, pgmq;

ALTER FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB)
  SET search_path = public, pg_catalog, pgmq;

-- 2. Trigger-only SECURITY DEFINER functions should not be directly callable
-- through PostgREST by anon/authenticated users.
REVOKE EXECUTE ON FUNCTION public.grant_admin_for_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pending_subscription() FROM PUBLIC, anon, authenticated;

-- 3. pending_claims: keep admin/service management, add a scoped SELECT guard
-- for future defense-in-depth if authenticated reads are ever exposed.
DROP POLICY IF EXISTS "users read own pending claims" ON public.pending_claims;
CREATE POLICY "users read own pending claims"
  ON public.pending_claims
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND claimed_at IS NULL
    AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

REVOKE ALL ON public.pending_claims FROM anon;
GRANT SELECT ON public.pending_claims TO authenticated;

-- 4. email-assets is a public bucket for fixed asset URLs, but broad SELECT on
-- storage.objects also enables bucket listing. Public object URLs keep working
-- for public buckets without an anonymous list policy.
DROP POLICY IF EXISTS "Public read email-assets" ON storage.objects;

-- 5. Stripe webhook event idempotency. The webhook runs with service_role and
-- uses these RPC helpers to avoid marking failed partial work as processed.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  object_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stripe_webhook_events TO service_role;

DROP POLICY IF EXISTS "Service role manages stripe webhook events"
  ON public.stripe_webhook_events;
CREATE POLICY "Service role manages stripe webhook events"
  ON public.stripe_webhook_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.begin_stripe_webhook_event(
  _event_id TEXT,
  _event_type TEXT,
  _object_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status TEXT;
  v_processing_started_at TIMESTAMPTZ;
BEGIN
  INSERT INTO public.stripe_webhook_events (
    event_id,
    event_type,
    object_id,
    status,
    attempts,
    processing_started_at,
    updated_at
  )
  VALUES (
    _event_id,
    _event_type,
    _object_id,
    'processing',
    1,
    now(),
    now()
  )
  ON CONFLICT (event_id) DO NOTHING;

  IF FOUND THEN
    RETURN 'process';
  END IF;

  SELECT status, processing_started_at
  INTO v_status, v_processing_started_at
  FROM public.stripe_webhook_events
  WHERE event_id = _event_id;

  IF v_status = 'processed' THEN
    RETURN 'duplicate';
  END IF;

  IF v_status = 'processing'
     AND v_processing_started_at > now() - INTERVAL '10 minutes' THEN
    RETURN 'in_progress';
  END IF;

  UPDATE public.stripe_webhook_events
  SET status = 'processing',
      attempts = attempts + 1,
      processing_started_at = now(),
      processed_at = NULL,
      last_error = NULL,
      event_type = _event_type,
      object_id = _object_id,
      updated_at = now()
  WHERE event_id = _event_id;

  RETURN 'process';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_stripe_webhook_event(
  _event_id TEXT,
  _status TEXT,
  _last_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF _status NOT IN ('processed', 'failed') THEN
    RAISE EXCEPTION 'invalid stripe webhook status: %', _status;
  END IF;

  UPDATE public.stripe_webhook_events
  SET status = _status,
      processed_at = CASE WHEN _status = 'processed' THEN now() ELSE NULL END,
      last_error = _last_error,
      updated_at = now()
  WHERE event_id = _event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_stripe_webhook_event(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_stripe_webhook_event(TEXT, TEXT, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.finish_stripe_webhook_event(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_stripe_webhook_event(TEXT, TEXT, TEXT)
  TO service_role;