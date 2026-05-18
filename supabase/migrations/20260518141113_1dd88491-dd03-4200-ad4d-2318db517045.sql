
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- ============ user_roles ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "users read own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "admins manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ subscriptions ============
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  price_id text,
  product_id text,
  status text NOT NULL,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  is_founding boolean NOT NULL DEFAULT false,
  is_comped boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_email_lower_idx ON public.subscriptions (lower(email));
CREATE INDEX subscriptions_user_id_idx ON public.subscriptions (user_id);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "admin manages subscriptions"
  ON public.subscriptions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Access helper used by content RLS
CREATE OR REPLACE FUNCTION public.has_active_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE user_id = _user_id
        AND (is_comped OR status IN ('active','trialing'))
    )
$$;

-- ============ pending_claims ============
CREATE TABLE public.pending_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  price_id text,
  status text NOT NULL,
  current_period_end timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX pending_claims_unclaimed_email_idx
  ON public.pending_claims (lower(email)) WHERE claimed_at IS NULL;
ALTER TABLE public.pending_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manages pending claims"
  ON public.pending_claims FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ templates ============
CREATE TABLE public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  long_description text,
  category text NOT NULL,
  file_type text NOT NULL DEFAULT 'pdf',
  download_url text,
  featured boolean NOT NULL DEFAULT false,
  badge text,
  pages text,
  highlights text[] NOT NULL DEFAULT '{}'::text[],
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read templates"
  ON public.templates FOR SELECT
  USING (published AND public.has_active_access(auth.uid()));

CREATE POLICY "admin manages templates"
  ON public.templates FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ replays ============
CREATE TABLE public.replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  video_url text,
  thumbnail_url text,
  duration_minutes integer,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  tags text[] NOT NULL DEFAULT '{}'::text[],
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.replays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active members read replays"
  ON public.replays FOR SELECT
  USING (published AND public.has_active_access(auth.uid()));

CREATE POLICY "admin manages replays"
  ON public.replays FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ Claim trigger ============
CREATE OR REPLACE FUNCTION public.claim_pending_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  RETURN NEW;
END;
$$;

CREATE TRIGGER claim_pending_subscription_on_profile
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.claim_pending_subscription();
