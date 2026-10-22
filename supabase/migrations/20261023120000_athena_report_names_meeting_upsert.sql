-- Names on the IOR page, more signed board pages, and one row per PM-meeting confirmation.
-- Additive: replaces two functions and adds one. No tables dropped and no rows deleted.

CREATE OR REPLACE FUNCTION public.mcp_report_page_get(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co public.mcp_companies; sc text; names jsonb;
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
  names := jsonb_build_object(
    'job_id', j.id,
    'job_name', j.name,
    'items', public.mcp_report_open_items(_job, false),
    'people', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.display_name)) FROM public.mcp_company_members m WHERE m.company_id = j.company_id), '[]'::jsonb)
  );
  IF _page = 'ior' THEN
    RETURN jsonb_build_object('page', 'ior', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'report', public.mcp_living_report_get(_job, 'ior', NULL), 'names', names);
  END IF;
  IF _page IN ('schedule', 'payapp') THEN
    RETURN jsonb_build_object('page', _page, 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'report', public.mcp_living_report_get(_job, CASE _page WHEN 'schedule' THEN 'cpm' ELSE 'billing_forecast' END, NULL), 'names', names);
  END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  IF _page = 'lookahead' THEN
    RETURN jsonb_build_object('page', 'lookahead', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'lookahead', public.mcp_report_latest_lookahead(_job), 'report', public.mcp_living_report_get(_job, 'cpm', NULL),
      'items', public.mcp_report_open_items(_job, sc <> 'full'), 'names', names);
  END IF;
  IF _page = 'field' OR _page = 'items' THEN
    RETURN public.mcp_field_board(_job) || jsonb_build_object('page', _page, 'names', names);
  END IF;
  IF _page = 'daily' THEN RETURN public.mcp_field_daily_page(_job) || jsonb_build_object('names', names); END IF;
  IF _page = 'photos' THEN RETURN public.mcp_field_photo_page(_job) || jsonb_build_object('names', names); END IF;
  RETURN jsonb_build_object('page', 'briefing', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
    'today', (now() AT TIME ZONE coalesce(j.time_zone, 'America/Chicago'))::date, 'items', public.mcp_report_open_items(_job, sc <> 'full'),
    'report', jsonb_build_object('found', true, 'contract_completion_date', j.contract_completion_date, 'scope', sc), 'names', names);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_board_link_open(_token_hash text, _job uuid, _page text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_board_links; payload jsonb;
BEGIN
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF _page NOT IN ('field', 'items', 'daily', 'photos', 'ior', 'payapp', 'schedule', 'lookahead', 'briefing') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  SELECT * INTO r FROM public.mcp_board_links WHERE token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF r.job_id <> _job THEN RETURN jsonb_build_object('status', 'wrong_job'); END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF (_page IN ('ior', 'payapp') AND r.scope <> 'full') OR r.scope NOT IN ('full', 'super') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  PERFORM set_config('request.jwt.claim.sub', r.created_by::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', r.created_by::text, 'role', 'authenticated')::text, true);
  BEGIN
    payload := public.mcp_report_page_get(_page, _job, NULL);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'denied');
  END;
  INSERT INTO public.mcp_board_link_opens (link_id, job_id, page) VALUES (r.id, r.job_id, _page);
  UPDATE public.mcp_board_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('status', 'ok', 'payload', payload);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) TO anon, authenticated;

-- One confirmation per job and stable key. A repeat updates or closes that row. Older duplicates stay in the table.
CREATE OR REPLACE FUNCTION public.mcp_meeting_item_save(_job uuid, _key text, _action text, _close boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; iid uuid; made jsonb;
BEGIN
  IF _key !~ '^pm:[a-z0-9_]+$' THEN RAISE EXCEPTION 'MCP_BAD:Bad meeting item.'; END IF;
  IF coalesce(btrim(_action), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:action is required.'; END IF;
  j := public.mcp_assert_job(_job);
  SELECT id INTO iid FROM public.mcp_open_items
    WHERE job_id = _job AND check_key = _key
    ORDER BY (status = 'open') DESC, updated_at DESC NULLS LAST
    LIMIT 1;
  IF iid IS NOT NULL THEN
    UPDATE public.mcp_open_items
      SET action = j.job_number || ' – ' || left(btrim(_action), 480),
          reported_at = now(),
          updated_at = now(),
          status = CASE WHEN coalesce(_close, false) THEN 'resolved' ELSE 'open' END,
          resolution = CASE WHEN coalesce(_close, false) THEN 'verified' ELSE resolution END,
          resolved_at = CASE WHEN coalesce(_close, false) THEN now() ELSE resolved_at END
      WHERE id = iid;
    RETURN jsonb_build_object('item_id', iid, 'existing', true, 'closed', coalesce(_close, false));
  END IF;
  made := public.mcp_open_item_create(_job, jsonb_build_object(
    'check_key', _key, 'action', btrim(_action), 'tool', 'pm_meeting', 'category', 'Meeting', 'kind', 'general'));
  IF coalesce(_close, false) AND made ? 'item_id' THEN
    UPDATE public.mcp_open_items
      SET status = 'resolved', resolution = 'verified', resolved_at = now(), updated_at = now()
      WHERE id = (made->>'item_id')::uuid;
  END IF;
  RETURN made || jsonb_build_object('closed', coalesce(_close, false));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_meeting_item_save(uuid, text, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_meeting_item_save(uuid, text, text, boolean) TO authenticated;
