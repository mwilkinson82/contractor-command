
-- Phase 1: Tier model foundation
-- Adds book_buyer / intensive / circle tiers, helpers, and re-gates Circle-only content.

-- 1. Tier enum (ordered low → high)
CREATE TYPE public.app_tier AS ENUM ('book_buyer', 'intensive', 'circle');

-- 2. Add tier column to subscriptions; default existing rows to 'circle'
ALTER TABLE public.subscriptions
  ADD COLUMN tier public.app_tier NOT NULL DEFAULT 'circle';

-- 3. Helper: numeric rank for comparisons
CREATE OR REPLACE FUNCTION public.tier_rank(_tier public.app_tier)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _tier
    WHEN 'book_buyer' THEN 1
    WHEN 'intensive' THEN 2
    WHEN 'circle' THEN 3
  END;
$$;

-- 4. Highest active tier for a user (admins always count as 'circle')
CREATE OR REPLACE FUNCTION public.get_user_tier(_user_id uuid)
RETURNS public.app_tier
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(_user_id, 'admin') THEN 'circle'::public.app_tier
    ELSE (
      SELECT s.tier
      FROM public.subscriptions s
      WHERE (s.is_comped OR s.status IN ('active','trialing'))
        AND (
          s.user_id = _user_id
          OR lower(s.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
      ORDER BY public.tier_rank(s.tier) DESC
      LIMIT 1
    )
  END;
$$;

-- 5. Convenience: has at least the given tier?
CREATE OR REPLACE FUNCTION public.has_tier_at_least(_user_id uuid, _min public.app_tier)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.tier_rank(public.get_user_tier(_user_id)) >= public.tier_rank(_min),
    false
  );
$$;

-- 6. Re-gate Circle-only content from has_active_access → has_tier_at_least('circle').
-- This keeps existing Circle members fully working AND prevents future Book Buyers
-- from leaking into Vault / Calls / Templates / Replays / Ask threads.

-- replays
DROP POLICY IF EXISTS "active members read replays" ON public.replays;
CREATE POLICY "circle members read replays"
ON public.replays FOR SELECT
USING (published AND public.has_tier_at_least(auth.uid(), 'circle'));

-- templates
DROP POLICY IF EXISTS "active members read templates" ON public.templates;
CREATE POLICY "circle members read templates"
ON public.templates FOR SELECT
USING (published AND public.has_tier_at_least(auth.uid(), 'circle'));

-- 7. Extend claim trigger to set tier from pending_claims.metadata.product
CREATE OR REPLACE FUNCTION public.claim_pending_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim public.pending_claims%ROWTYPE;
  v_tier public.app_tier;
BEGIN
  SELECT * INTO v_claim
  FROM public.pending_claims
  WHERE lower(email) = lower(NEW.email) AND claimed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    -- Map product → tier (default: circle, preserves prior behavior)
    v_tier := CASE v_claim.metadata->>'product'
      WHEN 'book_v2' THEN 'book_buyer'::public.app_tier
      WHEN 'intensive' THEN 'intensive'::public.app_tier
      ELSE 'circle'::public.app_tier
    END;

    INSERT INTO public.subscriptions (
      user_id, email, stripe_customer_id, stripe_subscription_id,
      price_id, status, current_period_end, is_founding, metadata, tier
    ) VALUES (
      NEW.id, NEW.email, v_claim.stripe_customer_id, v_claim.stripe_subscription_id,
      v_claim.price_id, v_claim.status, v_claim.current_period_end,
      COALESCE((v_claim.metadata->>'memberRole') = 'founding_member', false),
      v_claim.metadata, v_tier
    )
    ON CONFLICT (stripe_subscription_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          current_period_end = EXCLUDED.current_period_end,
          tier = EXCLUDED.tier,
          updated_at = now();

    UPDATE public.pending_claims
    SET claimed_at = now(), claimed_by = NEW.id
    WHERE id = v_claim.id;
  END IF;

  UPDATE public.subscriptions
  SET user_id = NEW.id,
      updated_at = now()
  WHERE user_id IS NULL
    AND lower(email) = lower(NEW.email);

  RETURN NEW;
END;
$function$;
