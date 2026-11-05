-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
--
-- Athena job logs, part 1 of 4: CPM without cost loading and RFIs recorded
-- outside Athena. The four parts together are the former
-- 20261105100000_athena_job_logs.sql, split only to make each file smaller to
-- apply; no statement changed. Needs
-- 20261105090000_athena_job_import_whole_job first.
--
-- Before: a CPM could be saved only when its activity values tied to the
-- contract; RFIs could only be logged as sent through Athena; claims,
-- inspections and owner decisions had no log in Athena; the job import kept
-- schedules, RFIs, decisions, claims and inspections only in its archive.
-- After:
--   - A CPM saves with activity IDs, logic and durations alone. It ties to the
--     contract only when cost loaded: once any activity carries a value other
--     than 0, all loaded values must tie to the cent (an unvalued activity
--     counts as 0). Nothing spreads dollars onto a plain CPM.
--   - An RFI can be recorded as sent and/or answered outside Athena (state
--     sent_outside, then answered), with its source number, sent date, answer
--     and who answered, and no send receipt. RFIs sent through Athena still need
--     their receipt; status 'submitted' still requires one.
--   - New logs: mcp_claims (+ mcp_claim_events), mcp_inspections and
--     mcp_decisions, written only through mcp_job_log_record and read through
--     mcp_job_log_rows. Full job access reads and writes; a Super may read and
--     record inspections, without cost. A claim may link a delay event (and its
--     claim open item), a change order and an IOR risk; a decision may link a
--     change order, an IOR risk and a selection on the job's selection board
--     (by id, read-only check; the board itself is unchanged).
--   - The job import (package version 3) saves the schedule as CPM version 1
--     when the job has none, and brings RFIs, decisions, claims with their
--     events and inspections into these logs. Re-runs add only what is new.
-- Rollback: supabase/rollbacks/20261105100000_athena_job_logs.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. CPM without cost loading.
CREATE OR REPLACE FUNCTION public.mcp_living_report_save(
  _job uuid, _type text, _base_version integer, _data jsonb, _data_date date,
  _activity_count integer, _contract_total numeric, _forecast_total numeric,
  _what text, _why text, _who text, _completion date DEFAULT NULL, _replace_completion boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur integer; prev public.mcp_living_reports; dropped text[]; cd date; nid uuid; loaded boolean;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF _type NOT IN ('cpm', 'billing_forecast', 'ior', 'dashboard') THEN RAISE EXCEPTION 'MCP_BAD:Unknown report type.'; END IF;
  IF coalesce(btrim(_what), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:Say what changed in this version.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':' || _type));
  SELECT coalesce(max(version), 0) INTO cur FROM public.mcp_living_reports WHERE job_id = _job AND report_type = _type;
  IF coalesce(_base_version, 0) <> cur THEN RAISE EXCEPTION 'MCP_BAD:This report changed since you loaded it (now v%). Load the latest version and update that one.', cur; END IF;
  IF cur > 0 THEN
    SELECT * INTO prev FROM public.mcp_living_reports WHERE job_id = _job AND report_type = _type AND version = cur;
    SELECT array_agg(p->>'id') INTO dropped FROM jsonb_array_elements(coalesce(prev.data->'activities', '[]'::jsonb)) p
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_data->'activities', '[]'::jsonb)) n WHERE n->>'id' = p->>'id');
    IF dropped IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Not saved: this update drops activities %. Keep every activity.', array_to_string(dropped, ', '); END IF;
  END IF;
  -- A CPM ties to the contract only when it is cost loaded: any activity with a
  -- value other than 0. A plain CPM (IDs, logic, durations) saves with no tie.
  -- Once any activity carries a value, the loaded total must tie to the cent.
  loaded := _type = 'cpm' AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_data->'activities') = 'array' THEN _data->'activities' ELSE '[]'::jsonb END) a
    WHERE jsonb_typeof(a->'value') = 'number' AND (a->>'value')::numeric <> 0);
  IF (_type = 'billing_forecast' OR loaded) AND (_contract_total IS NULL OR _forecast_total IS NULL OR round(_contract_total, 2) <> round(_forecast_total, 2)) THEN
    RAISE EXCEPTION 'MCP_BAD:Not saved: the forecast doesn''t tie to the contract.';
  END IF;
  IF _completion IS NOT NULL THEN
    SELECT contract_completion_date INTO cd FROM public.mcp_jobs WHERE id = _job;
    IF cd IS NOT NULL AND cd <> _completion AND NOT _replace_completion THEN
      RAISE EXCEPTION 'MCP_BAD:A different contract completion date (%) is already saved. Confirm the change first.', cd;
    END IF;
    UPDATE public.mcp_jobs SET contract_completion_date = _completion WHERE id = _job;
  END IF;
  INSERT INTO public.mcp_living_reports (job_id, report_type, version, data_date, data, activity_count, contract_total, forecast_total, change_what, change_why, updated_by_name)
  VALUES (_job, _type, cur + 1, _data_date, _data, _activity_count, _contract_total, _forecast_total, btrim(_what), nullif(btrim(coalesce(_why, '')), ''), _who)
  RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'version', cur + 1);
END $$;

-- 2. RFIs recorded outside Athena.
ALTER TABLE public.mcp_submittals DROP CONSTRAINT IF EXISTS mcp_submittals_request_content_check;
ALTER TABLE public.mcp_submittals ADD CONSTRAINT mcp_submittals_request_content_check
  CHECK (package_purpose NOT IN ('rfi','rfc') OR (
    request_details IS NOT NULL AND jsonb_typeof(request_details)='object'
    AND length(btrim(coalesce(request_details->>'condition',''))) BETWEEN 1 AND 12000
    AND length(btrim(coalesce(request_details->>'question',''))) BETWEEN 1 AND 12000
    AND btrim(request_details->>'condition') !~* '^(needed|unknown|n/?a|tbd|pending|not provided)$'
    AND btrim(request_details->>'question') !~* '^(needed|unknown|n/?a|tbd|pending|not provided)$'
    AND jsonb_typeof(request_details->'references')='array'
    AND jsonb_array_length(request_details->'references') BETWEEN 1 AND 40
    AND request_details->>'state' IN ('draft','sent_outside','answered','closed')
    AND (request_details->>'state' <> 'sent_outside' OR (package_purpose = 'rfi' AND coalesce(jsonb_typeof(request_details->'outside'), '') = 'object'))
    AND status IN ('in_prep','submitted','in_review','closed')
  ));

-- A request sent outside Athena behaves as sent: its question is preserved,
-- an answer can be captured against it, and it can be closed or reopened.
-- The log shows it as sent and marks it recorded outside.
DO $patch$
DECLARE original text; revised text;
BEGIN
 SELECT pg_get_functiondef('public.mcp_request_record(uuid,text,text,jsonb)'::regprocedure) INTO original;
 IF position($m$details->>'state'='sent_outside'$m$ IN original) = 0 THEN
   revised := replace(original, $m$WHEN sent THEN 'sent' ELSE 'draft' END;$m$,
     $m$WHEN sent THEN 'sent' WHEN details->>'state'='sent_outside' THEN 'sent' ELSE 'draft' END;$m$);
   IF revised = original THEN RAISE EXCEPTION 'Request writer changed; review outside-RFI integration.'; END IF;
   -- A reopened revision is a new Athena draft: it does not carry the outside marker.
   original := revised;
   revised := replace(original, $m$details:=(details-'answer') ||$m$, $m$details:=(details-'answer'-'outside') ||$m$);
   IF revised = original THEN RAISE EXCEPTION 'Request reopen changed; review outside-RFI integration.'; END IF;
   EXECUTE revised;
 END IF;
 SELECT pg_get_functiondef('public.mcp_request_rows(uuid,text)'::regprocedure) INTO original;
 IF position('recorded_outside' IN original) = 0 THEN
   revised := replace(original, $m$'state',CASE WHEN s.request_details->>'state' IN ('answered','closed') THEN s.request_details->>'state'$m$,
     $m$'recorded_outside',(s.request_details ? 'outside'),'state',CASE WHEN s.request_details->>'state' IN ('answered','closed') THEN s.request_details->>'state' WHEN s.request_details->>'state'='sent_outside' THEN 'sent'$m$);
   IF revised = original THEN RAISE EXCEPTION 'Request log changed; review outside-RFI integration.'; END IF;
   EXECUTE revised;
 END IF;
END $patch$;

-- Record an RFI that was sent and/or answered outside Athena. No package is
-- built or sent; the record says where it was handled. Never sent from here.
CREATE OR REPLACE FUNCTION public.mcp_request_record_outside(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.mcp_jobs; s public.mcp_submittals; op public.mcp_request_operations; rid uuid; sig text;
  seq int; tn int; tid uuid; details jsonb; refs jsonb; outside jsonb; state text; sent date; answered date;
  ttl text; q text; cond text; src text; srcnum text; tz text; today date;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Recording an RFI needs full access to its job.'; END IF;
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR octet_length(_p::text) > 100000 THEN RAISE EXCEPTION 'MCP_BAD:RFI content is missing or too large.'; END IF;
  rid := nullif(_p->>'request_id', '')::uuid;
  IF rid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A request operation ID is required for safe retries.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  sig := md5(jsonb_build_object('kind', 'rfi', 'action', 'record_outside', 'payload', _p - 'host')::text);
  SELECT * INTO op FROM public.mcp_request_operations WHERE job_id = _job AND request_id = rid;
  IF op.request_id IS NOT NULL THEN
    IF op.actor_id <> auth.uid() OR op.digest <> sig THEN RAISE EXCEPTION 'MCP_BAD:That operation ID already belongs to different content.'; END IF;
    RETURN jsonb_build_object('saved_id', op.submittal_id, 'already_applied', true);
  END IF;
  tz := coalesce(nullif(j.time_zone, ''), 'UTC');
  today := (now() AT TIME ZONE tz)::date;
  ttl := btrim(coalesce(_p->>'title', ''));
  q := btrim(coalesce(_p->>'question', ''));
  cond := coalesce(nullif(btrim(coalesce(_p->>'condition', '')), ''), ttl);
  src := left(coalesce(nullif(btrim(coalesce(_p->>'source', '')), ''), 'another system'), 80);
  srcnum := nullif(left(btrim(coalesce(_p->>'source_number', '')), 40), '');
  IF length(ttl) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:An RFI needs a title.'; END IF;
  IF length(q) NOT BETWEEN 1 AND 12000 THEN RAISE EXCEPTION 'MCP_BAD:An RFI needs its question.'; END IF;
  sent := nullif(_p->>'sent_on', '')::date;
  answered := nullif(_p->>'answered_on', '')::date;
  IF sent > today OR answered > today THEN RAISE EXCEPTION 'MCP_BAD:A sent or answered date cannot be in the future.'; END IF;
  IF answered < sent THEN RAISE EXCEPTION 'MCP_BAD:The answer date is before the sent date.'; END IF;
  IF nullif(btrim(coalesce(_p->>'answer_text', '')), '') IS NOT NULL AND answered IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:An answer recorded outside Athena needs the date it was received.';
  END IF;
  IF answered IS NOT NULL AND length(btrim(coalesce(_p->>'answer_text', ''))) NOT BETWEEN 1 AND 12000 THEN
    RAISE EXCEPTION 'MCP_BAD:An answer recorded outside Athena needs its text.';
  END IF;
  state := CASE WHEN answered IS NOT NULL THEN 'answered' WHEN sent IS NOT NULL THEN 'sent_outside' ELSE 'draft' END;
  refs := CASE WHEN jsonb_typeof(_p->'references') = 'array' AND jsonb_array_length(_p->'references') BETWEEN 1 AND 40 THEN _p->'references'
    ELSE jsonb_build_array(jsonb_build_object('kind', 'condition', 'citation',
      'Recorded outside Athena' || ': ' || src || coalesce(' RFI ' || srcnum, ''))) END;
  outside := jsonb_build_object('recorded_outside', true, 'source', src, 'source_number', srcnum, 'sent_on', sent,
    'sent_to', nullif(left(btrim(coalesce(_p->>'sent_to', '')), 120), ''), 'answered_on', answered,
    'answered_by', nullif(left(btrim(coalesce(_p->>'answered_by', '')), 320), ''), 'recorded_at', now());
  SELECT coalesce(max(substring(number FROM '[0-9]+$')::int), 0) + 1 INTO seq
    FROM public.mcp_submittals WHERE job_id = _job AND number ~ '^RFI-[0-9]{1,8}$';
  SELECT coalesce(max(number), 0) + 1 INTO tn FROM public.mcp_transmittals WHERE job_id = _job;
  INSERT INTO public.mcp_transmittals(company_id, job_id, number, to_name, sent_on)
    VALUES (j.company_id, _job, tn, outside->>'sent_to', sent) RETURNING id INTO tid;
  details := jsonb_build_object('condition', cond, 'question', q, 'references', refs, 'suggested_resolution', NULL,
    'recipient_name', outside->>'sent_to', 'recipient_role', NULL, 'recipient_email', NULL,
    'due_date', nullif(_p->>'due_date', ''), 'due_basis', CASE WHEN nullif(_p->>'due_date', '') IS NOT NULL THEN 'member_target' END,
    'state', state, 'record_version', 1, 'outside', outside);
  IF answered IS NOT NULL THEN
    details := details || jsonb_build_object('answer', jsonb_build_object('text', btrim(_p->>'answer_text'),
      'received_from', coalesce(outside->>'answered_by', 'Not recorded in ' || src),
      'received_at', (answered::timestamp AT TIME ZONE tz), 'recorded_outside', true));
  END IF;
  INSERT INTO public.mcp_submittals(company_id, job_id, number, revision, transmittal_id, spec_section, title,
    submittal_type, status, ball_in_court, source, required, package_purpose, request_details, required_by, submitted_on, returned_on)
  VALUES (j.company_id, _job, 'RFI-' || lpad(seq::text, greatest(3, length(seq::text)), '0'), 0, tid, '', ttl, 'other',
    CASE state WHEN 'draft' THEN 'in_prep' ELSE 'in_review' END,
    CASE state WHEN 'sent_outside' THEN 'architect_engineer' ELSE 'gc' END,
    'imported', true, 'rfi', details, nullif(_p->>'due_date', '')::date, sent, answered) RETURNING * INTO s;
  INSERT INTO public.mcp_request_operations(job_id, request_id, actor_id, digest, submittal_id) VALUES (_job, rid, auth.uid(), sig, s.id);
  PERFORM public.mcp_project_record_add(_job, 'rfi_record_outside', 'RFI ' || s.number || ' · ' || s.title,
    CASE state WHEN 'answered' THEN 'Recorded as sent and answered outside Athena.' WHEN 'sent_outside' THEN 'Recorded as sent outside Athena; no Athena send receipt.'
      ELSE 'Recorded from outside Athena as a draft, not sent.' END,
    outside->>'sent_to', NULL, 'mcp_submittals', s.id, jsonb_build_object('number', s.number, 'request_details', s.request_details), 'user');
  RETURN jsonb_build_object('saved_id', s.id, 'number', s.number, 'state', state, 'record_version', 1, 'already_applied', false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_request_record_outside(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_request_record_outside(uuid, jsonb) TO authenticated;

