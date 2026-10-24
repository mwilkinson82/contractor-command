-- Athena only. Apply through Lovable Cloud; preserve all company/job history.
-- Bound companies cannot borrow a creator's other subscription or cached grant.
CREATE OR REPLACE FUNCTION mcp_private.circle_company_live(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public,pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_circle_provisioning p
    JOIN public.subscriptions s ON s.id=p.source_subscription_id
    JOIN auth.users u ON u.id=p.owner_user_id
    WHERE p.company_id=_company AND p.owner_user_id IS NOT NULL
      AND s.stripe_subscription_id=p.stripe_subscription_id
      AND s.stripe_customer_id=p.stripe_customer_id
      AND (s.user_id=p.owner_user_id OR s.user_id IS NULL)
      AND (u.email_confirmed_at IS NOT NULL OR s.user_id=p.owner_user_id)
      AND s.tier IN ('circle','hardcore')
      -- Paid access ends at the source period boundary, even while Stripe still
      -- says active or an older invoice has a later paid-through timestamp.
      AND (s.current_period_end IS NULL OR s.current_period_end>now())
      AND (membership_private.subscription_state(s,now())='eligible'
        OR (p.override_until>now() AND s.status='active' AND EXISTS (
          SELECT 1 FROM public.circle_subscription_evidence e WHERE e.stripe_subscription_id=s.stripe_subscription_id
            AND e.review_reason='renewal_payment_pending')))
  )
$$;


CREATE OR REPLACE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN mcp_private.circle_company_live(_company) THEN 'circle' ELSE coalesce(
    (SELECT e.plan FROM public.mcp_company_entitlements e WHERE e.company_id=_company
      AND e.status IN ('active','trialing') AND e.plan IN ('athena_pm','athena_office')),
    CASE WHEN NOT EXISTS(SELECT 1 FROM public.mcp_circle_provisioning WHERE company_id=_company)
      THEN (SELECT public.get_user_tier(c.created_by)::text FROM public.mcp_companies c WHERE c.id=_company) END) END
$$;

CREATE OR REPLACE FUNCTION public.mcp_company_plan_live(_company uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.mcp_circle_provisioning WHERE company_id=_company)
    THEN mcp_private.circle_company_live(_company) OR EXISTS(
      SELECT 1 FROM public.mcp_company_entitlements e WHERE e.company_id=_company
        AND e.status IN ('active','trialing') AND e.plan IN ('athena_pm','athena_office'))
    ELSE EXISTS(SELECT 1 FROM public.mcp_company_entitlements e WHERE e.company_id=_company
      AND e.status IN ('active','trialing') AND e.plan IN ('athena_pm','athena_office'))
      OR coalesce((SELECT mcp_private.is_circle_active(c.created_by) FROM public.mcp_companies c WHERE c.id=_company),false)
    END
$$;

CREATE OR REPLACE FUNCTION public.mcp_role_allowed(_company uuid, _role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.mcp_circle_provisioning WHERE company_id=_company)
    AND public.mcp_company_tier(_company) IS NULL THEN false
    ELSE _role='owner' OR coalesce((SELECT p.roles IS NULL OR _role=ANY(p.roles)
      FROM public.mcp_team_plans p WHERE p.tier=public.mcp_company_tier(_company)),true) END
$$;

-- These helpers also guard company writes and team-owner RPCs. Job scope and
-- member RLS already call mcp_role_allowed, so the same cutoff applies to seats.
CREATE OR REPLACE FUNCTION public.mcp_member_role(_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.mcp_company_members WHERE company_id=_company AND user_id=auth.uid()
    AND public.mcp_role_allowed(_company,role)
$$;
CREATE OR REPLACE FUNCTION public.mcp_is_company_owner(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.mcp_member_role(_company)='owner',false)
$$;

CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  PERFORM mcp_private.circle_sync_user(auth.uid());
  BEGIN PERFORM public.mcp_team_accept_invites(); EXCEPTION WHEN OTHERS THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.mcp_company_members m WHERE m.user_id=auth.uid()
    AND public.mcp_role_allowed(m.company_id,m.role) AND public.mcp_company_plan_live(m.company_id)) THEN RETURN true; END IF;
  -- Keep legacy, not-yet-provisioned users' existing onboarding, but never let a
  -- warm five-minute cache or unrelated owner grant resurrect an ended binding.
  RETURN NOT EXISTS(SELECT 1 FROM public.mcp_circle_provisioning p
      WHERE p.owner_user_id=auth.uid() OR p.payment_user_id=auth.uid())
    AND mcp_private.is_circle_active(auth.uid());
END $$;
