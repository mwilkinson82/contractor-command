ALTER TABLE public.mcp_checklist_items
  ADD COLUMN IF NOT EXISTS display_label text,
  ADD COLUMN IF NOT EXISTS no_recommendation text,
  ADD COLUMN IF NOT EXISTS sets_flag text,
  ADD COLUMN IF NOT EXISTS no_is_gap boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

ALTER TABLE public.mcp_company_members DROP CONSTRAINT IF EXISTS mcp_company_members_role_check;
ALTER TABLE public.mcp_company_members ADD CONSTRAINT mcp_company_members_role_check
  CHECK (role = ANY (ARRAY['owner','pm','all_access','finance','estimating','contracts','super']));

-- 'full' | 'contract' | NULL (no access)
CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN m.role = 'super' THEN NULL
    WHEN j.restricted AND m.role NOT IN ('owner','all_access')
      AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN NULL
    WHEN m.role IN ('estimating','contracts') THEN 'contract'
    ELSE 'full' END
  FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
  WHERE j.id = _job
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_job_scope(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.mcp_can_access_job(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.mcp_job_scope(_job) = 'full', false)
$$;

CREATE OR REPLACE FUNCTION public.mcp_can_access_contract(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.mcp_job_scope(_job) IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_can_access_contract(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.mcp_is_company_member(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role <> 'super')
$$;

CREATE OR REPLACE FUNCTION public.mcp_contract_check_key(_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_checklist_items WHERE key = _key AND section = 'contract_time')
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_contract_check_key(text) FROM anon;

-- Contract-only read policies (estimating / contracts)
CREATE POLICY "contract scope job read" ON public.mcp_jobs FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND public.mcp_can_access_contract(id));
CREATE POLICY "contract scope facts read" ON public.mcp_job_facts FOR SELECT TO authenticated
  USING (module = 'contract' AND public.mcp_can_access_contract(job_id));
CREATE POLICY "contract scope answers read" ON public.mcp_job_answers FOR SELECT TO authenticated
  USING (public.mcp_contract_check_key(check_key) AND public.mcp_can_access_contract(job_id));
CREATE POLICY "contract scope items read" ON public.mcp_open_items FOR SELECT TO authenticated
  USING (section IN ('contract_time','contract') AND public.mcp_can_access_contract(job_id));
CREATE POLICY "contract scope na read" ON public.mcp_job_na FOR SELECT TO authenticated
  USING (target = 'contract_time' OR public.mcp_contract_check_key(target)) ;

CREATE OR REPLACE FUNCTION public.mcp_resolve_job(_company uuid, _job_number text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE j public.mcp_jobs; q text := lower(btrim(coalesce(_job_number, ''))); sug jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE company_id = _company AND job_number = btrim(_job_number) AND public.mcp_can_access_contract(id);
  IF FOUND THEN RETURN jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'name', j.name, 'company_id', j.company_id, 'scope', public.mcp_job_scope(j.id)); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('job_number', job_number, 'name', name)), '[]'::jsonb) INTO sug FROM (
    SELECT job_number, name FROM public.mcp_jobs
    WHERE company_id = _company AND public.mcp_can_access_contract(id) AND q <> ''
      AND (strpos(lower(name), q) > 0 OR strpos(lower(job_number), q) > 0)
    ORDER BY created_at DESC LIMIT 3) s;
  RETURN jsonb_build_object('not_found', true, 'suggestions', sug);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_assert_job_scope(_job uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s text;
BEGIN
  PERFORM public.mcp_assert_active();
  s := public.mcp_job_scope(_job);
  IF s IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  RETURN s;
END $function$;
REVOKE EXECUTE ON FUNCTION public.mcp_assert_job_scope(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.mcp_next_check(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE f jsonb; c public.mcp_checklist_items; rv jsonb; total int := 0; idx int := 0; found_c public.mcp_checklist_items; found_idx int; sc text;
BEGIN
  sc := public.mcp_assert_job_scope(_job);
  f := public.mcp_job_flagset(_job);
  FOR c IN SELECT * FROM public.mcp_latest_setup_checks() LOOP
    IF sc = 'contract' AND c.section IS DISTINCT FROM 'contract_time' THEN CONTINUE; END IF;
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
    'label', found_c.display_label, 'trade', found_c.trade, 'severity', found_c.severity, 'prompt', found_c.prompt,
    'record_value', rv, 'index', found_idx, 'total', total);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_answer(_job uuid, _key text, _answer text, _detail text, _owner text, _needed_by date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE nc jsonb; item jsonb; d text := nullif(btrim(_detail), ''); c public.mcp_checklist_items; rec text; fl jsonb;
BEGIN
  PERFORM public.mcp_assert_job_scope(_job);
  IF _answer NOT IN ('yes','no','na','unknown') THEN RAISE EXCEPTION 'MCP_BAD:response must be yes, no, na or unknown.'; END IF;
  nc := public.mcp_next_check(_job);
  IF nc IS NULL THEN RAISE EXCEPTION 'MCP_BAD:All setup questions for this job are answered.'; END IF;
  IF nc->>'key' <> _key THEN RAISE EXCEPTION 'MCP_BAD:That isn''t the current question. Call next_question and answer the check it returns.'; END IF;
  IF _answer = 'na' AND d IS NULL THEN RAISE EXCEPTION 'MCP_BAD:N/A needs a reason in detail.'; END IF;
  SELECT * INTO c FROM public.mcp_checklist_items WHERE key = _key AND version = (nc->>'version')::int;
  INSERT INTO public.mcp_job_answers (job_id, check_key, check_version, answer, detail)
    VALUES (_job, _key, (nc->>'version')::int, _answer, d)
    ON CONFLICT (job_id, check_key) DO UPDATE SET answer = EXCLUDED.answer, detail = EXCLUDED.detail,
      check_version = EXCLUDED.check_version, answered_by = auth.uid(), answered_at = now();
  IF c.sets_flag IS NOT NULL AND _answer IN ('yes','no') THEN
    fl := jsonb_build_object(c.sets_flag, _answer);
    IF c.sets_flag = 'is_gc' THEN fl := fl || jsonb_build_object('is_sub', CASE WHEN _answer = 'yes' THEN 'no' ELSE 'yes' END); END IF;
    PERFORM public.mcp_set_flags(_job, fl, 'member_answer');
  END IF;
  IF _answer = 'na' THEN
    INSERT INTO public.mcp_job_na (job_id, scope, target, reason) VALUES (_job, 'item', _key, d) ON CONFLICT DO NOTHING;
  ELSIF _answer = 'unknown' OR (_answer = 'no' AND c.no_is_gap) THEN
    item := public.mcp_open_item_create(_job, jsonb_build_object(
      'check_key', 'setup:' || _key, 'check_version', nc->>'version', 'trade', nc->>'trade', 'category', nc->>'category',
      'severity', nc->>'severity', 'section', nc->>'section', 'tool', 'answer',
      'kind', CASE WHEN _answer = 'unknown' THEN 'confirm_unknown' ELSE 'gap' END,
      'action', CASE WHEN _answer = 'unknown' THEN 'Confirm: ' ELSE 'Resolve: ' END
        || coalesce(c.display_label || ' ', '') || regexp_replace(nc->>'prompt', '^PLACEHOLDER:\s*', ''),
      'detail', d, 'accountable', _owner, 'needed_by', _needed_by));
    IF _answer = 'no' THEN rec := c.no_recommendation; END IF;
  END IF;
  PERFORM public.mcp_audit_job(_job, 'answer', 'answer_' || _answer, _key);
  RETURN jsonb_build_object('recorded', _answer, 'item', item, 'recommendation', rec);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_set_facts(_job uuid, _module text, _facts jsonb, _source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE k text; v jsonb; st text; known text[] := '{}'; unk text[] := '{}'; sc text;
BEGIN
  sc := public.mcp_assert_job_scope(_job);
  IF _module NOT IN ('scope','contract','handoff','budget','sov','warranty') THEN RAISE EXCEPTION 'MCP_BAD:bad module'; END IF;
  IF sc = 'contract' AND _module <> 'contract' THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
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
END $function$;