CREATE OR REPLACE FUNCTION public.has_active_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE (s.is_comped OR s.status IN ('active','trialing'))
        AND (
          s.user_id = _user_id
          OR lower(s.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
    )
$$;

CREATE OR REPLACE FUNCTION public.claim_pending_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.pending_claims%ROWTYPE;
BEGIN
  SELECT * INTO v_claim
  FROM public.pending_claims
  WHERE lower(email) = lower(NEW.email) AND claimed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.subscriptions (
      user_id, email, stripe_customer_id, stripe_subscription_id,
      price_id, status, current_period_end, is_founding, metadata
    ) VALUES (
      NEW.id, NEW.email, v_claim.stripe_customer_id, v_claim.stripe_subscription_id,
      v_claim.price_id, v_claim.status, v_claim.current_period_end,
      COALESCE((v_claim.metadata->>'memberRole') = 'founding_member', false),
      v_claim.metadata
    )
    ON CONFLICT (stripe_subscription_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          current_period_end = EXCLUDED.current_period_end,
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
$$;

UPDATE public.subscriptions s
SET user_id = p.id,
    updated_at = now()
FROM public.profiles p
WHERE s.user_id IS NULL
  AND lower(s.email) = lower(p.email);

UPDATE public.pending_claims pc
SET claimed_at = now(),
    claimed_by = p.id
FROM public.profiles p
WHERE pc.claimed_at IS NULL
  AND lower(pc.email) = lower(p.email);