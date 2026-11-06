-- Rollback for 20261106233000_athena_portal_code_reuse: the code-issue functions as they were, and the two helpers dropped.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.mcp_portal_code_issue(_access uuid, _purpose text, _code_hash text, _invite_hash text, _session_hash text, _item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; j public.mcp_jobs; co public.mcp_companies; st text; it public.mcp_portal_items;
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
  IF (SELECT count(*) FROM public.mcp_portal_codes WHERE access_id = a.id AND created_at > now() - interval '15 minutes') >= 5
     OR (SELECT count(*) FROM public.mcp_portal_codes WHERE access_id = a.id AND created_at > now() - interval '1 day') >= 20 THEN
    RETURN jsonb_build_object('status', 'slow_down');
  END IF;
  UPDATE public.mcp_portal_codes SET used_at = now() WHERE access_id = a.id AND purpose = _purpose AND used_at IS NULL;
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
DECLARE a public.mcp_portal_access; j public.mcp_jobs; co public.mcp_companies; st text; e text := lower(btrim(coalesce(_email, '')));
BEGIN
  IF _code_hash IS NULL OR _code_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access FOR UPDATE;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF (SELECT count(*) FROM public.mcp_portal_codes WHERE access_id = a.id AND created_at > now() - interval '15 minutes') >= 5
     OR (SELECT count(*) FROM public.mcp_portal_codes WHERE access_id = a.id AND created_at > now() - interval '1 day') >= 20
     OR (SELECT count(*) FROM public.mcp_portal_events WHERE access_id = a.id AND kind = 'sign_in_wrong_email'
           AND at > now() - interval '15 minutes') >= 10 THEN
    RETURN jsonb_build_object('status', 'slow_down');
  END IF;
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

DROP FUNCTION IF EXISTS public.mcp_portal_code_pending(uuid, text, uuid);
DROP FUNCTION IF EXISTS mcp_private.portal_code_wait(uuid, text, uuid);
DROP INDEX IF EXISTS public.mcp_portal_codes_access_purpose;
