-- Morning brief piece 2. User-level web push, separate from job daily reminders.
-- Additive: new tables and functions. Job subscriptions on mcp_push_subscriptions stay as they are.
-- One brief per user per local day. No email. VAPID keys stay in the app environment.
-- The cron is every 5 minutes. It reads the service role key from vault when that secret
-- is already there. This file does not write a key.

CREATE TABLE IF NOT EXISTS public.mcp_user_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL CHECK (endpoint LIKE 'https://%'),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 200),
  auth_secret text NOT NULL CHECK (length(auth_secret) BETWEEN 1 AND 200),
  dead_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS mcp_user_push_subscriptions_user_idx
  ON public.mcp_user_push_subscriptions (user_id)
  WHERE dead_at IS NULL;

ALTER TABLE public.mcp_user_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user push subscription read own" ON public.mcp_user_push_subscriptions;
CREATE POLICY "user push subscription read own" ON public.mcp_user_push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.mcp_user_push_subscriptions FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_user_push_subscriptions TO authenticated;
GRANT ALL ON public.mcp_user_push_subscriptions TO service_role;

-- One row per user per local day. A second insert the same day does nothing.
CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_sends (
  user_id uuid NOT NULL,
  sent_on date NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sent_on)
);

ALTER TABLE public.mcp_morning_brief_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_morning_brief_sends FROM anon, authenticated, public;
GRANT ALL ON public.mcp_morning_brief_sends TO service_role;

-- Allow the morning-brief payload kind on the existing send log. Daily and test stay valid.
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.mcp_push_send_log'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%payload_kind%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.mcp_push_send_log DROP CONSTRAINT %I', cname);
  END IF;
END $$;
ALTER TABLE public.mcp_push_send_log
  ADD CONSTRAINT mcp_push_send_log_payload_kind_check
  CHECK (payload_kind IN ('daily', 'test', 'brief'));

CREATE OR REPLACE FUNCTION public.mcp_push_log_send(
  _subscription uuid, _user uuid, _job uuid, _status text, _http int, _error text, _kind text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  IF _status NOT IN ('success', 'failure', 'unconfigured') THEN RAISE EXCEPTION 'MCP_BAD:Bad status.'; END IF;
  IF _kind NOT IN ('daily', 'test', 'brief') THEN RAISE EXCEPTION 'MCP_BAD:Bad payload.'; END IF;
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

-- Saving the browser endpoint again turns a dead user subscription back on.
CREATE OR REPLACE FUNCTION public.mcp_user_push_subscription_save(_endpoint text, _p256dh text, _auth text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  IF coalesce(_endpoint, '') NOT LIKE 'https://%' THEN RAISE EXCEPTION 'MCP_BAD:That notification address is not valid.'; END IF;
  IF length(btrim(coalesce(_p256dh, ''))) = 0 OR length(btrim(coalesce(_auth, ''))) = 0 THEN
    RAISE EXCEPTION 'MCP_BAD:The notification keys are missing.';
  END IF;
  INSERT INTO public.mcp_user_push_subscriptions (user_id, endpoint, p256dh, auth_secret)
  VALUES (auth.uid(), _endpoint, _p256dh, _auth)
  ON CONFLICT (user_id, endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth_secret = EXCLUDED.auth_secret, dead_at = NULL
  RETURNING id INTO sid;
  RETURN jsonb_build_object('id', sid, 'saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_user_push_subscription_save(text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_user_push_subscription_save(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_user_push_subscribed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_user_push_subscriptions
    WHERE user_id = auth.uid() AND dead_at IS NULL
  );
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_user_push_subscribed() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_user_push_subscribed() TO authenticated;

-- Live user subscriptions plus the member's briefing clock. Service role only.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_candidates() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', u.user_id,
      'enabled', coalesce(s.enabled, true),
      'send_local', to_char(coalesce(s.send_local, '06:30'::time), 'HH24:MI'),
      'time_zone', coalesce(s.time_zone, 'America/New_York'),
      'last_sent_on', (
        SELECT max(b.sent_on) FROM public.mcp_morning_brief_sends b WHERE b.user_id = u.user_id
      ),
      'subscriptions', u.subs
    ))
    FROM (
      SELECT p.user_id,
        jsonb_agg(jsonb_build_object(
          'id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth_secret
        )) AS subs
      FROM public.mcp_user_push_subscriptions p
      WHERE p.dead_at IS NULL
      GROUP BY p.user_id
    ) u
    LEFT JOIN public.mcp_morning_brief_settings s ON s.user_id = u.user_id
  ), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_morning_brief_candidates() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_candidates() TO service_role;

-- The morning brief feed for one member. Service role only. Uses that member's job scope.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_feed_for(_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  IF _user IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Missing user.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', _user::text, 'role', 'authenticated')::text,
    true
  );
  RETURN public.mcp_morning_brief_feed();
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_morning_brief_feed_for(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_feed_for(uuid) TO service_role;

-- Claims the local day. A repeat the same day is a no-op.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_mark_sent(_user uuid, _day date, _body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  IF _user IS NULL OR _day IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Missing day.'; END IF;
  IF length(btrim(coalesce(_body, ''))) = 0 THEN RAISE EXCEPTION 'MCP_BAD:Missing brief.'; END IF;
  INSERT INTO public.mcp_morning_brief_sends (user_id, sent_on, body)
  VALUES (_user, _day, left(btrim(_body), 500))
  ON CONFLICT (user_id, sent_on) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('marked', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_morning_brief_mark_sent(uuid, date, text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_mark_sent(uuid, date, text) TO service_role;

-- A 404 or 410 from the push service. Service role only. Job subscriptions are not touched.
CREATE OR REPLACE FUNCTION public.mcp_user_push_mark_dead(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  UPDATE public.mcp_user_push_subscriptions SET dead_at = coalesce(dead_at, now()) WHERE id = _id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('dead', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_user_push_mark_dead(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.mcp_user_push_mark_dead(uuid) TO service_role;

-- Every 5 minutes, when pg_cron, pg_net, and the existing vault key are already installed.
-- A missing extension does not fail this migration. No key is written here.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'athena-morning-brief') THEN
    PERFORM cron.unschedule('athena-morning-brief');
  END IF;
  PERFORM cron.schedule(
    'athena-morning-brief',
    '*/5 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://app.meetathena.io/api/athena/morning-brief',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'email_queue_service_role_key' LIMIT 1
        )
      ),
      body := '{"action":"dispatch"}'::jsonb
    );
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'athena morning brief cron was not scheduled';
END
$cron$;
