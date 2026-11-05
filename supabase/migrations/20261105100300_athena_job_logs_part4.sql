-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
--
-- Athena job logs, part 4 of 4: the job import reads package version 3.
-- Needs 20261105100200_athena_job_logs_part3 first. The four parts together are the former
-- 20261105100000_athena_job_logs.sql, split only to make each file smaller to
-- apply; no statement changed.
-- Rollback (all four parts): supabase/rollbacks/20261105100000_athena_job_logs.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 4. Job import: schedule, RFIs, decisions, claims, inspections (package version 3).
CREATE OR REPLACE FUNCTION public.mcp_job_import_context(_company uuid, _job_number text, _source text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.mcp_jobs; sc text;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE company_id = _company AND job_number = btrim(_job_number);
  IF j.id IS NULL THEN RETURN jsonb_build_object('job_exists', false); END IF;
  sc := public.mcp_job_scope(j.id);
  IF sc IS DISTINCT FROM 'full' THEN
    RETURN jsonb_build_object('job_exists', true, 'job_id', j.id, 'scope', sc, 'name', j.name);
  END IF;
  RETURN jsonb_build_object(
    'job_exists', true, 'job_id', j.id, 'scope', sc, 'name', j.name,
    'sov_fee_pct', j.sov_fee_pct, 'sov_basis', j.sov_basis,
    'has_official_sov', EXISTS (SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id = j.id AND f.module = 'sov'
      AND f.status = 'known' AND jsonb_typeof(f.value -> 'billable_value') = 'number'),
    'contract_keys', coalesce((SELECT jsonb_agg(key ORDER BY key) FROM public.mcp_job_facts WHERE job_id = j.id AND module = 'contract' AND status = 'known'), '[]'),
    'budget_keys', coalesce((SELECT jsonb_agg(key ORDER BY key) FROM public.mcp_job_facts WHERE job_id = j.id AND module = 'budget'), '[]'),
    'submittals', coalesce((SELECT jsonb_agg(lower(number) || '#' || revision) FROM public.mcp_submittals WHERE job_id = j.id), '[]'),
    'daily_dates', coalesce((SELECT jsonb_agg(report_date ORDER BY report_date) FROM public.mcp_daily_reports WHERE job_id = j.id), '[]'),
    'imported', coalesce((SELECT jsonb_agg(source_kind || ':' || source_id) FROM public.mcp_import_records
      WHERE job_id = j.id AND source_system = _source), '[]'),
    'has_ior', EXISTS (SELECT 1 FROM public.mcp_living_reports WHERE job_id = j.id AND report_type = 'ior'),
    'has_cpm', EXISTS (SELECT 1 FROM public.mcp_living_reports WHERE job_id = j.id AND report_type = 'cpm'),
    'archived', coalesce((SELECT jsonb_agg(source_table || ':' || source_id) FROM public.mcp_import_archive
      WHERE job_id = j.id AND source_system = _source), '[]'));
END $$;

CREATE OR REPLACE FUNCTION public.mcp_job_import_stage(_company uuid, _job_number text, _package jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.mcp_jobs; b public.mcp_import_batches; n text := btrim(coalesce(_job_number, ''));
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  IF n !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' THEN RAISE EXCEPTION 'MCP_BAD:The job number must be 1-40 letters, digits, dots, dashes or underscores. Nothing was saved.'; END IF;
  IF jsonb_typeof(_package) IS DISTINCT FROM 'object' OR octet_length(_package::text) > 6000000
    OR coalesce(_package ->> 'version', '') NOT IN ('1','2','3')
    OR coalesce(_package -> 'source' ->> 'system', '') NOT IN ('overwatch','procore','buildertrend','spreadsheet') THEN
    RAISE EXCEPTION 'MCP_BAD:That import package is not one Athena can read. Nothing was saved.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE company_id = _company AND job_number = n;
  IF j.id IS NOT NULL AND public.mcp_job_scope(j.id) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t do it.';
  END IF;
  UPDATE public.mcp_import_batches SET status = 'cancelled'
    WHERE actor_id = auth.uid() AND company_id = _company AND job_number = n AND status = 'staged';
  INSERT INTO public.mcp_import_batches (company_id, job_id, job_number, source_system, actor_id, package, package_hash, expires_at)
    VALUES (_company, j.id, n, _package -> 'source' ->> 'system', auth.uid(), _package, md5(_package::text), now() + interval '15 minutes')
    RETURNING * INTO b;
  RETURN jsonb_build_object('batch_id', b.id, 'package_hash', b.package_hash, 'expires_at', b.expires_at, 'job_exists', j.id IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_job_import_apply(_batch uuid, _hash text, _confirmed boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.mcp_import_batches; p jsonb; src text; jid uuid; j public.mcp_jobs; made jsonb; created boolean := false;
  facts jsonb; k text; v jsonb; item jsonb; r jsonb; rid uuid; num text; rev int;
  n_contract int := 0; n_sov int := 0; n_budget int := 0; n_open int := 0; n_co int := 0; n_sub int := 0; n_daily int := 0;
  skipped jsonb := '[]'; sov_written boolean := false; outcome jsonb;
  n_ior int := 0; n_risks int := 0; n_archive int := 0; n_rows int; who text; t text; arows jsonb;
  n_sched int := 0; n_rfi int := 0; n_dec int := 0; n_claim int := 0; n_insp int := 0; ev jsonb; pl jsonb; link text;
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
  IF coalesce(_confirmed, false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Save only after the member says yes to this review. Nothing was saved.'; END IF;
  IF NOT public.mcp_is_company_member(b.company_id) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  p := b.package; src := b.source_system;

  -- Job: the one named in the review, or a new one.
  SELECT id INTO jid FROM public.mcp_jobs WHERE company_id = b.company_id AND job_number = b.job_number;
  IF jid IS NULL THEN
    IF b.job_id IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:The job in this review is gone. Nothing was saved.'; END IF;
    made := public.mcp_job_create(b.company_id, b.job_number, coalesce(nullif(btrim(p -> 'job' ->> 'name'), ''), b.job_number), NULL);
    IF coalesce((made ->> 'duplicate')::boolean, false) THEN RAISE EXCEPTION 'MCP_BAD:Job % already exists. Run the review again. Nothing was saved.', b.job_number; END IF;
    jid := (made ->> 'job_id')::uuid; created := true;
  ELSIF b.job_id IS NULL OR b.job_id <> jid THEN
    RAISE EXCEPTION 'MCP_BAD:Job % was created after this review. Run the review again so it shows what is already there. Nothing was saved.', b.job_number;
  END IF;
  IF public.mcp_job_scope(jid) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t do it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = jid FOR UPDATE;
  IF created AND (nullif(btrim(p -> 'job' ->> 'pm_name'), '') IS NOT NULL OR nullif(btrim(p -> 'job' ->> 'pm_email'), '') IS NOT NULL) THEN
    PERFORM public.mcp_job_settings(jid, NULL, nullif(btrim(p -> 'job' ->> 'pm_name'), ''), nullif(btrim(p -> 'job' ->> 'pm_email'), ''), NULL);
  END IF;
  INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
    VALUES (jid, src, 'job', coalesce(nullif(p -> 'job' ->> 'source_id', ''), 'job'), jid::text, b.id) ON CONFLICT DO NOTHING;

  -- Contract facts: never overwrite a known fact.
  facts := '{}';
  FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(p -> 'contract_facts', '{}')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_job_facts WHERE job_id = jid AND module = 'contract' AND key = k AND status = 'known') THEN
      skipped := skipped || jsonb_build_array('Contract ' || replace(k, '_', ' ') || ' is already on the job; kept it.');
    ELSE facts := facts || jsonb_build_object(k, v); n_contract := n_contract + 1; END IF;
  END LOOP;
  IF facts <> '{}' THEN PERFORM public.mcp_set_facts(jid, 'contract', facts, 'document'); END IF;

  -- SOV, fee basis and opening balances: only onto a job with no official SOV.
  IF jsonb_typeof(p -> 'sov') = 'object' AND (p -> 'sov' -> 'lines') <> '{}' THEN
    IF EXISTS (SELECT 1 FROM public.mcp_job_facts WHERE job_id = jid AND module = 'sov') THEN
      skipped := skipped || jsonb_build_array('The job already has an SOV; the imported SOV and opening balances were not written.');
    ELSIF j.sov_fee_pct IS NOT NULL AND j.sov_fee_pct <> 0 THEN
      skipped := skipped || jsonb_build_array('The job already has a fee percent; the imported SOV was not written.');
    ELSE
      IF j.sov_fee_pct IS NULL AND j.sov_basis IS NULL THEN
        PERFORM public.mcp_job_sov_terms(jid, 0, p -> 'sov' ->> 'basis');
      END IF;
      PERFORM public.mcp_set_facts(jid, 'sov', p -> 'sov' -> 'lines', 'document');
      SELECT count(*) INTO n_sov FROM jsonb_object_keys(p -> 'sov' -> 'lines');
      sov_written := true;
      FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'opening_balances', '[]')) LOOP
        INSERT INTO public.mcp_import_opening_balances (job_id, sov_key, scheduled_cents, work_to_date_cents, stored_to_date_cents,
          retained_cents, through_application, period_to, source_system, batch_id)
        VALUES (jid, item ->> 'sov_key', (item ->> 'scheduled_cents')::bigint, coalesce((item ->> 'work_to_date_cents')::bigint, 0),
          coalesce((item ->> 'stored_to_date_cents')::bigint, 0), coalesce((item ->> 'retained_cents')::bigint, 0),
          nullif(p -> 'billing' ->> 'last_application', ''), nullif(p -> 'billing' ->> 'period_to', '')::date, src, b.id)
        ON CONFLICT (job_id, sov_key) DO NOTHING;
        n_open := n_open + 1;
      END LOOP;
    END IF;
  END IF;

  -- Budget: add cost codes the job doesn't have yet.
  facts := '{}';
  FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(p -> 'budget', '{}')) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.mcp_job_facts WHERE job_id = jid AND module = 'budget' AND key = k) THEN
      facts := facts || jsonb_build_object(k, v); n_budget := n_budget + 1;
    END IF;
  END LOOP;
  IF facts <> '{}' THEN PERFORM public.mcp_set_facts(jid, 'budget', facts, 'document'); END IF;

  -- Open (pending) change orders become priced PCO drafts, ready to send.
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'change_orders', '[]')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'change_order' AND source_id = item ->> 'source_id') THEN CONTINUE; END IF;
    rid := md5(b.id::text || ':create:' || (item ->> 'source_id'))::uuid;
    r := public.mcp_change_record(jid, 'create', jsonb_build_object(
      'request_id', rid, 'title', item ->> 'title', 'condition', item ->> 'condition', 'scope', item ->> 'scope',
      'references', jsonb_build_array(jsonb_build_object('kind', 'condition', 'citation', item ->> 'citation')),
      'schedule_days', item -> 'schedule_days', 'owner_number', item -> 'number'));
    PERFORM public.mcp_change_record(jid, 'price', jsonb_build_object(
      'request_id', md5(b.id::text || ':price:' || (item ->> 'source_id'))::uuid, 'submittal_id', r ->> 'saved_id',
      'expected_version', r -> 'record_version',
      'lines', jsonb_build_array(jsonb_build_object('category', 'other', 'description', item ->> 'title', 'quantity', 1,
        'unit_rate_cents', (item ->> 'amount_cents')::bigint, 'source', item ->> 'citation'))));
    INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
      VALUES (jid, src, 'change_order', item ->> 'source_id', r ->> 'saved_id', b.id);
    n_co := n_co + 1;
  END LOOP;

  -- Submittal log: never overwrite a number and revision already on the job.
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'submittals', '[]')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'submittal' AND source_id = item ->> 'source_id') THEN CONTINUE; END IF;
    num := btrim(item -> 'payload' ->> 'number'); rev := coalesce((item -> 'payload' ->> 'revision')::int, 0);
    IF EXISTS (SELECT 1 FROM public.mcp_submittals WHERE job_id = jid AND lower(number) = lower(num) AND revision = rev) THEN
      skipped := skipped || jsonb_build_array('Submittal ' || num || ' rev ' || rev || ' is already on the job; kept it.');
      CONTINUE;
    END IF;
    r := public.mcp_submittal_log(jid, 'import', item -> 'payload');
    INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
      VALUES (jid, src, 'submittal', item ->> 'source_id', r ->> 'saved_id', b.id);
    n_sub := n_sub + 1;
  END LOOP;

  -- Dailies: only dates with no Athena daily, so nothing a super wrote is replaced.
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'dailies', '[]')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'daily' AND source_id = item ->> 'source_id') THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.mcp_daily_reports WHERE job_id = jid AND report_date = (item ->> 'date')::date) THEN
      skipped := skipped || jsonb_build_array('A daily for ' || (item ->> 'date') || ' is already on the job; kept it.');
      CONTINUE;
    END IF;
    r := public.mcp_daily_report_save(jid, (item ->> 'date')::date, true, item ->> 'weather', item ->> 'manpower', item ->> 'subs',
      item ->> 'deliveries', item ->> 'issues', item ->> 'delays', item ->> 'safety', item ->> 'transcript', item -> 'lines');
    INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
      VALUES (jid, src, 'daily', item ->> 'source_id', r ->> 'id', b.id);
    n_daily := n_daily + 1;
  END LOOP;

  -- IOR: version 1 of the job's IOR living report, through the living report
  -- writer, only when the job has none. Athena's own IOR is never replaced.
  IF jsonb_typeof(p -> 'ior') = 'object' THEN
    IF EXISTS (SELECT 1 FROM public.mcp_living_reports WHERE job_id = jid AND report_type = 'ior') THEN
      skipped := skipped || jsonb_build_array('The job already has an IOR; kept Athena''s.');
    ELSIF NOT EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'ior' AND source_id = p -> 'ior' ->> 'source_id') THEN
      IF jsonb_typeof(p -> 'ior' -> 'model') IS DISTINCT FROM 'object' OR coalesce(btrim(p -> 'ior' ->> 'source_id'), '') = '' THEN
        RAISE EXCEPTION 'MCP_BAD:The IOR in this import is not one Athena can read. Nothing was saved.';
      END IF;
      SELECT nullif(btrim(display_name), '') INTO who FROM public.mcp_company_members WHERE company_id = b.company_id AND user_id = auth.uid();
      r := public.mcp_living_report_save(jid, 'ior', 0, jsonb_build_object('ior_model', p -> 'ior' -> 'model'),
        nullif(p -> 'ior' ->> 'data_date', '')::date, NULL, NULL, NULL,
        coalesce(nullif(btrim(p -> 'ior' ->> 'what'), ''), 'Imported IOR'), NULL, who);
      INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
        VALUES (jid, src, 'ior', p -> 'ior' ->> 'source_id', r ->> 'id', b.id);
      n_ior := 1;
      n_risks := coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p -> 'ior' -> 'model' -> 'exposures') = 'array' THEN p -> 'ior' -> 'model' -> 'exposures' END), 0);
    END IF;
  END IF;

  -- Archive: every source row, as the source stored it, read-only on the job.
  -- A row already archived from this source keeps its first copy.
  IF jsonb_typeof(p -> 'archive') = 'object' THEN
    FOR t, arows IN SELECT key, value FROM jsonb_each(p -> 'archive') LOOP
      IF t !~ '^[a-z][a-z0-9_]{0,62}$' OR jsonb_typeof(arows) IS DISTINCT FROM 'object'
        OR EXISTS (SELECT 1 FROM jsonb_each(arows) e WHERE length(e.key) NOT BETWEEN 1 AND 200 OR jsonb_typeof(e.value) IS DISTINCT FROM 'object') THEN
        RAISE EXCEPTION 'MCP_BAD:The archive in this import is not one Athena can read. Nothing was saved.';
      END IF;
      INSERT INTO public.mcp_import_archive (job_id, company_id, source_system, source_table, source_id, row, batch_id)
        SELECT jid, b.company_id, src, t, e.key, e.value, b.id FROM jsonb_each(arows) e
        ON CONFLICT (job_id, source_system, source_table, source_id) DO NOTHING;
      GET DIAGNOSTICS n_rows = ROW_COUNT;
      IF n_rows > 0 THEN
        INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
          VALUES (jid, src, 'archive', t, NULL, b.id) ON CONFLICT DO NOTHING;
      END IF;
      n_archive := n_archive + n_rows;
    END LOOP;
  END IF;

  -- Schedule: version 1 of the job's CPM, organized from the source, not cost
  -- loaded, through the living report writer; only when the job has no CPM.
  IF jsonb_typeof(p -> 'schedule') = 'object' THEN
    IF EXISTS (SELECT 1 FROM public.mcp_living_reports WHERE job_id = jid AND report_type = 'cpm') THEN
      skipped := skipped || jsonb_build_array('The job already has a CPM; kept Athena''s.');
    ELSIF NOT EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'schedule' AND source_id = p -> 'schedule' ->> 'source_id') THEN
      IF jsonb_typeof(p -> 'schedule' -> 'data' -> 'activities') IS DISTINCT FROM 'array' OR coalesce(btrim(p -> 'schedule' ->> 'source_id'), '') = '' THEN
        RAISE EXCEPTION 'MCP_BAD:The schedule in this import is not one Athena can read. Nothing was saved.';
      END IF;
      SELECT nullif(btrim(display_name), '') INTO who FROM public.mcp_company_members WHERE company_id = b.company_id AND user_id = auth.uid();
      n_sched := jsonb_array_length(p -> 'schedule' -> 'data' -> 'activities');
      r := public.mcp_living_report_save(jid, 'cpm', 0, p -> 'schedule' -> 'data', nullif(p -> 'schedule' ->> 'data_date', '')::date,
        n_sched, NULL, NULL, coalesce(nullif(btrim(p -> 'schedule' ->> 'what'), ''), 'Imported schedule'), NULL, who);
      INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
        VALUES (jid, src, 'schedule', p -> 'schedule' ->> 'source_id', r ->> 'id', b.id);
    END IF;
  END IF;

  -- RFIs handled outside Athena: recorded as sent and/or answered, never sent again.
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'rfis', '[]')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'rfi' AND source_id = item ->> 'source_id') THEN CONTINUE; END IF;
    r := public.mcp_request_record_outside(jid, coalesce(item -> 'payload', '{}') || jsonb_build_object('request_id', md5(b.id::text || ':rfi:' || (item ->> 'source_id'))::uuid));
    INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
      VALUES (jid, src, 'rfi', item ->> 'source_id', r ->> 'saved_id', b.id);
    n_rfi := n_rfi + 1;
  END LOOP;

  -- Owner decisions, claims (and their events) and inspections, through the
  -- job log writer. A link to a change order resolves through this ledger.
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'decisions', '[]')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'decision' AND source_id = item ->> 'source_id') THEN CONTINUE; END IF;
    pl := coalesce(item -> 'payload', '{}') || jsonb_build_object('request_id', md5(b.id::text || ':decision:' || (item ->> 'source_id'))::uuid,
      'source', jsonb_build_object('system', src, 'id', item ->> 'source_id'));
    SELECT target_id INTO link FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'change_order' AND source_id = item ->> 'change_order';
    IF link IS NOT NULL THEN pl := pl || jsonb_build_object('change_order_id', link); END IF;
    r := public.mcp_job_log_record(jid, 'decisions', 'create', pl);
    INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
      VALUES (jid, src, 'decision', item ->> 'source_id', r ->> 'saved_id', b.id);
    n_dec := n_dec + 1;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'claims', '[]')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'claim' AND source_id = item ->> 'source_id') THEN CONTINUE; END IF;
    pl := coalesce(item -> 'payload', '{}') || jsonb_build_object('request_id', md5(b.id::text || ':claim:' || (item ->> 'source_id'))::uuid,
      'source', jsonb_build_object('system', src, 'id', item ->> 'source_id'));
    SELECT target_id INTO link FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'change_order' AND source_id = item ->> 'change_order';
    IF link IS NOT NULL THEN pl := pl || jsonb_build_object('change_order_id', link); END IF;
    IF EXISTS (SELECT 1 FROM public.mcp_claims WHERE job_id = jid AND lower(number) = lower(pl ->> 'number')) THEN
      pl := pl - 'number';
      skipped := skipped || jsonb_build_array('Claim number ' || (item -> 'payload' ->> 'number') || ' is already on the job; the imported claim took the next number.');
    END IF;
    r := public.mcp_job_log_record(jid, 'claims', 'create', pl);
    FOR ev IN SELECT value FROM jsonb_array_elements(coalesce(item -> 'events', '[]')) LOOP
      PERFORM public.mcp_job_log_record(jid, 'claims', 'event', coalesce(ev -> 'payload', '{}') || jsonb_build_object(
        'request_id', md5(b.id::text || ':claim_event:' || (ev ->> 'source_id'))::uuid, 'claim_id', r ->> 'saved_id'));
    END LOOP;
    INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
      VALUES (jid, src, 'claim', item ->> 'source_id', r ->> 'saved_id', b.id);
    n_claim := n_claim + 1;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p -> 'inspections', '[]')) LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'inspection' AND source_id = item ->> 'source_id') THEN CONTINUE; END IF;
    pl := coalesce(item -> 'payload', '{}') || jsonb_build_object('request_id', md5(b.id::text || ':inspection:' || (item ->> 'source_id'))::uuid,
      'source', jsonb_build_object('system', src, 'id', item ->> 'source_id'));
    SELECT target_id INTO link FROM public.mcp_import_records WHERE job_id = jid AND source_system = src AND source_kind = 'inspection' AND source_id = item ->> 'parent';
    IF link IS NOT NULL THEN pl := pl || jsonb_build_object('parent_id', link); END IF;
    r := public.mcp_job_log_record(jid, 'inspections', 'create', pl);
    INSERT INTO public.mcp_import_records (job_id, source_system, source_kind, source_id, target_id, batch_id)
      VALUES (jid, src, 'inspection', item ->> 'source_id', r ->> 'saved_id', b.id);
    n_insp := n_insp + 1;
  END LOOP;

  outcome := jsonb_build_object('job_id', jid, 'job_number', b.job_number, 'job_created', created,
    'contract_facts', n_contract, 'sov_lines', n_sov, 'budget_lines', n_budget, 'opening_balances', n_open,
    'change_orders', n_co, 'submittals', n_sub, 'dailies', n_daily, 'skipped', skipped, 'already_applied', false)
    || jsonb_build_object('ior', n_ior, 'ior_risks', n_risks, 'archive_rows', n_archive)
    || jsonb_build_object('schedule_activities', n_sched, 'rfis', n_rfi, 'decisions', n_dec, 'claims', n_claim, 'inspections', n_insp);
  UPDATE public.mcp_import_batches SET status = 'applied', applied_at = now(), job_id = jid, result = outcome WHERE id = b.id;
  PERFORM public.mcp_audit(b.company_id, b.job_number, 'job_import', 'import_applied', b.id::text);
  RETURN outcome;
END $$;

REVOKE ALL ON FUNCTION public.mcp_job_import_context(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_job_import_stage(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_job_import_apply(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_import_context(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_job_import_stage(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_job_import_apply(uuid, text, boolean) TO authenticated;
