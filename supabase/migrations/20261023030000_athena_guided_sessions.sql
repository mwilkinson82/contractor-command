-- Guided meeting snapshots for the next IOR comparison. Additive only: one table, two functions.
-- Does not change jobs, open items, living reports, or lookaheads.
-- NOT APPLIED until this migration is reviewed.

CREATE TABLE IF NOT EXISTS public.mcp_guided_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  flow text NOT NULL CHECK (flow IN ('pm_meeting', 'pm_morning', 'pm_evening')),
  stage text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_guided_sessions_job_idx ON public.mcp_guided_sessions (job_id, flow, created_at DESC);

ALTER TABLE public.mcp_guided_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "guided session read full scope" ON public.mcp_guided_sessions;
CREATE POLICY "guided session read full scope" ON public.mcp_guided_sessions FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
REVOKE INSERT, UPDATE, DELETE ON public.mcp_guided_sessions FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_guided_sessions TO authenticated;
GRANT ALL ON public.mcp_guided_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_guided_save(_job uuid, _flow text, _stage text, _snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE nid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF _flow NOT IN ('pm_meeting', 'pm_morning', 'pm_evening') THEN RAISE EXCEPTION 'MCP_BAD:Unknown meeting.'; END IF;
  IF coalesce(btrim(_stage), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:Name the stage.'; END IF;
  INSERT INTO public.mcp_guided_sessions (job_id, flow, stage, snapshot)
  VALUES (_job, _flow, btrim(_stage), coalesce(_snapshot, '{}'::jsonb))
  RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_guided_save(uuid, text, text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_guided_save(uuid, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_guided_latest(_job uuid, _flow text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_guided_sessions;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF _flow NOT IN ('pm_meeting', 'pm_morning', 'pm_evening') THEN RAISE EXCEPTION 'MCP_BAD:Unknown meeting.'; END IF;
  SELECT * INTO r FROM public.mcp_guided_sessions WHERE job_id = _job AND flow = _flow ORDER BY created_at DESC LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'stage', r.stage, 'snapshot', r.snapshot, 'at', r.created_at);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_guided_latest(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_guided_latest(uuid, text) TO authenticated;
