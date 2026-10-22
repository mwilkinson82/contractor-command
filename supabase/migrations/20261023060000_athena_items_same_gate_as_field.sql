-- Open items use the field board's company and member check.
-- Additive: replaces mcp_report_page_get. The items branch returns the field board payload with page set to items.

CREATE OR REPLACE FUNCTION public.mcp_report_page_get(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co public.mcp_companies; sc text;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF _company IS NULL OR NOT public.mcp_is_company_leader(_company) THEN RAISE EXCEPTION 'MCP_BAD:The portfolio is for owners and leadership.'; END IF;
    SELECT * INTO co FROM public.mcp_companies WHERE id = _company;
    RETURN jsonb_build_object('page', 'portfolio', 'company', co.name, 'jobs', public.mcp_report_portfolio_rows(_company, true), 'money', true);
  END IF;
  IF _page NOT IN ('ior', 'schedule', 'lookahead', 'payapp', 'briefing', 'field', 'daily', 'photos', 'items') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT * INTO co FROM public.mcp_companies WHERE id = j.company_id;
  IF _page IN ('ior', 'schedule', 'payapp') THEN
    RETURN jsonb_build_object('page', _page, 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'report', public.mcp_living_report_get(_job, CASE _page WHEN 'schedule' THEN 'cpm' WHEN 'payapp' THEN 'billing_forecast' ELSE 'ior' END, NULL));
  END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  IF _page = 'lookahead' THEN
    RETURN jsonb_build_object('page', 'lookahead', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'lookahead', public.mcp_report_latest_lookahead(_job), 'report', public.mcp_living_report_get(_job, 'cpm', NULL),
      'items', public.mcp_report_open_items(_job, sc <> 'full'));
  END IF;
  IF _page = 'field' OR _page = 'items' THEN
    RETURN public.mcp_field_board(_job) || jsonb_build_object('page', _page);
  END IF;
  IF _page = 'daily' THEN RETURN public.mcp_field_daily_page(_job); END IF;
  IF _page = 'photos' THEN RETURN public.mcp_field_photo_page(_job); END IF;
  RETURN jsonb_build_object('page', 'briefing', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
    'today', (now() AT TIME ZONE coalesce(j.time_zone, 'America/Chicago'))::date, 'items', public.mcp_report_open_items(_job, sc <> 'full'),
    'report', jsonb_build_object('found', true, 'contract_completion_date', j.contract_completion_date, 'scope', sc));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) TO authenticated;
