-- Client page codes: picking a package never spends a code, and changing your mind never locks you out.
--
-- * mcp_private.portal_code_wait: minutes until another code may be sent, 0 when one may go now. Sign-in codes and
--   decision codes are counted apart, and decision codes per item, so a morning of sign-ins never blocks a choice:
--     sign-in: 5 in 15 minutes, 20 in a day; decision: 5 in 15 minutes and 10 in a day for the same item.
--   Each code still expires in 10 minutes and locks after 5 wrong tries.
-- * mcp_portal_code_pending: whether this signed-in session already has an unused, unexpired, unlocked decision
--   code for the item. The page reuses it instead of sending another, so switching from Better to Best costs nothing.
-- * mcp_portal_code_issue / mcp_portal_page_code_issue: as in 20261104170000_athena_customer_portal and
--   20261106160000_athena_portal_page_sign_in, with the limits above, the wait in minutes on slow_down, and a new
--   decision code voids only earlier codes for the same item.
-- Plain SQL for Lovable to apply. Rollback: supabase/rollbacks/20261106233000_athena_portal_code_reuse.rollback.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE INDEX IF NOT EXISTS mcp_portal_codes_access_purpose ON public.mcp_portal_codes (access_id, purpose, item_id, created_at DESC);

CREATE OR REPLACE FUNCTION mcp_private.portal_code_wait(_access uuid, _purpose text, _item uuid) RETURNS int
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE per15 int := 5; perday int := CASE WHEN _purpose = 'decide' THEN 10 ELSE 20 END; t timestamptz; w numeric := 0;
BEGIN
  -- The code that has to age out before the count drops under the limit, in each window.
  SELECT created_at INTO t FROM public.mcp_portal_codes
   WHERE access_id = _access AND purpose = _purpose AND (_purpose = 'sign_in' OR item_id = _item)
     AND created_at > now() - interval '15 minutes'
   ORDER BY created_at DESC OFFSET per15 - 1 LIMIT 1;
  IF t IS NOT NULL THEN w := greatest(w, extract(epoch FROM (t + interval '15 minutes' - now())) / 60); END IF;
  t := NULL;
  SELECT created_at INTO t FROM public.mcp_portal_codes
   WHERE access_id = _access AND purpose = _purpose AND (_purpose = 'sign_in' OR item_id = _item)
     AND created_at > now() - interval '1 day'
   ORDER BY created_at DESC OFFSET perday - 1 LIMIT 1;
  IF t IS NOT NULL THEN w := greatest(w, extract(epoch FROM (t + interval '1 day' - now())) / 60); END IF;
  RETURN CASE WHEN w > 0 THEN greatest(1, ceil(w)::int) ELSE 0 END;
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_code_wait(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_portal_code_pending(_access uuid, _session_hash text, _item uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_portal_codes;
BEGIN
  IF _access IS NULL OR _item IS NULL OR (mcp_private.portal_session(_access, _session_hash)).id IS NULL THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  SELECT * INTO c FROM public.mcp_portal_codes
   WHERE access_id = _access AND purpose = 'decide' AND item_id = _item AND used_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF c.id IS NULL OR c.expires_at <= now() + interval '1 minute' OR c.attempts >= 5 THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'sent_at', c.created_at, 'expires_at', c.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_code_pending(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_code_pending(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_portal_code_issue(_access uuid, _purpose text, _code_hash text, _invite_hash text, _session_hash text, _item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; j public.mcp_jobs; co public.mcp_companies; st text; it public.mcp_portal_items; wait int;
BEGIN
  IF _code_hash IS NULL OR _code_hash !~ '^[0-9a-f]{64}$' OR _purpose NOT IN ('sign_in', 'decide') THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access FOR UPDATE;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF _purpose = 'sign_in' THEN
    IF _invite_hash IS DISTINCT FROM a.invite_hash THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
    IF a.invite_expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  ELSE
    IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
    SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL;
    IF it.id IS NULL OR EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = it.id) THEN
      RETURN jsonb_build_object('status', 'not_open');
    END IF;
  END IF;
  wait := mcp_private.portal_code_wait(a.id, _purpose, CASE WHEN _purpose = 'decide' THEN _item END);
  IF wait > 0 THEN RETURN jsonb_build_object('status', 'slow_down', 'retry_minutes', wait); END IF;
  UPDATE public.mcp_portal_codes SET used_at = now() WHERE access_id = a.id AND purpose = _purpose AND used_at IS NULL
    AND (_purpose = 'sign_in' OR item_id = _item);
  INSERT INTO public.mcp_portal_codes (access_id, purpose, item_id, code_hash, expires_at)
  VALUES (a.id, _purpose, CASE WHEN _purpose = 'decide' THEN _item END, _code_hash, now() + interval '10 minutes');
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = a.company_id;
  RETURN jsonb_build_object('status', 'ok', 'email', a.email, 'name', a.name, 'company', co.name, 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_code_issue(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_code_issue(uuid, text, text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_portal_page_code_issue(_access uuid, _email text, _code_hash text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; j public.mcp_jobs; co public.mcp_companies; st text; e text := lower(btrim(coalesce(_email, ''))); wait int;
BEGIN
  IF _code_hash IS NULL OR _code_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access FOR UPDATE;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  wait := mcp_private.portal_code_wait(a.id, 'sign_in', NULL);
  IF wait = 0 AND (SELECT count(*) FROM public.mcp_portal_events WHERE access_id = a.id AND kind = 'sign_in_wrong_email'
           AND at > now() - interval '15 minutes') >= 10 THEN
    wait := 15;
  END IF;
  IF wait > 0 THEN RETURN jsonb_build_object('status', 'slow_down', 'retry_minutes', wait); END IF;
  IF e = '' OR e <> a.email THEN
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
    VALUES (a.id, a.job_id, 'sign_in_wrong_email', '{}'::jsonb, left(_ip, 100), left(_user_agent, 400));
    RETURN jsonb_build_object('status', 'mismatch');
  END IF;
  UPDATE public.mcp_portal_codes SET used_at = now() WHERE access_id = a.id AND purpose = 'sign_in' AND used_at IS NULL;
  INSERT INTO public.mcp_portal_codes (access_id, purpose, item_id, code_hash, expires_at)
  VALUES (a.id, 'sign_in', NULL, _code_hash, now() + interval '10 minutes');
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = a.company_id;
  RETURN jsonb_build_object('status', 'ok', 'email', a.email, 'name', a.name, 'company', co.name, 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_page_code_issue(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_page_code_issue(uuid, text, text, text, text) TO service_role;
