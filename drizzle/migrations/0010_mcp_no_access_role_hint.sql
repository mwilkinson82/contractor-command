CREATE OR REPLACE FUNCTION public.mcp_caller_is_no_access_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE user_id = auth.uid() AND role = 'super')
     AND NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE user_id = auth.uid() AND role <> 'super')
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_caller_is_no_access_role() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_caller_is_no_access_role() TO authenticated;