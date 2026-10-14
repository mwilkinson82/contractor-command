CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN m.role = 'super' THEN NULL
    WHEN j.restricted AND m.role NOT IN ('owner','all_access','finance')
      AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN NULL
    WHEN m.role IN ('estimating','contracts') THEN 'contract'
    ELSE 'full' END
  FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
  WHERE j.id = _job
$$;