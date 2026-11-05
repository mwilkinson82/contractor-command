-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
--
-- Athena job logs, part 3 of 4: the job log writer and reader.
-- Needs 20261105100100_athena_job_logs_part2 first. The four parts together are the former
-- 20261105100000_athena_job_logs.sql, split only to make each file smaller to
-- apply; no statement changed.
-- Rollback (all four parts): supabase/rollbacks/20261105100000_athena_job_logs.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Create, update (by record version) or add a claim event. _log: claims,
-- inspections or decisions. Every write carries a request_id for safe retries.
CREATE OR REPLACE FUNCTION public.mcp_job_log_record(_job uuid, _log text, _action text, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sc text; j public.mcp_jobs; rid uuid; sig text; op public.mcp_job_log_operations; rec uuid; num text; seq int;
  v int; co uuid; de public.mcp_delay_events; item uuid; parent uuid; sel uuid; out jsonb; cl public.mcp_claims;
  ins public.mcp_inspections; dc public.mcp_decisions; d1 date; d2 date;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF coalesce(_log, '') NOT IN ('claims','inspections','decisions') THEN RAISE EXCEPTION 'MCP_BAD:Choose the claims, inspections or decisions log.'; END IF;
  IF sc IS DISTINCT FROM 'full' AND NOT coalesce(_log = 'inspections' AND sc = 'super', false) THEN
    RAISE EXCEPTION 'MCP_BAD:This log needs full access to the job. Your role can''t change it.';
  END IF;
  IF coalesce(_action, '') NOT IN ('create','update','event') OR (_action = 'event' AND _log <> 'claims') THEN
    RAISE EXCEPTION 'MCP_BAD:Choose create or update (or event, for a claim).';
  END IF;
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR octet_length(_p::text) > 100000 THEN RAISE EXCEPTION 'MCP_BAD:The record is missing or too large.'; END IF;
  rid := nullif(_p->>'request_id', '')::uuid;
  IF rid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A request operation ID is required for safe retries.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  sig := md5(jsonb_build_object('log', _log, 'action', _action, 'payload', _p - 'host')::text);
  SELECT * INTO op FROM public.mcp_job_log_operations WHERE job_id = _job AND request_id = rid;
  IF op.request_id IS NOT NULL THEN
    IF op.actor_id <> auth.uid() OR op.digest <> sig THEN RAISE EXCEPTION 'MCP_BAD:That operation ID already belongs to different content.'; END IF;
    RETURN op.result || jsonb_build_object('already_applied', true);
  END IF;
  IF sc = 'super' AND (_p ? 'cost_impact_cents') THEN RAISE EXCEPTION 'MCP_BAD:Cost impact needs full access to the job.'; END IF;
  IF nullif(_p->>'change_order_id', '') IS NOT NULL THEN
    SELECT id INTO co FROM public.mcp_submittals WHERE id = (_p->>'change_order_id')::uuid AND job_id = _job AND package_purpose = 'change_order';
    IF co IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That change order is not on this job.'; END IF;
  END IF;
  IF _p ? 'status' AND _log = 'claims' AND _p->>'status' NOT IN ('in_preparation','submitted','pending_review','under_review','reviewed','resolved','rejected','withdrawn') THEN
    RAISE EXCEPTION 'MCP_BAD:Claim status is one of in_preparation, submitted, pending_review, under_review, reviewed, resolved, rejected or withdrawn.';
  END IF;
  IF _p ? 'claim_type' AND _p->>'claim_type' NOT IN ('delay','extension_of_time','delay_damages','acceleration','disruption','other') THEN
    RAISE EXCEPTION 'MCP_BAD:Claim type is one of delay, extension_of_time, delay_damages, acceleration, disruption or other.';
  END IF;
  IF _p ? 'status' AND _log = 'inspections' AND _p->>'status' NOT IN ('planned','requested','scheduled','passed','failed','partial','cancelled') THEN
    RAISE EXCEPTION 'MCP_BAD:Inspection status is one of planned, requested, scheduled, passed, failed, partial or cancelled.';
  END IF;
  IF _p ? 'result' AND _p->>'result' NOT IN ('pending','pass','fail','partial','cancelled') THEN
    RAISE EXCEPTION 'MCP_BAD:Inspection result is one of pending, pass, fail, partial or cancelled.';
  END IF;
  IF _p ? 'status' AND _log = 'decisions' AND _p->>'status' NOT IN ('open','in_progress','decided','withdrawn') THEN
    RAISE EXCEPTION 'MCP_BAD:Decision status is one of open, in_progress, decided or withdrawn.';
  END IF;
  IF coalesce((_p->>'money_claimed_cents')::bigint, 0) < 0 OR coalesce((_p->>'money_awarded_cents')::bigint, 0) < 0 THEN
    RAISE EXCEPTION 'MCP_BAD:Claimed and awarded amounts can''t be negative.';
  END IF;

  IF _log = 'claims' THEN
    IF nullif(_p->>'delay_event_id', '') IS NOT NULL THEN
      SELECT * INTO de FROM public.mcp_delay_events WHERE id = (_p->>'delay_event_id')::uuid AND job_id = _job;
      IF de.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That delay event is not on this job.'; END IF;
    END IF;
    item := coalesce(nullif(_p->>'claim_item_id', '')::uuid, de.claim_item_id);
    IF item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mcp_open_items WHERE id = item AND job_id = _job) THEN
      RAISE EXCEPTION 'MCP_BAD:That claim item is not on this job.';
    END IF;
    IF _action = 'create' THEN
      IF length(btrim(coalesce(_p->>'title', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:A claim needs a title.'; END IF;
      num := nullif(btrim(coalesce(_p->>'number', '')), '');
      IF num IS NULL THEN
        SELECT coalesce(max(substring(number FROM '[0-9]+$')::int), 0) + 1 INTO seq FROM public.mcp_claims WHERE job_id = _job AND number ~ '^CL-[0-9]{1,8}$';
        num := 'CL-' || lpad(seq::text, 3, '0');
      ELSIF EXISTS (SELECT 1 FROM public.mcp_claims WHERE job_id = _job AND lower(number) = lower(num)) THEN
        RAISE EXCEPTION 'MCP_BAD:Claim % is already on this job.', num;
      END IF;
      INSERT INTO public.mcp_claims (company_id, job_id, number, claim_type, title, description, status, money_claimed_cents, money_awarded_cents,
        time_claimed_days, time_awarded_days, submitted_on, resolved_on, outcome, owner_name, change_order_id, exposure_ref, delay_event_id, claim_item_id, source)
      VALUES (j.company_id, _job, num, coalesce(_p->>'claim_type', 'other'), btrim(_p->>'title'), coalesce(_p->>'description', ''),
        coalesce(_p->>'status', 'in_preparation'), coalesce((_p->>'money_claimed_cents')::bigint, 0), coalesce((_p->>'money_awarded_cents')::bigint, 0),
        coalesce((_p->>'time_claimed_days')::int, 0), coalesce((_p->>'time_awarded_days')::int, 0), nullif(_p->>'submitted_on', '')::date,
        nullif(_p->>'resolved_on', '')::date, nullif(_p->>'outcome', ''), nullif(_p->>'owner_name', ''), co, nullif(_p->>'exposure_ref', ''),
        de.id, item, CASE WHEN jsonb_typeof(_p->'source') = 'object' THEN _p->'source' END)
      RETURNING * INTO cl;
    ELSE
      SELECT * INTO cl FROM public.mcp_claims WHERE job_id = _job AND ((nullif(_p->>'claim_id', '') IS NOT NULL AND id = (_p->>'claim_id')::uuid)
        OR (nullif(_p->>'claim_id', '') IS NULL AND lower(number) = lower(_p->>'number'))) FOR UPDATE;
      IF cl.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That claim is not on this job.'; END IF;
      IF _action = 'event' THEN
        IF coalesce(_p->>'event_type', '') NOT IN ('submitted','received','reviewed','meeting','returned_for_revision','resubmitted','resolved','other') THEN
          RAISE EXCEPTION 'MCP_BAD:Event type is one of submitted, received, reviewed, meeting, returned_for_revision, resubmitted, resolved or other.';
        END IF;
        INSERT INTO public.mcp_claim_events (claim_id, job_id, event_type, event_date, revision_number, note)
          VALUES (cl.id, _job, _p->>'event_type', nullif(_p->>'event_date', '')::date, coalesce((_p->>'revision_number')::int, 0), nullif(_p->>'note', ''));
      ELSE
        IF nullif(_p->>'expected_version', '')::int IS DISTINCT FROM cl.record_version THEN RAISE EXCEPTION 'MCP_BAD:The claim changed. Read it again before saving.'; END IF;
        IF _p ? 'title' AND length(btrim(coalesce(_p->>'title', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:A claim needs a title.'; END IF;
        UPDATE public.mcp_claims SET
          claim_type = CASE WHEN _p ? 'claim_type' THEN _p->>'claim_type' ELSE claim_type END,
          title = CASE WHEN _p ? 'title' THEN btrim(_p->>'title') ELSE title END,
          description = CASE WHEN _p ? 'description' THEN coalesce(_p->>'description', '') ELSE description END,
          status = CASE WHEN _p ? 'status' THEN _p->>'status' ELSE status END,
          money_claimed_cents = CASE WHEN _p ? 'money_claimed_cents' THEN coalesce((_p->>'money_claimed_cents')::bigint, 0) ELSE money_claimed_cents END,
          money_awarded_cents = CASE WHEN _p ? 'money_awarded_cents' THEN coalesce((_p->>'money_awarded_cents')::bigint, 0) ELSE money_awarded_cents END,
          time_claimed_days = CASE WHEN _p ? 'time_claimed_days' THEN coalesce((_p->>'time_claimed_days')::int, 0) ELSE time_claimed_days END,
          time_awarded_days = CASE WHEN _p ? 'time_awarded_days' THEN coalesce((_p->>'time_awarded_days')::int, 0) ELSE time_awarded_days END,
          submitted_on = CASE WHEN _p ? 'submitted_on' THEN nullif(_p->>'submitted_on', '')::date ELSE submitted_on END,
          resolved_on = CASE WHEN _p ? 'resolved_on' THEN nullif(_p->>'resolved_on', '')::date ELSE resolved_on END,
          outcome = CASE WHEN _p ? 'outcome' THEN nullif(_p->>'outcome', '') ELSE outcome END,
          owner_name = CASE WHEN _p ? 'owner_name' THEN nullif(_p->>'owner_name', '') ELSE owner_name END,
          change_order_id = CASE WHEN _p ? 'change_order_id' THEN co ELSE change_order_id END,
          exposure_ref = CASE WHEN _p ? 'exposure_ref' THEN nullif(_p->>'exposure_ref', '') ELSE exposure_ref END,
          delay_event_id = CASE WHEN _p ? 'delay_event_id' THEN de.id ELSE delay_event_id END,
          claim_item_id = CASE WHEN _p ? 'claim_item_id' OR _p ? 'delay_event_id' THEN item ELSE claim_item_id END,
          record_version = record_version + 1, updated_at = now()
        WHERE id = cl.id RETURNING * INTO cl;
      END IF;
    END IF;
    IF cl.resolved_on < cl.submitted_on THEN RAISE EXCEPTION 'MCP_BAD:The resolved date is before the submitted date.'; END IF;
    rec := cl.id; num := cl.number; v := cl.record_version;
  ELSIF _log = 'inspections' THEN
    IF nullif(_p->>'parent_id', '') IS NOT NULL THEN
      SELECT id INTO parent FROM public.mcp_inspections WHERE id = (_p->>'parent_id')::uuid AND job_id = _job;
      IF parent IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That earlier inspection is not on this job.'; END IF;
    END IF;
    IF _action = 'create' THEN
      IF length(btrim(coalesce(_p->>'inspection_type', ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:An inspection needs its type (for example Framing or Final electrical).'; END IF;
      INSERT INTO public.mcp_inspections (company_id, job_id, inspection_type, authority, location, inspector, responsible_party, status, result,
        requested_on, scheduled_on, completed_on, attempt, reinspection_required, cost_impact_cents, schedule_impact_weeks, notes, corrective_action,
        parent_id, risk_ref, source)
      VALUES (j.company_id, _job, btrim(_p->>'inspection_type'), nullif(_p->>'authority', ''), nullif(_p->>'location', ''), nullif(_p->>'inspector', ''),
        nullif(_p->>'responsible_party', ''), coalesce(_p->>'status', 'planned'), coalesce(_p->>'result', 'pending'),
        nullif(_p->>'requested_on', '')::date, nullif(_p->>'scheduled_on', '')::date, nullif(_p->>'completed_on', '')::date,
        coalesce((_p->>'attempt')::int, CASE WHEN parent IS NOT NULL THEN (SELECT attempt + 1 FROM public.mcp_inspections WHERE id = parent) ELSE 1 END),
        coalesce((_p->>'reinspection_required')::boolean, false), coalesce((_p->>'cost_impact_cents')::bigint, 0),
        nullif(_p->>'schedule_impact_weeks', '')::numeric, nullif(_p->>'notes', ''), nullif(_p->>'corrective_action', ''), parent,
        nullif(_p->>'risk_ref', ''), CASE WHEN jsonb_typeof(_p->'source') = 'object' THEN _p->'source' END)
      RETURNING * INTO ins;
    ELSE
      SELECT * INTO ins FROM public.mcp_inspections WHERE job_id = _job AND id = nullif(_p->>'inspection_id', '')::uuid FOR UPDATE;
      IF ins.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That inspection is not on this job.'; END IF;
      IF nullif(_p->>'expected_version', '')::int IS DISTINCT FROM ins.record_version THEN RAISE EXCEPTION 'MCP_BAD:The inspection changed. Read it again before saving.'; END IF;
      IF parent = ins.id THEN RAISE EXCEPTION 'MCP_BAD:An inspection can''t follow itself.'; END IF;
      UPDATE public.mcp_inspections SET
        inspection_type = CASE WHEN _p ? 'inspection_type' AND length(btrim(coalesce(_p->>'inspection_type', ''))) BETWEEN 1 AND 120 THEN btrim(_p->>'inspection_type') ELSE inspection_type END,
        authority = CASE WHEN _p ? 'authority' THEN nullif(_p->>'authority', '') ELSE authority END,
        location = CASE WHEN _p ? 'location' THEN nullif(_p->>'location', '') ELSE location END,
        inspector = CASE WHEN _p ? 'inspector' THEN nullif(_p->>'inspector', '') ELSE inspector END,
        responsible_party = CASE WHEN _p ? 'responsible_party' THEN nullif(_p->>'responsible_party', '') ELSE responsible_party END,
        status = CASE WHEN _p ? 'status' THEN _p->>'status' ELSE status END,
        result = CASE WHEN _p ? 'result' THEN _p->>'result' ELSE result END,
        requested_on = CASE WHEN _p ? 'requested_on' THEN nullif(_p->>'requested_on', '')::date ELSE requested_on END,
        scheduled_on = CASE WHEN _p ? 'scheduled_on' THEN nullif(_p->>'scheduled_on', '')::date ELSE scheduled_on END,
        completed_on = CASE WHEN _p ? 'completed_on' THEN nullif(_p->>'completed_on', '')::date ELSE completed_on END,
        attempt = CASE WHEN _p ? 'attempt' THEN coalesce((_p->>'attempt')::int, attempt) ELSE attempt END,
        reinspection_required = CASE WHEN _p ? 'reinspection_required' THEN coalesce((_p->>'reinspection_required')::boolean, false) ELSE reinspection_required END,
        cost_impact_cents = CASE WHEN _p ? 'cost_impact_cents' THEN coalesce((_p->>'cost_impact_cents')::bigint, 0) ELSE cost_impact_cents END,
        schedule_impact_weeks = CASE WHEN _p ? 'schedule_impact_weeks' THEN nullif(_p->>'schedule_impact_weeks', '')::numeric ELSE schedule_impact_weeks END,
        notes = CASE WHEN _p ? 'notes' THEN nullif(_p->>'notes', '') ELSE notes END,
        corrective_action = CASE WHEN _p ? 'corrective_action' THEN nullif(_p->>'corrective_action', '') ELSE corrective_action END,
        parent_id = CASE WHEN _p ? 'parent_id' THEN parent ELSE parent_id END,
        risk_ref = CASE WHEN _p ? 'risk_ref' THEN nullif(_p->>'risk_ref', '') ELSE risk_ref END,
        record_version = record_version + 1, updated_at = now()
      WHERE id = ins.id RETURNING * INTO ins;
    END IF;
    IF ins.completed_on < ins.requested_on THEN RAISE EXCEPTION 'MCP_BAD:The completed date is before the requested date.'; END IF;
    rec := ins.id; num := ins.inspection_type || ' #' || ins.attempt; v := ins.record_version;
  ELSE
    IF nullif(_p->>'selection_id', '') IS NOT NULL THEN
      sel := (_p->>'selection_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM mcp_private.residential_selection_boards bd, jsonb_array_elements(coalesce(bd.body->'selections', '[]'::jsonb)) x
        WHERE bd.job_id = _job AND x->>'id' = sel::text) THEN
        RAISE EXCEPTION 'MCP_BAD:That selection is not on this job''s selection board.';
      END IF;
    END IF;
    IF _action = 'create' THEN
      IF length(btrim(coalesce(_p->>'decision', ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Say what needs deciding.'; END IF;
      num := nullif(btrim(coalesce(_p->>'number', '')), '');
      IF num IS NULL THEN
        SELECT coalesce(max(substring(number FROM '[0-9]+$')::int), 0) + 1 INTO seq FROM public.mcp_decisions WHERE job_id = _job AND number ~ '^D-[0-9]{1,8}$';
        num := 'D-' || lpad(seq::text, 3, '0');
      ELSIF EXISTS (SELECT 1 FROM public.mcp_decisions WHERE job_id = _job AND lower(number) = lower(num)) THEN
        RAISE EXCEPTION 'MCP_BAD:Decision % is already on this job.', num;
      END IF;
      INSERT INTO public.mcp_decisions (company_id, job_id, number, decision, status, owner_name, owner_email, due_on, impact, decided_on, outcome, notes,
        change_order_id, exposure_ref, selection_id, source)
      VALUES (j.company_id, _job, num, btrim(_p->>'decision'), coalesce(_p->>'status', 'open'), nullif(_p->>'owner_name', ''), nullif(_p->>'owner_email', ''),
        nullif(_p->>'due_on', '')::date, nullif(_p->>'impact', ''), nullif(_p->>'decided_on', '')::date, nullif(_p->>'outcome', ''), nullif(_p->>'notes', ''),
        co, nullif(_p->>'exposure_ref', ''), sel, CASE WHEN jsonb_typeof(_p->'source') = 'object' THEN _p->'source' END)
      RETURNING * INTO dc;
    ELSE
      SELECT * INTO dc FROM public.mcp_decisions WHERE job_id = _job AND ((nullif(_p->>'decision_id', '') IS NOT NULL AND id = (_p->>'decision_id')::uuid)
        OR (nullif(_p->>'decision_id', '') IS NULL AND lower(number) = lower(_p->>'number'))) FOR UPDATE;
      IF dc.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That decision is not on this job.'; END IF;
      IF nullif(_p->>'expected_version', '')::int IS DISTINCT FROM dc.record_version THEN RAISE EXCEPTION 'MCP_BAD:The decision changed. Read it again before saving.'; END IF;
      IF _p ? 'decision' AND length(btrim(coalesce(_p->>'decision', ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Say what needs deciding.'; END IF;
      UPDATE public.mcp_decisions SET
        decision = CASE WHEN _p ? 'decision' THEN btrim(_p->>'decision') ELSE decision END,
        status = CASE WHEN _p ? 'status' THEN _p->>'status' ELSE status END,
        owner_name = CASE WHEN _p ? 'owner_name' THEN nullif(_p->>'owner_name', '') ELSE owner_name END,
        owner_email = CASE WHEN _p ? 'owner_email' THEN nullif(_p->>'owner_email', '') ELSE owner_email END,
        due_on = CASE WHEN _p ? 'due_on' THEN nullif(_p->>'due_on', '')::date ELSE due_on END,
        impact = CASE WHEN _p ? 'impact' THEN nullif(_p->>'impact', '') ELSE impact END,
        decided_on = CASE WHEN _p ? 'decided_on' THEN nullif(_p->>'decided_on', '')::date ELSE decided_on END,
        outcome = CASE WHEN _p ? 'outcome' THEN nullif(_p->>'outcome', '') ELSE outcome END,
        notes = CASE WHEN _p ? 'notes' THEN nullif(_p->>'notes', '') ELSE notes END,
        change_order_id = CASE WHEN _p ? 'change_order_id' THEN co ELSE change_order_id END,
        exposure_ref = CASE WHEN _p ? 'exposure_ref' THEN nullif(_p->>'exposure_ref', '') ELSE exposure_ref END,
        selection_id = CASE WHEN _p ? 'selection_id' THEN sel ELSE selection_id END,
        record_version = record_version + 1, updated_at = now()
      WHERE id = dc.id RETURNING * INTO dc;
    END IF;
    IF dc.status = 'decided' AND dc.decided_on IS NULL AND (dc.source IS NULL) THEN
      RAISE EXCEPTION 'MCP_BAD:A decided item needs the date it was decided.';
    END IF;
    rec := dc.id; num := dc.number; v := dc.record_version;
  END IF;

  out := jsonb_build_object('saved_id', rec, 'number', num, 'record_version', v, 'log', _log, 'already_applied', false);
  INSERT INTO public.mcp_job_log_operations (job_id, request_id, actor_id, digest, log, record_id, result)
    VALUES (_job, rid, auth.uid(), sig, _log, rec, out);
  PERFORM public.mcp_project_record_add(_job, 'job_log_' || left(_log, 20) || '_' || _action,
    CASE _log WHEN 'claims' THEN 'Claim ' WHEN 'inspections' THEN 'Inspection ' ELSE 'Decision ' END || num,
    CASE _action WHEN 'create' THEN 'Recorded.' WHEN 'event' THEN 'Claim event recorded.' ELSE 'Updated.' END,
    NULL, NULL, CASE _log WHEN 'claims' THEN 'mcp_claims' WHEN 'inspections' THEN 'mcp_inspections' ELSE 'mcp_decisions' END, rec,
    jsonb_build_object('log', _log, 'action', _action, 'number', num), 'user');
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_log_record(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_log_record(uuid, text, text, jsonb) TO authenticated;

-- Read one log. Supers read inspections only, with no cost.
CREATE OR REPLACE FUNCTION public.mcp_job_log_rows(_job uuid, _log text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sc text; j public.mcp_jobs; recs jsonb; tz text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF coalesce(_log, '') NOT IN ('claims','inspections','decisions') THEN RAISE EXCEPTION 'MCP_BAD:Choose the claims, inspections or decisions log.'; END IF;
  IF sc <> 'full' AND NOT coalesce(_log = 'inspections' AND sc = 'super', false) THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  tz := coalesce(nullif(j.time_zone, ''), 'UTC');
  IF _log = 'claims' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(c) - 'company_id' - 'created_by' || jsonb_build_object(
      'change_order_number', (SELECT number FROM public.mcp_submittals s WHERE s.id = c.change_order_id),
      'events', coalesce((SELECT jsonb_agg(to_jsonb(e) - 'job_id' - 'created_by' ORDER BY e.event_date NULLS LAST, e.created_at) FROM public.mcp_claim_events e WHERE e.claim_id = c.id), '[]'))
      ORDER BY c.number), '[]') INTO recs FROM public.mcp_claims c WHERE c.job_id = _job;
  ELSIF _log = 'inspections' THEN
    SELECT coalesce(jsonb_agg(CASE WHEN sc = 'full' THEN to_jsonb(i) ELSE to_jsonb(i) - 'cost_impact_cents' END - 'company_id' - 'created_by'
      ORDER BY coalesce(i.scheduled_on, i.requested_on, i.completed_on) NULLS LAST, i.created_at), '[]') INTO recs FROM public.mcp_inspections i WHERE i.job_id = _job;
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(d) - 'company_id' - 'created_by' || jsonb_build_object(
      'change_order_number', (SELECT number FROM public.mcp_submittals s WHERE s.id = d.change_order_id),
      'overdue', d.status IN ('open','in_progress') AND d.due_on < (now() AT TIME ZONE tz)::date) ORDER BY d.number), '[]')
      INTO recs FROM public.mcp_decisions d WHERE d.job_id = _job;
  END IF;
  RETURN jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'job_name', j.name, 'log', _log,
    'today', to_char(now() AT TIME ZONE tz, 'YYYY-MM-DD'), 'read_only', sc <> 'full' AND _log <> 'inspections', 'no_financials', sc <> 'full', 'records', recs);
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_log_rows(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_log_rows(uuid, text) TO authenticated;

