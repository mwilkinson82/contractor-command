-- Athena access detail for the tool guard. Additive: one new function.
-- Does not change circle_decision, mcp_gate, tables, or rows.
-- Stripe status past_due on a Circle or Hardcore subscription counts as active
-- for Athena even when the paid period is stale. Canceled, unpaid, and ended
-- subscriptions do not. circle_decision itself is unchanged.

CREATE OR REPLACE FUNCTION public.mcp_athena_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  em text := '';
  decision jsonb := '{}'::jsonb;
  circle_active boolean := false;
  has_company boolean := false;
  company_seat boolean := false;
  current_paid boolean := false;
  stale_paid boolean := false;
  missing_paid boolean := false;
  past_due boolean := false;
  paid_period text := 'none';
  state text;
  reason text;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object(
      'state', 'ineligible',
      'reason', 'no_current_entitlement',
      'has_access', false,
      'circle_active', false,
      'has_company', false,
      'company_seat', false,
      'paid_period', 'none',
      'past_due', false
    );
  END IF;

  SELECT coalesce(email, '') INTO em FROM auth.users WHERE id = uid;
  decision := coalesce(public.get_circle_entitlement(uid, em), '{}'::jsonb);
  circle_active := coalesce((decision->>'hasAccess')::boolean, false);
  state := coalesce(decision->>'state', CASE WHEN circle_active THEN 'eligible' ELSE 'ineligible' END);
  reason := coalesce(decision->>'reason', CASE WHEN circle_active THEN 'paid_period' ELSE 'no_current_entitlement' END);

  SELECT EXISTS (
    SELECT 1 FROM public.mcp_company_members m WHERE m.user_id = uid
  ) INTO has_company;

  SELECT EXISTS (
    SELECT 1 FROM public.mcp_company_members m
    WHERE m.user_id = uid
      AND public.mcp_role_allowed(m.company_id, m.role)
      AND public.mcp_company_plan_live(m.company_id)
  ) INTO company_seat;

  -- Read-only. An empty match set yields one aggregate row of nulls.
  SELECT
    coalesce(bool_or(
      e.observed_at IS NOT NULL
      AND e.paid_through > now()
      AND s.status IN ('active', 'past_due', 'canceled')
    ), false),
    coalesce(bool_or(
      e.observed_at IS NOT NULL
      AND e.paid_through IS NOT NULL
      AND e.paid_through <= now()
      AND s.status IN ('active', 'past_due')
    ), false),
    coalesce(bool_or(
      s.status IN ('active', 'trialing', 'past_due')
      AND (e.observed_at IS NULL OR e.paid_through IS NULL)
    ), false),
    coalesce(bool_or(s.status = 'past_due'), false)
  INTO current_paid, stale_paid, missing_paid, past_due
  FROM public.subscriptions s
  LEFT JOIN public.circle_subscription_evidence e
    ON e.stripe_subscription_id = s.stripe_subscription_id
  WHERE s.tier IN ('circle', 'hardcore')
    AND public.subscription_matches_identity(s.user_id, s.email, s.metadata, uid, em);

  paid_period := CASE
    WHEN current_paid THEN 'current'
    WHEN stale_paid THEN 'stale'
    WHEN missing_paid THEN 'missing'
    ELSE 'none'
  END;

  -- past_due keeps Athena until Stripe marks the subscription canceled, unpaid, or ended.
  circle_active := circle_active OR past_due;

  RETURN jsonb_build_object(
    'state', state,
    'reason', reason,
    'has_access', circle_active OR company_seat,
    'circle_active', circle_active,
    'has_company', has_company,
    'company_seat', company_seat,
    'paid_period', paid_period,
    'past_due', past_due,
    'tier', decision->>'tier'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_athena_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_athena_access() TO authenticated, service_role;
