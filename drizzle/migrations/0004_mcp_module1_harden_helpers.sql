-- Internal helpers run with the caller's rights so signed-in users can't use them to read checklist rules or bypass job access.
ALTER FUNCTION public.mcp_latest_setup_checks() SECURITY INVOKER;
ALTER FUNCTION public.mcp_job_flagset(uuid) SECURITY INVOKER;
ALTER FUNCTION public.mcp_open_item_create(uuid, jsonb) SECURITY INVOKER;
ALTER FUNCTION public.mcp_audit_job(uuid, text, text, text) SECURITY INVOKER;

-- Writes to company jobs only for members with job access (additive restrictive policies).
CREATE POLICY "company job write guard" ON public.mcp_open_items AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.mcp_jobs j WHERE j.id = job_id AND j.company_id IS NOT NULL) OR public.mcp_can_access_job(job_id));
CREATE POLICY "company job write guard" ON public.mcp_lookaheads AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.mcp_jobs j WHERE j.id = job_id AND j.company_id IS NOT NULL) OR public.mcp_can_access_job(job_id));
CREATE POLICY "company job update guard" ON public.mcp_open_items AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (company_id IS NULL OR public.mcp_can_access_job(job_id));