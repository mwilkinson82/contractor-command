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
    IF r.tier IN ('circle', 'hardcore') THEN
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
    tier := v_tier;
    workspace_limit := v_ws;
    seat_limit := v_seats;
  END IF;

  RETURN NEXT;
END;
$function$;