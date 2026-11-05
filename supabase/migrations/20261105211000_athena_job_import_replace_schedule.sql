-- Job import: replace an imported CPM with the source's schedule, recalculated.
-- Only on the member's explicit ask, from a review staged as a schedule
-- replacement. Only while the job's CPM is still the one an import saved:
-- every version saved over it since must be a pure recalculation (same
-- activities, names, durations, logic, progress, money and baselines; only
-- calculated dates, float and criticality changed, blank remaining durations,
-- WBS or calendars filled in, and the calculation settings set). Any edit in
-- Athena blocks the replace. The new version goes on top; earlier versions
-- stay in the report's history. Safe to run again.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- One activity, without what a calculation writes or fills in, with its logic
-- in a fixed order and FS / lag 0 spelled out.
CREATE OR REPLACE FUNCTION public.mcp_cpm_activity_core(_a jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_strip_nulls(
    (_a - 'start' - 'finish' - 'total_float' - 'critical' - 'remaining_duration' - 'wbs_id' - 'calendar_id' - 'predecessors')
    || jsonb_build_object('predecessors', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', l ->> 'id',
          'type', coalesce(l ->> 'type', 'FS'),
          'lag', coalesce(nullif(l -> 'lag', 'null'::jsonb), '0'::jsonb),
          'basis', l ->> 'lag_calendar_basis'))
        ORDER BY l ->> 'id', coalesce(l ->> 'type', 'FS'))
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_a -> 'predecessors') = 'array' THEN _a -> 'predecessors' ELSE '[]'::jsonb END) l
    ), '[]'::jsonb)))
$$;

-- True when _next is _prev recalculated: nothing a person enters changed.
CREATE OR REPLACE FUNCTION public.mcp_cpm_recalc_only(_prev jsonb, _next jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE pa jsonb; na jsonb; k text; ps jsonb; ns jsonb;
BEGIN
  IF jsonb_typeof(_prev -> 'activities') IS DISTINCT FROM 'array' OR jsonb_typeof(_next -> 'activities') IS DISTINCT FROM 'array'
    OR jsonb_array_length(_prev -> 'activities') <> jsonb_array_length(_next -> 'activities') THEN
    RETURN false;
  END IF;
  IF (SELECT count(DISTINCT e ->> 'id') FROM jsonb_array_elements(_prev -> 'activities') e) <> jsonb_array_length(_prev -> 'activities')
    OR (SELECT count(DISTINCT e ->> 'id') FROM jsonb_array_elements(_next -> 'activities') e) <> jsonb_array_length(_next -> 'activities') THEN
    RETURN false;
  END IF;
  FOR pa IN SELECT e FROM jsonb_array_elements(_prev -> 'activities') e LOOP
    na := NULL;
    SELECT e INTO na FROM jsonb_array_elements(_next -> 'activities') e WHERE e ->> 'id' = pa ->> 'id';
    IF na IS NULL THEN RETURN false; END IF;
    -- A calculation may fill these in when blank, never change them once set.
    FOREACH k IN ARRAY ARRAY['remaining_duration', 'wbs_id', 'calendar_id'] LOOP
      IF coalesce(pa -> k, 'null'::jsonb) <> 'null'::jsonb AND (pa -> k) IS DISTINCT FROM (na -> k) THEN RETURN false; END IF;
    END LOOP;
    IF public.mcp_cpm_activity_core(pa) IS DISTINCT FROM public.mcp_cpm_activity_core(na) THEN RETURN false; END IF;
  END LOOP;
  -- Everything outside the activities and the calculation stays the same:
  -- billing, TIA, baselines and any delay analysis.
  IF jsonb_strip_nulls(_prev - 'activities' - 'schedule_control') IS DISTINCT FROM jsonb_strip_nulls(_next - 'activities' - 'schedule_control') THEN
    RETURN false;
  END IF;
  ps := jsonb_strip_nulls(coalesce(CASE WHEN jsonb_typeof(_prev -> 'schedule_control') = 'object' THEN _prev -> 'schedule_control' END, '{}'::jsonb)
    - 'wbs' - 'settings' - 'calculation' - 'prior_update' - 'schema_version');
  ns := jsonb_strip_nulls(coalesce(CASE WHEN jsonb_typeof(_next -> 'schedule_control') = 'object' THEN _next -> 'schedule_control' END, '{}'::jsonb)
    - 'wbs' - 'settings' - 'calculation' - 'prior_update' - 'schema_version');
  IF ps -> 'baselines' = '[]'::jsonb THEN ps := ps - 'baselines'; END IF;
  IF ns -> 'baselines' = '[]'::jsonb THEN ns := ns - 'baselines'; END IF;
  RETURN ps = ns;
END $$;

REVOKE ALL ON FUNCTION public.mcp_cpm_activity_core(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_cpm_recalc_only(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_job_import_replace_schedule(_batch uuid, _hash text, _confirmed boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.mcp_import_batches; p jsonb; jid uuid; cur integer; iv integer; edited integer; who text; r jsonb; n integer; outcome jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  SELECT * INTO b FROM public.mcp_import_batches WHERE id = _batch FOR UPDATE;
  IF b.id IS NULL OR b.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'MCP_BAD:That import review is not yours. Run the review again. Nothing was saved.';
  END IF;
  IF b.status = 'applied' THEN RETURN b.result || jsonb_build_object('already_applied', true); END IF;
  IF b.status = 'cancelled' THEN RAISE EXCEPTION 'MCP_BAD:That import review was replaced or cancelled. Use the newest review. Nothing was saved.'; END IF;
  IF b.expires_at < now() THEN RAISE EXCEPTION 'MCP_BAD:That import review expired. Run the review again. Nothing was saved.'; END IF;
  IF _hash IS DISTINCT FROM b.package_hash OR md5(b.package::text) IS DISTINCT FROM b.package_hash THEN
    RAISE EXCEPTION 'MCP_BAD:That import key does not match the review. Nothing was saved.';
  END IF;
  IF coalesce(_confirmed, false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Replace the schedule only after the member says yes to this review. Nothing was saved.'; END IF;
  IF NOT public.mcp_is_company_member(b.company_id) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  p := b.package;
  IF jsonb_typeof(p -> 'schedule') IS DISTINCT FROM 'object' OR (p -> 'schedule' ->> 'replace') IS DISTINCT FROM 'true'
    OR jsonb_typeof(p -> 'schedule' -> 'data' -> 'activities') IS DISTINCT FROM 'array'
    OR coalesce(btrim(p -> 'schedule' ->> 'source_id'), '') = '' THEN
    RAISE EXCEPTION 'MCP_BAD:This review is not a schedule replacement. Nothing was saved.';
  END IF;
  SELECT id INTO jid FROM public.mcp_jobs WHERE company_id = b.company_id AND job_number = b.job_number;
  IF jid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:The job in this review is gone. Nothing was saved.'; END IF;
  IF public.mcp_job_scope(jid) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t do it.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(jid::text || ':cpm'));
  SELECT coalesce(max(version), 0) INTO cur FROM public.mcp_living_reports WHERE job_id = jid AND report_type = 'cpm';
  IF cur = 0 THEN RAISE EXCEPTION 'MCP_BAD:This job has no CPM to replace. Import the job instead. Nothing was saved.'; END IF;
  SELECT lr.version INTO iv FROM public.mcp_import_records ir
    JOIN public.mcp_living_reports lr ON lr.id::text = ir.target_id AND lr.job_id = jid AND lr.report_type = 'cpm'
    WHERE ir.job_id = jid AND ir.source_system = b.source_system AND ir.source_kind = 'schedule'
      AND ir.source_id = p -> 'schedule' ->> 'source_id';
  IF iv IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:The job''s CPM didn''t come from this import, so the import can''t replace it. Nothing was saved.';
  END IF;
  -- Versions saved over the imported one must each be a pure recalculation.
  SELECT s.version INTO edited FROM (
      SELECT version, data, lag(data) OVER (ORDER BY version) AS prev
      FROM public.mcp_living_reports WHERE job_id = jid AND report_type = 'cpm' AND version >= iv
    ) s
    WHERE s.version > iv AND NOT coalesce(public.mcp_cpm_recalc_only(s.prev, s.data), false)
    ORDER BY s.version LIMIT 1;
  IF edited IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_BAD:The CPM was edited in Athena after the import (version % changed activities, logic, progress or baselines; now version %), so the import can''t replace it. Nothing was saved.', edited, cur;
  END IF;
  SELECT nullif(btrim(display_name), '') INTO who FROM public.mcp_company_members WHERE company_id = b.company_id AND user_id = auth.uid();
  n := jsonb_array_length(p -> 'schedule' -> 'data' -> 'activities');
  r := public.mcp_living_report_save(jid, 'cpm', cur, p -> 'schedule' -> 'data', nullif(p -> 'schedule' ->> 'data_date', '')::date,
    n, NULL, NULL, coalesce(nullif(btrim(p -> 'schedule' ->> 'what'), ''), 'Replaced the imported schedule'),
    'Replaced the imported CPM with the source schedule, recalculated, on the member''s ask.', who);
  UPDATE public.mcp_import_records SET target_id = r ->> 'id', batch_id = b.id
    WHERE job_id = jid AND source_system = b.source_system AND source_kind = 'schedule' AND source_id = p -> 'schedule' ->> 'source_id';
  outcome := jsonb_build_object('job_id', jid, 'job_number', b.job_number, 'replaced', true, 'already_applied', false,
    'schedule_activities', n, 'cpm_version', (r ->> 'version')::integer, 'replaced_version', cur,
    'imported_version', iv,
    'data_date', p -> 'schedule' ->> 'data_date');
  UPDATE public.mcp_import_batches SET status = 'applied', applied_at = now(), job_id = jid, result = outcome WHERE id = b.id;
  PERFORM public.mcp_audit(b.company_id, b.job_number, 'job_import', 'schedule_replaced', b.id::text);
  RETURN outcome;
END $$;

REVOKE ALL ON FUNCTION public.mcp_job_import_replace_schedule(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_import_replace_schedule(uuid, text, boolean) TO authenticated;
