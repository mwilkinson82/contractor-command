-- 0.8.22 Athena lockdown (r3). mcp_call_log already exists live as (id, user_id, called_at), written by the
-- usage caps mcp_abuse_cap_check / mcp_abuse_cap_hit / mcp_rate_hit. This migration ALTERs it instead of creating it:
-- old and cap rows get tool = 'gate'; the caps count and prune only 'gate' rows, so their limits behave exactly as before
-- and the new per-tool log rows are neither double-counted nor pruned by them. mcp_call_log grants and policies are unchanged.

CREATE TABLE IF NOT EXISTS public.mcp_call_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.mcp_companies(id) ON DELETE SET NULL;
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS tool text NOT NULL DEFAULT 'gate';
ALTER TABLE public.mcp_call_log ADD COLUMN IF NOT EXISTS job_number text;
CREATE INDEX IF NOT EXISTS mcp_call_log_user_time ON public.mcp_call_log (user_id, called_at DESC);
CREATE INDEX IF NOT EXISTS mcp_call_log_user_tool_time ON public.mcp_call_log (user_id, tool, called_at DESC);
ALTER TABLE public.mcp_call_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mcp_abuse_cap_check(_hourly integer DEFAULT 200, _daily integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE h int; d int; oldest_h timestamptz; oldest_d timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'limit', 'auth'); END IF;
  SELECT count(*) FILTER (WHERE called_at > now() - interval '1 hour'),
         count(*) FILTER (WHERE called_at > now() - interval '1 day'),
         min(called_at) FILTER (WHERE called_at > now() - interval '1 hour'),
         min(called_at) FILTER (WHERE called_at > now() - interval '1 day')
    INTO h, d, oldest_h, oldest_d
    FROM public.mcp_call_log WHERE user_id = auth.uid() AND tool = 'gate' AND called_at > now() - interval '1 day';
  IF h >= _hourly THEN RETURN jsonb_build_object('ok', false, 'limit', 'hourly', 'resets_at', oldest_h + interval '1 hour'); END IF;
  IF d >= _daily THEN RETURN jsonb_build_object('ok', false, 'limit', 'daily', 'resets_at', oldest_d + interval '1 day'); END IF;
  INSERT INTO public.mcp_call_log(user_id, tool) VALUES (auth.uid(), 'gate');
  DELETE FROM public.mcp_call_log WHERE user_id = auth.uid() AND tool = 'gate' AND called_at < now() - interval '25 hours';
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_abuse_cap_hit()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE h int; d int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT count(*) FILTER (WHERE called_at > now() - interval '1 hour'),
         count(*) FILTER (WHERE called_at > now() - interval '1 day')
    INTO h, d FROM public.mcp_call_log WHERE user_id = auth.uid() AND tool = 'gate' AND called_at > now() - interval '1 day';
  IF h >= 60 OR d >= 300 THEN RETURN false; END IF;
  INSERT INTO public.mcp_call_log(user_id, tool) VALUES (auth.uid(), 'gate');
  DELETE FROM public.mcp_call_log WHERE user_id = auth.uid() AND tool = 'gate' AND called_at < now() - interval '25 hours';
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_rate_hit(_limit integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM public.mcp_call_log WHERE user_id = auth.uid() AND tool = 'gate' AND called_at > now() - interval '1 hour';
  IF n >= _limit THEN RETURN false; END IF;
  INSERT INTO public.mcp_call_log(user_id, tool) VALUES (auth.uid(), 'gate');
  DELETE FROM public.mcp_call_log WHERE user_id = auth.uid() AND tool = 'gate' AND called_at < now() - interval '2 hours';
  RETURN true;
END $function$;

CREATE TABLE IF NOT EXISTS public.mcp_company_canaries (
  company_id uuid PRIMARY KEY REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_security_flags (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  company_id uuid REFERENCES public.mcp_companies(id) ON DELETE SET NULL,
  tool text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bulk_pull', 'odd_params', 'no_job_spec_pull', 'extraction_text', 'tool_cap', 'soft_lock')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, -- counts only
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_security_flags_user_time ON public.mcp_security_flags (user_id, created_at DESC);

-- Members can't read or write the canary and flag tables (mcp_call_log keeps its existing grants/policies); only the SECURITY DEFINER function and service_role touch them.
ALTER TABLE public.mcp_company_canaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_security_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_company_canaries, public.mcp_security_flags FROM anon, authenticated;
GRANT ALL ON public.mcp_call_log, public.mcp_company_canaries, public.mcp_security_flags TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mcp_call_log_id_seq, public.mcp_security_flags_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_canary_for(_company uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int; tries int := 0;
BEGIN
  IF _company IS NULL THEN RETURN NULL; END IF;
  SELECT code INTO c FROM public.mcp_company_canaries WHERE company_id = _company;
  IF c IS NOT NULL THEN RETURN c; END IF;
  LOOP
    c := '';
    FOR i IN 1..6 LOOP c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); END LOOP;
    BEGIN
      INSERT INTO public.mcp_company_canaries (company_id, code) VALUES (_company, c)
        ON CONFLICT (company_id) DO NOTHING;
      SELECT code INTO c FROM public.mcp_company_canaries WHERE company_id = _company;
      RETURN c;
    EXCEPTION WHEN unique_violation THEN
      tries := tries + 1;
      IF tries > 5 THEN RETURN NULL; END IF;
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.mcp_canary_for(uuid) FROM PUBLIC, anon, authenticated;

-- One call per tool call, from the server, as the signed-in member.
-- Returns {ok, limit?, resets_at?, canary}. Rejected calls are not logged as calls (they are flagged).
CREATE OR REPLACE FUNCTION public.mcp_security_touch(
  _tool text, _job_number text, _signals jsonb, _tool_hourly int, _soft_lock boolean, _soft_lock_flags int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  co uuid;
  n_tool int; oldest timestamptz; n_heavy10 int; n_jobs10 int; n_flags24 int; last_call timestamptz;
  sig text;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'limit', 'soft_lock'); END IF;
  _tool := left(coalesce(_tool, ''), 60);
  _job_number := left(_job_number, 40);

  SELECT s.current_company INTO co FROM public.mcp_user_settings s WHERE s.user_id = uid;
  IF co IS NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN min(m.company_id::text)::uuid END INTO co FROM public.mcp_company_members m WHERE m.user_id = uid;
  END IF;

  -- Signals the server computed from the call's arguments (no content is passed, only the signal names).
  FOR sig IN SELECT jsonb_array_elements_text(coalesce(_signals, '[]'::jsonb)) LOOP
    IF sig IN ('odd_params', 'no_job_spec_pull', 'extraction_text') THEN
      INSERT INTO public.mcp_security_flags (user_id, company_id, tool, kind) VALUES (uid, co, _tool, sig);
    END IF;
  END LOOP;

  -- Optional soft lock (OFF unless the server passes _soft_lock true): after N flags in 24 h, one call per 2 minutes.
  IF coalesce(_soft_lock, false) THEN
    SELECT count(*) INTO n_flags24 FROM public.mcp_security_flags f WHERE f.user_id = uid AND f.created_at > now() - interval '24 hours' AND f.kind <> 'soft_lock';
    IF n_flags24 >= greatest(coalesce(_soft_lock_flags, 5), 1) THEN
      SELECT max(called_at) INTO last_call FROM public.mcp_call_log WHERE user_id = uid;
      IF last_call IS NOT NULL AND last_call > now() - interval '2 minutes' THEN
        IF NOT EXISTS (SELECT 1 FROM public.mcp_security_flags WHERE user_id = uid AND kind = 'soft_lock' AND created_at > now() - interval '1 hour') THEN
          INSERT INTO public.mcp_security_flags (user_id, company_id, tool, kind, detail) VALUES (uid, co, _tool, 'soft_lock', jsonb_build_object('flags_24h', n_flags24));
        END IF;
        RETURN jsonb_build_object('ok', false, 'limit', 'soft_lock', 'resets_at', last_call + interval '2 minutes');
      END IF;
    END IF;
  END IF;

  -- Heavy-tool hourly cap (report, cpm_activities, next_question).
  IF _tool_hourly IS NOT NULL THEN
    SELECT count(*), min(called_at) INTO n_tool, oldest FROM public.mcp_call_log
      WHERE user_id = uid AND tool = _tool AND called_at > now() - interval '1 hour';
    IF n_tool >= _tool_hourly THEN
      IF NOT EXISTS (SELECT 1 FROM public.mcp_security_flags WHERE user_id = uid AND kind = 'tool_cap' AND tool = _tool AND created_at > now() - interval '1 hour') THEN
        INSERT INTO public.mcp_security_flags (user_id, company_id, tool, kind, detail) VALUES (uid, co, _tool, 'tool_cap', jsonb_build_object('calls_1h', n_tool));
      END IF;
      RETURN jsonb_build_object('ok', false, 'limit', 'tool_hourly', 'resets_at', oldest + interval '1 hour');
    END IF;
  END IF;

  INSERT INTO public.mcp_call_log (user_id, company_id, tool, job_number) VALUES (uid, co, _tool, _job_number);

  -- Bulk sequential pulls: 30+ heavy calls or 8+ different jobs in 10 minutes. Flagged at most once an hour.
  SELECT count(*) FILTER (WHERE tool IN ('report', 'cpm_activities', 'next_question', 'living_report_get', 'contract_terms')),
         count(DISTINCT job_number)
    INTO n_heavy10, n_jobs10
    FROM public.mcp_call_log WHERE user_id = uid AND called_at > now() - interval '10 minutes';
  IF (n_heavy10 >= 30 OR n_jobs10 >= 8)
     AND NOT EXISTS (SELECT 1 FROM public.mcp_security_flags WHERE user_id = uid AND kind = 'bulk_pull' AND created_at > now() - interval '1 hour') THEN
    INSERT INTO public.mcp_security_flags (user_id, company_id, tool, kind, detail)
      VALUES (uid, co, _tool, 'bulk_pull', jsonb_build_object('heavy_10m', n_heavy10, 'jobs_10m', n_jobs10));
  END IF;

  RETURN jsonb_build_object('ok', true, 'canary', public.mcp_canary_for(co));
END $$;
REVOKE ALL ON FUNCTION public.mcp_security_touch(text, text, jsonb, int, boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_security_touch(text, text, jsonb, int, boolean, int) TO authenticated;

-- Digest rows for the daily email (service_role only).
CREATE OR REPLACE FUNCTION public.mcp_security_digest(_since timestamptz)
RETURNS TABLE (company text, member text, tool text, calls bigint, flags bigint, kinds text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (
    SELECT user_id, company_id, tool, count(*) AS calls FROM public.mcp_call_log WHERE called_at >= _since GROUP BY 1, 2, 3
  ), f AS (
    SELECT user_id, company_id, tool, count(*) AS flags, array_agg(DISTINCT kind) AS kinds FROM public.mcp_security_flags WHERE created_at >= _since GROUP BY 1, 2, 3
  )
  SELECT coalesce(co.name, '(no company)'), coalesce(m.display_name, x.user_id::text), x.tool,
         coalesce(c.calls, 0), coalesce(f.flags, 0), coalesce(f.kinds, ARRAY[]::text[])
  FROM (SELECT user_id, company_id, tool FROM c UNION SELECT user_id, company_id, tool FROM f) x
  LEFT JOIN c USING (user_id, company_id, tool)
  LEFT JOIN f USING (user_id, company_id, tool)
  LEFT JOIN public.mcp_companies co ON co.id = x.company_id
  LEFT JOIN public.mcp_company_members m ON m.user_id = x.user_id AND m.company_id = x.company_id
  ORDER BY 5 DESC, 4 DESC;
$$;
REVOKE ALL ON FUNCTION public.mcp_security_digest(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_security_digest(timestamptz) TO service_role;
