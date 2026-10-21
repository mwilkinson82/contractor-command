-- Athena v0.8.22 (STAGED, not applied): (1) job creators lose visibility once their job access is removed,
-- (2) Terms acceptance record for the connect page. Rollback: supabase/rollbacks/20261022120000_athena_account_team_privacy_terms.rollback.sql
-- Owners, All-access and AP keep every company job (mcp_job_scope = 'full'); nothing here touches job data.

-- 1a. PM scope no longer counts "I created this job". A PM sees a job when they are its PM or have a job access row.
CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT public.mcp_role_allowed(j.company_id, m.role) THEN NULL
    WHEN m.role = 'super' THEN CASE WHEN EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid())
      THEN 'super' ELSE NULL END
    WHEN m.role IN ('owner','all_access','ap') THEN 'full'
    WHEN m.role = 'pm' THEN CASE WHEN j.pm_user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN 'full' ELSE NULL END
    WHEN j.restricted AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN NULL
    WHEN m.role IN ('estimating','contracts') THEN 'contract'
    ELSE 'full' END
  FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
  WHERE j.id = _job
$$;

-- 1b. The 0001 "own rows" policies (user_id = auth.uid()) stay for personal, company-less rows, but company rows must
-- also pass job scope. RESTRICTIVE policies AND with every permissive one, so "own rows" can no longer leak a job.
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_jobs;
CREATE POLICY "company job scope read guard" ON public.mcp_jobs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.mcp_job_scope(id) IS NOT NULL);
DROP POLICY IF EXISTS "company job scope update guard" ON public.mcp_jobs;
CREATE POLICY "company job scope update guard" ON public.mcp_jobs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (company_id IS NULL OR public.mcp_job_scope(id) IS NOT NULL);
DROP POLICY IF EXISTS "company job scope delete guard" ON public.mcp_jobs;
CREATE POLICY "company job scope delete guard" ON public.mcp_jobs AS RESTRICTIVE FOR DELETE TO authenticated
  USING (company_id IS NULL OR public.mcp_job_scope(id) IS NOT NULL);

-- Answers follow their lookahead (mcp_lookaheads already has scope guards, 0014), so the subquery only finds visible ones.
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_answers;
CREATE POLICY "company job scope read guard" ON public.mcp_answers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_lookaheads l WHERE l.id = mcp_answers.lookahead_id));
DROP POLICY IF EXISTS "company job scope update guard" ON public.mcp_answers;
CREATE POLICY "company job scope update guard" ON public.mcp_answers AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_lookaheads l WHERE l.id = mcp_answers.lookahead_id));
DROP POLICY IF EXISTS "company job scope delete guard" ON public.mcp_answers;
CREATE POLICY "company job scope delete guard" ON public.mcp_answers AS RESTRICTIVE FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_lookaheads l WHERE l.id = mcp_answers.lookahead_id));

-- Item history follows its open item (mcp_open_items already has a scope read guard, 0015).
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_item_events;
CREATE POLICY "company job scope read guard" ON public.mcp_item_events AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.id = mcp_item_events.item_id));
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_item_evidence;
CREATE POLICY "company job scope read guard" ON public.mcp_item_evidence AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.id = mcp_item_evidence.item_id));
DROP POLICY IF EXISTS "company job scope read guard" ON public.mcp_carry_forwards;
CREATE POLICY "company job scope read guard" ON public.mcp_carry_forwards AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.id = mcp_carry_forwards.item_id));

-- 2. Terms acceptance (who and when). Written only through mcp_accept_terms; members can read their own rows.
CREATE TABLE IF NOT EXISTS public.mcp_terms_acceptances (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  terms_version text NOT NULL,
  terms_url text NOT NULL,
  context text NOT NULL DEFAULT 'connect' CHECK (context IN ('connect','signup','account')),
  authorization_id text,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_terms_acceptances_user ON public.mcp_terms_acceptances (user_id, accepted_at DESC);
ALTER TABLE public.mcp_terms_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_terms_acceptances_own_read ON public.mcp_terms_acceptances;
CREATE POLICY mcp_terms_acceptances_own_read ON public.mcp_terms_acceptances FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.mcp_terms_acceptances FROM anon, authenticated;
GRANT SELECT ON public.mcp_terms_acceptances TO authenticated;
GRANT ALL ON public.mcp_terms_acceptances TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_accept_terms(_version text, _url text, _context text DEFAULT 'connect',
  _authorization text DEFAULT NULL, _user_agent text DEFAULT NULL) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  IF coalesce(btrim(_version), '') = '' OR _url !~ '^https://' THEN RAISE EXCEPTION 'MCP_BAD:Missing terms version.'; END IF;
  INSERT INTO public.mcp_terms_acceptances (user_id, terms_version, terms_url, context, authorization_id, user_agent)
  VALUES (auth.uid(), left(_version, 40), left(_url, 300), coalesce(_context, 'connect'), left(_authorization, 200), left(_user_agent, 400))
  RETURNING accepted_at INTO t;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.mcp_accept_terms(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_accept_terms(text,text,text,text,text) TO authenticated;
