-- Apply through Lovable Cloud only. Plain SQL for Lovable to apply; nothing in this repo applies it.
-- Sign in on the customer page itself. When a customer opens a link from any customer email ("Review and sign",
-- "Open your project page") and isn't signed in, the page asks for their email, sends a 6-digit code to it if it is
-- the address the page was shared with, and signs them in on that page. They no longer need the invite email.
-- The code goes only to the invited address; any other address gets no code and is logged. Same limits as the invite:
-- five codes per 15 minutes and 20 a day per customer, five wrong tries lock a code. Signing, approving or choosing
-- still needs its own fresh code. Additive: two new server-only functions. No existing function or data changes.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Stores a sign-in code hash when _email is this customer's address. Returns 'ok' with where to send it, or
-- 'mismatch', 'slow_down', 'revoked', 'closed' or 'unknown'.
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

-- Signs the customer in on their page with the newest sign-in code. Returns 'ok', 'wrong', 'locked', 'expired',
-- 'revoked', 'closed' or 'unknown'.
CREATE OR REPLACE FUNCTION public.mcp_portal_page_sign_in(_access uuid, _code_hash text, _session_hash text, _remember boolean, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; chk text; exp timestamptz;
BEGIN
  IF _session_hash IS NULL OR _session_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access FOR UPDATE;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  chk := mcp_private.portal_code_check(a.id, 'sign_in', NULL, _code_hash);
  IF chk <> 'ok' THEN
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
    VALUES (a.id, a.job_id, 'sign_in_failed', jsonb_build_object('reason', chk, 'via', 'page'), left(_ip, 100), left(_user_agent, 400));
    RETURN jsonb_build_object('status', chk);
  END IF;
  exp := now() + CASE WHEN coalesce(_remember, false) THEN interval '30 days' ELSE interval '12 hours' END;
  INSERT INTO public.mcp_portal_sessions (access_id, token_hash, expires_at, last_seen_at, ip, user_agent)
  VALUES (a.id, _session_hash, exp, now(), left(_ip, 100), left(_user_agent, 400));
  UPDATE public.mcp_portal_access SET last_seen_at = now() WHERE id = a.id;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
  VALUES (a.id, a.job_id, 'signed_in', jsonb_build_object('remember', coalesce(_remember, false), 'via', 'page'), left(_ip, 100), left(_user_agent, 400));
  RETURN jsonb_build_object('status', 'ok', 'access_id', a.id, 'expires_at', exp);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_page_sign_in(uuid, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_page_sign_in(uuid, text, text, boolean, text, text) TO service_role;
