-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
--
-- Athena job logs and the rest of the whole-job import. Needs
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

-- 3. Job logs: claims, inspections, owner decisions.
CREATE TABLE IF NOT EXISTS public.mcp_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 40),
  claim_type text NOT NULL CHECK (claim_type IN ('delay','extension_of_time','delay_damages','acceleration','disruption','other')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 12000),
  status text NOT NULL CHECK (status IN ('in_preparation','submitted','pending_review','under_review','reviewed','resolved','rejected','withdrawn')),
  money_claimed_cents bigint NOT NULL DEFAULT 0 CHECK (money_claimed_cents >= 0),
  money_awarded_cents bigint NOT NULL DEFAULT 0 CHECK (money_awarded_cents >= 0),
  time_claimed_days integer NOT NULL DEFAULT 0 CHECK (time_claimed_days BETWEEN 0 AND 3650),
  time_awarded_days integer NOT NULL DEFAULT 0 CHECK (time_awarded_days BETWEEN 0 AND 3650),
  submitted_on date,
  resolved_on date,
  outcome text CHECK (length(outcome) <= 4000),
  owner_name text CHECK (length(owner_name) <= 120),
  change_order_id uuid REFERENCES public.mcp_submittals(id) ON DELETE SET NULL,
  exposure_ref text CHECK (length(exposure_ref) <= 300),
  delay_event_id uuid REFERENCES public.mcp_delay_events(id) ON DELETE SET NULL,
  claim_item_id uuid REFERENCES public.mcp_open_items(id) ON DELETE SET NULL,
  source jsonb CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
  record_version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_claims_job_number ON public.mcp_claims (job_id, lower(number));
CREATE TABLE IF NOT EXISTS public.mcp_claim_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.mcp_claims(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('submitted','received','reviewed','meeting','returned_for_revision','resubmitted','resolved','other')),
  event_date date,
  revision_number integer NOT NULL DEFAULT 0 CHECK (revision_number BETWEEN 0 AND 99),
  note text CHECK (length(note) <= 4000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_claim_events_claim ON public.mcp_claim_events (claim_id, event_date);
CREATE TABLE IF NOT EXISTS public.mcp_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  inspection_type text NOT NULL CHECK (length(btrim(inspection_type)) BETWEEN 1 AND 120),
  authority text CHECK (length(authority) <= 200),
  location text CHECK (length(location) <= 200),
  inspector text CHECK (length(inspector) <= 120),
  responsible_party text CHECK (length(responsible_party) <= 120),
  status text NOT NULL CHECK (status IN ('planned','requested','scheduled','passed','failed','partial','cancelled')),
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','partial','cancelled')),
  requested_on date,
  scheduled_on date,
  completed_on date,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 99),
  reinspection_required boolean NOT NULL DEFAULT false,
  cost_impact_cents bigint NOT NULL DEFAULT 0,
  schedule_impact_weeks numeric CHECK (schedule_impact_weeks BETWEEN -520 AND 520),
  notes text CHECK (length(notes) <= 4000),
  corrective_action text CHECK (length(corrective_action) <= 4000),
  parent_id uuid REFERENCES public.mcp_inspections(id) ON DELETE SET NULL,
  risk_ref text CHECK (length(risk_ref) <= 300),
  source jsonb CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
  record_version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_inspections_job ON public.mcp_inspections (job_id, scheduled_on);
CREATE TABLE IF NOT EXISTS public.mcp_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 40),
  decision text NOT NULL CHECK (length(btrim(decision)) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK (status IN ('open','in_progress','decided','withdrawn')),
  owner_name text CHECK (length(owner_name) <= 120),
  owner_email text CHECK (owner_email IS NULL OR (length(owner_email) <= 320 AND owner_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  due_on date,
  impact text CHECK (length(impact) <= 2000),
  decided_on date,
  outcome text CHECK (length(outcome) <= 4000),
  notes text CHECK (length(notes) <= 4000),
  change_order_id uuid REFERENCES public.mcp_submittals(id) ON DELETE SET NULL,
  exposure_ref text CHECK (length(exposure_ref) <= 300),
  -- A selection on the job's selection board (mcp_private.residential_selection_boards
  -- body.selections[].id). Checked when written; the board is never changed here.
  selection_id uuid,
  source jsonb CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
  record_version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_decisions_job_number ON public.mcp_decisions (job_id, lower(number));
CREATE TABLE IF NOT EXISTS public.mcp_job_log_operations (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  digest text NOT NULL,
  log text NOT NULL,
  record_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, request_id)
);

-- Writes only through mcp_job_log_record. Direct reads: full job scope (these
-- logs carry money); Supers read inspections, without cost, through
-- mcp_job_log_rows.
ALTER TABLE public.mcp_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_log_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_claims, public.mcp_claim_events, public.mcp_inspections, public.mcp_decisions, public.mcp_job_log_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mcp_claims, public.mcp_claim_events, public.mcp_inspections, public.mcp_decisions TO authenticated;
GRANT ALL ON public.mcp_claims, public.mcp_claim_events, public.mcp_inspections, public.mcp_decisions, public.mcp_job_log_operations TO service_role;
DROP POLICY IF EXISTS "claims read full scope" ON public.mcp_claims;
CREATE POLICY "claims read full scope" ON public.mcp_claims FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "claim events read full scope" ON public.mcp_claim_events;
CREATE POLICY "claim events read full scope" ON public.mcp_claim_events FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "inspections read full scope" ON public.mcp_inspections;
CREATE POLICY "inspections read full scope" ON public.mcp_inspections FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "decisions read full scope" ON public.mcp_decisions;
CREATE POLICY "decisions read full scope" ON public.mcp_decisions FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));

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
