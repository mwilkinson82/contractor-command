-- Athena accounting Phase 5: job cost import and ledger. Additive only. STAGED, NOT APPLIED.
-- Money is bigint cents. Dollars: full job scope only (owner, all-access, accounting, a PM on own job). Supers see none.
CREATE TABLE IF NOT EXISTS public.mcp_job_cost_imports (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  source text NOT NULL,
  rows jsonb NOT NULL,
  control_total bigint NOT NULL,
  imported_by uuid DEFAULT auth.uid(),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mcp_ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version integer NOT NULL,
  contract_sum bigint NOT NULL,
  estimate_total bigint NOT NULL,
  retainage_held bigint NOT NULL,
  lines jsonb NOT NULL,
  ties jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, version)
);
ALTER TABLE public.mcp_job_cost_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_ledgers ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcp_job_cost_imports_read ON public.mcp_job_cost_imports FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
CREATE POLICY mcp_ledgers_read ON public.mcp_ledgers FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));

CREATE OR REPLACE FUNCTION public.mcp_job_costs_import(_job uuid, _source text, _rows jsonb, _control_total bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  INSERT INTO public.mcp_job_cost_imports (job_id, source, rows, control_total) VALUES (_job, _source, _rows, _control_total)
  ON CONFLICT (job_id) DO UPDATE SET source = excluded.source, rows = excluded.rows, control_total = excluded.control_total, imported_by = auth.uid(), imported_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.mcp_ledger_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.mcp_ledgers; v public.mcp_record_versions; i public.mcp_job_cost_imports;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job.'; END IF;
  SELECT * INTO l FROM public.mcp_ledgers WHERE job_id = _job ORDER BY version DESC LIMIT 1;
  SELECT * INTO v FROM public.mcp_record_versions WHERE job_id = _job AND record_type = 'ledger' ORDER BY version DESC LIMIT 1;
  SELECT * INTO i FROM public.mcp_job_cost_imports WHERE job_id = _job;
  RETURN jsonb_build_object('version', coalesce(l.version, 0), 'at', v.created_at, 'by', v.saved_by_name,
    'contract_sum', coalesce(l.contract_sum, 0), 'estimate_total', coalesce(l.estimate_total, 0), 'retainage_held', coalesce(l.retainage_held, 0),
    'lines', coalesce(l.lines, '[]'::jsonb),
    'import', CASE WHEN i.job_id IS NULL THEN NULL ELSE jsonb_build_object('rows', i.rows, 'control_total', i.control_total, 'source', i.source) END);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_ledger_save(_job uuid, _base_version integer, _ledger jsonb, _ties jsonb, _what text, _who text, _tz text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_ties) t WHERE (t->>'ok')::boolean IS NOT TRUE) THEN RAISE EXCEPTION 'MCP_BAD:A tie misses. Zero tolerance; nothing was saved.'; END IF;
  v := public.mcp_record_version_bump(_job, 'ledger', _base_version, current_date, _tz, _what, _ties, _who);
  INSERT INTO public.mcp_ledgers (job_id, version, contract_sum, estimate_total, retainage_held, lines, ties)
  VALUES (_job, (v->>'version')::integer, (_ledger->>'contract_sum')::bigint, (_ledger->>'estimate_total')::bigint, (_ledger->>'retainage_held')::bigint, _ledger->'lines', _ties);
  RETURN jsonb_build_object('version', (v->>'version')::integer);
END $$;

REVOKE EXECUTE ON FUNCTION public.mcp_job_costs_import(uuid, text, jsonb, bigint) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_ledger_get(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_ledger_save(uuid, integer, jsonb, jsonb, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_job_costs_import(uuid, text, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ledger_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ledger_save(uuid, integer, jsonb, jsonb, text, text, text) TO authenticated;
