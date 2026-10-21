-- Athena accounting phase 1: foundations plus decision D1 (retainage per job, from the contract).
-- Additive only: three new tables and five functions. No drops, no deletes, no changes to existing rows or tables.
-- NOT APPLIED. Apply only after Marshall's yes.
--
-- 1. mcp_retainage_rules      the saved retainage rule per job, append-only versions (D1: no global default).
-- 2. mcp_number_sequences     numbers that can't double-assign when two people save at once (T-007, RFI-008, App 04).
-- 3. mcp_record_versions      version + stamp + change log line for every living master (logs, ledger, project record).
-- Money is never stored as floating point here: rates are integer basis points (1000 = 10%).

-- ---------- 1. Retainage rule per job ----------
CREATE TABLE IF NOT EXISTS public.mcp_retainage_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  base_rate_bp integer NOT NULL CHECK (base_rate_bp BETWEEN 0 AND 10000),
  reduction text NOT NULL CHECK (reduction IN ('prospective', 'whole_balance', 'period_start_status', 'none')),
  threshold_bp integer CHECK (threshold_bp IS NULL OR threshold_bp BETWEEN 1 AND 10000),
  threshold_basis text CHECK (threshold_basis IS NULL OR threshold_basis IN ('contract_sum_to_date', 'original_contract')),
  reduced_rate_bp integer CHECK (reduced_rate_bp IS NULL OR reduced_rate_bp BETWEEN 0 AND 10000),
  release_terms text,
  source text NOT NULL CHECK (source IN ('contract', 'pm_answer')),
  clause_section text,
  clause_text text,
  answered_by text,
  change_what text NOT NULL,
  saved_by uuid NOT NULL DEFAULT auth.uid(),
  saved_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, version),
  CHECK (
    (reduction = 'none' AND threshold_bp IS NULL AND reduced_rate_bp IS NULL)
    OR (reduction <> 'none' AND threshold_bp IS NOT NULL AND threshold_basis IS NOT NULL AND reduced_rate_bp IS NOT NULL AND reduced_rate_bp <= base_rate_bp)
  ),
  CHECK (
    (source = 'contract' AND coalesce(btrim(clause_text), '') <> '' AND coalesce(btrim(clause_section), '') <> '')
    OR (source = 'pm_answer' AND coalesce(btrim(answered_by), '') <> '')
  )
);
CREATE INDEX IF NOT EXISTS mcp_retainage_rules_job_idx ON public.mcp_retainage_rules (job_id, version DESC);

ALTER TABLE public.mcp_retainage_rules ENABLE ROW LEVEL SECURITY;
-- Direct reads: full job scope only. No INSERT/UPDATE/DELETE policy: writes go only through mcp_retainage_rule_save.
DROP POLICY IF EXISTS "retainage rule read full scope" ON public.mcp_retainage_rules;
CREATE POLICY "retainage rule read full scope" ON public.mcp_retainage_rules FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
GRANT SELECT ON public.mcp_retainage_rules TO authenticated;
GRANT ALL ON public.mcp_retainage_rules TO service_role;

-- Latest saved rule. Full and contract roles (contract terms); not the Super view.
CREATE OR REPLACE FUNCTION public.mcp_retainage_rule_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text := public.mcp_job_scope(_job); r public.mcp_retainage_rules;
BEGIN
  PERFORM public.mcp_assert_active();
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:Your role has a limited, read-only view of this job (no financials).'; END IF;
  SELECT * INTO r FROM public.mcp_retainage_rules WHERE job_id = _job ORDER BY version DESC LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('found', false, 'version', 0); END IF;
  RETURN jsonb_build_object('found', true, 'version', r.version, 'base_rate_bp', r.base_rate_bp, 'reduction', r.reduction,
    'threshold_bp', r.threshold_bp, 'threshold_basis', r.threshold_basis, 'reduced_rate_bp', r.reduced_rate_bp,
    'release_terms', r.release_terms, 'source', r.source, 'clause_section', r.clause_section, 'clause_text', r.clause_text,
    'answered_by', r.answered_by, 'updated_at', r.created_at, 'updated_by_name', r.saved_by_name);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_retainage_rule_get(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_retainage_rule_get(uuid) TO authenticated;

-- Save the next version after the user said yes. Full job scope only; base_version must be current.
CREATE OR REPLACE FUNCTION public.mcp_retainage_rule_save(_job uuid, _base_version integer, _rule jsonb, _what text, _who text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur integer; nid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF coalesce(btrim(_what), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:Say what changed in this version.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':retainage_rule'));
  SELECT coalesce(max(version), 0) INTO cur FROM public.mcp_retainage_rules WHERE job_id = _job;
  IF coalesce(_base_version, 0) <> cur THEN RAISE EXCEPTION 'MCP_BAD:The retainage rule moved to v%. Reload first.', cur; END IF;
  INSERT INTO public.mcp_retainage_rules (job_id, version, base_rate_bp, reduction, threshold_bp, threshold_basis, reduced_rate_bp,
    release_terms, source, clause_section, clause_text, answered_by, change_what, saved_by_name)
  VALUES (_job, cur + 1, (_rule->>'base_rate_bp')::integer, _rule->>'reduction', (_rule->>'threshold_bp')::integer, _rule->>'threshold_basis',
    (_rule->>'reduced_rate_bp')::integer, nullif(btrim(coalesce(_rule->>'release_terms', '')), ''), _rule->>'source',
    nullif(btrim(coalesce(_rule->>'clause_section', '')), ''), _rule->>'clause_text', nullif(btrim(coalesce(_rule->>'answered_by', '')), ''),
    btrim(_what), _who)
  RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'version', cur + 1);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_retainage_rule_save(uuid, integer, jsonb, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_retainage_rule_save(uuid, integer, jsonb, text, text) TO authenticated;

-- ---------- 2. Number sequences ----------
-- Scoped by company, and by job when job_id is set, so per-job or per-company numbering (decision D10) both fit.
CREATE TABLE IF NOT EXISTS public.mcp_number_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  seq_type text NOT NULL CHECK (seq_type ~ '^[a-z_]{2,40}$'),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_number_sequences_scope_uq
  ON public.mcp_number_sequences (company_id, coalesce(job_id, '00000000-0000-0000-0000-000000000000'::uuid), seq_type);
ALTER TABLE public.mcp_number_sequences ENABLE ROW LEVEL SECURITY;
-- No direct policies: read and advance only through mcp_next_number.
GRANT ALL ON public.mcp_number_sequences TO service_role;

-- Atomically take the next number. One row update under a row lock, so two saves at once get 7 and 8, never 7 twice.
CREATE OR REPLACE FUNCTION public.mcp_next_number(_company uuid, _job uuid, _seq_type text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _job IS NOT NULL THEN
    IF coalesce(public.mcp_job_scope(_job) IN ('full'), false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mcp_jobs WHERE id = _job AND company_id = _company) THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role IN ('owner', 'all_access')) THEN
    RAISE EXCEPTION 'MCP_NO_COMPANY';
  END IF;
  INSERT INTO public.mcp_number_sequences AS s (company_id, job_id, seq_type, last_number)
  VALUES (_company, _job, _seq_type, 1)
  ON CONFLICT (company_id, coalesce(job_id, '00000000-0000-0000-0000-000000000000'::uuid), seq_type)
  DO UPDATE SET last_number = s.last_number + 1, updated_at = now()
  RETURNING last_number INTO n;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_next_number(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_next_number(uuid, uuid, text) TO authenticated;

-- ---------- 3. Version and stamp for every living master ----------
CREATE TABLE IF NOT EXISTS public.mcp_record_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type ~ '^[a-z_]{2,40}$'),
  version integer NOT NULL CHECK (version >= 1),
  as_of date,
  time_zone text NOT NULL,
  change_what text NOT NULL,
  ties jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_by uuid NOT NULL DEFAULT auth.uid(),
  saved_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, record_type, version)
);
CREATE INDEX IF NOT EXISTS mcp_record_versions_job_idx ON public.mcp_record_versions (job_id, record_type, version DESC);
ALTER TABLE public.mcp_record_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "record versions read job scope" ON public.mcp_record_versions;
CREATE POLICY "record versions read job scope" ON public.mcp_record_versions FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
GRANT SELECT ON public.mcp_record_versions TO authenticated;
GRANT ALL ON public.mcp_record_versions TO service_role;

-- Next version of a master after a yes. base_version must be current ("moved to v4, reload first").
CREATE OR REPLACE FUNCTION public.mcp_record_version_bump(_job uuid, _type text, _base_version integer, _as_of date, _tz text, _what text, _ties jsonb, _who text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur integer; nid uuid; at timestamptz;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF coalesce(btrim(_what), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:Say what changed in this version.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':' || _type));
  SELECT coalesce(max(version), 0) INTO cur FROM public.mcp_record_versions WHERE job_id = _job AND record_type = _type;
  IF coalesce(_base_version, 0) <> cur THEN RAISE EXCEPTION 'MCP_BAD:Moved to v%. Reload first.', cur; END IF;
  INSERT INTO public.mcp_record_versions (job_id, record_type, version, as_of, time_zone, change_what, ties, saved_by_name)
  VALUES (_job, _type, cur + 1, _as_of, coalesce(nullif(btrim(_tz), ''), 'America/New_York'), btrim(_what), coalesce(_ties, '{}'::jsonb), _who)
  RETURNING id, created_at INTO nid, at;
  RETURN jsonb_build_object('id', nid, 'version', cur + 1, 'at', at);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_record_version_bump(uuid, text, integer, date, text, text, jsonb, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_record_version_bump(uuid, text, integer, date, text, text, jsonb, text) TO authenticated;
