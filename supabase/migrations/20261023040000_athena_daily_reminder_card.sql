-- In-chat daily reminder. Additive only. NOT APPLIED.
-- Records that a member was shown the "today's daily isn't in" card, once per user per job per day.
-- Does not send email. Does not change mcp_job_scope or the reminder settings table.

CREATE TABLE IF NOT EXISTS public.mcp_daily_reminder_shows (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  shown_on date NOT NULL,
  shown_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id, shown_on)
);
CREATE INDEX IF NOT EXISTS mcp_daily_reminder_shows_user_idx ON public.mcp_daily_reminder_shows (user_id, shown_on DESC);

ALTER TABLE public.mcp_daily_reminder_shows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "daily reminder show read own" ON public.mcp_daily_reminder_shows;
CREATE POLICY "daily reminder show read own" ON public.mcp_daily_reminder_shows FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.mcp_job_scope(job_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.mcp_daily_reminder_shows FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_daily_reminder_shows TO authenticated;
GRANT ALL ON public.mcp_daily_reminder_shows TO service_role;

-- Facts for the card. Any role that can see the job. No write.
CREATE OR REPLACE FUNCTION public.mcp_daily_reminder_status(_job_number text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; n int; r public.mcp_daily_reminders; tz text; local_ts timestamp; last_d date; has_today boolean; shown boolean;
BEGIN
  PERFORM public.mcp_assert_active();
  SELECT count(*) INTO n FROM public.mcp_jobs WHERE job_number = btrim(coalesce(_job_number, '')) AND public.mcp_job_scope(id) IS NOT NULL;
  IF n <> 1 THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE job_number = btrim(_job_number) AND public.mcp_job_scope(id) IS NOT NULL;
  SELECT * INTO r FROM public.mcp_daily_reminders WHERE job_id = j.id;
  tz := coalesce(r.time_zone, j.time_zone, 'America/New_York');
  BEGIN
    local_ts := now() AT TIME ZONE tz;
  EXCEPTION WHEN others THEN
    tz := 'America/New_York';
    local_ts := now() AT TIME ZONE tz;
  END;
  SELECT max(report_date) INTO last_d FROM public.mcp_daily_reports WHERE job_id = j.id;
  has_today := EXISTS (SELECT 1 FROM public.mcp_daily_reports WHERE job_id = j.id AND report_date = local_ts::date);
  shown := EXISTS (SELECT 1 FROM public.mcp_daily_reminder_shows WHERE job_id = j.id AND user_id = auth.uid() AND shown_on = local_ts::date);
  RETURN jsonb_build_object(
    'found', true,
    'job_id', j.id,
    'job_number', j.job_number,
    'job_name', j.name,
    'enabled', coalesce(r.enabled, false),
    'send_local', to_char(coalesce(r.send_local, time '14:30'), 'HH24:MI'),
    'time_zone', tz,
    'local_date', local_ts::date,
    'local_minutes', extract(hour FROM local_ts)::int * 60 + extract(minute FROM local_ts)::int,
    'daily_today', has_today,
    'last_daily', last_d,
    'already_shown', shown
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_reminder_status(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_daily_reminder_status(text) TO authenticated;

-- Record one show. A second call the same day records nothing.
CREATE OR REPLACE FUNCTION public.mcp_daily_reminder_mark_shown(_job uuid, _day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; n int;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS NULL OR auth.uid() IS NULL OR _day IS NULL THEN
    RETURN jsonb_build_object('recorded', false);
  END IF;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id = _job;
  INSERT INTO public.mcp_daily_reminder_shows (job_id, company_id, user_id, shown_on)
  VALUES (_job, cid, auth.uid(), _day)
  ON CONFLICT (job_id, user_id, shown_on) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('recorded', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_reminder_mark_shown(uuid, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_daily_reminder_mark_shown(uuid, date) TO authenticated;

-- Web push subscriptions. One row per browser endpoint, per member, per job.
-- The private VAPID key is not stored here.
CREATE TABLE IF NOT EXISTS public.mcp_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  endpoint text NOT NULL CHECK (endpoint LIKE 'https://%'),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 200),
  auth_secret text NOT NULL CHECK (length(auth_secret) BETWEEN 1 AND 200),
  last_sent_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id, endpoint)
);
CREATE INDEX IF NOT EXISTS mcp_push_subscriptions_job_idx ON public.mcp_push_subscriptions (job_id, user_id);

ALTER TABLE public.mcp_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push subscription read own" ON public.mcp_push_subscriptions;
CREATE POLICY "push subscription read own" ON public.mcp_push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.mcp_job_scope(job_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.mcp_push_subscriptions FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_push_subscriptions TO authenticated;
GRANT ALL ON public.mcp_push_subscriptions TO service_role;

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
  ON CONFLICT (user_id, job_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth_secret = EXCLUDED.auth_secret
  RETURNING id INTO sid;
  RETURN jsonb_build_object('id', sid, 'saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_subscription_save(uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_subscription_save(uuid, text, text, text) TO authenticated;

-- Rows the scheduler may send. Service role only. No dollars.
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
  ), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_due() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_due() TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_push_mark_sent(_id uuid, _day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  UPDATE public.mcp_push_subscriptions SET last_sent_on = _day WHERE id = _id AND (last_sent_on IS NULL OR last_sent_on < _day);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('marked', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_mark_sent(uuid, date) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_mark_sent(uuid, date) TO service_role;

-- The member's own subscriptions for a test send. Job 2701 only.
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
    WHERE s.job_id = _job AND s.user_id = auth.uid()
  ), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_push_test_targets(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_push_test_targets(uuid) TO authenticated;

-- Scheduler: a person sets pg_cron to POST /api/athena/field-push {"action":"dispatch"}
-- every minute, with Authorization Bearer the service role key.
-- Do not put that key, or the VAPID private key, in this file.
-- Set ATHENA_VAPID_PUBLIC_KEY and ATHENA_VAPID_PRIVATE_KEY on the app.
-- This file does not create the cron job.
