-- Athena 0.8.17: three more private report pages at app.meetathena.io/r/job/<job_id>/<page> so hosts that can't draw
-- in-chat cards (Grok Bot) always have a styled view to open: lookahead, payapp, briefing.
-- Read-only: replaces mcp_report_page_get and mcp_report_page_stamp with the same ior/schedule/portfolio branches plus
-- the new pages. No tables, no data changes; share links stay ior/schedule/portfolio only.
-- Access: lookahead and briefing = full or super scope (supers: no dollars, no internal-only items); payapp = full only.
-- Depends on 20261021120000_athena_report_pages.sql. NOT APPLIED. Apply only after Marshall's yes.

-- Internal: newest visible lookahead that has content (any open item linked); an empty one only when all are empty.
-- (The setup container and merged/retired ones, inputs.kind 'setup' / 'merged', are never shown.)
CREATE OR REPLACE FUNCTION public.mcp_report_latest_lookahead(_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('id', l.id, 'start_date', l.start_date, 'end_date', l.end_date)
  FROM public.mcp_lookaheads l
  WHERE l.job_id = _job AND coalesce(l.inputs->>'kind', '') NOT IN ('setup', 'merged')
  ORDER BY NOT EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.lookahead_id = l.id), (l.start_date IS NULL), l.start_date DESC, l.end_date DESC, l.created_at DESC LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_latest_lookahead(uuid) FROM anon, authenticated, public;

-- Internal: open items for a page. Supers never get internal-only items. Text fields only (no cost effects).
CREATE OR REPLACE FUNCTION public.mcp_report_open_items(_job uuid, _super boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', i.action, 'owner', coalesce(i.accountable, i.owner),
    'due', coalesce(i.needed_by, i.due_date), 'type', coalesce(i.item_type, i.kind)) ORDER BY coalesce(i.needed_by, i.due_date) NULLS LAST), '[]'::jsonb)
  FROM public.mcp_open_items i
  WHERE i.job_id = _job AND i.status = 'open' AND (NOT _super OR coalesce(i.internal_only, false) = false)
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_open_items(uuid, boolean) FROM anon, authenticated, public;

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
  IF _page NOT IN ('ior', 'schedule', 'lookahead', 'payapp', 'briefing') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
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
  RETURN jsonb_build_object('page', 'briefing', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
    'today', (now() AT TIME ZONE coalesce(j.time_zone, 'America/Chicago'))::date, 'items', public.mcp_report_open_items(_job, sc <> 'full'),
    'report', jsonb_build_object('found', true, 'contract_completion_date', j.contract_completion_date, 'scope', sc));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_report_page_stamp(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; s text;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF _company IS NULL OR NOT public.mcp_is_company_leader(_company) THEN RAISE EXCEPTION 'MCP_BAD:The portfolio is for owners and leadership.'; END IF;
    SELECT count(*)::text || '|' || coalesce(max(r.created_at)::text, '') || '|' || (SELECT count(*) FROM public.mcp_jobs WHERE company_id = _company)::text INTO s
      FROM public.mcp_living_reports r JOIN public.mcp_jobs j ON j.id = r.job_id WHERE j.company_id = _company;
    RETURN s;
  END IF;
  IF _page NOT IN ('ior', 'schedule', 'lookahead', 'payapp', 'briefing') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF (_page IN ('ior', 'payapp') AND sc <> 'full') OR (_page IN ('schedule', 'lookahead', 'briefing') AND sc NOT IN ('full', 'super')) THEN RAISE EXCEPTION 'MCP_BAD:No access.'; END IF;
  IF _page IN ('lookahead', 'briefing') THEN
    -- Items and lookaheads change without a report version: stamp on their latest change too.
    SELECT coalesce((SELECT max(version)::text || '|' || max(created_at)::text FROM public.mcp_living_reports WHERE job_id = _job AND report_type = 'cpm'), 'none')
      || '|' || coalesce((SELECT count(*)::text || '|' || max(updated_at)::text FROM public.mcp_open_items WHERE job_id = _job AND status = 'open'), '')
      || '|' || coalesce((SELECT max(created_at)::text FROM public.mcp_lookaheads WHERE job_id = _job), '')
      || '|' || CASE WHEN _page = 'briefing' THEN current_date::text ELSE '' END INTO s;
    RETURN s;
  END IF;
  SELECT r.version::text || '|' || r.created_at::text INTO s FROM public.mcp_living_reports r
    WHERE r.job_id = _job AND r.report_type = CASE _page WHEN 'schedule' THEN 'cpm' WHEN 'payapp' THEN 'billing_forecast' ELSE 'ior' END ORDER BY r.version DESC LIMIT 1;
  RETURN coalesce(s, 'none');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) TO authenticated;
