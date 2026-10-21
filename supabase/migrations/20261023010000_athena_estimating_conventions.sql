-- Estimator profile for takeoff conventions. Additive only: one table and two functions.
-- Does not change takeoff lines, gaps, or the bid tables.
-- NOT APPLIED until this migration is reviewed.

CREATE TABLE IF NOT EXISTS public.mcp_estimate_profiles (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  profile text NOT NULL CHECK (profile IN ('as_drawn', 'estimator')),
  forms_faces integer NOT NULL DEFAULT 1 CHECK (forms_faces IN (1, 2)),
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_estimate_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estimate profile read by contract scope" ON public.mcp_estimate_profiles;
CREATE POLICY "estimate profile read by contract scope" ON public.mcp_estimate_profiles FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_profiles FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_estimate_profiles TO authenticated;
GRANT ALL ON public.mcp_estimate_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_estimate_profile_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_estimate_profiles;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  SELECT * INTO r FROM public.mcp_estimate_profiles WHERE job_id = _job;
  IF r.job_id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'profile', r.profile, 'forms_faces', r.forms_faces);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_profile_get(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_profile_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_profile_save(_job uuid, _profile text, _faces integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF _profile NOT IN ('as_drawn', 'estimator') THEN RAISE EXCEPTION 'MCP_BAD:The profile is as drawn or estimator. Nothing was saved.'; END IF;
  IF coalesce(_faces, 1) NOT IN (1, 2) THEN RAISE EXCEPTION 'MCP_BAD:Forms faces are 1 or 2. Nothing was saved.'; END IF;
  INSERT INTO public.mcp_estimate_profiles (job_id, company_id, profile, forms_faces)
  VALUES (_job, cid, _profile, coalesce(_faces, 1))
  ON CONFLICT (job_id) DO UPDATE SET profile = EXCLUDED.profile, forms_faces = EXCLUDED.forms_faces, updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('saved', true, 'profile', _profile, 'forms_faces', coalesce(_faces, 1));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_profile_save(uuid, text, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_profile_save(uuid, text, integer) TO authenticated;
