
-- Bump rank: power_hour/sm_school/contractor_school become equivalent to circle (4).
-- Hardcore remains highest (5).
CREATE OR REPLACE FUNCTION public.tier_rank(_tier app_tier)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _tier
    WHEN 'aos_only' THEN 0
    WHEN 'book_buyer' THEN 1
    WHEN 'intensive' THEN 3
    WHEN 'power_hour' THEN 4
    WHEN 'sm_school' THEN 4
    WHEN 'contractor_school' THEN 4
    WHEN 'circle' THEN 4
    WHEN 'hardcore' THEN 5
  END;
$function$;

-- AOS limits: power_hour/sm_school/contractor_school get unlimited (same as circle/hardcore).
CREATE OR REPLACE FUNCTION public.get_user_aos_limits(_user_id uuid)
 RETURNS TABLE(tier app_tier, workspace_limit integer, seat_limit integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier public.app_tier;
  v_ws integer := 0;
  v_seats integer := 0;
  v_has_unlimited boolean := false;
  r RECORD;
BEGIN
  IF public.has_role(_user_id, 'admin') THEN
    tier := 'circle'::public.app_tier;
    workspace_limit := -1;
    seat_limit := -1;
    RETURN NEXT;
    RETURN;
  END IF;

  v_tier := public.get_user_tier(_user_id);

  FOR r IN
    SELECT s.tier, s.metadata
    FROM public.subscriptions s
    WHERE (s.is_comped OR s.status IN ('active','trialing'))
      AND (
        s.user_id = _user_id
        OR lower(s.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
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
  END LOOP;

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
$function$;

-- Replay access: lock book_buyer out of circle_call. Class-specific categories
-- are unused now (recordings live in the Google Meet invite) but we keep the
-- function shape so existing rows/types don't break.
CREATE OR REPLACE FUNCTION public.can_read_replay_category(_user_id uuid, _category replay_category)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE _category
    WHEN 'circle_call' THEN public.has_tier_at_least(_user_id, 'intensive')
    WHEN 'power_hour' THEN public.has_tier_at_least(_user_id, 'circle')
    WHEN 'sm_school' THEN public.has_tier_at_least(_user_id, 'circle')
    WHEN 'contractor_school' THEN public.has_tier_at_least(_user_id, 'circle')
    ELSE false
  END;
$function$;
