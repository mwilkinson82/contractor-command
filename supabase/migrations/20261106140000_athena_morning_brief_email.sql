-- Morning brief piece 3: the daily email. Additive. Off for every member until they turn it on.
-- The app also keeps it off unless ATHENA_BRIEF_EMAIL_ENABLED is "true". One email per member per local day.
-- The member's address comes from their own sign-in account. This file sends nothing and deletes no data.

ALTER TABLE public.mcp_morning_brief_settings
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT false;

-- One row per member per local day. message_id stays empty until the email provider accepts the send.
CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_email_sends (
  user_id uuid NOT NULL,
  sent_on date NOT NULL,
  message_id text CHECK (message_id IS NULL OR length(message_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sent_on)
);
ALTER TABLE public.mcp_morning_brief_email_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_morning_brief_email_sends FROM anon, authenticated, public;
GRANT ALL ON public.mcp_morning_brief_email_sends TO service_role;

-- The member's own email switch and the address it goes to.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_email_get() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE on_ boolean; addr text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  SELECT s.email_enabled INTO on_ FROM public.mcp_morning_brief_settings s WHERE s.user_id = auth.uid();
  SELECT u.email INTO addr FROM auth.users u WHERE u.id = auth.uid();
  RETURN jsonb_build_object('email_enabled', coalesce(on_, false), 'email', addr);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_email_get() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_email_get() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_morning_brief_email_set(_on boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE addr text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  IF _on IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Say on or off.'; END IF;
  INSERT INTO public.mcp_morning_brief_settings (user_id, email_enabled)
  VALUES (auth.uid(), _on)
  ON CONFLICT (user_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, updated_at = now();
  SELECT u.email INTO addr FROM auth.users u WHERE u.id = auth.uid();
  RETURN jsonb_build_object('email_enabled', _on, 'email', addr, 'saved', true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_email_set(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_email_set(boolean) TO authenticated;

-- Members who turned the email on, with their clock and last email day. Service role only.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_email_candidates() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', s.user_id,
      'email', u.email,
      'enabled', s.enabled,
      'email_enabled', s.email_enabled,
      'send_local', to_char(s.send_local, 'HH24:MI'),
      'time_zone', s.time_zone,
      'last_sent_on', (SELECT max(e.sent_on) FROM public.mcp_morning_brief_email_sends e WHERE e.user_id = s.user_id)
    ))
    FROM public.mcp_morning_brief_settings s
    JOIN auth.users u ON u.id = s.user_id
    WHERE s.email_enabled AND s.enabled AND u.email IS NOT NULL
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_email_candidates() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_email_candidates() TO service_role;

-- Claims the member's local day before the send. A second claim the same day returns false.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_email_claim(_user uuid, _day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  IF _user IS NULL OR _day IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Missing day.'; END IF;
  INSERT INTO public.mcp_morning_brief_email_sends (user_id, sent_on) VALUES (_user, _day)
  ON CONFLICT (user_id, sent_on) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('claimed', n > 0);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_email_claim(uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_email_claim(uuid, date) TO service_role;

-- Gives the day back when the send failed, so the next run tries again. A sent day stays.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_email_release(_user uuid, _day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  DELETE FROM public.mcp_morning_brief_email_sends
  WHERE user_id = _user AND sent_on = _day AND message_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('released', n > 0);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_email_release(uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_email_release(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_morning_brief_email_sent(_user uuid, _day date, _id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  UPDATE public.mcp_morning_brief_email_sends
  SET message_id = left(coalesce(nullif(btrim(_id), ''), 'sent'), 200)
  WHERE user_id = _user AND sent_on = _day;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('saved', n > 0);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_email_sent(uuid, date, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_email_sent(uuid, date, text) TO service_role;

-- Runs one of the brief's read functions as one member. Service role only. Anything else is refused.
CREATE OR REPLACE FUNCTION public.mcp_brief_as_user(_user uuid, _fn text, _args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a jsonb := coalesce(_args, '{}'::jsonb); t text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
  IF _user IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Missing user.'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _user::text, 'role', 'authenticated')::text, true);
  IF _fn = 'mcp_living_report_get' THEN
    t := a->>'_type';
    IF t IS NULL OR t NOT IN ('cpm', 'ior') THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
    RETURN public.mcp_living_report_get(_job => (a->>'_job')::uuid, _type => t);
  ELSIF _fn = 'mcp_change_rows' THEN
    RETURN public.mcp_change_rows(_job => (a->>'_job')::uuid);
  ELSIF _fn = 'mcp_buyout_get' THEN
    RETURN public.mcp_buyout_get(_company => (a->>'_company')::uuid, _job => (a->>'_job')::uuid);
  ELSIF _fn = 'mcp_billing_evidence_record' THEN
    IF a->>'_action' IS DISTINCT FROM 'payment_application_read' THEN RAISE EXCEPTION 'MCP_BAD:Not allowed.'; END IF;
    RETURN public.mcp_billing_evidence_record(_job => (a->>'_job')::uuid, _action => 'payment_application_read', _p => '{}'::jsonb);
  ELSIF _fn = 'mcp_submittal_chase_due' THEN
    RETURN public.mcp_submittal_chase_due();
  END IF;
  RAISE EXCEPTION 'MCP_BAD:Not allowed.';
END $$;
REVOKE ALL ON FUNCTION public.mcp_brief_as_user(uuid, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_brief_as_user(uuid, text, jsonb) TO service_role;
