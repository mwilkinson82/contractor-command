-- Job import: the source's contract completion on the CPM header, and an
-- explicit replace of an imported CPM. After an import is saved, Athena fills
-- mcp_jobs.contract_completion_date from the package's job.contract_completion
-- (Overwatch's baseline completion), only when the job has none; a date
-- already on the job is never changed. Safe to run again.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.mcp_job_import_completion(_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.mcp_import_batches; jid uuid; raw text; d date; cur date; filled boolean := false;
BEGIN
  PERFORM public.mcp_assert_active();
  SELECT * INTO b FROM public.mcp_import_batches WHERE id = _batch;
  IF b.id IS NULL OR b.actor_id IS DISTINCT FROM auth.uid() OR b.status IS DISTINCT FROM 'applied' THEN
    RETURN jsonb_build_object('filled', false);
  END IF;
  SELECT id, contract_completion_date INTO jid, cur FROM public.mcp_jobs
    WHERE company_id = b.company_id AND job_number = b.job_number;
  IF jid IS NULL OR public.mcp_job_scope(jid) IS DISTINCT FROM 'full' THEN
    RETURN jsonb_build_object('filled', false);
  END IF;
  raw := btrim(coalesce(b.package -> 'job' ->> 'contract_completion', ''));
  IF raw ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN d := raw::date; EXCEPTION WHEN others THEN d := NULL; END;
  END IF;
  IF d IS NOT NULL AND cur IS NULL THEN
    UPDATE public.mcp_jobs SET contract_completion_date = d WHERE id = jid AND contract_completion_date IS NULL;
    filled := FOUND;
  END IF;
  RETURN jsonb_build_object('filled', filled, 'contract_completion_date', coalesce(cur, CASE WHEN filled THEN d END));
END $$;

REVOKE ALL ON FUNCTION public.mcp_job_import_completion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_import_completion(uuid) TO authenticated;

-- Job import: replace an imported CPM with the source's schedule, recalculated.
-- Only on the member's explicit ask, from a review staged as a schedule
-- replacement. Only while the job's latest CPM version is the one an import
-- saved (nothing was saved over it in Athena since). The new version goes on
-- top; earlier versions stay in the report's history.
CREATE OR REPLACE FUNCTION public.mcp_job_import_replace_schedule(_batch uuid, _hash text, _confirmed boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.mcp_import_batches; p jsonb; jid uuid; cur integer; lid uuid; who text; r jsonb; n integer; outcome jsonb;
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
  SELECT id INTO lid FROM public.mcp_living_reports WHERE job_id = jid AND report_type = 'cpm' AND version = cur;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = b.source_system
      AND source_kind = 'schedule' AND source_id = p -> 'schedule' ->> 'source_id' AND target_id = lid::text) THEN
    RAISE EXCEPTION 'MCP_BAD:The CPM was saved in Athena after the import (now version %), so the import can''t replace it. Nothing was saved.', cur;
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
    'data_date', p -> 'schedule' ->> 'data_date');
  UPDATE public.mcp_import_batches SET status = 'applied', applied_at = now(), job_id = jid, result = outcome WHERE id = b.id;
  PERFORM public.mcp_audit(b.company_id, b.job_number, 'job_import', 'schedule_replaced', b.id::text);
  RETURN outcome;
END $$;

REVOKE ALL ON FUNCTION public.mcp_job_import_replace_schedule(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_import_replace_schedule(uuid, text, boolean) TO authenticated;
