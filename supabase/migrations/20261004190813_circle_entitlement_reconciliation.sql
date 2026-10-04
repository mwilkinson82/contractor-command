-- REVIEW ONLY. Apply through Lovable after the identity/grant dry run is approved.
-- No guessed grants, Stripe-ID corrections, grace periods, cron jobs, or sends.
CREATE SCHEMA IF NOT EXISTS membership_private;
REVOKE ALL ON SCHEMA membership_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA membership_private TO service_role;

CREATE TABLE public.circle_owner_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_subscription_id uuid UNIQUE REFERENCES public.subscriptions(id),
  user_id uuid,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  tier public.app_tier NOT NULL DEFAULT 'circle' CHECK(tier IN ('circle','hardcore')),
  granted_by uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  CHECK (expires_at IS NULL OR expires_at > granted_at)
);
CREATE TABLE public.circle_subscription_evidence (
  stripe_subscription_id text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  paid_through timestamptz,
  review_reason text
);
-- Capture existing access only to avoid broad revocations during review. This is
-- not membership evidence, and never qualifies anyone for an announcement.
CREATE TABLE public.circle_legacy_reviews (
  subscription_id uuid PRIMARY KEY REFERENCES public.subscriptions(id),
  preserve_access boolean NOT NULL,
  resolved_at timestamptz,
  resolution text,
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
INSERT INTO public.circle_legacy_reviews(subscription_id, preserve_access)
SELECT id, is_comped OR status IN ('active','trialing')
FROM public.subscriptions WHERE tier IN ('circle','hardcore');

CREATE TABLE public.circle_audience_sync (
  email text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','synced','failed','review')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);
-- Service only: no API access for members; the authenticated admin server owns writes.
ALTER TABLE public.circle_owner_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_subscription_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_legacy_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_audience_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.circle_owner_grants, public.circle_subscription_evidence,
  public.circle_legacy_reviews, public.circle_audience_sync FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.circle_owner_grants, public.circle_subscription_evidence,
  public.circle_legacy_reviews, public.circle_audience_sync TO service_role;

CREATE FUNCTION membership_private.subscription_state(s public.subscriptions, at_time timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public, pg_catalog AS $$
DECLARE e public.circle_subscription_evidence; r public.circle_legacy_reviews;
BEGIN
  IF s.tier NOT IN ('circle','hardcore') THEN RETURN 'not_circle'; END IF;
  -- A converted manual source can never resurrect itself after its grant expires/revokes.
  IF EXISTS (SELECT 1 FROM public.circle_owner_grants g WHERE g.source_subscription_id = s.id)
    AND (s.stripe_subscription_id IS NULL OR s.stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$') THEN RETURN 'ineligible'; END IF;
  SELECT * INTO r FROM public.circle_legacy_reviews WHERE subscription_id = s.id;
  IF r.resolution = 'superseded' THEN RETURN 'ineligible'; END IF;
  SELECT * INTO e FROM public.circle_subscription_evidence WHERE stripe_subscription_id = s.stripe_subscription_id;
  IF e.review_reason IS NOT NULL AND e.review_reason <> 'renewal_payment_pending' THEN RETURN 'review'; END IF;
  IF s.status IN ('superseded','incomplete_expired','incomplete','unpaid','paused') THEN
    IF s.is_comped AND r.resolved_at IS NULL THEN RETURN 'review'; END IF;
    RETURN 'ineligible';
  END IF;
  IF e.observed_at IS NOT NULL AND e.paid_through > at_time
    AND s.status IN ('active','past_due','canceled') THEN RETURN 'eligible'; END IF;
  IF s.is_comped AND r.resolved_at IS NULL THEN RETURN 'review'; END IF;
  IF e.review_reason = 'renewal_payment_pending' THEN RETURN 'review'; END IF;
  IF s.status = 'canceled' THEN RETURN 'ineligible'; END IF;
  -- An expired verified paid period is never extended just by an active status.
  IF e.observed_at IS NOT NULL AND e.paid_through IS NOT NULL AND s.status = 'active'
    THEN RETURN 'ineligible'; END IF;
  -- Trial/grace/missing-payment/legacy identity policy is deliberately unresolved.
  RETURN 'review';
END;
$$;

CREATE FUNCTION membership_private.circle_decision(_user_id uuid, _email text, at_time timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH rows AS (
    SELECT s.*, CASE WHEN s.user_id IS NOT NULL AND _user_id IS NOT NULL AND s.user_id <> _user_id
        THEN 'review' ELSE membership_private.subscription_state(s, at_time) END AS decision,
      coalesce(r.preserve_access AND r.resolved_at IS NULL
        AND (s.user_id IS NULL OR _user_id IS NULL OR s.user_id = _user_id), false) AS review_access
    FROM public.subscriptions s LEFT JOIN public.circle_legacy_reviews r ON r.subscription_id = s.id
    WHERE s.tier IN ('circle','hardcore')
      AND public.subscription_matches_identity(s.user_id,s.email,s.metadata,_user_id,_email)
  ), grants AS (
    SELECT g.tier FROM public.circle_owner_grants g
    WHERE ((_user_id IS NOT NULL AND g.user_id = _user_id)
      OR (g.user_id IS NULL AND lower(g.email) = lower(btrim(_email))))
      AND g.revoked_at IS NULL AND g.granted_at <= at_time
      AND (g.expires_at IS NULL OR g.expires_at > at_time)
  ), facts AS (
    SELECT EXISTS(SELECT 1 FROM grants) AS granted,
      EXISTS(SELECT 1 FROM rows WHERE decision = 'eligible') AS paid,
      EXISTS(SELECT 1 FROM rows WHERE decision = 'review') AS review,
      EXISTS(SELECT 1 FROM rows WHERE decision = 'review' AND review_access) AS preserved
  )
  SELECT jsonb_build_object(
    'tier', (SELECT tier FROM (SELECT tier FROM grants UNION ALL SELECT tier FROM rows WHERE decision = 'eligible' OR (decision = 'review' AND review_access)) t ORDER BY public.tier_rank(tier) DESC LIMIT 1),
    'state', CASE WHEN granted OR paid THEN 'eligible' WHEN review THEN 'review' ELSE 'ineligible' END,
    'hasAccess', granted OR paid OR preserved,
    'reason', CASE WHEN granted THEN 'owner_grant' WHEN paid THEN 'paid_period'
      WHEN review THEN 'membership_review_required' ELSE 'no_current_entitlement' END
  ) FROM facts;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA membership_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA membership_private TO service_role;

-- One canonical decision for Hub, Lovable announcements and Resend reconciliation.
CREATE FUNCTION public.get_circle_entitlement(_user_id uuid, _email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT membership_private.circle_decision(_user_id, _email);
$$;
REVOKE ALL ON FUNCTION public.get_circle_entitlement(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_circle_entitlement(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_tier(_user_id uuid)
RETURNS public.app_tier LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH identity AS (SELECT (SELECT email FROM public.profiles WHERE id = _user_id) AS email),
  tiers AS (
    SELECT s.tier FROM public.subscriptions s CROSS JOIN identity i
    WHERE s.tier NOT IN ('circle','hardcore') AND (s.is_comped OR s.status IN ('active','trialing'))
      AND public.subscription_matches_identity(s.user_id,s.email,s.metadata,_user_id,i.email)
    UNION ALL
    SELECT (membership_private.circle_decision(_user_id,i.email)->>'tier')::public.app_tier FROM identity i
    WHERE (membership_private.circle_decision(_user_id,i.email)->>'hasAccess')::boolean
  )
  SELECT CASE WHEN public.has_role(_user_id,'admin') THEN 'circle'::public.app_tier
    ELSE (SELECT tier FROM tiers ORDER BY public.tier_rank(tier) DESC LIMIT 1) END;
$$;
CREATE OR REPLACE FUNCTION public.has_active_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT public.get_user_tier(_user_id) IS NOT NULL;
$$;

CREATE FUNCTION public.queue_circle_audience_sync(_email text) RETURNS void
LANGUAGE sql SET search_path = public, pg_catalog AS $$
  INSERT INTO public.circle_audience_sync(email) VALUES(lower(btrim(_email)))
  ON CONFLICT(email) DO UPDATE SET revision = circle_audience_sync.revision + 1,
    status = 'pending', last_error = NULL, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.queue_circle_audience_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_circle_audience_sync(text) TO service_role;

-- Atomic source update + durable outbox, serialized per subscription. A late
-- webhook refresh cannot overwrite a later refresh, even across event IDs.
CREATE FUNCTION public.apply_circle_subscription_snapshot(_row jsonb, _paid_through timestamptz,
  _observed_at timestamptz, _review_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE sid text := _row->>'stripe_subscription_id'; prior public.subscriptions;
BEGIN
  IF sid !~ '^sub_[A-Za-z0-9]+$' OR _row->>'tier' <> 'circle' THEN RAISE EXCEPTION 'Invalid Circle snapshot'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(sid, 0));
  IF EXISTS(SELECT 1 FROM public.circle_subscription_evidence WHERE stripe_subscription_id = sid AND observed_at >= _observed_at)
    THEN RETURN false; END IF;
  SELECT * INTO prior FROM public.subscriptions WHERE stripe_subscription_id = sid;
  INSERT INTO public.subscriptions(user_id,email,stripe_customer_id,stripe_subscription_id,price_id,product_id,
    status,cancel_at_period_end,current_period_end,metadata,tier,updated_at)
  VALUES ((_row->>'user_id')::uuid,lower(_row->>'email'),_row->>'stripe_customer_id',sid,_row->>'price_id',_row->>'product_id',
    _row->>'status',coalesce((_row->>'cancel_at_period_end')::boolean,false),(_row->>'current_period_end')::timestamptz,
    coalesce(prior.metadata,'{}'::jsonb) || coalesce(_row->'metadata','{}'::jsonb),'circle',now())
  ON CONFLICT(stripe_subscription_id) DO UPDATE SET
    user_id = coalesce(subscriptions.user_id, excluded.user_id), email = excluded.email,
    stripe_customer_id = excluded.stripe_customer_id, price_id = excluded.price_id, product_id = excluded.product_id,
    status = excluded.status, cancel_at_period_end = excluded.cancel_at_period_end,
    current_period_end = excluded.current_period_end, metadata = excluded.metadata, updated_at = now();
  INSERT INTO public.circle_subscription_evidence VALUES(sid,_observed_at,_paid_through,_review_reason)
  ON CONFLICT(stripe_subscription_id) DO UPDATE SET observed_at = excluded.observed_at,
    paid_through = greatest(circle_subscription_evidence.paid_through,excluded.paid_through), review_reason = excluded.review_reason;
  PERFORM public.queue_circle_audience_sync(_row->>'email');
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_circle_subscription_snapshot(jsonb,timestamptz,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_circle_subscription_snapshot(jsonb,timestamptz,timestamptz,text) TO service_role;

-- Atomic manual grant/revoke. Does not modify Stripe billing status. The legacy
-- record is explicitly resolved only for this owner-reviewed action.
CREATE FUNCTION public.set_circle_owner_grant(_subscription_id uuid, _user_id uuid, _email text,
  _actor uuid, _enabled boolean, _reason text, _expires_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE sid uuid := _subscription_id; s public.subscriptions;
BEGIN
  IF NOT public.has_role(_actor,'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF btrim(_reason) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF sid IS NULL THEN
    IF NOT _enabled THEN RETURN; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(lower(btrim(_email)), 1));
    SELECT source_subscription_id INTO sid FROM public.circle_owner_grants
      WHERE email = lower(btrim(_email)) AND user_id IS NOT DISTINCT FROM _user_id LIMIT 1;
    IF sid IS NULL THEN
      INSERT INTO public.subscriptions(user_id,email,status,tier,metadata)
        VALUES(_user_id,lower(btrim(_email)),'active','circle','{"source":"owner_grant"}') RETURNING id INTO sid;
    END IF;
  END IF;
  SELECT * INTO STRICT s FROM public.subscriptions WHERE id = sid FOR UPDATE;
  IF lower(btrim(_email)) <> lower(s.email) OR (_user_id IS NOT NULL AND s.user_id IS NOT NULL AND _user_id <> s.user_id)
    THEN RAISE EXCEPTION 'Identity mismatch requires review'; END IF;
  IF _enabled THEN
    INSERT INTO public.circle_owner_grants(source_subscription_id,user_id,email,tier,granted_by,reason,expires_at)
      VALUES(sid,coalesce(s.user_id,_user_id),lower(btrim(s.email)),CASE WHEN s.tier = 'hardcore' THEN 'hardcore'::public.app_tier ELSE 'circle'::public.app_tier END,_actor,_reason,_expires_at)
    ON CONFLICT(source_subscription_id) DO UPDATE SET granted_by = _actor, granted_at = now(),
      reason = _reason, expires_at = _expires_at, revoked_at = NULL, revoked_by = NULL
      WHERE circle_owner_grants.revoked_at IS NOT NULL OR circle_owner_grants.expires_at IS DISTINCT FROM _expires_at
        OR circle_owner_grants.reason IS DISTINCT FROM _reason;
  ELSE
    UPDATE public.circle_owner_grants SET revoked_at = coalesce(revoked_at,now()), revoked_by = _actor
      WHERE source_subscription_id = sid AND revoked_at IS NULL;
    -- A revoke without an existing grant must still tombstone a legacy manual row.
    IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.circle_owner_grants WHERE source_subscription_id = sid) THEN
      INSERT INTO public.circle_owner_grants(source_subscription_id,user_id,email,granted_by,reason,revoked_at,revoked_by)
        VALUES(sid,coalesce(s.user_id,_user_id),lower(btrim(s.email)),_actor,_reason,now(),_actor);
    END IF;
  END IF;
  UPDATE public.subscriptions SET is_comped = false WHERE id = sid AND tier IN ('circle','hardcore');
  INSERT INTO public.circle_legacy_reviews VALUES(sid,false,now(),'owner_grant_reviewed')
    ON CONFLICT(subscription_id) DO UPDATE SET preserve_access = false, resolved_at = now(), resolution = excluded.resolution;
  PERFORM public.queue_circle_audience_sync(s.email);
END;
$$;
REVOKE ALL ON FUNCTION public.set_circle_owner_grant(uuid,uuid,text,uuid,boolean,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_circle_owner_grant(uuid,uuid,text,uuid,boolean,text,timestamptz) TO service_role;

-- Fix the existing retry-claim race: failed/expired events are locked before reclaim.
CREATE OR REPLACE FUNCTION public.begin_stripe_webhook_event(_event_id text,_event_type text,_object_id text)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE s public.stripe_webhook_events;
BEGIN
  INSERT INTO public.stripe_webhook_events(event_id,event_type,object_id,status,processing_started_at)
    VALUES(_event_id,_event_type,_object_id,'processing',now()) ON CONFLICT(event_id) DO NOTHING;
  IF FOUND THEN RETURN 'process'; END IF;
  SELECT * INTO s FROM public.stripe_webhook_events WHERE event_id = _event_id FOR UPDATE;
  IF s.status = 'processed' THEN RETURN 'duplicate'; END IF;
  IF s.status = 'processing' AND s.processing_started_at > now() - interval '10 minutes' THEN RETURN 'in_progress'; END IF;
  UPDATE public.stripe_webhook_events SET status = 'processing', attempts = attempts + 1,
    processing_started_at = now(), processed_at = NULL, last_error = NULL,
    event_type = _event_type, object_id = _object_id, updated_at = now() WHERE event_id = _event_id;
  RETURN 'process';
END;
$$;

-- Leases serialize external membership writes; revision changes remain pending.
CREATE FUNCTION public.claim_circle_audience_sync(_email text DEFAULT NULL)
RETURNS SETOF public.circle_audience_sync LANGUAGE sql SET search_path = public, pg_catalog AS $$
  UPDATE public.circle_audience_sync SET status = 'processing', attempts = attempts + 1, updated_at = now()
  WHERE email IN (SELECT email FROM public.circle_audience_sync
    WHERE (_email IS NULL OR email = _email) AND (status IN ('pending','failed') OR (status = 'processing' AND updated_at < now() - interval '10 minutes'))
    ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 10)
  RETURNING *;
$$;
CREATE OR REPLACE FUNCTION public.queue_circle_audience_sync(_email text) RETURNS void
LANGUAGE sql SET search_path = public, pg_catalog AS $$
  INSERT INTO public.circle_audience_sync(email) VALUES(lower(btrim(_email)))
  ON CONFLICT(email) DO UPDATE SET revision = circle_audience_sync.revision + 1,
    status = CASE WHEN circle_audience_sync.status = 'processing' THEN 'processing' ELSE 'pending' END,
    last_error = NULL,
    updated_at = CASE WHEN circle_audience_sync.status = 'processing' THEN circle_audience_sync.updated_at ELSE now() END;
$$;
CREATE FUNCTION public.finish_circle_audience_sync(_email text,_revision bigint,_attempt integer,_status text,_error text)
RETURNS void LANGUAGE sql SET search_path = public, pg_catalog AS $$
  UPDATE public.circle_audience_sync SET
    status = CASE WHEN revision = _revision THEN _status ELSE 'pending' END,
    last_error = left(_error,2000), updated_at = now(),
    synced_at = CASE WHEN revision = _revision AND _status = 'synced' THEN now() ELSE synced_at END
  WHERE email = _email AND status = 'processing' AND attempts = _attempt;
$$;
REVOKE ALL ON FUNCTION public.claim_circle_audience_sync(text),
  public.finish_circle_audience_sync(text,bigint,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_circle_audience_sync(text),
  public.finish_circle_audience_sync(text,bigint,integer,text,text) TO service_role;

-- Preserve unrelated products; stop stale Circle rows from retaining unlimited AOS limits.
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
    WHERE s.tier NOT IN ('circle','hardcore') AND (s.is_comped OR s.status IN ('active','trialing'))
      AND public.subscription_matches_identity(s.user_id, s.email, s.metadata, _user_id, v_email)
    UNION ALL SELECT (d->>'tier')::public.app_tier, '{}'::jsonb
      FROM (SELECT membership_private.circle_decision(_user_id,v_email) d) x WHERE (d->>'hasAccess')::boolean
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
    WHERE s.tier NOT IN ('circle','hardcore') AND (s.is_comped OR s.status IN ('active','trialing'))
      AND public.subscription_matches_identity(s.user_id, s.email, s.metadata, v_user_id, v_email)
    UNION ALL SELECT (d->>'tier')::public.app_tier, '{}'::jsonb
      FROM (SELECT membership_private.circle_decision(v_user_id,v_email) d) x WHERE (d->>'hasAccess')::boolean
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
-- Expiry sweep queues known Circle identities only. No cron is installed here.
CREATE FUNCTION public.queue_circle_audience_sweep() RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE e text;
BEGIN
  FOR e IN
    SELECT lower(coalesce(p.email,s.email)) FROM public.subscriptions s
      LEFT JOIN public.profiles p ON p.id = s.user_id WHERE s.tier IN ('circle','hardcore')
    UNION SELECT lower(coalesce(p.email,g.email)) FROM public.circle_owner_grants g
      LEFT JOIN public.profiles p ON p.id = g.user_id
  LOOP
    -- Do not reset failed attempts/leases; sweep idempotently makes completed jobs due.
    INSERT INTO public.circle_audience_sync(email) VALUES(e)
      ON CONFLICT(email) DO UPDATE SET status = 'pending', revision = circle_audience_sync.revision + 1, updated_at = now()
      WHERE circle_audience_sync.status IN ('synced','review');
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_circle_audience_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_circle_audience_sweep() TO service_role;

CREATE TABLE public.circle_owner_grant_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.circle_owner_grants(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  previous jsonb,
  current jsonb NOT NULL
);
ALTER TABLE public.circle_owner_grant_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.circle_owner_grant_history FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT ON public.circle_owner_grant_history TO service_role;
CREATE FUNCTION membership_private.audit_owner_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  INSERT INTO public.circle_owner_grant_history(grant_id,previous,current)
    VALUES(NEW.id,CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION membership_private.audit_owner_grant() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION membership_private.audit_owner_grant() TO service_role;
CREATE TRIGGER circle_owner_grant_history AFTER INSERT OR UPDATE ON public.circle_owner_grants
  FOR EACH ROW EXECUTE FUNCTION membership_private.audit_owner_grant();
