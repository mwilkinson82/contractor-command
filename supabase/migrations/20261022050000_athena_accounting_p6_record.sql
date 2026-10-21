-- Athena accounting Phase 6: Project Record versions. Additive only. STAGED, NOT APPLIED.
-- D9: dollar sections are saved only by full scope (owner, all-access, accounting, a PM on own job).
CREATE TABLE IF NOT EXISTS public.mcp_project_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version integer NOT NULL,
  sections jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, version)
);
ALTER TABLE public.mcp_project_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcp_project_records_read ON public.mcp_project_records FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));

CREATE OR REPLACE FUNCTION public.mcp_project_record_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_project_records;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job.'; END IF;
  SELECT * INTO r FROM public.mcp_project_records WHERE job_id = _job ORDER BY version DESC LIMIT 1;
  RETURN jsonb_build_object('version', coalesce(r.version, 0), 'sections', r.sections, 'at', r.created_at);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_project_record_save(_job uuid, _base_version integer, _sections jsonb, _what text, _who text, _tz text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  v := public.mcp_record_version_bump(_job, 'project_record', _base_version, current_date, _tz, _what, NULL, _who);
  INSERT INTO public.mcp_project_records (job_id, version, sections) VALUES (_job, (v->>'version')::integer, _sections);
  RETURN jsonb_build_object('version', (v->>'version')::integer);
END $$;

REVOKE EXECUTE ON FUNCTION public.mcp_project_record_get(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_project_record_save(uuid, integer, jsonb, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_project_record_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_record_save(uuid, integer, jsonb, text, text, text) TO authenticated;
