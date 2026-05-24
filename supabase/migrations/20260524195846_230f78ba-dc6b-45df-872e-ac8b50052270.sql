
-- 1) Fix subscription privilege escalation: remove email-based matching from access checks.
-- Subscriptions get user_id backfilled by claim_pending_subscription trigger on signup,
-- so user_id should always be populated for legitimate access.

CREATE OR REPLACE FUNCTION public.has_active_access(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE (s.is_comped OR s.status IN ('active','trialing'))
        AND s.user_id = _user_id
    )
$function$;

CREATE OR REPLACE FUNCTION public.get_user_tier(_user_id uuid)
 RETURNS app_tier
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') THEN 'circle'::public.app_tier
    ELSE (
      SELECT s.tier
      FROM public.subscriptions s
      WHERE (s.is_comped OR s.status IN ('active','trialing'))
        AND s.user_id = _user_id
      ORDER BY public.tier_rank(s.tier) DESC
      LIMIT 1
    )
  END;
$function$;

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
      AND s.user_id = _user_id
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
      AND user_id = _user_id;

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

-- 2) Restrict company-logos storage policies to authenticated role only
DROP POLICY IF EXISTS "owner can upload own company logo" ON storage.objects;
DROP POLICY IF EXISTS "owner can update own company logo" ON storage.objects;
DROP POLICY IF EXISTS "owner can delete own company logo" ON storage.objects;

CREATE POLICY "owner can upload own company logo"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'company-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "owner can update own company logo"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'company-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "owner can delete own company logo"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'company-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 3) Revoke EXECUTE on SECURITY DEFINER functions that should not be callable
-- by clients (trigger-only, server-only via service role, or webhook helpers).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_admin_for_owner() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pending_subscription() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.begin_stripe_webhook_event(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_stripe_webhook_event(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated;
