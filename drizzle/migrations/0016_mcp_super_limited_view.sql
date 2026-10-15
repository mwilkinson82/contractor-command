-- Super: "Limited view, no financials". A Super sees only jobs they are assigned to (mcp_job_access), read-only:
-- schedule/deadlines and non-internal open items. No budget, SOV, billing or cost facts. Restricted jobs stay hidden
-- unless assigned. Writes still go through mcp_assert_job (full scope only), so Supers can't change anything.
-- Additive in effect: new helper functions and policies; the scope helpers are redefined in place.

CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN m.role = 'super' THEN CASE WHEN EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid())
      THEN 'super' ELSE NULL END
    WHEN m.role IN ('owner','all_access','finance') THEN 'full'
    WHEN m.role = 'pm' THEN CASE WHEN j.pm_user_id = auth.uid() OR j.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN 'full' ELSE NULL END
    WHEN j.restricted AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN NULL
    WHEN m.role IN ('estimating','contracts') THEN 'contract'
    ELSE 'full' END
  FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
  WHERE j.id = _job
$$;

-- Contract data stays full/contract only (the new 'super' scope must not open contract facts or items).
CREATE OR REPLACE FUNCTION public.mcp_can_access_contract(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.mcp_job_scope(_job) IN ('full','contract'), false)
$$;

CREATE OR REPLACE FUNCTION public.mcp_can_view_job(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.mcp_job_scope(_job) IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_can_view_job(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_can_view_job(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_is_super_view(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.mcp_job_scope(_job) = 'super', false)
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_is_super_view(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_is_super_view(uuid) TO authenticated;

-- Any member, including a Super, for read-only company context. Company writes keep using mcp_is_company_member.
CREATE OR REPLACE FUNCTION public.mcp_is_company_viewer(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_is_company_viewer(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_is_company_viewer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_resolve_job(_company uuid, _job_number text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE j public.mcp_jobs; q text := lower(btrim(coalesce(_job_number, ''))); sug jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_viewer(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE company_id = _company AND job_number = btrim(_job_number) AND public.mcp_can_view_job(id);
  IF FOUND THEN RETURN jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'name', j.name, 'company_id', j.company_id, 'scope', public.mcp_job_scope(j.id)); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('job_number', job_number, 'name', name)), '[]'::jsonb) INTO sug FROM (
    SELECT job_number, name FROM public.mcp_jobs
    WHERE company_id = _company AND public.mcp_can_view_job(id) AND q <> ''
      AND (strpos(lower(name), q) > 0 OR strpos(lower(job_number), q) > 0)
    ORDER BY created_at DESC LIMIT 3) s;
  RETURN jsonb_build_object('not_found', true, 'suggestions', sug);
END $function$;

-- A Super with no assigned job still gets the "no access" hint.
CREATE OR REPLACE FUNCTION public.mcp_caller_is_no_access_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE user_id = auth.uid() AND role = 'super')
     AND NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE user_id = auth.uid() AND role <> 'super')
     AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a JOIN public.mcp_jobs j ON j.id = a.job_id
                     JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = a.user_id
                     WHERE a.user_id = auth.uid() AND m.role = 'super')
$$;

-- Read-only Super policies (no facts / flags / budget / SOV policies are added, so those stay hidden).
CREATE POLICY "super view company read" ON public.mcp_companies FOR SELECT TO authenticated
  USING (public.mcp_is_company_viewer(id) AND EXISTS (SELECT 1 FROM public.mcp_jobs j WHERE j.company_id = mcp_companies.id AND public.mcp_is_super_view(j.id)));
CREATE POLICY "super view job read" ON public.mcp_jobs FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND public.mcp_is_super_view(id));
CREATE POLICY "super view items read" ON public.mcp_open_items FOR SELECT TO authenticated
  USING (NOT internal_only AND coalesce(section, '') NOT IN ('budget','sov') AND public.mcp_is_super_view(job_id));
CREATE POLICY "super view deadlines read" ON public.mcp_job_deadlines FOR SELECT TO authenticated
  USING (NOT internal_only AND public.mcp_is_super_view(job_id));
CREATE POLICY "super view na read" ON public.mcp_job_na FOR SELECT TO authenticated
  USING (public.mcp_is_super_view(job_id));

-- Creator "own rows" must not outlive a role change: items follow job scope for reads too (closes the
-- demoted-creator read path seen in the live test; contract and super views keep their own policies).
CREATE POLICY "company job scope read guard" ON public.mcp_open_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.mcp_can_access_job(job_id)
    OR (section IN ('contract_time','contract') AND public.mcp_can_access_contract(job_id))
    OR (NOT internal_only AND coalesce(section, '') NOT IN ('budget','sov') AND public.mcp_is_super_view(job_id)));