CREATE OR REPLACE FUNCTION public.subscription_matches_identity(
  _sub_user_id uuid,
  _sub_email text,
  _sub_metadata jsonb,
  _user_id uuid,
  _email text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (_user_id IS NOT NULL AND _sub_user_id = _user_id)
    OR (_email IS NOT NULL AND lower(coalesce(_sub_email, '')) = lower(_email))
    OR (
      _email IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(_sub_metadata->'account_aliases', '[]'::jsonb)) AS alias(email)
        WHERE lower(alias.email) = lower(_email)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_active_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH identity AS (
    SELECT (SELECT p.email FROM public.profiles p WHERE p.id = _user_id LIMIT 1) AS email
  )
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.subscriptions s
      CROSS JOIN identity i
      WHERE (s.is_comped OR s.status IN ('active','trialing'))
        AND public.subscription_matches_identity(s.user_id, s.email, s.metadata, _user_id, i.email)
    );
$$;

CREATE OR REPLACE FUNCTION public.get_user_tier(_user_id uuid)
RETURNS app_tier
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH identity AS (
    SELECT (SELECT p.email FROM public.profiles p WHERE p.id = _user_id LIMIT 1) AS email
  )
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') THEN 'circle'::public.app_tier
    ELSE (
      SELECT s.tier
      FROM public.subscriptions s
      CROSS JOIN identity i
      WHERE (s.is_comped OR s.status IN ('active','trialing'))
        AND public.subscription_matches_identity(s.user_id, s.email, s.metadata, _user_id, i.email)
      ORDER BY public.tier_rank(s.tier) DESC
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_aos_limits(_user_id uuid)
RETURNS TABLE(tier app_tier, workspace_limit integer, seat_limit integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
  v_tier public.app_tier;
  v_ws integer := 0;
  v_seats integer := 0;
  v_has_unlimited boolean := false;
  v_addon_seats integer := 0;
  v_addon_ws integer := 0;
  r RECORD;
BEGIN
  SELECT lower(p.email) INTO v_email
  FROM public.profiles p
  WHERE p.id = _user_id
  LIMIT 1;

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
      AND public.subscription_matches_identity(s.user_id, s.email, s.metadata, _user_id, v_email)
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

  IF NOT v_has_unlimited THEN
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'seat' THEN quantity ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN kind = 'workspace' THEN quantity ELSE 0 END), 0)
    INTO v_addon_seats, v_addon_ws
    FROM public.aos_addons
    WHERE status IN ('active','trialing')
      AND (
        user_id = _user_id
        OR (v_email IS NOT NULL AND lower(email) = v_email)
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

CREATE OR REPLACE FUNCTION public.get_user_aos_limits_by_email(_email text)
RETURNS TABLE(tier app_tier, workspace_limit integer, seat_limit integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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

  IF v_user_id IS NOT NULL AND public.has_role(v_user_id, 'admin') THEN
    tier := 'circle'::public.app_tier;
    workspace_limit := -1;
    seat_limit := -1;
    RETURN NEXT;
    RETURN;
  END IF;

  FOR r IN
    SELECT s.tier, s.metadata
    FROM public.subscriptions s
    WHERE (s.is_comped OR s.status IN ('active','trialing'))
      AND public.subscription_matches_identity(s.user_id, s.email, s.metadata, v_user_id, v_email)
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