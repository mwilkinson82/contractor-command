-- Rollback for 20261022120000_athena_account_team_privacy_terms.sql. Restores the 20261021190000 job scope (PM creator
-- clause) and drops the new guards and the Terms function. The acceptance table is KEPT on purpose (it is a record of
-- who agreed); drop it only with Marshall's word (last line, commented).
CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT public.mcp_role_allowed(j.company_id, m.role) THEN NULL
    WHEN m.role = 'super' THEN CASE WHEN EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid())
      THEN 'super' ELSE NULL END
    WHEN m.role IN ('owner','all_access','ap') THEN 'full'
    WHEN m.role = 'pm' THEN CASE WHEN j.pm_user_id = auth.uid() OR j.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN 'full' ELSE NULL END
    WHEN j.restricted AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN NULL
    WHEN m.role IN ('estimating','contracts') THEN 'contract'
    ELSE 'full' END
  FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
  WHERE j.id = _job
$$;
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_jobs;
DROP POLICY IF EXISTS "company job scope update guard" ON public.mcp_jobs;
DROP POLICY IF EXISTS "company job scope delete guard" ON public.mcp_jobs;
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_answers;
DROP POLICY IF EXISTS "company job scope update guard" ON public.mcp_answers;
DROP POLICY IF EXISTS "company job scope delete guard" ON public.mcp_answers;
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_item_events;
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_item_evidence;
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_carry_forwards;
DROP FUNCTION IF EXISTS public.mcp_accept_terms(text,text,text,text,text);
-- DROP TABLE IF EXISTS public.mcp_terms_acceptances;  -- only with Marshall's word: deletes acceptance records
