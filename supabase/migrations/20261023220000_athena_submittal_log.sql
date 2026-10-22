-- Living submittal log. Additive only: new tables, new job columns, and replaced read functions.
-- Does not remove tables or rows. Job 2701 samples go through submittal_log.
-- There was no transmittal table. mcp_transmittals is the transmittal log.
-- Public vs private is the existing public_job flag (yes = public, no = private). It is not a new column.
-- Letterhead fills the transmittal row later. file_ref is the file hook. spec_excerpt is the spec-reading hook.
-- submittal_kickoff_at is the kickoff walkthrough hook. Chase columns are stored only. Nothing here sends email.

ALTER TABLE public.mcp_jobs
  ADD COLUMN IF NOT EXISTS submittal_review_days integer NOT NULL DEFAULT 14;

ALTER TABLE public.mcp_jobs
  ADD COLUMN IF NOT EXISTS submittal_posture text,
  ADD COLUMN IF NOT EXISTS submittal_kickoff_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.mcp_jobs
    ADD CONSTRAINT mcp_jobs_submittal_review_days_check
    CHECK (submittal_review_days BETWEEN 1 AND 365);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.mcp_jobs
    ADD CONSTRAINT mcp_jobs_submittal_posture_check
    CHECK (submittal_posture IS NULL OR submittal_posture IN ('strict', 'advisory'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.mcp_jobs.submittal_posture IS 'strict or advisory. Null until set. When null, public_job yes resolves to strict and public_job no resolves to advisory.';
COMMENT ON COLUMN public.mcp_jobs.submittal_kickoff_at IS 'Hook for the later kickoff walkthrough. Null until that walkthrough runs.';

CREATE TABLE IF NOT EXISTS public.mcp_transmittals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number > 0),
  -- Filled later by the letterhead cover sheet. Unused by this log.
  to_name text,
  to_email text,
  subject text,
  sent_on date,
  cover_note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, number)
);
CREATE INDEX IF NOT EXISTS mcp_transmittals_job_idx ON public.mcp_transmittals (job_id, number);

CREATE TABLE IF NOT EXISTS public.mcp_submittals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 40),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision <= 99),
  previous_id uuid REFERENCES public.mcp_submittals(id),
  transmittal_id uuid NOT NULL UNIQUE REFERENCES public.mcp_transmittals(id),
  spec_section text NOT NULL CHECK (length(btrim(spec_section)) BETWEEN 1 AND 40),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  submittal_type text NOT NULL CHECK (submittal_type IN ('product_data', 'shop_drawing', 'sample', 'other')),
  status text NOT NULL CHECK (status IN (
    'not_started', 'in_prep', 'submitted', 'in_review', 'approved', 'approved_as_noted',
    'revise_and_resubmit', 'rejected', 'closed'
  )),
  ball_in_court text NOT NULL CHECK (ball_in_court IN ('sub', 'gc', 'architect_engineer', 'owner')),
  ball_in_court_name text,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('spec_derived', 'user', 'imported')),
  required boolean NOT NULL DEFAULT true,
  not_required_reason text,
  spec_excerpt text,
  required_by date,
  submitted_on date,
  due_back date,
  returned_on date,
  notes text,
  review_days integer NOT NULL DEFAULT 14 CHECK (review_days BETWEEN 1 AND 365),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, number, revision),
  CONSTRAINT mcp_submittals_spec_waiver CHECK (
    required OR source <> 'spec_derived' OR (
      not_required_reason IS NOT NULL AND length(btrim(not_required_reason)) BETWEEN 3 AND 500
    )
  )
);
CREATE INDEX IF NOT EXISTS mcp_submittals_job_idx ON public.mcp_submittals (job_id, number, revision);

CREATE TABLE IF NOT EXISTS public.mcp_submittal_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('product_cut', 'shop_drawing', 'sample', 'calc', 'warranty', 'other')),
  source_party text NOT NULL CHECK (length(btrim(source_party)) BETWEEN 1 AND 120),
  file_ref text,
  status text NOT NULL CHECK (status IN ('needed', 'requested', 'received', 'approved')),
  required boolean NOT NULL DEFAULT true,
  requested_at timestamptz,
  received_at timestamptz,
  chase_role text CHECK (chase_role IS NULL OR chase_role IN ('supplier', 'manufacturer', 'sub')),
  chase_name text,
  chase_email text,
  last_chased_at timestamptz,
  next_chase_at date,
  chase_count integer NOT NULL DEFAULT 0 CHECK (chase_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_submittal_package_items_submittal_idx ON public.mcp_submittal_package_items (submittal_id);

ALTER TABLE public.mcp_transmittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_submittal_package_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transmittal read" ON public.mcp_transmittals FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
CREATE POLICY "submittal read" ON public.mcp_submittals FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
CREATE POLICY "submittal package read" ON public.mcp_submittal_package_items FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));

REVOKE INSERT, UPDATE, DELETE ON public.mcp_transmittals FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_submittals FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_submittal_package_items FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_transmittals, public.mcp_submittals, public.mcp_submittal_package_items TO authenticated;
GRANT ALL ON public.mcp_transmittals, public.mcp_submittals, public.mcp_submittal_package_items TO service_role;

COMMENT ON TABLE public.mcp_transmittals IS 'Per-job transmittal log. Each submittal revision takes the next number. Letterhead fills to_name, subject, sent_on, and cover_note later.';
COMMENT ON COLUMN public.mcp_submittal_package_items.file_ref IS 'File reference only. The package PDF and upload land later.';
COMMENT ON COLUMN public.mcp_submittal_package_items.chase_email IS 'Stored chase contact. No email is sent from this column.';
COMMENT ON COLUMN public.mcp_submittals.spec_excerpt IS 'Hook for later spec reading. Null until a spec pass fills it.';

-- Project record for disputes and claims. Not the internal audit log (that one stores ids only)
-- and not item events (those belong to open items). Append-only uses the existing mcp_block_change().
-- email_reply is allowed and unused: a later pass records reply outcomes. Nothing here sends email.
CREATE TABLE IF NOT EXISTS public.mcp_project_record_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL CHECK (actor IN ('user', 'athena')),
  actor_id uuid,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 4000),
  counterparty_name text,
  counterparty_email text,
  ref_table text,
  ref_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS mcp_project_record_events_job_idx ON public.mcp_project_record_events (job_id, occurred_at DESC);
ALTER TABLE public.mcp_project_record_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project record read" ON public.mcp_project_record_events FOR SELECT TO authenticated
  USING (public.mcp_job_scope(job_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.mcp_project_record_events FROM anon, authenticated, public, service_role;
GRANT SELECT ON public.mcp_project_record_events TO authenticated;
GRANT SELECT ON public.mcp_project_record_events TO service_role;
CREATE TRIGGER mcp_project_record_events_append_only
  BEFORE UPDATE OR DELETE ON public.mcp_project_record_events
  FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
COMMENT ON TABLE public.mcp_project_record_events IS 'Append-only project record. Kind email_reply is reserved for a later reply-outcome pass.';

CREATE OR REPLACE FUNCTION public.mcp_project_record_add(
  _job uuid, _kind text, _title text, _summary text,
  _counterparty_name text, _counterparty_email text,
  _ref_table text, _ref_id uuid, _payload jsonb, _actor text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; cid uuid; nid uuid; who text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  who := coalesce(nullif(btrim(coalesce(_actor, '')), ''), 'user');
  IF who NOT IN ('user', 'athena') THEN RAISE EXCEPTION 'MCP_BAD:The record actor is the user or Athena.'; END IF;
  IF _kind !~ '^[a-z][a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'MCP_BAD:That record kind is not valid.'; END IF;
  IF coalesce(btrim(_title), '') = '' OR coalesce(btrim(_summary), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:A record needs a title and a summary.'; END IF;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id = _job;
  INSERT INTO public.mcp_project_record_events (
    company_id, job_id, actor, actor_id, kind, title, summary,
    counterparty_name, counterparty_email, ref_table, ref_id, payload
  ) VALUES (
    cid, _job, who, CASE WHEN who = 'user' THEN auth.uid() ELSE NULL END,
    _kind, left(btrim(_title), 300), left(btrim(_summary), 4000),
    nullif(btrim(coalesce(_counterparty_name, '')), ''),
    nullif(btrim(coalesce(_counterparty_email, '')), ''),
    nullif(btrim(coalesce(_ref_table, '')), ''), _ref_id, coalesce(_payload, '{}'::jsonb)
  ) RETURNING id INTO nid;
  RETURN nid;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_project_record_add(uuid, text, text, text, text, text, text, uuid, jsonb, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_project_record_add(uuid, text, text, text, text, text, text, uuid, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_record(_job uuid, _id uuid, _kind text, _issued boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.mcp_submittals; tnum int; tid uuid;
BEGIN
  SELECT * INTO s FROM public.mcp_submittals WHERE id = _id AND job_id = _job;
  IF s.id IS NULL THEN RETURN; END IF;
  SELECT id, number INTO tid, tnum FROM public.mcp_transmittals WHERE id = s.transmittal_id;
  PERFORM public.mcp_project_record_add(
    _job, _kind,
    'Submittal ' || s.number || ' revision ' || s.revision::text,
    s.title || '. Spec ' || s.spec_section || '. ' || replace(s.status, '_', ' ') || '.',
    s.ball_in_court_name, NULL, 'mcp_submittals', s.id,
    jsonb_build_object('number', s.number, 'revision', s.revision, 'status', s.status, 'transmittal_number', tnum, 'spec_section', s.spec_section),
    'user'
  );
  IF coalesce(_issued, false) THEN
    PERFORM public.mcp_project_record_add(
      _job, 'transmittal_issued',
      'Transmittal T-' || tnum::text,
      'Issued for submittal ' || s.number || ' revision ' || s.revision::text || ', ' || s.title || '.',
      s.ball_in_court_name, NULL, 'mcp_transmittals', tid,
      jsonb_build_object('number', tnum, 'submittal_id', s.id),
      'user'
    );
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_record(uuid, uuid, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_record(uuid, uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_project_record_search(
  _job uuid, _from date, _to date, _kind text, _q text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; sc text; rows jsonb; needle text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  needle := nullif(lower(btrim(coalesce(_q, ''))), '');
  IF needle IS NOT NULL THEN needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'occurred_at', e.occurred_at, 'actor', e.actor, 'kind', e.kind,
    'title', e.title, 'summary', e.summary, 'counterparty_name', e.counterparty_name,
    'counterparty_email', e.counterparty_email, 'ref_table', e.ref_table, 'ref_id', e.ref_id
  ) ORDER BY e.occurred_at DESC, e.id DESC), '[]'::jsonb) INTO rows
  FROM (
    SELECT * FROM public.mcp_project_record_events e
    WHERE e.job_id = _job
      AND (_from IS NULL OR e.occurred_at::date >= _from)
      AND (_to IS NULL OR e.occurred_at::date <= _to)
      AND (nullif(btrim(coalesce(_kind, '')), '') IS NULL OR e.kind = _kind)
      AND (needle IS NULL OR lower(e.title || ' ' || e.summary || ' ' || coalesce(e.counterparty_name, '') || ' ' || coalesce(e.counterparty_email, '')) LIKE '%' || needle || '%' ESCAPE '\')
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT 100
  ) e;
  RETURN jsonb_build_object('job_number', j.job_number, 'job_name', j.name, 'events', rows);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_project_record_search(uuid, date, date, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_project_record_search(uuid, date, date, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_rows(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co text; sc text; zone text; rows jsonb; flag text; posture text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT name INTO co FROM public.mcp_companies WHERE id = j.company_id;
  SELECT value INTO flag FROM public.mcp_job_flags WHERE job_id = _job AND flag_key = 'public_job';
  posture := j.submittal_posture;
  IF posture IS NULL THEN
    IF flag = 'yes' THEN posture := 'strict';
    ELSIF flag = 'no' THEN posture := 'advisory';
    END IF;
  END IF;
  zone := coalesce(nullif(btrim(j.time_zone), ''), 'America/New_York');
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.number, s.revision), '[]'::jsonb) INTO rows
  FROM (
    SELECT DISTINCT ON (lower(btrim(sub.number)))
      sub.id, sub.number, sub.revision, sub.previous_id, t.number AS transmittal_number,
      sub.spec_section, sub.title, sub.submittal_type, sub.status, sub.ball_in_court, sub.ball_in_court_name,
      sub.source, sub.required, sub.not_required_reason, sub.spec_excerpt,
      sub.required_by, sub.submitted_on, sub.due_back, sub.returned_on, sub.notes, sub.review_days,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'kind', p.kind, 'source_party', p.source_party, 'file_ref', p.file_ref,
          'status', p.status, 'required', p.required, 'requested_at', p.requested_at, 'received_at', p.received_at,
          'chase_role', p.chase_role, 'chase_name', p.chase_name, 'chase_email', p.chase_email,
          'last_chased_at', p.last_chased_at, 'next_chase_at', p.next_chase_at, 'chase_count', p.chase_count
        ) ORDER BY p.created_at, p.id)
        FROM public.mcp_submittal_package_items p WHERE p.submittal_id = sub.id
      ), '[]'::jsonb) AS package_items
    FROM public.mcp_submittals sub
    JOIN public.mcp_transmittals t ON t.id = sub.transmittal_id
    WHERE sub.job_id = _job
    ORDER BY lower(btrim(sub.number)), sub.revision DESC, sub.id DESC
  ) s;
  RETURN jsonb_build_object(
    'company', co, 'job_number', j.job_number, 'job_name', j.name, 'scope', sc,
    'read_only', sc <> 'full', 'review_days', j.submittal_review_days, 'time_zone', zone,
    'posture', posture, 'posture_set', j.submittal_posture, 'public_job', flag, 'kickoff_at', j.submittal_kickoff_at,
    'today', to_char((now() AT TIME ZONE zone)::date, 'YYYY-MM-DD'), 'submittals', rows
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_rows(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_rows(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_page(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN public.mcp_submittal_rows(_job) || jsonb_build_object('page', 'submittals');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_page(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_page(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_items_write(_job uuid, _company uuid, _submittal uuid, _items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE item jsonb; kind text; party text; st text; role text; email text; n int; iid uuid; req boolean;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) = 'null' THEN RETURN; END IF;
  IF jsonb_typeof(_items) <> 'array' THEN RAISE EXCEPTION 'MCP_BAD:Package items have to be a list. Nothing was saved.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(_items) LOOP
    kind := btrim(coalesce(item->>'kind', ''));
    party := btrim(coalesce(item->>'source_party', ''));
    st := btrim(coalesce(item->>'status', 'needed'));
    role := nullif(btrim(coalesce(item->>'chase_role', '')), '');
    email := nullif(btrim(coalesce(item->>'chase_email', '')), '');
    IF kind NOT IN ('product_cut', 'shop_drawing', 'sample', 'calc', 'warranty', 'other') THEN
      RAISE EXCEPTION 'MCP_BAD:Package kind has to be product cut, shop drawing, sample, calc, warranty, or other. Nothing was saved.';
    END IF;
    IF party = '' OR length(party) > 120 THEN RAISE EXCEPTION 'MCP_BAD:Each package item needs a source. Nothing was saved.'; END IF;
    IF st NOT IN ('needed', 'requested', 'received', 'approved') THEN
      RAISE EXCEPTION 'MCP_BAD:Package status has to be needed, requested, received, or approved. Nothing was saved.';
    END IF;
    IF role IS NOT NULL AND role NOT IN ('supplier', 'manufacturer', 'sub') THEN
      RAISE EXCEPTION 'MCP_BAD:Chase contact has to be a supplier, manufacturer, or sub. Nothing was saved.';
    END IF;
    IF email IS NOT NULL AND email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'MCP_BAD:The chase email is not a valid address. Nothing was saved.';
    END IF;
    n := coalesce(nullif(item->>'chase_count', '')::int, 0);
    IF n < 0 OR n > 999 THEN RAISE EXCEPTION 'MCP_BAD:Chase count is out of range. Nothing was saved.'; END IF;
    req := coalesce(item->>'required', 'true') IS DISTINCT FROM 'false';
    iid := nullif(item->>'id', '')::uuid;
    IF iid IS NOT NULL THEN
      UPDATE public.mcp_submittal_package_items SET
        kind = kind, source_party = party, file_ref = nullif(btrim(coalesce(item->>'file_ref', '')), ''),
        status = st, required = req,
        requested_at = CASE
          WHEN nullif(item->>'requested_at', '') IS NOT NULL THEN (item->>'requested_at')::timestamptz
          WHEN st IN ('requested', 'received', 'approved') THEN coalesce(requested_at, now())
          ELSE requested_at END,
        received_at = CASE
          WHEN nullif(item->>'received_at', '') IS NOT NULL THEN (item->>'received_at')::timestamptz
          WHEN st IN ('received', 'approved') THEN coalesce(received_at, now())
          ELSE received_at END,
        chase_role = role,
        chase_name = nullif(btrim(coalesce(item->>'chase_name', '')), ''),
        chase_email = email,
        last_chased_at = CASE WHEN nullif(item->>'last_chased_at', '') IS NOT NULL THEN (item->>'last_chased_at')::timestamptz ELSE last_chased_at END,
        next_chase_at = CASE WHEN item ? 'next_chase_at' THEN nullif(item->>'next_chase_at', '')::date ELSE next_chase_at END,
        chase_count = n, updated_at = now()
      WHERE id = iid AND submittal_id = _submittal AND job_id = _job;
      IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:That package item is not on this submittal. Nothing was saved.'; END IF;
    ELSE
      INSERT INTO public.mcp_submittal_package_items (
        company_id, job_id, submittal_id, kind, source_party, file_ref, status, required,
        requested_at, received_at, chase_role, chase_name, chase_email, last_chased_at, next_chase_at, chase_count
      ) VALUES (
        _company, _job, _submittal, kind, party, nullif(btrim(coalesce(item->>'file_ref', '')), ''), st, req,
        CASE
          WHEN nullif(item->>'requested_at', '') IS NOT NULL THEN (item->>'requested_at')::timestamptz
          WHEN st IN ('requested', 'received', 'approved') THEN now() ELSE NULL END,
        CASE
          WHEN nullif(item->>'received_at', '') IS NOT NULL THEN (item->>'received_at')::timestamptz
          WHEN st IN ('received', 'approved') THEN now() ELSE NULL END,
        role, nullif(btrim(coalesce(item->>'chase_name', '')), ''), email,
        CASE WHEN nullif(item->>'last_chased_at', '') IS NOT NULL THEN (item->>'last_chased_at')::timestamptz ELSE NULL END,
        nullif(item->>'next_chase_at', '')::date, n
      );
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_items_write(uuid, uuid, uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_items_write(uuid, uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_log(_job uuid, _action text, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  j public.mcp_jobs; sc text; cur public.mcp_submittals;
  days int; num text; rev int; spec text; ttl text; typ text; st text; ball text; ball_name text;
  required_by date; submitted date; returned date; notes text; tid uuid; tnum int; sid uuid; saved uuid;
  src text; req boolean; reason text; excerpt text; posture text; prior uuid; evt text; issued boolean := false;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _action NOT IN ('add', 'update', 'resubmit', 'import') THEN RAISE EXCEPTION 'MCP_BAD:Use add, update, resubmit, or import. Nothing was saved.'; END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc = 'super' THEN RAISE EXCEPTION 'MCP_BAD:Your role has a limited, read-only view of this job (no financials). Ask your owner or PM to make changes.'; END IF;
  IF sc <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t do it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;

  days := j.submittal_review_days;
  IF _payload ? 'review_days' AND nullif(_payload->>'review_days', '') IS NOT NULL THEN
    days := (_payload->>'review_days')::int;
    IF days < 1 OR days > 365 THEN RAISE EXCEPTION 'MCP_BAD:Review days have to be from 1 to 365. Nothing was saved.'; END IF;
    UPDATE public.mcp_jobs SET submittal_review_days = days, updated_at = now() WHERE id = _job;
  END IF;
  IF _payload ? 'posture' THEN
    posture := nullif(btrim(coalesce(_payload->>'posture', '')), '');
    IF posture IS NOT NULL AND posture NOT IN ('strict', 'advisory') THEN RAISE EXCEPTION 'MCP_BAD:Posture is strict or advisory. Nothing was saved.'; END IF;
    UPDATE public.mcp_jobs SET submittal_posture = posture, updated_at = now() WHERE id = _job;
  END IF;

  IF _action = 'import' THEN
    num := nullif(btrim(coalesce(_payload->>'number', '')), '');
    spec := btrim(coalesce(_payload->>'spec_section', ''));
    ttl := btrim(coalesce(_payload->>'title', ''));
    IF num IS NULL OR spec = '' OR length(spec) > 40 OR ttl = '' OR length(ttl) > 200 THEN
      RAISE EXCEPTION 'MCP_BAD:An import row needs a number, a spec section, and a title. Nothing was saved.';
    END IF;
    rev := coalesce(nullif(_payload->>'revision', '')::int, 0);
    IF rev < 0 OR rev > 99 THEN RAISE EXCEPTION 'MCP_BAD:Revision is out of range. Nothing was saved.'; END IF;
    typ := coalesce(nullif(btrim(coalesce(_payload->>'submittal_type', '')), ''), 'other');
    st := coalesce(nullif(btrim(coalesce(_payload->>'status', '')), ''), 'not_started');
    ball := coalesce(nullif(btrim(coalesce(_payload->>'ball_in_court', '')), ''), 'sub');
    IF typ NOT IN ('product_data', 'shop_drawing', 'sample', 'other') THEN RAISE EXCEPTION 'MCP_BAD:Type has to be product data, shop drawing, sample, or other. Nothing was saved.'; END IF;
    IF st NOT IN ('not_started', 'in_prep', 'submitted', 'in_review', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'closed') THEN
      RAISE EXCEPTION 'MCP_BAD:That status is not on the submittal log. Nothing was saved.';
    END IF;
    IF ball NOT IN ('sub', 'gc', 'architect_engineer', 'owner') THEN RAISE EXCEPTION 'MCP_BAD:Ball in court has to be the sub, GC, architect or engineer, or owner. Nothing was saved.'; END IF;
    req := coalesce(_payload->>'required', 'true') IS DISTINCT FROM 'false';
    reason := nullif(btrim(coalesce(_payload->>'not_required_reason', '')), '');
    IF NOT req AND (reason IS NULL OR length(reason) < 3 OR length(reason) > 500) THEN
      RAISE EXCEPTION 'MCP_BAD:Marking a row not required needs a reason. Nothing was saved.';
    END IF;
    required_by := nullif(_payload->>'required_by', '')::date;
    submitted := nullif(_payload->>'submitted_on', '')::date;
    returned := nullif(_payload->>'returned_on', '')::date;
    notes := nullif(btrim(coalesce(_payload->>'notes', '')), '');
    ball_name := nullif(btrim(coalesce(_payload->>'ball_in_court_name', '')), '');
    SELECT * INTO cur FROM public.mcp_submittals WHERE job_id = _job AND lower(number) = lower(num) AND revision = rev;
    IF cur.id IS NOT NULL THEN
      UPDATE public.mcp_submittals SET
        spec_section = spec, title = ttl, submittal_type = typ, status = st, ball_in_court = ball,
        ball_in_court_name = ball_name, source = 'imported', required = req, not_required_reason = reason,
        required_by = required_by, submitted_on = submitted,
        due_back = CASE WHEN submitted IS NULL THEN NULL ELSE submitted + days END,
        returned_on = returned, notes = notes, review_days = days, updated_at = now()
      WHERE id = cur.id;
      saved := cur.id;
      evt := 'submittal_status';
      issued := false;
    ELSE
      SELECT id INTO prior FROM public.mcp_submittals WHERE job_id = _job AND lower(number) = lower(num) AND revision = rev - 1;
      SELECT coalesce(max(number), 0) + 1 INTO tnum FROM public.mcp_transmittals WHERE job_id = _job;
      INSERT INTO public.mcp_transmittals (company_id, job_id, number) VALUES (j.company_id, _job, tnum) RETURNING id INTO tid;
      INSERT INTO public.mcp_submittals (
        company_id, job_id, number, revision, previous_id, transmittal_id, spec_section, title, submittal_type, status,
        ball_in_court, ball_in_court_name, source, required, not_required_reason, required_by, submitted_on, due_back, returned_on, notes, review_days
      ) VALUES (
        j.company_id, _job, num, rev, prior, tid, spec, ttl, typ, st, ball, ball_name, 'imported', req, reason,
        required_by, submitted, CASE WHEN submitted IS NULL THEN NULL ELSE submitted + days END, returned, notes, days
      ) RETURNING id INTO saved;
      evt := 'submittal_created';
      issued := true;
    END IF;
    IF _payload ? 'package_items' THEN
      PERFORM public.mcp_submittal_items_write(_job, j.company_id, saved, _payload->'package_items');
    END IF;
    PERFORM public.mcp_submittal_record(_job, saved, evt, issued);
    RETURN public.mcp_submittal_rows(_job) || jsonb_build_object('saved_id', saved);
  END IF;

  IF _action = 'add' THEN
    spec := btrim(coalesce(_payload->>'spec_section', ''));
    ttl := btrim(coalesce(_payload->>'title', ''));
    typ := btrim(coalesce(_payload->>'submittal_type', ''));
    IF spec = '' OR length(spec) > 40 THEN RAISE EXCEPTION 'MCP_BAD:Spec section is required. Nothing was saved.'; END IF;
    IF ttl = '' OR length(ttl) > 200 THEN RAISE EXCEPTION 'MCP_BAD:Title is required. Nothing was saved.'; END IF;
    IF typ NOT IN ('product_data', 'shop_drawing', 'sample', 'other') THEN RAISE EXCEPTION 'MCP_BAD:Type has to be product data, shop drawing, sample, or other. Nothing was saved.'; END IF;
    num := nullif(btrim(coalesce(_payload->>'number', '')), '');
    IF num IS NULL THEN
      SELECT lpad((coalesce(max(CASE WHEN number ~ '^[0-9]{1,6}$' THEN number::int END), 0) + 1)::text, 3, '0')
        INTO num FROM public.mcp_submittals WHERE job_id = _job;
    END IF;
    IF EXISTS (SELECT 1 FROM public.mcp_submittals WHERE job_id = _job AND lower(number) = lower(num)) THEN
      RAISE EXCEPTION 'MCP_BAD:That submittal number already exists. Resubmit it for the next revision. Nothing was saved.';
    END IF;
    st := coalesce(nullif(btrim(coalesce(_payload->>'status', '')), ''), 'not_started');
    ball := coalesce(nullif(btrim(coalesce(_payload->>'ball_in_court', '')), ''), 'sub');
    IF st NOT IN ('not_started', 'in_prep', 'submitted', 'in_review', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'closed') THEN
      RAISE EXCEPTION 'MCP_BAD:That status is not on the submittal log. Nothing was saved.';
    END IF;
    IF ball NOT IN ('sub', 'gc', 'architect_engineer', 'owner') THEN RAISE EXCEPTION 'MCP_BAD:Ball in court has to be the sub, GC, architect or engineer, or owner. Nothing was saved.'; END IF;
    required_by := nullif(_payload->>'required_by', '')::date;
    submitted := nullif(_payload->>'submitted_on', '')::date;
    returned := nullif(_payload->>'returned_on', '')::date;
    notes := nullif(btrim(coalesce(_payload->>'notes', '')), '');
    ball_name := nullif(btrim(coalesce(_payload->>'ball_in_court_name', '')), '');
    IF notes IS NOT NULL AND length(notes) > 4000 THEN RAISE EXCEPTION 'MCP_BAD:Notes are too long. Nothing was saved.'; END IF;
    IF ball_name IS NOT NULL AND length(ball_name) > 120 THEN RAISE EXCEPTION 'MCP_BAD:The ball-in-court name is too long. Nothing was saved.'; END IF;
    src := coalesce(nullif(btrim(coalesce(_payload->>'source', '')), ''), 'user');
    IF src NOT IN ('spec_derived', 'user', 'imported') THEN RAISE EXCEPTION 'MCP_BAD:Source has to be from the spec, the user, or an import. Nothing was saved.'; END IF;
    req := coalesce(_payload->>'required', 'true') IS DISTINCT FROM 'false';
    reason := nullif(btrim(coalesce(_payload->>'not_required_reason', '')), '');
    excerpt := nullif(btrim(coalesce(_payload->>'spec_excerpt', '')), '');
    IF NOT req AND src = 'spec_derived' AND (reason IS NULL OR length(reason) < 3 OR length(reason) > 500) THEN
      RAISE EXCEPTION 'MCP_BAD:A spec row marked not required needs a reason. Nothing was saved.';
    END IF;
    SELECT coalesce(max(number), 0) + 1 INTO tnum FROM public.mcp_transmittals WHERE job_id = _job;
    INSERT INTO public.mcp_transmittals (company_id, job_id, number) VALUES (j.company_id, _job, tnum) RETURNING id INTO tid;
    INSERT INTO public.mcp_submittals (
      company_id, job_id, number, revision, transmittal_id, spec_section, title, submittal_type, status,
      ball_in_court, ball_in_court_name, source, required, not_required_reason, spec_excerpt,
      required_by, submitted_on, due_back, returned_on, notes, review_days
    ) VALUES (
      j.company_id, _job, num, 0, tid, spec, ttl, typ, st, ball, ball_name, src, req, reason, excerpt, required_by, submitted,
      CASE WHEN submitted IS NULL THEN NULL ELSE submitted + days END, returned, notes, days
    ) RETURNING id INTO saved;
    evt := 'submittal_created';
    issued := true;
    PERFORM public.mcp_submittal_items_write(_job, j.company_id, saved, _payload->'package_items');
  ELSE
    sid := nullif(_payload->>'submittal_id', '')::uuid;
    IF sid IS NOT NULL THEN
      SELECT * INTO cur FROM public.mcp_submittals WHERE id = sid AND job_id = _job;
    ELSE
      num := nullif(btrim(coalesce(_payload->>'number', '')), '');
      IF num IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Name the submittal. Nothing was saved.'; END IF;
      rev := nullif(_payload->>'revision', '')::int;
      SELECT * INTO cur FROM public.mcp_submittals
        WHERE job_id = _job AND lower(number) = lower(num)
          AND (rev IS NULL OR revision = rev)
        ORDER BY revision DESC, id DESC LIMIT 1;
    END IF;
    IF cur.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That submittal is not on this job. Nothing was saved.'; END IF;

    IF _action = 'resubmit' THEN
      IF EXISTS (SELECT 1 FROM public.mcp_submittals WHERE job_id = _job AND lower(number) = lower(cur.number) AND revision > cur.revision) THEN
        RAISE EXCEPTION 'MCP_BAD:Resubmit the latest revision. Nothing was saved.';
      END IF;
      spec := coalesce(nullif(btrim(coalesce(_payload->>'spec_section', '')), ''), cur.spec_section);
      ttl := coalesce(nullif(btrim(coalesce(_payload->>'title', '')), ''), cur.title);
      typ := coalesce(nullif(btrim(coalesce(_payload->>'submittal_type', '')), ''), cur.submittal_type);
      IF spec = '' THEN RAISE EXCEPTION 'MCP_BAD:Spec section is required. Nothing was saved.'; END IF;
      IF typ NOT IN ('product_data', 'shop_drawing', 'sample', 'other') THEN RAISE EXCEPTION 'MCP_BAD:Type has to be product data, shop drawing, sample, or other. Nothing was saved.'; END IF;
      st := coalesce(nullif(btrim(coalesce(_payload->>'status', '')), ''), 'in_prep');
      ball := coalesce(nullif(btrim(coalesce(_payload->>'ball_in_court', '')), ''), cur.ball_in_court);
      IF st NOT IN ('not_started', 'in_prep', 'submitted', 'in_review', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'closed') THEN
        RAISE EXCEPTION 'MCP_BAD:That status is not on the submittal log. Nothing was saved.';
      END IF;
      IF ball NOT IN ('sub', 'gc', 'architect_engineer', 'owner') THEN RAISE EXCEPTION 'MCP_BAD:Ball in court has to be the sub, GC, architect or engineer, or owner. Nothing was saved.'; END IF;
      required_by := CASE WHEN _payload ? 'required_by' THEN nullif(_payload->>'required_by', '')::date ELSE cur.required_by END;
      submitted := CASE WHEN _payload ? 'submitted_on' THEN nullif(_payload->>'submitted_on', '')::date ELSE NULL END;
      returned := CASE WHEN _payload ? 'returned_on' THEN nullif(_payload->>'returned_on', '')::date ELSE NULL END;
      notes := CASE WHEN _payload ? 'notes' THEN nullif(btrim(coalesce(_payload->>'notes', '')), '') ELSE cur.notes END;
      ball_name := CASE WHEN _payload ? 'ball_in_court_name' THEN nullif(btrim(coalesce(_payload->>'ball_in_court_name', '')), '') ELSE cur.ball_in_court_name END;
      rev := cur.revision + 1;
      IF rev > 99 THEN RAISE EXCEPTION 'MCP_BAD:That submittal has too many revisions. Nothing was saved.'; END IF;
      SELECT coalesce(max(number), 0) + 1 INTO tnum FROM public.mcp_transmittals WHERE job_id = _job;
      INSERT INTO public.mcp_transmittals (company_id, job_id, number) VALUES (j.company_id, _job, tnum) RETURNING id INTO tid;
      src := CASE WHEN _payload ? 'source' THEN btrim(coalesce(_payload->>'source', '')) ELSE cur.source END;
      IF src NOT IN ('spec_derived', 'user', 'imported') THEN RAISE EXCEPTION 'MCP_BAD:Source has to be from the spec, the user, or an import. Nothing was saved.'; END IF;
      req := CASE WHEN _payload ? 'required' THEN coalesce(_payload->>'required', 'true') IS DISTINCT FROM 'false' ELSE cur.required END;
      reason := CASE WHEN _payload ? 'not_required_reason' THEN nullif(btrim(coalesce(_payload->>'not_required_reason', '')), '') ELSE cur.not_required_reason END;
      excerpt := CASE WHEN _payload ? 'spec_excerpt' THEN nullif(btrim(coalesce(_payload->>'spec_excerpt', '')), '') ELSE cur.spec_excerpt END;
      IF NOT req AND src = 'spec_derived' AND (reason IS NULL OR length(reason) < 3 OR length(reason) > 500) THEN
        RAISE EXCEPTION 'MCP_BAD:A spec row marked not required needs a reason. Nothing was saved.';
      END IF;
      INSERT INTO public.mcp_submittals (
        company_id, job_id, number, revision, previous_id, transmittal_id, spec_section, title, submittal_type, status,
        ball_in_court, ball_in_court_name, source, required, not_required_reason, spec_excerpt,
        required_by, submitted_on, due_back, returned_on, notes, review_days
      ) VALUES (
        j.company_id, _job, cur.number, rev, cur.id, tid, spec, ttl, typ, st, ball, ball_name, src, req, reason, excerpt,
        required_by, submitted, CASE WHEN submitted IS NULL THEN NULL ELSE submitted + days END, returned, notes, days
      ) RETURNING id INTO saved;
      evt := 'submittal_created';
      issued := true;
      IF _payload ? 'package_items' THEN
        PERFORM public.mcp_submittal_items_write(_job, j.company_id, saved, _payload->'package_items');
      ELSE
        INSERT INTO public.mcp_submittal_package_items (
          company_id, job_id, submittal_id, kind, source_party, status, required, chase_role, chase_name, chase_email, chase_count
        )
        SELECT company_id, job_id, saved, kind, source_party, 'needed', required, chase_role, chase_name, chase_email, 0
        FROM public.mcp_submittal_package_items WHERE submittal_id = cur.id;
      END IF;
    ELSE
      spec := CASE WHEN _payload ? 'spec_section' THEN btrim(coalesce(_payload->>'spec_section', '')) ELSE cur.spec_section END;
      ttl := CASE WHEN _payload ? 'title' THEN btrim(coalesce(_payload->>'title', '')) ELSE cur.title END;
      typ := CASE WHEN _payload ? 'submittal_type' THEN btrim(coalesce(_payload->>'submittal_type', '')) ELSE cur.submittal_type END;
      st := CASE WHEN _payload ? 'status' THEN btrim(coalesce(_payload->>'status', '')) ELSE cur.status END;
      ball := CASE WHEN _payload ? 'ball_in_court' THEN btrim(coalesce(_payload->>'ball_in_court', '')) ELSE cur.ball_in_court END;
      IF spec = '' THEN RAISE EXCEPTION 'MCP_BAD:Spec section is required. Nothing was saved.'; END IF;
      IF ttl = '' THEN RAISE EXCEPTION 'MCP_BAD:Title is required. Nothing was saved.'; END IF;
      IF typ NOT IN ('product_data', 'shop_drawing', 'sample', 'other') THEN RAISE EXCEPTION 'MCP_BAD:Type has to be product data, shop drawing, sample, or other. Nothing was saved.'; END IF;
      IF st NOT IN ('not_started', 'in_prep', 'submitted', 'in_review', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'closed') THEN
        RAISE EXCEPTION 'MCP_BAD:That status is not on the submittal log. Nothing was saved.';
      END IF;
      IF ball NOT IN ('sub', 'gc', 'architect_engineer', 'owner') THEN RAISE EXCEPTION 'MCP_BAD:Ball in court has to be the sub, GC, architect or engineer, or owner. Nothing was saved.'; END IF;
      required_by := CASE WHEN _payload ? 'required_by' THEN nullif(_payload->>'required_by', '')::date ELSE cur.required_by END;
      submitted := CASE WHEN _payload ? 'submitted_on' THEN nullif(_payload->>'submitted_on', '')::date ELSE cur.submitted_on END;
      returned := CASE WHEN _payload ? 'returned_on' THEN nullif(_payload->>'returned_on', '')::date ELSE cur.returned_on END;
      notes := CASE WHEN _payload ? 'notes' THEN nullif(btrim(coalesce(_payload->>'notes', '')), '') ELSE cur.notes END;
      ball_name := CASE WHEN _payload ? 'ball_in_court_name' THEN nullif(btrim(coalesce(_payload->>'ball_in_court_name', '')), '') ELSE cur.ball_in_court_name END;
      IF _payload ? 'review_days' THEN days := days; ELSE days := cur.review_days; END IF;
      src := CASE WHEN _payload ? 'source' THEN btrim(coalesce(_payload->>'source', '')) ELSE cur.source END;
      IF src NOT IN ('spec_derived', 'user', 'imported') THEN RAISE EXCEPTION 'MCP_BAD:Source has to be from the spec, the user, or an import. Nothing was saved.'; END IF;
      req := CASE WHEN _payload ? 'required' THEN coalesce(_payload->>'required', 'true') IS DISTINCT FROM 'false' ELSE cur.required END;
      reason := CASE WHEN _payload ? 'not_required_reason' THEN nullif(btrim(coalesce(_payload->>'not_required_reason', '')), '') ELSE cur.not_required_reason END;
      excerpt := CASE WHEN _payload ? 'spec_excerpt' THEN nullif(btrim(coalesce(_payload->>'spec_excerpt', '')), '') ELSE cur.spec_excerpt END;
      IF NOT req AND src = 'spec_derived' AND (reason IS NULL OR length(reason) < 3 OR length(reason) > 500) THEN
        RAISE EXCEPTION 'MCP_BAD:A spec row marked not required needs a reason. Nothing was saved.';
      END IF;
      UPDATE public.mcp_submittals SET
        spec_section = spec, title = ttl, submittal_type = typ, status = st, ball_in_court = ball,
        ball_in_court_name = ball_name, source = src, required = req, not_required_reason = reason, spec_excerpt = excerpt,
        required_by = required_by, submitted_on = submitted,
        due_back = CASE WHEN submitted IS NULL THEN NULL ELSE submitted + days END,
        returned_on = returned, notes = notes, review_days = days, updated_at = now()
      WHERE id = cur.id;
      saved := cur.id;
      evt := CASE WHEN _payload ? 'status' THEN 'submittal_status' ELSE 'submittal_status' END;
      issued := false;
      IF _payload ? 'package_items' THEN
        PERFORM public.mcp_submittal_items_write(_job, j.company_id, saved, _payload->'package_items');
      END IF;
    END IF;
  END IF;

  PERFORM public.mcp_submittal_record(_job, saved, coalesce(evt, 'submittal_status'), issued);
  RETURN public.mcp_submittal_rows(_job) || jsonb_build_object('saved_id', saved);
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'MCP_BAD:Check the dates and try again. Nothing was saved.';
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_log(uuid, text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_log(uuid, text, jsonb) TO authenticated;

-- Same page reader as before, plus the submittal board. Superintendent may read it.
CREATE OR REPLACE FUNCTION public.mcp_report_page_get(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co public.mcp_companies; sc text; names jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF _company IS NULL OR NOT public.mcp_is_company_leader(_company) THEN RAISE EXCEPTION 'MCP_BAD:The portfolio is for owners and leadership.'; END IF;
    SELECT * INTO co FROM public.mcp_companies WHERE id = _company;
    RETURN jsonb_build_object('page', 'portfolio', 'company', co.name, 'jobs', public.mcp_report_portfolio_rows(_company, true), 'money', true);
  END IF;
  IF _page NOT IN ('ior', 'schedule', 'lookahead', 'payapp', 'briefing', 'field', 'daily', 'photos', 'items', 'submittals') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT * INTO co FROM public.mcp_companies WHERE id = j.company_id;
  names := jsonb_build_object(
    'job_id', j.id,
    'job_name', j.name,
    'items', public.mcp_report_open_items(_job, false),
    'people', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.display_name)) FROM public.mcp_company_members m WHERE m.company_id = j.company_id), '[]'::jsonb)
  );
  IF _page = 'ior' THEN
    RETURN jsonb_build_object('page', 'ior', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'report', public.mcp_living_report_get(_job, 'ior', NULL), 'names', names);
  END IF;
  IF _page IN ('schedule', 'payapp') THEN
    RETURN jsonb_build_object('page', _page, 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'report', public.mcp_living_report_get(_job, CASE _page WHEN 'schedule' THEN 'cpm' ELSE 'billing_forecast' END, NULL), 'names', names);
  END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  IF _page = 'submittals' THEN RETURN public.mcp_submittal_page(_job); END IF;
  IF _page = 'lookahead' THEN
    RETURN jsonb_build_object('page', 'lookahead', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'lookahead', public.mcp_report_latest_lookahead(_job), 'report', public.mcp_living_report_get(_job, 'cpm', NULL),
      'items', public.mcp_report_open_items(_job, sc <> 'full'), 'names', names);
  END IF;
  IF _page = 'field' OR _page = 'items' THEN
    RETURN public.mcp_field_board(_job) || jsonb_build_object('page', _page, 'names', names);
  END IF;
  IF _page = 'daily' THEN RETURN public.mcp_field_daily_page(_job) || jsonb_build_object('names', names); END IF;
  IF _page = 'photos' THEN RETURN public.mcp_field_photo_page(_job) || jsonb_build_object('names', names); END IF;
  RETURN jsonb_build_object('page', 'briefing', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
    'today', (now() AT TIME ZONE coalesce(j.time_zone, 'America/Chicago'))::date, 'items', public.mcp_report_open_items(_job, sc <> 'full'),
    'report', jsonb_build_object('found', true, 'contract_completion_date', j.contract_completion_date, 'scope', sc), 'names', names);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_report_page_stamp(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; s text;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF _company IS NULL OR NOT public.mcp_is_company_leader(_company) THEN RAISE EXCEPTION 'MCP_BAD:The portfolio is for owners and leadership.'; END IF;
    SELECT count(*)::text || '|' || coalesce(max(r.created_at)::text, '') || '|' || (SELECT count(*) FROM public.mcp_jobs WHERE company_id = _company)::text INTO s
      FROM public.mcp_living_reports r JOIN public.mcp_jobs j ON j.id = r.job_id WHERE j.company_id = _company;
    RETURN s;
  END IF;
  IF _page NOT IN ('ior', 'schedule', 'lookahead', 'payapp', 'briefing', 'field', 'daily', 'photos', 'items', 'submittals') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF (_page IN ('ior', 'payapp') AND sc <> 'full') OR (_page IN ('schedule', 'lookahead', 'briefing', 'field', 'daily', 'photos', 'items', 'submittals') AND sc NOT IN ('full', 'super')) THEN RAISE EXCEPTION 'MCP_BAD:No access.'; END IF;
  IF _page = 'submittals' THEN
    SELECT coalesce((SELECT max(updated_at)::text FROM public.mcp_submittals WHERE job_id = _job), '')
      || '|' || coalesce((SELECT max(updated_at)::text FROM public.mcp_submittal_package_items WHERE job_id = _job), '')
      || '|' || coalesce((SELECT count(*)::text FROM public.mcp_transmittals WHERE job_id = _job), '0')
    INTO s;
    RETURN coalesce(s, 'none');
  END IF;
  IF _page IN ('lookahead', 'briefing', 'field', 'daily', 'photos', 'items') THEN
    SELECT coalesce((SELECT max(version)::text || '|' || max(created_at)::text FROM public.mcp_living_reports WHERE job_id = _job AND report_type = 'cpm'), 'none')
      || '|' || coalesce((SELECT count(*)::text || '|' || max(updated_at)::text FROM public.mcp_open_items WHERE job_id = _job AND status = 'open'), '')
      || '|' || coalesce((SELECT max(created_at)::text FROM public.mcp_lookaheads WHERE job_id = _job), '')
      || '|' || CASE WHEN _page = 'briefing' THEN current_date::text ELSE '' END
      || '|' || coalesce((SELECT max(updated_at)::text FROM public.mcp_field_activities WHERE job_id = _job), '')
      || '|' || coalesce((SELECT max(updated_at)::text FROM public.mcp_daily_reports WHERE job_id = _job), '')
      || '|' || coalesce((SELECT max(created_at)::text FROM public.mcp_progress_photos WHERE job_id = _job), '')
      INTO s;
    RETURN s;
  END IF;
  SELECT r.version::text || '|' || r.created_at::text INTO s FROM public.mcp_living_reports r
    WHERE r.job_id = _job AND r.report_type = CASE _page WHEN 'schedule' THEN 'cpm' WHEN 'payapp' THEN 'billing_forecast' ELSE 'ior' END ORDER BY r.version DESC LIMIT 1;
  RETURN coalesce(s, 'none');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_board_link_open(_token_hash text, _job uuid, _page text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_board_links; payload jsonb;
BEGIN
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF _page NOT IN ('field', 'items', 'daily', 'photos', 'ior', 'payapp', 'schedule', 'lookahead', 'briefing', 'submittals') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  SELECT * INTO r FROM public.mcp_board_links WHERE token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF r.job_id <> _job THEN RETURN jsonb_build_object('status', 'wrong_job'); END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF (_page IN ('ior', 'payapp') AND r.scope <> 'full') OR r.scope NOT IN ('full', 'super') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  PERFORM set_config('request.jwt.claim.sub', r.created_by::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', r.created_by::text, 'role', 'authenticated')::text, true);
  BEGIN
    payload := public.mcp_report_page_get(_page, _job, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'denied');
  END;
  INSERT INTO public.mcp_board_link_opens (link_id, job_id, page) VALUES (r.id, r.job_id, _page);
  UPDATE public.mcp_board_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('status', 'ok', 'payload', payload);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) TO anon, authenticated;
