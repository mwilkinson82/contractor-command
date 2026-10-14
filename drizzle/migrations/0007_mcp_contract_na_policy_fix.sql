DROP POLICY IF EXISTS "contract scope na read" ON public.mcp_job_na;
CREATE POLICY "contract scope na read" ON public.mcp_job_na FOR SELECT TO authenticated
  USING ((target = 'contract_time' OR public.mcp_contract_check_key(target)) AND public.mcp_can_access_contract(job_id));