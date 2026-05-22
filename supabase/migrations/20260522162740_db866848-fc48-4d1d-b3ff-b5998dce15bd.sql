
-- Email-based AOS limits lookup. Mirrors get_user_aos_limits(uuid) but resolves
-- by email when there's no portal user_id yet (e.g. AOS-only sign-ins, or users
-- who haven't signed into Circle). Also honors aos_links.aos_email so a member
-- who uses a different email inside AOS still resolves to their Circle tier.
CREATE OR REPLACE FUNCTION public.get_user_aos_limits_by_email(_email text)
RETURNS TABLE(tier public.app_tier, workspace_limit integer, seat_limit integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(coalesce(_email, ''));
  v_user_id uuid;
  v_tier public.app_tier;
  v_ws integer := 0;
  v_seats integer := 0;
  v_has_unlimited boolean := false;
  v_addon_seats integer := 0;
  v_addon_ws integer := 0;
  v_best_rank integer := -1;
  r RECORD;
BEGIN
  IF v_email = '' THEN
    tier := NULL;
    workspace_limit := 0;
    seat_limit := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Resolve to a portal user_id when possible (via profile email, sub email,
  -- or an existing aos_links.aos_email mapping).
  SELECT p.id INTO v_user_id
  FROM public.profiles p
  WHERE lower(p.email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    SELECT s.user_id INTO v_user_id
    FROM public.subscriptions s
    WHERE s.user_id IS NOT NULL AND lower(s.email) = v_email
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    SELECT al.user_id INTO v_user_id
    FROM public.aos_links al
    WHERE lower(al.aos_email) = v_email
    LIMIT 1;
  END IF;

  -- Admin shortcut.
  IF v_user_id IS NOT NULL AND public.has_role(v_user_id, 'admin') THEN
    tier := 'circle'::public.app_tier;
    workspace_limit := -1;
    seat_limit := -1;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Walk subscriptions matching either the email directly, the resolved
  -- user_id, OR a sibling email linked via aos_links.
  FOR r IN
    SELECT s.tier, s.metadata
    FROM public.subscriptions s
    WHERE (s.is_comped OR s.status IN ('active','trialing'))
      AND (
        lower(s.email) = v_email
        OR (v_user_id IS NOT NULL AND s.user_id = v_user_id)
        OR lower(s.email) IN (
          SELECT lower(p2.email) FROM public.profiles p2 WHERE p2.id = v_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.aos_links al2
          WHERE al2.user_id = s.user_id
            AND lower(al2.aos_email) = v_email
        )
      )
  LOOP
    IF r.tier IN ('circle', 'hardcore', 'power_hour', 'sm_school', 'contractor_school') THEN
      v_has_unlimited := true;
    ELSIF r.tier = 'intensive' THEN
      v_ws := GREATEST(v_ws, 2);
      v_seats := GREATEST(v_seats, 6);
    ELSIF r.tier = 'book_buyer' THEN
      v_ws := GREATEST(v_ws, 1);
      v_seats := GREATEST(v_seats, 2);
    ELSIF r.tier = 'aos_only' THEN
      v_ws := GREATEST(v_ws, 1 + COALESCE((r.metadata->>'workspaces')::int, 0));
      v_seats := GREATEST(v_seats, 1 + COALESCE((r.metadata->>'seats')::int, 0));
    END IF;

    IF public.tier_rank(r.tier) > v_best_rank THEN
      v_best_rank := public.tier_rank(r.tier);
      v_tier := r.tier;
    END IF;
  END LOOP;

  -- Add-on stacking (seats/workspaces purchased a la carte).
  IF NOT v_has_unlimited THEN
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'seat' THEN quantity ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN kind = 'workspace' THEN quantity ELSE 0 END), 0)
    INTO v_addon_seats, v_addon_ws
    FROM public.aos_addons
    WHERE status IN ('active','trialing')
      AND (
        lower(email) = v_email
        OR (v_user_id IS NOT NULL AND user_id = v_user_id)
      );

    v_seats := v_seats + v_addon_seats;
    v_ws := v_ws + v_addon_ws;
  END IF;

  IF v_has_unlimited THEN
    tier := COALESCE(v_tier, 'circle'::public.app_tier);
    workspace_limit := -1;
    seat_limit := -1;
  ELSE
    tier := v_tier;
    workspace_limit := v_ws;
    seat_limit := v_seats;
  END IF;

  RETURN NEXT;
END;
$$;

-- Allow the service role (used by the public AOS tier-lookup endpoint) to call it.
GRANT EXECUTE ON FUNCTION public.get_user_aos_limits_by_email(text) TO anon, authenticated, service_role;
