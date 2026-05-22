
CREATE TABLE IF NOT EXISTS public.aos_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('seat', 'workspace')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  price_id text,
  status text NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aos_addons_user ON public.aos_addons(user_id);
CREATE INDEX IF NOT EXISTS idx_aos_addons_email ON public.aos_addons(lower(email));
CREATE INDEX IF NOT EXISTS idx_aos_addons_kind_status ON public.aos_addons(kind, status);

ALTER TABLE public.aos_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own aos addons"
  ON public.aos_addons FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "admin manages aos addons"
  ON public.aos_addons FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_aos_addons_updated_at
  BEFORE UPDATE ON public.aos_addons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Stack book-buyer base limits with active add-on quantities.
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
  v_addon_seats integer := 0;
  v_addon_ws integer := 0;
  v_email text;
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
  v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));

  FOR r IN
    SELECT s.tier, s.metadata
    FROM public.subscriptions s
    WHERE (s.is_comped OR s.status IN ('active','trialing'))
      AND (s.user_id = _user_id OR lower(s.email) = v_email)
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

  -- Add-on stacking (currently only book_buyer is offered checkout, but the
  -- logic is generic — any non-unlimited tier benefits if we sell to them).
  IF NOT v_has_unlimited THEN
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'seat' THEN quantity ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN kind = 'workspace' THEN quantity ELSE 0 END), 0)
    INTO v_addon_seats, v_addon_ws
    FROM public.aos_addons
    WHERE status IN ('active','trialing')
      AND (user_id = _user_id OR lower(email) = v_email);

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
$function$;
