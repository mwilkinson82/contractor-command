CREATE OR REPLACE FUNCTION public.mcp_report_share_open(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.mcp_report_shares; j public.mcp_jobs; r public.mcp_living_reports; co text; logo text;
BEGIN
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.mcp_report_shares WHERE token_hash = _token_hash AND revoked_at IS NULL AND expires_at > now();
  IF s.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.mcp_report_shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = s.id;
  SELECT name, logo_url INTO co, logo FROM public.mcp_companies WHERE id = s.company_id;
  IF s.page = 'portfolio' THEN
    RETURN jsonb_build_object('page', 'portfolio', 'company', co, 'company_logo_url', logo, 'jobs', public.mcp_report_portfolio_rows(s.company_id, true), 'money', true, 'shared', true, 'expires_at', s.expires_at);
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = s.job_id;
  SELECT * INTO r FROM public.mcp_living_reports WHERE job_id = s.job_id AND report_type = CASE WHEN s.page = 'schedule' THEN 'cpm' ELSE 'ior' END ORDER BY version DESC LIMIT 1;
  RETURN jsonb_build_object('page', s.page, 'company', co, 'company_logo_url', logo, 'job_number', j.job_number, 'job_name', j.name, 'shared', true, 'expires_at', s.expires_at,
    'report', CASE WHEN r.id IS NULL THEN jsonb_build_object('found', false) ELSE jsonb_build_object('found', true, 'version', r.version, 'data_date', r.data_date,
      'updated_at', r.created_at, 'updated_by_name', r.updated_by_name, 'contract_completion_date', j.contract_completion_date,
      'contract_total', CASE WHEN s.show_money THEN r.contract_total END, 'forecast_total', CASE WHEN s.show_money THEN r.forecast_total END,
      'data', CASE WHEN s.show_money THEN r.data ELSE public.mcp_living_strip_money(r.data) END,
      'scope', CASE WHEN s.show_money THEN 'full' ELSE 'super' END) END);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_share_open(text) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_report_share_open(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_portal_brand(_access uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('name', co.name, 'logo_url', co.logo_url)
  FROM public.mcp_portal_access a JOIN public.mcp_companies co ON co.id = a.company_id
  WHERE a.id = _access;
$$;
REVOKE ALL ON FUNCTION public.mcp_portal_brand(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_brand(uuid) TO service_role;
