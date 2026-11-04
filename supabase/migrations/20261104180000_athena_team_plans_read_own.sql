-- Team plans: a signed-in user reads only the plan their own company is on (Lovable security scan finding, Nov 4).
-- Before, mcp_team_plans_read was USING (true), so any signed-in user could read every plan row and its notes.
-- Seat limits and role checks read this table inside SECURITY DEFINER functions (mcp_role_allowed, the team
-- snapshot), which are unaffected. No app code reads the table directly. Plain SQL; Lovable applies it.
DROP POLICY IF EXISTS mcp_team_plans_read ON public.mcp_team_plans;
CREATE POLICY mcp_team_plans_read ON public.mcp_team_plans FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.mcp_company_members m
    WHERE m.user_id = auth.uid() AND public.mcp_company_tier(m.company_id) = mcp_team_plans.tier
  )
);
REVOKE ALL ON public.mcp_team_plans FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_team_plans FROM authenticated;
