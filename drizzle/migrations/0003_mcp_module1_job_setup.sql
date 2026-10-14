CREATE SCHEMA IF NOT EXISTS mcp_private;
REVOKE ALL ON SCHEMA mcp_private FROM PUBLIC, anon;

CREATE TABLE public.mcp_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  agent_name text NOT NULL DEFAULT 'PM agent',
  company_role text,
  work_types text[] NOT NULL DEFAULT '{}',
  trades text[] NOT NULL DEFAULT '{}',
  tool_stack jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_rights jsonb NOT NULL DEFAULT '{"buyout":["owner"],"change_orders":["owner"],"claims":["owner"],"write_offs":["owner"],"waive_items":["owner"]}'::jsonb,
  default_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_test boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_company_members (
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','pm','all_access')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
ALTER TABLE public.mcp_jobs
  ADD COLUMN company_id uuid REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  ADD COLUMN restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX mcp_jobs_company_job_number ON public.mcp_jobs (company_id, job_number) WHERE company_id IS NOT NULL;
ALTER TABLE public.mcp_jobs DROP CONSTRAINT IF EXISTS mcp_jobs_user_id_name_key;

CREATE TABLE public.mcp_job_access (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL DEFAULT auth.uid(),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);
CREATE TABLE public.mcp_job_flags (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  flag_key text NOT NULL,
  value text NOT NULL CHECK (value IN ('yes','no','na','unknown')),
  source text NOT NULL CHECK (source IN ('document','member_answer','company_default')),
  set_by uuid NOT NULL DEFAULT auth.uid(),
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, flag_key)
);
CREATE TABLE public.mcp_job_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN ('scope','contract','handoff','budget','sov','warranty')),
  key text NOT NULL,
  value jsonb,
  status text NOT NULL DEFAULT 'known' CHECK (status IN ('known','unknown','na')),
  source text NOT NULL CHECK (source IN ('document','member_answer','company_default')),
  internal_only boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, module, key)
);
CREATE TABLE public.mcp_job_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  check_version integer NOT NULL,
  answer text NOT NULL CHECK (answer IN ('yes','no','na','unknown')),
  detail text,
  answered_by uuid NOT NULL DEFAULT auth.uid(),
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, check_key)
);
CREATE TABLE public.mcp_job_na (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('item','section')),
  target text NOT NULL,
  reason text NOT NULL,
  set_by uuid NOT NULL DEFAULT auth.uid(),
  set_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  reenabled_by uuid,
  reenabled_at timestamptz
);
CREATE UNIQUE INDEX mcp_job_na_active ON public.mcp_job_na (job_id, scope, target) WHERE active;
CREATE TABLE public.mcp_reenable_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  na_id uuid NOT NULL REFERENCES public.mcp_job_na(id) ON DELETE CASCADE,
  trigger_key text NOT NULL,
  outcome text NOT NULL DEFAULT 'suggested' CHECK (outcome IN ('suggested','declined','accepted')),
  actor uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (na_id, trigger_key)
);
CREATE TABLE public.mcp_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor uuid NOT NULL,
  company_id uuid,
  job_number text,
  tool text NOT NULL,
  action text NOT NULL,
  object_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_gate_cache (
  user_id uuid PRIMARY KEY,
  active boolean NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_checklist_items
  ADD COLUMN module text NOT NULL DEFAULT 'lookahead',
  ADD COLUMN section text,
  ADD COLUMN applies_when jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN record_ref text;

ALTER TABLE public.mcp_open_items
  ADD COLUMN company_id uuid,
  ADD COLUMN job_number text,
  ADD COLUMN source text,
  ADD COLUMN accountable text,
  ADD COLUMN needed_by date,
  ADD COLUMN verify_state text NOT NULL DEFAULT 'last_reported' CHECK (verify_state IN ('verified','last_reported')),
  ADD COLUMN verified_evidence text,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN reported_by text,
  ADD COLUMN reported_at timestamptz,
  ADD COLUMN cost_effect text,
  ADD COLUMN time_effect text,
  ADD COLUMN cash_effect text,
  ADD COLUMN effect_is_estimate boolean NOT NULL DEFAULT true,
  ADD COLUMN next_action text,
  ADD COLUMN next_action_approved_by text,
  ADD COLUMN kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','confirm_unknown','gap','commercial','warranty')),
  ADD COLUMN commercial_type text CHECK (commercial_type IN ('co','rea','claim','retainage')),
  ADD COLUMN section text,
  ADD COLUMN internal_only boolean NOT NULL DEFAULT false,
  ADD COLUMN resolution text;

ALTER TABLE public.mcp_item_events DROP CONSTRAINT IF EXISTS mcp_item_events_event_check;
ALTER TABLE public.mcp_item_events ADD CONSTRAINT mcp_item_events_event_check
  CHECK (event IN ('opened','carried_forward','resolved','updated','waived'));

CREATE OR REPLACE FUNCTION public.mcp_block_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'append-only'; END $$;
CREATE TRIGGER mcp_audit_log_append_only BEFORE UPDATE OR DELETE ON public.mcp_audit_log FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_item_events_append_only BEFORE UPDATE ON public.mcp_item_events FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_item_evidence_append_only BEFORE UPDATE ON public.mcp_item_evidence FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

CREATE OR REPLACE FUNCTION public.mcp_member_role(_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid()
$$;
CREATE OR REPLACE FUNCTION public.mcp_is_company_member(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.mcp_can_access_job(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_jobs j
    JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
    WHERE j.id = _job AND (NOT j.restricted OR m.role IN ('owner','all_access')
      OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid())))
$$;

CREATE OR REPLACE FUNCTION mcp_private.is_circle_active(_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.mcp_gate_cache; em text; v boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO c FROM public.mcp_gate_cache WHERE user_id = _user_id;
  IF FOUND AND c.checked_at > now() - interval '5 minutes' THEN RETURN c.active; END IF;
  SELECT email INTO em FROM auth.users WHERE id = _user_id;
  v := coalesce((public.get_circle_entitlement(_user_id, coalesce(em, ''))->>'hasAccess')::boolean, false);
  INSERT INTO public.mcp_gate_cache (user_id, active, checked_at) VALUES (_user_id, v, now())
    ON CONFLICT (user_id) DO UPDATE SET active = EXCLUDED.active, checked_at = EXCLUDED.checked_at;
  RETURN v;
END $$;
GRANT USAGE ON SCHEMA mcp_private TO service_role;
GRANT EXECUTE ON FUNCTION mcp_private.is_circle_active(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT mcp_private.is_circle_active(auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.mcp_assert_active() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF NOT public.mcp_gate() THEN RAISE EXCEPTION 'MCP_INACTIVE'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.mcp_assert_job(_job uuid) RETURNS public.mcp_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.mcp_jobs;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_can_access_job(_job) THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN j;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_audit(_company uuid, _job_number text, _tool text, _action text, _object text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF _company IS NOT NULL AND NOT public.mcp_is_company_member(_company) THEN RETURN; END IF;
  INSERT INTO public.mcp_audit_log (actor, company_id, job_number, tool, action, object_id)
  VALUES (auth.uid(), _company, left(_job_number, 60), left(_tool, 60), left(_action, 60), left(_object, 100));
END $$;
CREATE OR REPLACE FUNCTION public.mcp_audit_job(_job uuid, _tool text, _action text, _object text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.mcp_audit(j.company_id, j.job_number, _tool, _action, _object) FROM public.mcp_jobs j WHERE j.id = _job
$$;

CREATE OR REPLACE FUNCTION public.mcp_has_right(_company uuid, _right text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_companies c JOIN public.mcp_company_members m ON m.company_id = c.id AND m.user_id = auth.uid()
    WHERE c.id = _company AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(c.decision_rights -> _right, '[]'::jsonb)) r
      WHERE lower(r) IN (m.role, lower(m.display_name), m.user_id::text)))
$$;

CREATE OR REPLACE FUNCTION public.mcp_company_save(_company uuid, _p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid := _company;
BEGIN
  PERFORM public.mcp_assert_active();
  IF cid IS NULL THEN
    IF coalesce(btrim(_p->>'name'), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:name is required to create the company.'; END IF;
    INSERT INTO public.mcp_companies (name, is_test) VALUES (btrim(_p->>'name'), coalesce((_p->>'is_test')::boolean, false)) RETURNING id INTO cid;
    INSERT INTO public.mcp_company_members (company_id, user_id, display_name, role)
      VALUES (cid, auth.uid(), coalesce(nullif(btrim(_p->>'display_name'), ''), 'Owner'), 'owner');
  ELSIF coalesce(public.mcp_member_role(cid), '') <> 'owner' THEN
    RAISE EXCEPTION 'MCP_BAD:Only a company Owner can change the company profile.';
  END IF;
  UPDATE public.mcp_companies SET
    name = coalesce(nullif(btrim(_p->>'name'), ''), name),
    agent_name = coalesce(nullif(btrim(_p->>'agent_name'), ''), agent_name),
    company_role = coalesce(_p->>'company_role', company_role),
    work_types = CASE WHEN _p ? 'work_types' THEN ARRAY(SELECT jsonb_array_elements_text(_p->'work_types')) ELSE work_types END,
    trades = CASE WHEN _p ? 'trades' THEN ARRAY(SELECT jsonb_array_elements_text(_p->'trades')) ELSE trades END,
    tool_stack = coalesce(_p->'tool_stack', tool_stack),
    decision_rights = decision_rights || coalesce(_p->'decision_rights', '{}'::jsonb),
    default_flags = default_flags || coalesce(_p->'default_flags', '{}'::jsonb),
    updated_at = now()
  WHERE id = cid;
  PERFORM public.mcp_audit(cid, NULL, 'onboarding', CASE WHEN _company IS NULL THEN 'company_create' ELSE 'company_update' END, cid::text);
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_member_add(_company uuid, _email text, _display_name text, _role text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_member_role(_company), '') <> 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company Owner can add members.'; END IF;
  IF _role NOT IN ('owner','pm','all_access') THEN RAISE EXCEPTION 'MCP_BAD:role must be owner, pm or all_access.'; END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(btrim(_email));
  IF uid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:No account with that email. They need to sign in once first.'; END IF;
  INSERT INTO public.mcp_company_members (company_id, user_id, display_name, role) VALUES (_company, uid, btrim(_display_name), _role)
    ON CONFLICT (company_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role;
  PERFORM public.mcp_audit(_company, NULL, 'onboarding', 'member_add', uid::text);
  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_job_create(_company uuid, _job_number text, _name text, _restrict_to text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n text := btrim(_job_number); sug text; i int := 2; jid uuid; nm text; uid uuid; c public.mcp_companies;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  IF n !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' THEN RAISE EXCEPTION 'MCP_BAD:job_number must be 1-40 letters, digits, dots, dashes or underscores.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_jobs WHERE company_id = _company AND job_number = n) THEN
    sug := n || '-' || to_char(current_date, 'YY');
    WHILE EXISTS (SELECT 1 FROM public.mcp_jobs WHERE company_id = _company AND job_number = sug) LOOP
      sug := n || '-' || to_char(current_date, 'YY') || '-' || i; i := i + 1;
    END LOOP;
    PERFORM public.mcp_audit(_company, n, 'intake', 'job_create_rejected_duplicate', NULL);
    RETURN jsonb_build_object('duplicate', true, 'suggestion', sug);
  END IF;
  INSERT INTO public.mcp_jobs (user_id, name, job_number, company_id, restricted)
    VALUES (auth.uid(), btrim(_name), n, _company, coalesce(array_length(_restrict_to, 1), 0) > 0) RETURNING id INTO jid;
  IF coalesce(array_length(_restrict_to, 1), 0) > 0 THEN
    FOREACH nm IN ARRAY _restrict_to LOOP
      uid := NULL;
      SELECT user_id INTO uid FROM public.mcp_company_members WHERE company_id = _company AND lower(display_name) = lower(btrim(nm));
      IF uid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:% is not a member of this company.', nm; END IF;
      INSERT INTO public.mcp_job_access (job_id, user_id) VALUES (jid, uid) ON CONFLICT DO NOTHING;
    END LOOP;
    INSERT INTO public.mcp_job_access (job_id, user_id) VALUES (jid, auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.mcp_lookaheads (user_id, job_id, inputs) VALUES (auth.uid(), jid, '{"kind":"setup"}'::jsonb);
  SELECT * INTO c FROM public.mcp_companies WHERE id = _company;
  INSERT INTO public.mcp_job_flags (job_id, flag_key, value, source)
    SELECT jid, key, value, 'company_default' FROM jsonb_each_text(c.default_flags)
    WHERE key ~ '^[a-z_]{1,40}$' AND value IN ('yes','no','na','unknown');
  PERFORM public.mcp_audit(_company, n, 'intake', 'job_create', jid::text);
  RETURN jsonb_build_object('duplicate', false, 'job_id', jid, 'job_number', n);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_job(_company uuid, _job_number text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.mcp_jobs; q text := lower(btrim(coalesce(_job_number, ''))); sug jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE company_id = _company AND job_number = btrim(_job_number) AND public.mcp_can_access_job(id);
  IF FOUND THEN RETURN jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'name', j.name, 'company_id', j.company_id); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('job_number', job_number, 'name', name)), '[]'::jsonb) INTO sug FROM (
    SELECT job_number, name FROM public.mcp_jobs
    WHERE company_id = _company AND public.mcp_can_access_job(id) AND q <> ''
      AND (strpos(lower(name), q) > 0 OR strpos(lower(job_number), q) > 0)
    ORDER BY created_at DESC LIMIT 3) s;
  RETURN jsonb_build_object('not_found', true, 'suggestions', sug);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_open_item_create(_job uuid, _f jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.mcp_jobs; la uuid; acc text; nb date; iid uuid; d_owner boolean := false; d_nb boolean := false; ck text := nullif(_f->>'check_key', '');
BEGIN
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF ck IS NOT NULL THEN
    SELECT id INTO iid FROM public.mcp_open_items WHERE job_id = _job AND check_key = ck AND status = 'open' LIMIT 1;
    IF iid IS NOT NULL THEN RETURN jsonb_build_object('item_id', iid, 'existing', true); END IF;
  END IF;
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
    kind, commercial_type, section, internal_only, cost_effect, time_effect, cash_effect, effect_is_estimate, next_action, next_action_approved_by)
  VALUES (auth.uid(), _job, la, la, coalesce(ck, 'manual:' || gen_random_uuid()), coalesce((_f->>'check_version')::int, 1),
    coalesce(_f->>'trade', 'general'), coalesce(_f->>'category', 'general'), coalesce(_f->>'severity', 'medium'),
    j.job_number || ' – ' || left(coalesce(_f->>'action', 'Open item'), 480), left(_f->>'detail', 10000), acc, nb, j.company_id, j.job_number,
    coalesce(_f->>'source', 'member_answer'), acc, nb, 'last_reported', acc, now(),
    coalesce(_f->>'kind', 'general'), _f->>'commercial_type', _f->>'section', coalesce((_f->>'internal_only')::boolean, false),
    coalesce(_f->>'cost_effect', 'unknown'), coalesce(_f->>'time_effect', 'unknown'), coalesce(_f->>'cash_effect', 'unknown'),
    coalesce((_f->>'effect_is_estimate')::boolean, true), _f->>'next_action', _f->>'next_action_approved_by')
  RETURNING id INTO iid;
  INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id) VALUES (auth.uid(), iid, 'opened', la);
  PERFORM public.mcp_audit(j.company_id, j.job_number, coalesce(_f->>'tool', 'agent'), 'item_open', iid::text);
  RETURN jsonb_build_object('item_id', iid, 'existing', false, 'owner_defaulted', d_owner, 'needed_by_defaulted', d_nb, 'accountable', acc, 'needed_by', nb);
END $$;
CREATE OR REPLACE FUNCTION public.mcp_add_item(_job uuid, _f jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.mcp_assert_job(_job);
  IF coalesce(btrim(_f->>'action'), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:action is required.'; END IF;
  RETURN public.mcp_open_item_create(_job, _f);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_eval_cond(_c jsonb, _flags jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE x jsonb; v text;
BEGIN
  IF _c IS NULL OR _c = '{}'::jsonb THEN RETURN true; END IF;
  IF _c ? 'all' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(_c->'all') LOOP IF NOT public.mcp_eval_cond(x, _flags) THEN RETURN false; END IF; END LOOP;
    RETURN true;
  END IF;
  IF _c ? 'any' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(_c->'any') LOOP IF public.mcp_eval_cond(x, _flags) THEN RETURN true; END IF; END LOOP;
    RETURN false;
  END IF;
  v := coalesce(_flags->>(_c->>'flag'), 'unknown');
  IF v = 'unknown' THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM jsonb_array_elements_text(_c->'in') e WHERE e = v);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_job_flagset(_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_object_agg(flag_key, value), '{}'::jsonb) FROM public.mcp_job_flags WHERE job_id = _job
$$;

CREATE OR REPLACE FUNCTION public.mcp_latest_setup_checks() RETURNS SETOF public.mcp_checklist_items
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (SELECT DISTINCT ON (key) * FROM public.mcp_checklist_items WHERE module = 'job_setup' ORDER BY key, version DESC) s
  WHERE active ORDER BY position, key
$$;

CREATE OR REPLACE FUNCTION public.mcp_next_check(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f jsonb; c public.mcp_checklist_items; rv jsonb; total int := 0; idx int := 0; found_c public.mcp_checklist_items; found_idx int;
BEGIN
  PERFORM public.mcp_assert_job(_job);
  f := public.mcp_job_flagset(_job);
  FOR c IN SELECT * FROM public.mcp_latest_setup_checks() LOOP
    IF EXISTS (SELECT 1 FROM public.mcp_job_na n WHERE n.job_id = _job AND n.active
      AND ((n.scope = 'item' AND n.target = c.key) OR (n.scope = 'section' AND n.target = c.section))) THEN CONTINUE; END IF;
    IF NOT public.mcp_eval_cond(c.applies_when, f) THEN CONTINUE; END IF;
    total := total + 1;
    IF EXISTS (SELECT 1 FROM public.mcp_job_answers a WHERE a.job_id = _job AND a.check_key = c.key AND a.answer <> 'na') THEN
      idx := idx + 1; CONTINUE;
    END IF;
    IF found_c.key IS NULL THEN found_c := c; found_idx := idx + 1; END IF;
  END LOOP;
  IF found_c.key IS NULL THEN RETURN NULL; END IF;
  IF found_c.record_ref IS NOT NULL THEN
    SELECT value INTO rv FROM public.mcp_job_facts WHERE job_id = _job AND status = 'known'
      AND module = split_part(found_c.record_ref, '.', 1) AND key = split_part(found_c.record_ref, '.', 2);
  END IF;
  RETURN jsonb_build_object('key', found_c.key, 'version', found_c.version, 'section', found_c.section, 'category', found_c.category,
    'trade', found_c.trade, 'severity', found_c.severity, 'prompt', found_c.prompt, 'record_value', rv, 'index', found_idx, 'total', total);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_answer(_job uuid, _key text, _answer text, _detail text, _owner text, _needed_by date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nc jsonb; item jsonb; d text := nullif(btrim(_detail), '');
BEGIN
  PERFORM public.mcp_assert_job(_job);
  IF _answer NOT IN ('yes','no','na','unknown') THEN RAISE EXCEPTION 'MCP_BAD:response must be yes, no, na or unknown.'; END IF;
  nc := public.mcp_next_check(_job);
  IF nc IS NULL THEN RAISE EXCEPTION 'MCP_BAD:All setup questions for this job are answered.'; END IF;
  IF nc->>'key' <> _key THEN RAISE EXCEPTION 'MCP_BAD:That isn''t the current question. Call next_question and answer the check it returns.'; END IF;
  IF _answer = 'na' AND d IS NULL THEN RAISE EXCEPTION 'MCP_BAD:N/A needs a reason in detail.'; END IF;
  INSERT INTO public.mcp_job_answers (job_id, check_key, check_version, answer, detail)
    VALUES (_job, _key, (nc->>'version')::int, _answer, d)
    ON CONFLICT (job_id, check_key) DO UPDATE SET answer = EXCLUDED.answer, detail = EXCLUDED.detail,
      check_version = EXCLUDED.check_version, answered_by = auth.uid(), answered_at = now();
  IF _answer = 'na' THEN
    INSERT INTO public.mcp_job_na (job_id, scope, target, reason) VALUES (_job, 'item', _key, d) ON CONFLICT DO NOTHING;
  ELSIF _answer IN ('unknown','no') THEN
    item := public.mcp_open_item_create(_job, jsonb_build_object(
      'check_key', 'setup:' || _key, 'check_version', nc->>'version', 'trade', nc->>'trade', 'category', nc->>'category',
      'severity', nc->>'severity', 'section', nc->>'section', 'tool', 'answer',
      'kind', CASE WHEN _answer = 'unknown' THEN 'confirm_unknown' ELSE 'gap' END,
      'action', CASE WHEN _answer = 'unknown' THEN 'Confirm: ' ELSE 'Resolve: ' END || regexp_replace(nc->>'prompt', '^PLACEHOLDER:\s*', ''),
      'detail', d, 'accountable', _owner, 'needed_by', _needed_by));
  END IF;
  PERFORM public.mcp_audit_job(_job, 'answer', 'answer_' || _answer, _key);
  RETURN jsonb_build_object('recorded', _answer, 'item', item);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_mark_na(_job uuid, _scope text, _target text, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nid uuid; open_n int;
BEGIN
  PERFORM public.mcp_assert_job(_job);
  IF _scope NOT IN ('item','section') THEN RAISE EXCEPTION 'MCP_BAD:scope must be item or section.'; END IF;
  IF coalesce(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:N/A needs a reason.'; END IF;
  INSERT INTO public.mcp_job_na (job_id, scope, target, reason) VALUES (_job, _scope, btrim(_target), btrim(_reason))
    ON CONFLICT DO NOTHING RETURNING id INTO nid;
  SELECT count(*) INTO open_n FROM public.mcp_open_items WHERE job_id = _job AND status = 'open'
    AND ((_scope = 'section' AND section = btrim(_target)) OR (_scope = 'item' AND check_key = 'setup:' || btrim(_target)));
  PERFORM public.mcp_audit_job(_job, 'answer', 'mark_na_' || _scope, btrim(_target));
  RETURN jsonb_build_object('na_id', nid, 'already_na', nid IS NULL, 'open_items_kept', open_n);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_reenable(_job uuid, _scope text, _target text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nid uuid;
BEGIN
  PERFORM public.mcp_assert_job(_job);
  UPDATE public.mcp_job_na SET active = false, reenabled_by = auth.uid(), reenabled_at = now()
    WHERE job_id = _job AND scope = _scope AND target = btrim(_target) AND active RETURNING id INTO nid;
  IF nid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Nothing is marked N/A for that %.', _scope; END IF;
  UPDATE public.mcp_reenable_prompts SET outcome = 'accepted', decided_at = now() WHERE na_id = nid AND outcome = 'suggested';
  PERFORM public.mcp_audit_job(_job, 'answer', 'reenable_' || _scope, btrim(_target));
  RETURN jsonb_build_object('reenabled', nid);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_decline_reenable(_job uuid, _na_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM public.mcp_assert_job(_job);
  UPDATE public.mcp_reenable_prompts p SET outcome = 'declined', actor = auth.uid(), decided_at = now()
    FROM public.mcp_job_na na WHERE p.na_id = na.id AND na.id = _na_id AND na.job_id = _job AND p.outcome = 'suggested';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.mcp_audit_job(_job, 'answer', 'decline_reenable', _na_id::text);
  RETURN jsonb_build_object('declined', n);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_set_flags(_job uuid, _flags jsonb, _source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; v text; old public.mcp_job_flags; f jsonb; n public.mcp_job_na; pid uuid; trig text;
  sugg jsonb := '[]'::jsonb; items jsonb := '[]'::jsonb; changed text[] := '{}'; it jsonb;
BEGIN
  PERFORM public.mcp_assert_job(_job);
  IF _source NOT IN ('document','member_answer','company_default') THEN RAISE EXCEPTION 'MCP_BAD:bad source'; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(coalesce(_flags, '{}'::jsonb)) LOOP
    IF k !~ '^[a-z_]{1,40}$' OR v NOT IN ('yes','no','na','unknown') THEN CONTINUE; END IF;
    SELECT * INTO old FROM public.mcp_job_flags WHERE job_id = _job AND flag_key = k;
    IF FOUND AND _source = 'company_default' AND old.source <> 'company_default' THEN CONTINUE; END IF;
    IF FOUND AND v = 'unknown' AND old.value <> 'unknown' THEN CONTINUE; END IF;
    IF FOUND AND old.value = v THEN CONTINUE; END IF;
    INSERT INTO public.mcp_job_flags (job_id, flag_key, value, source) VALUES (_job, k, v, _source)
      ON CONFLICT (job_id, flag_key) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, set_by = auth.uid(), set_at = now();
    changed := changed || k;
    IF v = 'unknown' THEN
      it := public.mcp_open_item_create(_job, jsonb_build_object('check_key', 'flag:' || k, 'kind', 'confirm_unknown',
        'category', 'Applicability', 'section', 'applicability', 'source', _source, 'tool', 'intake',
        'action', 'Confirm whether this applies: ' || replace(k, '_', ' ')));
      IF NOT (it->>'existing')::boolean THEN items := items || it; END IF;
    END IF;
  END LOOP;
  f := public.mcp_job_flagset(_job);
  FOR n IN SELECT * FROM public.mcp_job_na WHERE job_id = _job AND active LOOP
    FOREACH k IN ARRAY changed LOOP
      IF (f->>k) IS DISTINCT FROM 'yes' THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.mcp_latest_setup_checks() c
        WHERE ((n.scope = 'item' AND c.key = n.target) OR (n.scope = 'section' AND c.section = n.target))
          AND jsonb_path_exists(c.applies_when, '$.** ? (@.flag == $k)', jsonb_build_object('k', k))
          AND public.mcp_eval_cond(c.applies_when, f)) THEN
        trig := 'flag:' || k || '=yes';
        pid := NULL;
        INSERT INTO public.mcp_reenable_prompts (na_id, trigger_key) VALUES (n.id, trig) ON CONFLICT DO NOTHING RETURNING id INTO pid;
        IF pid IS NOT NULL THEN
          sugg := sugg || jsonb_build_object('na_id', n.id, 'scope', n.scope, 'target', n.target, 'trigger', replace(k, '_', ' ') || ' is now yes');
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF array_length(changed, 1) > 0 THEN PERFORM public.mcp_audit_job(_job, 'intake', 'flags_set', array_to_string(changed, ',')); END IF;
  RETURN jsonb_build_object('changed', to_jsonb(changed), 'reenable_suggestions', sugg, 'confirm_items', items);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_set_facts(_job uuid, _module text, _facts jsonb, _source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; v jsonb; st text; known text[] := '{}'; unk text[] := '{}';
BEGIN
  PERFORM public.mcp_assert_job(_job);
  IF _module NOT IN ('scope','contract','handoff','budget','sov','warranty') THEN RAISE EXCEPTION 'MCP_BAD:bad module'; END IF;
  IF _source NOT IN ('document','member_answer','company_default') THEN RAISE EXCEPTION 'MCP_BAD:bad source'; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(_facts, '{}'::jsonb)) LOOP
    IF length(k) > 120 THEN CONTINUE; END IF;
    st := CASE WHEN v IS NULL OR v = 'null'::jsonb OR v = '"unknown"'::jsonb OR v = '""'::jsonb THEN 'unknown'
               WHEN v = '"na"'::jsonb THEN 'na' ELSE 'known' END;
    INSERT INTO public.mcp_job_facts (job_id, module, key, value, status, source, internal_only)
      VALUES (_job, _module, k, CASE WHEN st = 'known' THEN v END, st, _source, _module IN ('budget','handoff'))
      ON CONFLICT (job_id, module, key) DO UPDATE SET value = EXCLUDED.value, status = EXCLUDED.status, source = EXCLUDED.source,
        internal_only = EXCLUDED.internal_only, updated_by = auth.uid(), updated_at = now();
    IF st = 'unknown' THEN unk := unk || k; ELSE known := known || k; END IF;
  END LOOP;
  PERFORM public.mcp_audit_job(_job, 'intake', 'facts_' || _module, NULL);
  RETURN jsonb_build_object('known', to_jsonb(known), 'unknown', to_jsonb(unk));
END $$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_item(_item uuid, _kind text, _evidence text, _stated_by text, _stated_on date,
  _reason text, _approval text, _billing text, _collection text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it public.mcp_open_items; ev text := nullif(btrim(_evidence), ''); rgt text; res text; note text;
BEGIN
  PERFORM public.mcp_assert_active();
  SELECT * INTO it FROM public.mcp_open_items WHERE id = _item;
  IF NOT FOUND OR NOT public.mcp_can_access_job(it.job_id) THEN RAISE EXCEPTION 'MCP_NO_ITEM'; END IF;
  IF it.status <> 'open' THEN RAISE EXCEPTION 'MCP_BAD:That item is already closed.'; END IF;
  IF _kind = 'na' THEN RAISE EXCEPTION 'MCP_BAD:N/A is not a resolution. Marking a question or section N/A only stops future questions; this item stays open until it is resolved with evidence or waived by someone with that decision right.'; END IF;

  IF _kind = 'update' THEN
    IF coalesce(btrim(_stated_by), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:A status update needs stated_by (who reported it).'; END IF;
    UPDATE public.mcp_open_items SET verify_state = 'last_reported', reported_by = btrim(_stated_by),
      reported_at = coalesce(_stated_on::timestamptz, now()), updated_at = now() WHERE id = it.id;
    IF ev IS NOT NULL THEN INSERT INTO public.mcp_item_evidence (user_id, item_id, evidence) VALUES (auth.uid(), it.id, left(ev, 10000)); END IF;
    INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id, note) VALUES (auth.uid(), it.id, 'updated', it.lookahead_id, 'last-reported by ' || btrim(_stated_by));
    PERFORM public.mcp_audit_job(it.job_id, 'resolve_item', 'update', it.id::text);
    RETURN jsonb_build_object('closed', false, 'updated', true);
  END IF;

  IF _kind = 'verified' THEN
    IF ev IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Closing needs evidence.'; END IF;
    IF it.kind = 'commercial' THEN RAISE EXCEPTION 'MCP_BAD:Commercial items close only on approval, billing and collection (kind commercial_close), or an authorized drop (kind waive).'; END IF;
    res := 'verified';
  ELSIF _kind = 'member_statement' THEN
    IF it.kind <> 'confirm_unknown' THEN RAISE EXCEPTION 'MCP_BAD:A member statement only closes a confirm item. This item needs evidence (kind verified).'; END IF;
    IF ev IS NULL OR coalesce(btrim(_stated_by), '') = '' OR _stated_on IS NULL THEN
      RAISE EXCEPTION 'MCP_BAD:A member statement needs the statement (evidence), who said it (stated_by) and the date (stated_on).';
    END IF;
    ev := ev || ' — stated by ' || btrim(_stated_by) || ' on ' || _stated_on;
    res := 'member_statement';
  ELSIF _kind = 'waive' THEN
    rgt := CASE WHEN it.kind = 'commercial' THEN
      CASE it.commercial_type WHEN 'co' THEN 'change_orders' WHEN 'retainage' THEN 'write_offs' ELSE 'claims' END
      ELSE 'waive_items' END;
    IF NOT public.mcp_has_right(it.company_id, rgt) THEN
      RAISE EXCEPTION 'MCP_BAD:Only someone with the % decision right can waive or drop this item.', replace(rgt, '_', ' ');
    END IF;
    IF coalesce(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:A waiver needs a reason.'; END IF;
    note := 'waived: ' || btrim(_reason);
    ev := coalesce(ev, note);
    res := CASE WHEN it.kind = 'commercial' THEN 'dropped' ELSE 'waived' END;
  ELSIF _kind = 'commercial_close' THEN
    IF it.kind <> 'commercial' THEN RAISE EXCEPTION 'MCP_BAD:commercial_close is only for change order, REA, claim or retainage items.'; END IF;
    IF coalesce(btrim(_approval), '') = '' OR coalesce(btrim(_billing), '') = '' OR coalesce(btrim(_collection), '') = '' THEN
      RAISE EXCEPTION 'MCP_BAD:A commercial item closes only with approval, billing and collection evidence all provided.';
    END IF;
    ev := 'approval: ' || btrim(_approval) || ' | billing: ' || btrim(_billing) || ' | collection: ' || btrim(_collection) || coalesce(' | ' || ev, '');
    res := 'collected';
  ELSE
    RAISE EXCEPTION 'MCP_BAD:kind must be verified, member_statement, waive, commercial_close or update.';
  END IF;

  INSERT INTO public.mcp_item_evidence (user_id, item_id, evidence) VALUES (auth.uid(), it.id, left(ev, 10000));
  UPDATE public.mcp_open_items SET status = 'resolved', resolution = res, resolved_at = now(), updated_at = now(),
    verify_state = CASE WHEN res IN ('verified','collected') THEN 'verified' ELSE verify_state END,
    verified_evidence = CASE WHEN res IN ('verified','collected') THEN left(ev, 10000) ELSE verified_evidence END,
    verified_at = CASE WHEN res IN ('verified','collected') THEN now() ELSE verified_at END
  WHERE id = it.id;
  INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id, note)
    VALUES (auth.uid(), it.id, CASE WHEN res IN ('waived','dropped') THEN 'waived' ELSE 'resolved' END, it.lookahead_id, coalesce(note, res));
  PERFORM public.mcp_audit_job(it.job_id, 'resolve_item', 'close_' || res, it.id::text);
  RETURN jsonb_build_object('closed', true, 'resolution', res);
END $$;

GRANT SELECT ON public.mcp_companies, public.mcp_company_members, public.mcp_job_access, public.mcp_job_flags,
  public.mcp_job_facts, public.mcp_job_answers, public.mcp_job_na, public.mcp_reenable_prompts TO authenticated;
GRANT ALL ON public.mcp_companies, public.mcp_company_members, public.mcp_job_access, public.mcp_job_flags,
  public.mcp_job_facts, public.mcp_job_answers, public.mcp_job_na, public.mcp_reenable_prompts, public.mcp_audit_log, public.mcp_gate_cache TO service_role;

ALTER TABLE public.mcp_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_na ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_reenable_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_gate_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members read" ON public.mcp_companies FOR SELECT TO authenticated USING (public.mcp_is_company_member(id));
CREATE POLICY "company members read" ON public.mcp_company_members FOR SELECT TO authenticated USING (public.mcp_is_company_member(company_id));
CREATE POLICY "job access read" ON public.mcp_job_access FOR SELECT TO authenticated USING (public.mcp_can_access_job(job_id));
CREATE POLICY "job access read" ON public.mcp_job_flags FOR SELECT TO authenticated USING (public.mcp_can_access_job(job_id));
CREATE POLICY "job access read" ON public.mcp_job_facts FOR SELECT TO authenticated USING (public.mcp_can_access_job(job_id));
CREATE POLICY "job access read" ON public.mcp_job_answers FOR SELECT TO authenticated USING (public.mcp_can_access_job(job_id));
CREATE POLICY "job access read" ON public.mcp_job_na FOR SELECT TO authenticated USING (public.mcp_can_access_job(job_id));
CREATE POLICY "job access read" ON public.mcp_reenable_prompts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_job_na n WHERE n.id = na_id AND public.mcp_can_access_job(n.job_id)));
CREATE POLICY "company job read" ON public.mcp_jobs FOR SELECT TO authenticated USING (company_id IS NOT NULL AND public.mcp_can_access_job(id));
CREATE POLICY "company job read" ON public.mcp_lookaheads FOR SELECT TO authenticated USING (public.mcp_can_access_job(job_id));
CREATE POLICY "company job read" ON public.mcp_open_items FOR SELECT TO authenticated USING (public.mcp_can_access_job(job_id));
CREATE POLICY "company job read" ON public.mcp_item_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.id = item_id AND public.mcp_can_access_job(i.job_id)));
CREATE POLICY "company job read" ON public.mcp_item_evidence FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.id = item_id AND public.mcp_can_access_job(i.job_id)));

REVOKE ALL ON FUNCTION public.mcp_member_role(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_is_company_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_can_access_job(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_has_right(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_gate() FROM anon;
REVOKE ALL ON FUNCTION public.mcp_assert_active() FROM anon;
REVOKE ALL ON FUNCTION public.mcp_assert_job(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_audit(uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_audit_job(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_open_item_create(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_eval_cond(jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_job_flagset(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_latest_setup_checks() FROM anon;
REVOKE ALL ON FUNCTION public.mcp_company_save(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_member_add(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_job_create(uuid, text, text, text[]) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_resolve_job(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_add_item(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_next_check(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_answer(uuid, text, text, text, text, date) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_mark_na(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_reenable(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_decline_reenable(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_set_flags(uuid, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_set_facts(uuid, text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_resolve_item(uuid, text, text, text, date, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mcp_member_role(uuid), public.mcp_is_company_member(uuid), public.mcp_can_access_job(uuid),
  public.mcp_has_right(uuid, text), public.mcp_gate(), public.mcp_assert_active(), public.mcp_audit(uuid, text, text, text, text),
  public.mcp_company_save(uuid, jsonb), public.mcp_member_add(uuid, text, text, text), public.mcp_job_create(uuid, text, text, text[]),
  public.mcp_resolve_job(uuid, text), public.mcp_add_item(uuid, jsonb), public.mcp_next_check(uuid),
  public.mcp_answer(uuid, text, text, text, text, date), public.mcp_mark_na(uuid, text, text, text), public.mcp_reenable(uuid, text, text),
  public.mcp_decline_reenable(uuid, uuid), public.mcp_set_flags(uuid, jsonb, text), public.mcp_set_facts(uuid, text, jsonb, text),
  public.mcp_resolve_item(uuid, text, text, text, date, text, text, text, text) TO authenticated;

INSERT INTO public.mcp_checklist_items (key, version, category, trade, prompt, rule_type, required_inputs, severity, position, is_placeholder, module, section, applies_when, record_ref) VALUES
 ('setup_contract_on_file', 1, 'Contract', 'general', 'PLACEHOLDER: Is the executed contract, with general and supplementary conditions, on file for this job?', 'confirm', '{}', 'high', 100, true, 'job_setup', 'contract', '{}', NULL),
 ('setup_delay_notice', 1, 'Contract', 'general', 'PLACEHOLDER: Confirm the delay notice deadline and the clause it comes from.', 'confirm', '{}', 'high', 110, true, 'job_setup', 'contract', '{}', 'contract.notice_timing'),
 ('setup_retainage_terms', 1, 'Contract', 'general', 'PLACEHOLDER: Confirm the retainage percentage and reduction terms.', 'confirm', '{}', 'high', 120, true, 'job_setup', 'contract', '{"flag":"has_retainage","in":["yes"]}', 'contract.retainage'),
 ('setup_beneficial_use', 1, 'Contract', 'general', 'PLACEHOLDER: Confirm the beneficial use clause and what it triggers.', 'confirm', '{}', 'medium', 130, true, 'job_setup', 'contract', '{"flag":"beneficial_use","in":["yes"]}', 'contract.beneficial_use_clause'),
 ('setup_savings_split', 1, 'Contract', 'general', 'PLACEHOLDER: Confirm the savings split terms.', 'confirm', '{}', 'medium', 140, true, 'job_setup', 'contract', '{"any":[{"flag":"pricing_gmp","in":["yes"]},{"flag":"pricing_cost_plus","in":["yes"]}]}', 'contract.savings_split'),
 ('setup_public_requirements', 1, 'Public work', 'general', 'PLACEHOLDER: Are public-work requirements (wage rates, certified payroll, bonds) identified for this job?', 'confirm', '{}', 'high', 200, true, 'job_setup', 'public_requirements', '{"flag":"public_job","in":["yes"]}', NULL),
 ('setup_sub_qualifications', 1, 'Subcontracts', 'general', 'PLACEHOLDER: Are subcontractor qualifications and scopes confirmed for every subcontracted package?', 'confirm', '{}', 'high', 300, true, 'job_setup', 'subcontracts', '{"flag":"has_subcontracts","in":["yes"]}', 'handoff.sub_qualifications'),
 ('setup_equipment_lead_times', 1, 'Equipment', 'general', 'PLACEHOLDER: Are lead times and release dates confirmed for all major equipment?', 'confirm', '{}', 'high', 400, true, 'job_setup', 'equipment', '{"flag":"major_equipment","in":["yes"]}', NULL),
 ('setup_workmanship_warranty', 1, 'Warranty', 'general', 'PLACEHOLDER: Confirm the workmanship warranty period and what starts it.', 'confirm', '{}', 'medium', 500, true, 'job_setup', 'warranty', '{}', 'warranty.workmanship'),
 ('setup_residential_disclosures', 1, 'Residential', 'general', 'PLACEHOLDER: Are residential disclosures and homeowner notices identified?', 'confirm', '{}', 'medium', 600, true, 'job_setup', 'residential', '{"flag":"residential","in":["yes"]}', NULL);