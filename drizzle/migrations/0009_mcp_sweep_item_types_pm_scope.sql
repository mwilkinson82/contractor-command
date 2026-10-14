-- Jobs: time zone (NULL = unknown) and assigned PM
ALTER TABLE public.mcp_jobs ADD COLUMN IF NOT EXISTS time_zone text, ADD COLUMN IF NOT EXISTS pm_user_id uuid;

-- Open-item types
ALTER TABLE public.mcp_open_items
  ADD COLUMN IF NOT EXISTS item_type text,
  ADD COLUMN IF NOT EXISTS recommendation text,
  ADD COLUMN IF NOT EXISTS why text,
  ADD COLUMN IF NOT EXISTS help_offer text,
  ADD COLUMN IF NOT EXISTS waiting_on_document text,
  ADD COLUMN IF NOT EXISTS waiting_on_who text,
  ADD COLUMN IF NOT EXISTS waiting_since date,
  ADD COLUMN IF NOT EXISTS clause_source text,
  ADD COLUMN IF NOT EXISTS delivery_method text,
  ADD COLUMN IF NOT EXISTS recipient text,
  ADD COLUMN IF NOT EXISTS parent_item_id uuid;

UPDATE public.mcp_open_items i SET item_type = CASE
    WHEN EXISTS (SELECT 1 FROM public.mcp_job_na n WHERE n.job_id = i.job_id AND n.active
      AND ((n.scope = 'section' AND n.target = i.section) OR (n.scope = 'item' AND i.check_key = 'setup:' || n.target))) THEN 'na_disposition'
    WHEN i.kind = 'confirm_unknown' THEN 'unknown'
    WHEN i.kind = 'gap' THEN 'no'
    ELSE 'deadline' END
  WHERE i.item_type IS NULL;
UPDATE public.mcp_open_items i SET clause_source = coalesce(i.source, 'member_answer') || ' (due date set by member)'
  WHERE i.item_type = 'deadline' AND i.clause_source IS NULL;
UPDATE public.mcp_open_items i SET recommendation = c.no_recommendation,
    why = 'Answered no on a best-practice check for this job.',
    help_offer = 'The PM agent can help you close this gap — ask it to draft the next step.'
  FROM public.mcp_checklist_items c
  WHERE i.item_type = 'no' AND i.recommendation IS NULL AND i.check_key = 'setup:' || c.key AND c.version = i.check_version;

ALTER TABLE public.mcp_open_items ALTER COLUMN item_type SET DEFAULT 'deadline';
ALTER TABLE public.mcp_open_items ADD CONSTRAINT mcp_open_items_item_type_check
  CHECK (item_type IS NULL OR item_type IN ('unknown','no','na_disposition','pending_document','deadline'));

-- Contract time clauses / deadlines
CREATE TABLE public.mcp_job_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  clause_key text NOT NULL CHECK (clause_key IN ('notice','submittal_turnaround','rfi_turnaround','liquidated_damages','completion','other')),
  label text NOT NULL,
  clause_ref text,
  trigger_desc text,
  trigger_date date,
  trigger_alternatives date[] NOT NULL DEFAULT '{}',
  n_days int,
  day_type text CHECK (day_type IS NULL OR day_type IN ('calendar','business','working')),
  holidays date[],
  weekend_roll boolean NOT NULL DEFAULT false,
  fixed_date date,
  delivery_method text,
  recipient text,
  internal_only boolean NOT NULL DEFAULT false,
  item_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mcp_job_deadlines TO authenticated;
GRANT ALL ON public.mcp_job_deadlines TO service_role;
ALTER TABLE public.mcp_job_deadlines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deadlines read by job scope" ON public.mcp_job_deadlines FOR SELECT TO authenticated
  USING (public.mcp_can_access_contract(job_id) AND (NOT internal_only OR public.mcp_can_access_job(job_id)));

-- Surfaced metrics
CREATE TABLE public.mcp_surfaced (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  job_id uuid NOT NULL,
  ref text NOT NULL,
  item_id uuid,
  first_surfaced_at timestamptz NOT NULL DEFAULT now(),
  last_surfaced_at timestamptz NOT NULL DEFAULT now(),
  times int NOT NULL DEFAULT 1,
  UNIQUE (user_id, ref)
);
GRANT SELECT ON public.mcp_surfaced TO authenticated;
GRANT ALL ON public.mcp_surfaced TO service_role;
ALTER TABLE public.mcp_surfaced ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own surfaced" ON public.mcp_surfaced FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Session marks
CREATE TABLE public.mcp_sessions (
  user_id uuid PRIMARY KEY,
  last_call_at timestamptz NOT NULL DEFAULT now(),
  session_started_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mcp_sessions TO authenticated;
GRANT ALL ON public.mcp_sessions TO service_role;
ALTER TABLE public.mcp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own session" ON public.mcp_sessions FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.mcp_session_touch() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE prev timestamptz; fresh boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT last_call_at INTO prev FROM public.mcp_sessions WHERE user_id = auth.uid();
  fresh := prev IS NULL OR prev < now() - interval '4 hours';
  INSERT INTO public.mcp_sessions (user_id, last_call_at, session_started_at) VALUES (auth.uid(), now(), now())
    ON CONFLICT (user_id) DO UPDATE SET last_call_at = now(),
      session_started_at = CASE WHEN fresh THEN now() ELSE public.mcp_sessions.session_started_at END;
  RETURN fresh;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_session_touch() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_session_touch() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_log_surfaced(_refs jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; ins boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(_refs, '[]'::jsonb)) LOOP
    IF NOT public.mcp_can_access_contract((r->>'job_id')::uuid) THEN CONTINUE; END IF;
    INSERT INTO public.mcp_surfaced (user_id, job_id, ref, item_id)
      VALUES (auth.uid(), (r->>'job_id')::uuid, left(r->>'ref', 120), nullif(r->>'item_id', '')::uuid)
      ON CONFLICT (user_id, ref) DO UPDATE SET last_surfaced_at = now(), times = public.mcp_surfaced.times + 1
      RETURNING (xmax = 0) INTO ins;
    IF ins AND nullif(r->>'item_id', '') IS NOT NULL THEN
      INSERT INTO public.mcp_item_events (user_id, item_id, event) VALUES (auth.uid(), (r->>'item_id')::uuid, 'surfaced');
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_log_surfaced(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_log_surfaced(jsonb) TO authenticated;

-- TEST-only caller: reserved non-deliverable domain AND only a member of is_test companies
CREATE OR REPLACE FUNCTION public.mcp_is_test_caller() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL
    AND lower(coalesce(auth.jwt()->>'email', '')) LIKE '%@pm-agent-test.invalid'
    AND EXISTS (SELECT 1 FROM public.mcp_company_members m JOIN public.mcp_companies c ON c.id = m.company_id WHERE m.user_id = auth.uid() AND c.is_test)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_company_members m JOIN public.mcp_companies c ON c.id = m.company_id WHERE m.user_id = auth.uid() AND NOT c.is_test)
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_is_test_caller() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_is_test_caller() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN public.mcp_is_test_caller() THEN true ELSE mcp_private.is_circle_active(auth.uid()) END
$$;

-- PM sees own jobs only
CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN m.role = 'super' THEN NULL
    WHEN m.role IN ('owner','all_access','finance') THEN 'full'
    WHEN m.role = 'pm' THEN CASE WHEN j.pm_user_id = auth.uid() OR j.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN 'full' ELSE NULL END
    WHEN j.restricted AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN NULL
    WHEN m.role IN ('estimating','contracts') THEN 'contract'
    ELSE 'full' END
  FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
  WHERE j.id = _job
$$;

CREATE OR REPLACE FUNCTION public.mcp_job_settings(_job uuid, _time_zone text, _pm_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; r text; uid uuid;
BEGIN
  IF public.mcp_assert_job_scope(_job) <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t change job settings.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF nullif(btrim(_time_zone), '') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = btrim(_time_zone)) THEN
      RAISE EXCEPTION 'MCP_BAD:Unknown time zone. Use an IANA name such as America/Chicago.';
    END IF;
    UPDATE public.mcp_jobs SET time_zone = btrim(_time_zone), updated_at = now() WHERE id = _job;
    UPDATE public.mcp_open_items SET status = 'resolved', resolution = 'verified', verify_state = 'verified', verified_at = now(),
      verified_evidence = 'Time zone set to ' || btrim(_time_zone), resolved_at = now()
      WHERE job_id = _job AND check_key = 'tz:job' AND status = 'open';
    PERFORM public.mcp_audit_job(_job, 'intake', 'job_time_zone_set', NULL);
  END IF;
  IF nullif(btrim(_pm_name), '') IS NOT NULL THEN
    SELECT role INTO r FROM public.mcp_company_members WHERE company_id = j.company_id AND user_id = auth.uid();
    IF r NOT IN ('owner','all_access','finance') AND j.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'MCP_BAD:Only an Owner, Finance, All-access member or the job creator can assign the PM.';
    END IF;
    SELECT user_id INTO uid FROM public.mcp_company_members WHERE company_id = j.company_id AND lower(display_name) = lower(btrim(_pm_name));
    IF uid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:% is not a member of this company.', _pm_name; END IF;
    UPDATE public.mcp_jobs SET pm_user_id = uid, updated_at = now() WHERE id = _job;
    PERFORM public.mcp_audit_job(_job, 'intake', 'job_pm_set', uid::text);
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN jsonb_build_object('time_zone', j.time_zone, 'pm', (SELECT display_name FROM public.mcp_company_members WHERE company_id = j.company_id AND user_id = j.pm_user_id));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_job_settings(uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_job_settings(uuid, text, text) TO authenticated;

-- Open item create: types, recommendation, deadline delivery unknowns
CREATE OR REPLACE FUNCTION public.mcp_open_item_create(_job uuid, _f jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE j public.mcp_jobs; la uuid; acc text; nb date; iid uuid; d_owner boolean := false; d_nb boolean := false; ck text := nullif(_f->>'check_key', '');
  t text; rec text; why text; help text; cs text; child jsonb; c public.mcp_checklist_items;
BEGIN
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF ck IS NOT NULL THEN
    SELECT id, item_type INTO iid, t FROM public.mcp_open_items WHERE job_id = _job AND check_key = ck AND status = 'open' LIMIT 1;
    IF iid IS NOT NULL THEN RETURN jsonb_build_object('item_id', iid, 'existing', true, 'item_type', t); END IF;
  END IF;
  t := coalesce(nullif(_f->>'item_type', ''), CASE coalesce(_f->>'kind', 'general') WHEN 'confirm_unknown' THEN 'unknown' WHEN 'gap' THEN 'no' ELSE 'deadline' END);
  IF t NOT IN ('unknown','no','na_disposition','pending_document','deadline') THEN RAISE EXCEPTION 'MCP_BAD:Unknown item_type.'; END IF;
  IF t = 'pending_document' AND (nullif(btrim(_f->>'waiting_on_document'), '') IS NULL) THEN
    RAISE EXCEPTION 'MCP_BAD:A pending_document item needs waiting_on_document (the named document).';
  END IF;
  rec := nullif(_f->>'recommendation', ''); why := nullif(_f->>'why', ''); help := nullif(_f->>'help_offer', '');
  IF t = 'no' THEN
    IF rec IS NULL AND ck LIKE 'setup:%' THEN
      SELECT * INTO c FROM public.mcp_checklist_items WHERE key = substr(ck, 7) AND version = coalesce((_f->>'check_version')::int, 1);
      rec := c.no_recommendation;
    END IF;
    why := coalesce(why, 'Answered no on a best-practice check for this job.');
    help := coalesce(help, 'The PM agent can help you close this gap — ask it to draft the next step.');
  END IF;
  cs := nullif(_f->>'clause_source', '');
  IF t = 'deadline' AND cs IS NULL THEN cs := coalesce(_f->>'source', 'member_answer') || ' (due date set by member)'; END IF;
  SELECT id INTO la FROM public.mcp_lookaheads WHERE job_id = _job AND inputs->>'kind' = 'setup' ORDER BY created_at LIMIT 1;
  IF la IS NULL THEN
    INSERT INTO public.mcp_lookaheads (user_id, job_id, inputs) VALUES (auth.uid(), _job, '{"kind":"setup"}'::jsonb) RETURNING id INTO la;
  END IF;
  acc := nullif(btrim(_f->>'accountable'), '');
  IF acc IS NULL OR lower(acc) = 'unknown' THEN
    SELECT display_name INTO acc FROM public.mcp_company_members WHERE company_id = j.company_id AND user_id = auth.uid();
    d_owner := true;
  END IF;
  nb := nullif(_f->>'needed_by', '')::date;
  IF nb IS NULL THEN nb := current_date + 7; d_nb := true; END IF;
  INSERT INTO public.mcp_open_items (user_id, job_id, lookahead_id, origin_lookahead_id, check_key, check_version, trade, category, severity,
    action, detail, owner, due_date, company_id, job_number, source, accountable, needed_by, verify_state, reported_by, reported_at,
    kind, commercial_type, section, internal_only, cost_effect, time_effect, cash_effect, effect_is_estimate, next_action, next_action_approved_by,
    item_type, recommendation, why, help_offer, waiting_on_document, waiting_on_who, waiting_since, clause_source, delivery_method, recipient, parent_item_id)
  VALUES (auth.uid(), _job, la, la, coalesce(ck, 'manual:' || gen_random_uuid()), coalesce((_f->>'check_version')::int, 1),
    coalesce(_f->>'trade', 'general'), coalesce(_f->>'category', 'general'), coalesce(_f->>'severity', 'medium'),
    j.job_number || ' – ' || left(coalesce(_f->>'action', 'Open item'), 480), left(_f->>'detail', 10000), acc, nb, j.company_id, j.job_number,
    coalesce(_f->>'source', 'member_answer'), acc, nb, 'last_reported', acc, now(),
    coalesce(_f->>'kind', 'general'), _f->>'commercial_type', _f->>'section', coalesce((_f->>'internal_only')::boolean, false),
    coalesce(_f->>'cost_effect', 'unknown'), coalesce(_f->>'time_effect', 'unknown'), coalesce(_f->>'cash_effect', 'unknown'),
    coalesce((_f->>'effect_is_estimate')::boolean, true), _f->>'next_action', _f->>'next_action_approved_by',
    t, rec, why, help, nullif(_f->>'waiting_on_document', ''), nullif(_f->>'waiting_on_who', ''), nullif(_f->>'waiting_since', '')::date,
    cs, nullif(_f->>'delivery_method', ''), nullif(_f->>'recipient', ''), nullif(_f->>'parent_item_id', '')::uuid)
  RETURNING id INTO iid;
  INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id) VALUES (auth.uid(), iid, 'opened', la);
  PERFORM public.mcp_audit(j.company_id, j.job_number, coalesce(_f->>'tool', 'agent'), 'item_open', iid::text);
  IF t = 'deadline' AND coalesce((_f->>'clause_based')::boolean, false)
     AND (nullif(_f->>'delivery_method', '') IS NULL OR nullif(_f->>'recipient', '') IS NULL) THEN
    child := public.mcp_open_item_create(_job, jsonb_build_object(
      'check_key', 'delivery:' || iid, 'item_type', 'unknown', 'kind', 'confirm_unknown', 'section', _f->>'section',
      'category', coalesce(_f->>'category', 'Deadline'), 'tool', coalesce(_f->>'tool', 'agent'), 'parent_item_id', iid::text,
      'internal_only', coalesce((_f->>'internal_only')::boolean, false), 'accountable', acc, 'needed_by', least(nb, current_date + 2),
      'action', 'Confirm ' || concat_ws(' and ',
        CASE WHEN nullif(_f->>'delivery_method', '') IS NULL THEN 'delivery method' END,
        CASE WHEN nullif(_f->>'recipient', '') IS NULL THEN 'recipient' END) || ' for: ' || left(coalesce(_f->>'action', 'deadline'), 300)));
  END IF;
  RETURN jsonb_build_object('item_id', iid, 'existing', false, 'item_type', t, 'owner_defaulted', d_owner, 'needed_by_defaulted', d_nb,
    'accountable', acc, 'needed_by', nb, 'delivery_item', child);
END $function$;

-- Record a contract time clause; due date computed by the server code and passed in
CREATE OR REPLACE FUNCTION public.mcp_deadline_add(_job uuid, _d jsonb, _due date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s text; j public.mcp_jobs; did uuid; item jsonb; amb jsonb; trg jsonb; sec text;
BEGIN
  s := public.mcp_assert_job_scope(_job);
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  sec := 'contract';
  INSERT INTO public.mcp_job_deadlines (job_id, company_id, clause_key, label, clause_ref, trigger_desc, trigger_date, trigger_alternatives,
    n_days, day_type, holidays, weekend_roll, fixed_date, delivery_method, recipient, internal_only)
  VALUES (_job, j.company_id, _d->>'clause_key', left(_d->>'label', 300), left(_d->>'clause_ref', 200), left(_d->>'trigger_desc', 500),
    nullif(_d->>'trigger_date', '')::date,
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(_d->'trigger_alternatives', '[]'::jsonb))::date), '{}'),
    nullif(_d->>'n_days', '')::int, nullif(_d->>'day_type', ''),
    CASE WHEN _d ? 'holidays' THEN ARRAY(SELECT jsonb_array_elements_text(_d->'holidays')::date) END,
    coalesce((_d->>'weekend_roll')::boolean, false), nullif(_d->>'fixed_date', '')::date,
    nullif(_d->>'delivery_method', ''), nullif(_d->>'recipient', ''), coalesce((_d->>'internal_only')::boolean, false))
  RETURNING id INTO did;
  IF _due IS NOT NULL THEN
    item := public.mcp_open_item_create(_job, jsonb_build_object(
      'check_key', 'deadline:' || did, 'item_type', 'deadline', 'clause_based', true, 'section', sec, 'category', 'Deadline',
      'action', _d->>'label', 'needed_by', _due, 'accountable', _d->>'owner', 'tool', 'intake', 'source', coalesce(_d->>'source', 'document'),
      'clause_source', concat_ws(' ', _d->>'clause_ref', '(' || coalesce(_d->>'source', 'document') || ')'),
      'delivery_method', _d->>'delivery_method', 'recipient', _d->>'recipient', 'internal_only', coalesce((_d->>'internal_only')::boolean, false)));
    UPDATE public.mcp_job_deadlines SET item_id = (item->>'item_id')::uuid WHERE id = did;
  END IF;
  IF nullif(_d->>'day_type', '') IS NULL AND nullif(_d->>'n_days', '') IS NOT NULL THEN
    amb := public.mcp_open_item_create(_job, jsonb_build_object(
      'check_key', 'daytype:' || did, 'item_type', 'unknown', 'kind', 'confirm_unknown', 'section', sec, 'category', 'Deadline',
      'action', 'Confirm day type (calendar, business or working days) for: ' || (_d->>'label'), 'tool', 'intake',
      'needed_by', CASE WHEN _due IS NOT NULL THEN least(_due, current_date + 2) END));
  END IF;
  IF jsonb_array_length(coalesce(_d->'trigger_alternatives', '[]'::jsonb)) > 0 THEN
    trg := public.mcp_open_item_create(_job, jsonb_build_object(
      'check_key', 'trigger:' || did, 'item_type', 'unknown', 'kind', 'confirm_unknown', 'section', sec, 'category', 'Deadline',
      'action', 'Confirm which event starts the clock for: ' || (_d->>'label'), 'tool', 'intake',
      'needed_by', CASE WHEN _due IS NOT NULL THEN least(_due, current_date + 2) END));
  END IF;
  PERFORM public.mcp_audit_job(_job, 'intake', 'deadline_add', did::text);
  RETURN jsonb_build_object('deadline_id', did, 'item', item, 'day_type_item', amb, 'trigger_item', trg);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_deadline_add(uuid, jsonb, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_deadline_add(uuid, jsonb, date) TO authenticated;