CREATE POLICY "company job scope read guard" ON public.mcp_lookaheads AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.mcp_jobs j WHERE j.id = mcp_lookaheads.job_id AND j.company_id IS NOT NULL) OR public.mcp_can_access_job(job_id));
CREATE POLICY "company job scope update guard" ON public.mcp_lookaheads AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.mcp_jobs j WHERE j.id = mcp_lookaheads.job_id AND j.company_id IS NOT NULL) OR public.mcp_can_access_job(job_id));
CREATE POLICY "company job scope delete guard" ON public.mcp_lookaheads AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.mcp_jobs j WHERE j.id = mcp_lookaheads.job_id AND j.company_id IS NOT NULL) OR public.mcp_can_access_job(job_id));