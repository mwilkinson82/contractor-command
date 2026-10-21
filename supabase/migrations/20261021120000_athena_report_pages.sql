-- Athena 0.8.14: living report pages at app.meetathena.io/r/... (job IOR, job schedule, company portfolio).
-- Pages read the saved living reports; nothing new is stored for a private page. The optional owner share link
-- reuses the 0.8.11 pattern: only a SHA-256 of the token is stored, it expires, it can be turned off. Off by default.
-- Additive only: one table, seven functions. No drops, no deletes, no data changes.
-- Depends on 20261020213000_athena_living_reports.sql. NOT APPLIED. Apply only after Marshall's yes.

CREATE TABLE IF NOT EXISTS public.mcp_report_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  page text NOT NULL CHECK (page IN ('ior', 'schedule', 'portfolio')),
  show_money boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  CHECK ((page = 'portfolio') = (job_id IS NULL))
);
CREATE INDEX IF NOT EXISTS mcp_report_shares_job_idx ON public.mcp_report_shares (company_id, job_id, page);
ALTER TABLE public.mcp_report_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_report_shares FROM anon, authenticated, public;
GRANT ALL ON public.mcp_report_shares TO service_role;

-- Owner / leadership in a company (portfolio access).
CREATE OR REPLACE FUNCTION public.mcp_is_company_leader(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role IN ('owner', 'all_access'))
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_is_company_leader(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_is_company_leader(uuid) TO authenticated;

-- Internal: portfolio rows for a company (latest saved IOR/dashboard/CPM per job). Money only when _money.
CREATE OR REPLACE FUNCTION public.mcp_report_portfolio_rows(_company uuid, _money boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'job_id', j.id, 'job_number', j.job_number, 'name', j.name,
    'pm', (SELECT display_name FROM public.mcp_company_members m WHERE m.company_id = j.company_id AND m.user_id = j.pm_user_id),
    'completion_date', j.contract_completion_date,
    'cpm', (SELECT jsonb_build_object('version', r.version, 'data_date', r.data_date, 'updated_at', r.created_at, 'tia', r.data->'tia',
              'contract_total', CASE WHEN _money THEN r.contract_total END, 'forecast_total', CASE WHEN _money THEN r.forecast_total END)
            FROM public.mcp_living_reports r WHERE r.job_id = j.id AND r.report_type = 'cpm' ORDER BY r.version DESC LIMIT 1),
    'ior', (SELECT jsonb_build_object('version', r.version, 'data_date', r.data_date, 'updated_at', r.created_at,
              'data', CASE WHEN _money THEN r.data - 'activities' ELSE '{}'::jsonb END)
            FROM public.mcp_living_reports r WHERE r.job_id = j.id AND r.report_type = 'ior' ORDER BY r.version DESC LIMIT 1)
  ) ORDER BY j.job_number), '[]'::jsonb)
  FROM public.mcp_jobs j WHERE j.company_id = _company
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_portfolio_rows(uuid, boolean) FROM anon, authenticated, public;

-- Signed-in page read. ior/schedule: same rules as mcp_living_report_get (supers: schedule, no $; contract scope: no).
-- portfolio: owner/leadership only.
CREATE OR REPLACE FUNCTION public.mcp_report_page_get(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co public.mcp_companies;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF _company IS NULL OR NOT public.mcp_is_company_leader(_company) THEN RAISE EXCEPTION 'MCP_BAD:The portfolio is for owners and leadership.'; END IF;
    SELECT * INTO co FROM public.mcp_companies WHERE id = _company;
    RETURN jsonb_build_object('page', 'portfolio', 'company', co.name, 'jobs', public.mcp_report_portfolio_rows(_company, true), 'money', true);
  END IF;
  IF _page NOT IN ('ior', 'schedule') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT * INTO co FROM public.mcp_companies WHERE id = j.company_id;
  RETURN jsonb_build_object('page', _page, 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
    'report', public.mcp_living_report_get(_job, CASE WHEN _page = 'schedule' THEN 'cpm' ELSE 'ior' END, NULL));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) TO authenticated;

-- Lightweight refresh check for the signed-in page (0.8.14): returns only "<version>|<saved at>" for what the page shows,
-- under the same access rules as mcp_report_page_get, so the page skips the full read when nothing changed.
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
  IF _page NOT IN ('ior', 'schedule') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF (_page = 'ior' AND sc <> 'full') OR (_page = 'schedule' AND sc NOT IN ('full', 'super')) THEN RAISE EXCEPTION 'MCP_BAD:No access.'; END IF;
  SELECT r.version::text || '|' || r.created_at::text INTO s FROM public.mcp_living_reports r
    WHERE r.job_id = _job AND r.report_type = CASE WHEN _page = 'schedule' THEN 'cpm' ELSE 'ior' END ORDER BY r.version DESC LIMIT 1;
  RETURN coalesce(s, 'none');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) TO authenticated;

-- Owner share link. ior/portfolio: owner/leadership with full scope. schedule: full scope (with $) or super (no $).
CREATE OR REPLACE FUNCTION public.mcp_report_share_create(_page text, _job uuid, _company uuid, _token_hash text, _expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; co uuid := _company; nid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF co IS NULL OR NOT public.mcp_is_company_leader(co) THEN RAISE EXCEPTION 'MCP_BAD:Only an owner or leadership can share the portfolio.'; END IF;
    _job := NULL;
  ELSE
    sc := public.mcp_job_scope(_job);
    IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
    SELECT company_id INTO co FROM public.mcp_jobs WHERE id = _job;
    IF _page = 'ior' AND (sc <> 'full' OR NOT public.mcp_is_company_leader(co)) THEN RAISE EXCEPTION 'MCP_BAD:Only an owner or leadership can share the IOR.'; END IF;
    IF _page = 'schedule' AND sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t share the schedule.'; END IF;
    IF _page NOT IN ('ior', 'schedule') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  END IF;
  IF _expires_at <= now() OR _expires_at > now() + interval '90 days 1 hour' THEN RAISE EXCEPTION 'MCP_BAD:Links last 1 to 90 days.'; END IF;
  INSERT INTO public.mcp_report_shares (company_id, job_id, page, show_money, token_hash, expires_at)
  VALUES (co, _job, _page, coalesce(sc, 'full') = 'full', _token_hash, _expires_at) RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'show_money', coalesce(sc, 'full') = 'full');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_share_create(text, uuid, uuid, text, timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_share_create(text, uuid, uuid, text, timestamptz) TO authenticated;

-- Turn a share link off: the member who made it, or an owner/leadership member of that company.
CREATE OR REPLACE FUNCTION public.mcp_report_share_revoke(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_report_shares;
BEGIN
  PERFORM public.mcp_assert_active();
  SELECT * INTO r FROM public.mcp_report_shares WHERE token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF r.created_by <> auth.uid() AND NOT public.mcp_is_company_leader(r.company_id) THEN RETURN NULL; END IF;
  UPDATE public.mcp_report_shares SET revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid()) WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'page', r.page);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_share_revoke(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_share_revoke(text) TO authenticated;

-- Public share view (anon): hash in, the live latest report out. Expired, turned-off or unknown links return NULL.
-- Supers' shares never carry dollars; the IOR is never shown without dollars rights.
CREATE OR REPLACE FUNCTION public.mcp_report_share_open(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.mcp_report_shares; j public.mcp_jobs; r public.mcp_living_reports; co text;
BEGIN
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.mcp_report_shares WHERE token_hash = _token_hash AND revoked_at IS NULL AND expires_at > now();
  IF s.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.mcp_report_shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = s.id;
  SELECT name INTO co FROM public.mcp_companies WHERE id = s.company_id;
  IF s.page = 'portfolio' THEN
    RETURN jsonb_build_object('page', 'portfolio', 'company', co, 'jobs', public.mcp_report_portfolio_rows(s.company_id, true), 'money', true, 'shared', true, 'expires_at', s.expires_at);
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = s.job_id;
  SELECT * INTO r FROM public.mcp_living_reports WHERE job_id = s.job_id AND report_type = CASE WHEN s.page = 'schedule' THEN 'cpm' ELSE 'ior' END ORDER BY version DESC LIMIT 1;
  RETURN jsonb_build_object('page', s.page, 'company', co, 'job_number', j.job_number, 'job_name', j.name, 'shared', true, 'expires_at', s.expires_at,
    'report', CASE WHEN r.id IS NULL THEN jsonb_build_object('found', false) ELSE jsonb_build_object('found', true, 'version', r.version, 'data_date', r.data_date,
      'updated_at', r.created_at, 'updated_by_name', r.updated_by_name, 'contract_completion_date', j.contract_completion_date,
      'contract_total', CASE WHEN s.show_money THEN r.contract_total END, 'forecast_total', CASE WHEN s.show_money THEN r.forecast_total END,
      'data', CASE WHEN s.show_money THEN r.data ELSE public.mcp_living_strip_money(r.data) END,
      'scope', CASE WHEN s.show_money THEN 'full' ELSE 'super' END) END);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_share_open(text) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_report_share_open(text) TO anon, authenticated;

