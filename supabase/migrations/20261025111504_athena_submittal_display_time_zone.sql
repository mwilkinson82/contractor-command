-- Apply only through Lovable Cloud. No timestamp/data backfill, grants or RLS changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mcp_companies ADD COLUMN time_zone text;
COMMENT ON COLUMN public.mcp_companies.time_zone IS 'Optional IANA company default; job zone takes precedence for submittal build history.';

-- Preserve the existing company Owner check, membership gate and all other profile behavior.
DO $patch$
DECLARE src text; marker text := E'  UPDATE public.mcp_companies SET\n';
BEGIN
  src := pg_get_functiondef('public.mcp_company_save(uuid,jsonb)'::regprocedure);
  IF strpos(src, marker) = 0 OR strpos(src, 'Only a company Owner') = 0 THEN
    RAISE EXCEPTION 'Unexpected company profile function; no patch applied';
  END IF;
  src := replace(src, marker, E'  IF _p ? ''time_zone'' AND nullif(btrim(_p->>''time_zone''), '''') IS NOT NULL\n    AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=btrim(_p->>''time_zone'')) THEN\n    RAISE EXCEPTION ''MCP_BAD:Use a valid IANA company time zone.'';\n  END IF;\n  UPDATE public.mcp_companies SET\n    time_zone = CASE WHEN _p ? ''time_zone'' THEN nullif(btrim(_p->>''time_zone''), '''') ELSE time_zone END,\n');
  EXECUTE src;
END $patch$;

-- The already-authorized record carries raw saved settings. No legacy default
-- can masquerade as a saved job setting and outrank the company/member fallback.
DO $patch$
DECLARE src text; marker text := '''page'', ''submittal'', ''company_id'', j.company_id';
BEGIN
  src := pg_get_functiondef('public.mcp_submittal_record_get(uuid,text)'::regprocedure);
  IF strpos(src, marker) = 0 OR strpos(src, 'mcp_job_scope(_job)') = 0 THEN
    RAISE EXCEPTION 'Unexpected submittal reader; no patch applied';
  END IF;
  src := replace(src, marker, $replacement$'page', 'submittal', 'time_zone_context', jsonb_build_object(
      'job', nullif(btrim(j.time_zone), ''),
      'company', (SELECT nullif(btrim(c.time_zone), '') FROM public.mcp_companies c WHERE c.id=j.company_id),
      'member', (SELECT nullif(btrim(s.time_zone), '') FROM public.mcp_morning_brief_settings s WHERE s.user_id=auth.uid())
    ), 'company_id', j.company_id$replacement$);
  EXECUTE src;
END $patch$;

-- A preference change invalidates the member page's existing freshness cache.
DO $patch$
DECLARE src text; marker text := 'RETURN coalesce(s, ''none'');';
BEGIN
  src := pg_get_functiondef('public.mcp_submittal_record_stamp(uuid,text)'::regprocedure);
  IF strpos(src, marker) = 0 THEN RAISE EXCEPTION 'Unexpected submittal stamp; no patch applied'; END IF;
  src := replace(src, marker, $replacement$RETURN coalesce(s, 'none') || '|' || coalesce((
    SELECT jsonb_build_array(j.time_zone,c.time_zone,
      (SELECT b.time_zone FROM public.mcp_morning_brief_settings b WHERE b.user_id=auth.uid()))::text
    FROM public.mcp_jobs j JOIN public.mcp_companies c ON c.id=j.company_id WHERE j.id=_job
  ), '');$replacement$);
  EXECUTE src;
END $patch$;

NOTIFY pgrst, 'reload schema';
COMMIT;
