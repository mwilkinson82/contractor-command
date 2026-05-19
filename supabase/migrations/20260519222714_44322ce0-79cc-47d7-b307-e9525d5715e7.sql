-- Re-create tier_rank to include aos_only at the bottom
CREATE OR REPLACE FUNCTION public.tier_rank(_tier public.app_tier)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _tier
    WHEN 'aos_only' THEN 0
    WHEN 'book_buyer' THEN 1
    WHEN 'intensive' THEN 2
    WHEN 'circle' THEN 3
  END;
$$;

-- AOS allowance per user. -1 means unlimited.
-- Reads across all active/comped subscriptions and takes the best of each cap.
CREATE OR REPLACE FUNCTION public.get_user_aos_limits(_user_id uuid)
RETURNS TABLE(tier public.app_tier, workspace_limit integer, seat_limit integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier public.app_tier;
  v_ws integer := 0;
  v_seats integer := 0;
  v_has_unlimited boolean := false;
  r RECORD;
BEGIN
  -- Admin short-circuit
  IF public.has_role(_user_id, 'admin') THEN
    tier := 'circle'::public.app_tier;
    workspace_limit := -1;
    seat_limit := -1;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Highest tier the user holds (drives the returned tier label)
  v_tier := public.get_user_tier(_user_id);

  -- Walk every active/comped subscription and aggregate caps
  FOR r IN
    SELECT s.tier, s.metadata
    FROM public.subscriptions s
    WHERE (s.is_comped OR s.status IN ('active','trialing'))
      AND (
        s.user_id = _user_id
        OR lower(s.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
      )
  LOOP
    IF r.tier = 'circle' THEN
      v_has_unlimited := true;
    ELSIF r.tier = 'intensive' THEN
      v_ws := GREATEST(v_ws, 2);
      v_seats := GREATEST(v_seats, 6);
    ELSIF r.tier = 'book_buyer' THEN
      v_ws := GREATEST(v_ws, 1);
      v_seats := GREATEST(v_seats, 2);
    ELSIF r.tier = 'aos_only' THEN
      v_ws := GREATEST(
        v_ws,
        1 + COALESCE((r.metadata->>'workspaces')::int, 0)
      );
      v_seats := GREATEST(
        v_seats,
        1 + COALESCE((r.metadata->>'seats')::int, 0)
      );
    END IF;
  END LOOP;

  IF v_has_unlimited THEN
    tier := COALESCE(v_tier, 'circle'::public.app_tier);
    workspace_limit := -1;
    seat_limit := -1;
  ELSE
    tier := v_tier;  -- may be NULL if no active sub
    workspace_limit := v_ws;
    seat_limit := v_seats;
  END IF;

  RETURN NEXT;
END;
$$;