-- Cache mcp_athena_access the same way mcp_gate is cached.
-- Same key (user_id) and same TTL (5 minutes) as public.mcp_gate_cache
-- in mcp_private.is_circle_active. A warm call reads this row only.
-- Does not alter mcp_gate_cache or any existing table.

CREATE TABLE IF NOT EXISTS public.mcp_athena_access_cache (
  user_id uuid PRIMARY KEY,
  detail jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_athena_access_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_athena_access_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_athena_access_cache TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_athena_access()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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
  cached jsonb;
  result jsonb;
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

  -- Same user_id key and 5 minute window as mcp_gate_cache.
  SELECT c.detail INTO cached
  FROM public.mcp_athena_access_cache c
  WHERE c.user_id = uid AND c.checked_at > now() - interval '5 minutes';
  IF cached IS NOT NULL THEN RETURN cached; END IF;

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

  circle_active := circle_active OR past_due;

  result := jsonb_build_object(
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

  INSERT INTO public.mcp_athena_access_cache (user_id, detail, checked_at)
  VALUES (uid, result, now())
  ON CONFLICT (user_id) DO UPDATE SET detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_athena_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_athena_access() TO authenticated, service_role;
