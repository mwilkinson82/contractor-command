-- Push send log, and a dead mark for subscriptions the push service has dropped.
-- Additive. Revert this file to remove the log, the dead mark, and the due-query filter.
-- Does not change the reminder text or the send time.
-- VAPID keys stay in the app environment. This file does not set them.
-- No client access: row level security is on, and there is no policy for anon or authenticated.

ALTER TABLE public.mcp_push_subscriptions
  ADD COLUMN IF NOT EXISTS dead_at timestamptz;

CREATE TABLE IF NOT EXISTS public.mcp_push_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.mcp_push_subscriptions(id) ON DELETE SET NULL,
  user_id uuid,
  job_id uuid REFERENCES public.mcp_jobs(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('success', 'failure', 'unconfigured')),
  http_code int CHECK (http_code IS NULL OR http_code BETWEEN 100 AND 599),
  error_text text CHECK (error_text IS NULL OR length(error_text) <= 500),
  payload_kind text NOT NULL CHECK (payload_kind IN ('daily', 'test')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_push_send_log_created_idx ON public.mcp_push_send_log (created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_push_send_log_subscription_idx ON public.mcp_push_send_log (subscription_id, created_at DESC);

ALTER TABLE public.mcp_push_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_push_send_log FROM anon, authenticated, public;
GRANT ALL ON public.mcp_push_send_log TO service_role;

-- Saving the browser endpoint again means the member turned reminders back on.
CREATE OR REPLACE FUNCTION public.mcp_push_subscription_save(_job uuid, _endpoint text, _p256dh text, _auth text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; sid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  IF public.mcp_job_scope(_job) IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF coalesce(_endpoint, '') NOT LIKE 'https://%' THEN RAISE EXCEPTION 'MCP_BAD:That notification address is not valid.'; END IF;
  IF length(btrim(coalesce(_p256dh, ''))) = 0 OR length(btrim(coalesce(_auth, ''))) = 0 THEN
    RAISE EXCEPTION 'MCP_BAD:The notification keys are missing.';
  END IF;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id = _job;
  INSERT INTO public.mcp_push_subscriptions (user_id, job_id, company_id, endpoint, p256dh, auth_secret)
  VALUES (auth.uid(), _job, cid, _endpoint, _p256dh, _auth)
  ON CONFLICT (user_id, job_id, endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth_secret = EXCLUDED.auth_secret, dead_at = NULL
  RETURNING id INTO sid;
  RETURN jsonb_build_object('id', sid, 'saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_subscription_save(uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_subscription_save(uuid, text, text, text) TO authenticated;

-- Rows the scheduler may send. Dead endpoints stay out. Service role only. No dollars.
CREATE OR REPLACE FUNCTION public.mcp_push_due() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'job_id', s.job_id,
      'job_number', j.job_number,
      'job_name', j.name,
      'endpoint', s.endpoint,
      'p256dh', s.p256dh,
      'auth', s.auth_secret,
      'enabled', r.enabled,
      'send_local', to_char(r.send_local, 'HH24:MI'),
      'time_zone', coalesce(r.time_zone, j.time_zone, 'America/New_York'),
      'last_sent_on', s.last_sent_on,
      'daily_today', EXISTS (
        SELECT 1 FROM public.mcp_daily_reports d
        WHERE d.job_id = j.id
          AND d.report_date = (now() AT TIME ZONE coalesce(r.time_zone, j.time_zone, 'America/New_York'))::date
      )
    ))
    FROM public.mcp_push_subscriptions s
    JOIN public.mcp_jobs j ON j.id = s.job_id
    JOIN public.mcp_daily_reminders r ON r.job_id = j.id AND r.enabled
    WHERE s.dead_at IS NULL
  ), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_due() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_due() TO service_role;

-- The member's own live subscriptions for a test send. Job 2701 only.
CREATE OR REPLACE FUNCTION public.mcp_push_test_targets(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF j.job_number IS DISTINCT FROM '2701' THEN RAISE EXCEPTION 'MCP_BAD:Test notifications are only for job 2701.'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret, 'job_number', j.job_number, 'job_name', j.name))
    FROM public.mcp_push_subscriptions s
    WHERE s.job_id = _job AND s.user_id = auth.uid() AND s.dead_at IS NULL
  ), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_test_targets(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_test_targets(uuid) TO authenticated;

-- Service role only. A 404 or 410 from the push service calls this.
CREATE OR REPLACE FUNCTION public.mcp_push_mark_dead(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  UPDATE public.mcp_push_subscriptions SET dead_at = coalesce(dead_at, now()) WHERE id = _id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('dead', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_mark_dead(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_mark_dead(uuid) TO service_role;

-- One row per send attempt. Service role only. Clients cannot read or write this table.
CREATE OR REPLACE FUNCTION public.mcp_push_log_send(
  _subscription uuid, _user uuid, _job uuid, _status text, _http int, _error text, _kind text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  IF _status NOT IN ('success', 'failure', 'unconfigured') THEN RAISE EXCEPTION 'MCP_BAD:Bad status.'; END IF;
  IF _kind NOT IN ('daily', 'test') THEN RAISE EXCEPTION 'MCP_BAD:Bad payload.'; END IF;
  IF _http IS NOT NULL AND (_http < 100 OR _http > 599) THEN RAISE EXCEPTION 'MCP_BAD:Bad status code.'; END IF;
  INSERT INTO public.mcp_push_send_log (subscription_id, user_id, job_id, status, http_code, error_text, payload_kind)
  VALUES (
    _subscription,
    _user,
    _job,
    _status,
    _http,
    left(nullif(btrim(coalesce(_error, '')), ''), 500),
    _kind
  );
  RETURN jsonb_build_object('logged', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_log_send(uuid, uuid, uuid, text, int, text, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_log_send(uuid, uuid, uuid, text, int, text, text) TO service_role;
