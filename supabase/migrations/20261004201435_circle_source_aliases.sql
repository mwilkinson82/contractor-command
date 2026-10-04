-- REVIEW ONLY: apply this empty schema through Lovable after independent review.
-- No real identities, grants, billing changes, schedulers, or sends are included.
CREATE TABLE public.circle_source_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_subscription_id uuid NOT NULL REFERENCES public.subscriptions(id),
  source_stripe_subscription_id text NOT NULL CHECK (source_stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  source_stripe_customer_id text NOT NULL CHECK (source_stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  source_user_id uuid,
  source_email text NOT NULL CHECK (source_email = lower(btrim(source_email)) AND source_email <> ''),
  target_user_id uuid NOT NULL,
  target_email text NOT NULL CHECK (target_email = lower(btrim(target_email)) AND target_email <> ''),
  billing_email text NOT NULL CHECK (billing_email = lower(btrim(billing_email)) AND billing_email <> ''),
  approved_by uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  UNIQUE(source_subscription_id,target_user_id,target_email),
  CHECK (expires_at IS NULL OR expires_at > approved_at),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CHECK (revoked_at IS NULL OR (revocation_reason IS NOT NULL AND btrim(revocation_reason) <> ''))
);
CREATE INDEX circle_source_aliases_target ON public.circle_source_aliases(target_user_id,target_email);
CREATE INDEX circle_source_aliases_stripe ON public.circle_source_aliases(source_stripe_subscription_id);
CREATE TABLE public.circle_source_alias_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_id uuid NOT NULL REFERENCES public.circle_source_aliases(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  previous jsonb,
  current jsonb NOT NULL
);
ALTER TABLE public.circle_source_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_source_alias_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.circle_source_aliases, public.circle_source_alias_history FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.circle_source_aliases TO service_role;
GRANT SELECT,INSERT ON public.circle_source_alias_history TO service_role;

-- Pin every mapping to both sides' reviewed bindings. A changed Stripe source,
-- customer, Hub account or destination email needs a new explicit review.
CREATE FUNCTION membership_private.alias_binding_current(a public.circle_source_aliases,
  s public.subscriptions, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT a.source_subscription_id = s.id AND s.tier IN ('circle','hardcore')
    AND a.source_stripe_subscription_id = s.stripe_subscription_id
    AND a.source_stripe_customer_id = s.stripe_customer_id
    AND a.source_user_id IS NOT DISTINCT FROM s.user_id
    AND a.source_email = lower(btrim(s.email))
    AND a.approved_at <= at_time AND a.revoked_at IS NULL
    AND (a.expires_at IS NULL OR a.expires_at > at_time)
    AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = a.target_user_id AND lower(btrim(p.email)) = a.target_email)
    AND (s.user_id IS NULL OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = s.user_id));
$$;

-- The webhook may accept a differing billing address only for the existing
-- source account's exact, reviewed mapping. A secondary alias cannot rebind it.
CREATE FUNCTION public.circle_billing_identity_approved(_source_id uuid,
  _stripe_subscription_id text,_stripe_customer_id text,_hub_user_id uuid,_hub_email text,_billing_email text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public.circle_source_aliases a JOIN public.subscriptions s ON s.id = a.source_subscription_id
    WHERE s.id = _source_id AND s.stripe_subscription_id = _stripe_subscription_id
      AND s.stripe_customer_id = _stripe_customer_id AND s.user_id = _hub_user_id
      AND lower(btrim(s.email)) = lower(btrim(_hub_email))
      AND a.target_user_id = _hub_user_id AND a.target_email = lower(btrim(_hub_email))
      AND a.billing_email = lower(btrim(_billing_email))
      AND membership_private.alias_binding_current(a,s,now()));
$$;
REVOKE ALL ON FUNCTION public.circle_billing_identity_approved(uuid,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.circle_billing_identity_approved(uuid,text,text,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION membership_private.circle_decision(_user_id uuid,_email text,at_time timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public,pg_catalog AS $$
  WITH matched AS (
    SELECT s.*,public.subscription_matches_identity(s.user_id,s.email,s.metadata,_user_id,_email) AS direct_match,
      EXISTS(SELECT 1 FROM public.circle_source_aliases a WHERE a.source_subscription_id = s.id
        AND a.target_user_id = _user_id AND a.target_email = lower(btrim(_email))
        AND a.billing_email = lower(btrim(s.metadata->>'stripe_customer_email'))
        AND membership_private.alias_binding_current(a,s,at_time)) AS alias_match
    FROM public.subscriptions s WHERE s.tier IN ('circle','hardcore')
  ), rows AS (
    SELECT s.*,CASE WHEN s.user_id IS NOT NULL AND _user_id IS NOT NULL AND s.user_id <> _user_id AND NOT s.alias_match
      THEN 'review' ELSE membership_private.subscription_state(base,at_time) END AS decision,
      coalesce(r.preserve_access AND r.resolved_at IS NULL AND s.direct_match
        AND (s.user_id IS NULL OR _user_id IS NULL OR s.user_id = _user_id),false) AS review_access
    FROM matched s JOIN public.subscriptions base ON base.id = s.id
    LEFT JOIN public.circle_legacy_reviews r ON r.subscription_id = s.id
    WHERE s.direct_match OR s.alias_match
  ), grants AS (
    SELECT g.tier FROM public.circle_owner_grants g
    WHERE ((_user_id IS NOT NULL AND g.user_id = _user_id)
      OR (g.user_id IS NULL AND lower(g.email) = lower(btrim(_email))))
      AND g.revoked_at IS NULL AND g.granted_at <= at_time
      AND (g.expires_at IS NULL OR g.expires_at > at_time)
  ), facts AS (
    SELECT EXISTS(SELECT 1 FROM grants) AS granted,EXISTS(SELECT 1 FROM rows WHERE decision = 'eligible') AS paid,
      EXISTS(SELECT 1 FROM rows WHERE decision = 'review') AS review,
      EXISTS(SELECT 1 FROM rows WHERE decision = 'review' AND review_access) AS preserved
  )
  SELECT jsonb_build_object(
    'tier',(SELECT tier FROM (SELECT tier FROM grants UNION ALL SELECT tier FROM rows WHERE decision = 'eligible' OR (decision = 'review' AND review_access)) t ORDER BY public.tier_rank(tier) DESC LIMIT 1),
    'state',CASE WHEN granted OR paid THEN 'eligible' WHEN review THEN 'review' ELSE 'ineligible' END,
    'hasAccess',granted OR paid OR preserved,
    'reason',CASE WHEN granted THEN 'owner_grant' WHEN paid THEN 'paid_period' WHEN review THEN 'membership_review_required' ELSE 'no_current_entitlement' END
  ) FROM facts;
$$;

CREATE FUNCTION public.set_circle_source_alias(_source_id uuid,_expected_stripe_subscription_id text,
  _expected_stripe_customer_id text,_expected_source_user_id uuid,_expected_source_email text,
  _target_user_id uuid,_target_email text,_billing_email text,_actor uuid,_enabled boolean,_reason text,
  _expires_at timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
DECLARE s public.subscriptions; alias_id uuid;
BEGIN
  IF NOT public.has_role(_actor,'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _enabled IS NULL THEN RAISE EXCEPTION 'Explicit enable or revoke decision required'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_source_id::text,2));
  IF NOT _enabled THEN
    UPDATE public.circle_source_aliases SET revoked_at = now(),revoked_by = _actor,revocation_reason = _reason
      WHERE source_subscription_id = _source_id AND target_user_id = _target_user_id
        AND target_email = lower(btrim(_target_email)) AND revoked_at IS NULL RETURNING id INTO alias_id;
    IF alias_id IS NULL THEN SELECT id INTO alias_id FROM public.circle_source_aliases
      WHERE source_subscription_id = _source_id AND target_user_id = _target_user_id AND target_email = lower(btrim(_target_email)); END IF;
    RETURN alias_id;
  END IF;
  SELECT * INTO STRICT s FROM public.subscriptions WHERE id = _source_id FOR UPDATE;
  IF s.tier NOT IN ('circle','hardcore') OR s.stripe_subscription_id IS NULL OR s.stripe_customer_id IS NULL
    OR s.stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' OR s.stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    OR s.stripe_subscription_id IS DISTINCT FROM _expected_stripe_subscription_id
    OR s.stripe_customer_id IS DISTINCT FROM _expected_stripe_customer_id
    OR s.user_id IS DISTINCT FROM _expected_source_user_id
    OR lower(btrim(s.email)) IS DISTINCT FROM lower(btrim(_expected_source_email))
    THEN RAISE EXCEPTION 'Source changed or is not a recurring Circle source; review required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id = _target_user_id AND lower(btrim(email)) = lower(btrim(_target_email)))
    OR (SELECT count(*) FROM public.profiles WHERE lower(btrim(email)) = lower(btrim(_target_email))) <> 1
    THEN RAISE EXCEPTION 'Target identity requires review'; END IF;
  IF _billing_email IS NULL OR btrim(_billing_email) = '' THEN RAISE EXCEPTION 'Verified billing email required'; END IF;
  IF _expires_at IS NOT NULL AND _expires_at <= now() THEN RAISE EXCEPTION 'Expiry must be in the future'; END IF;
  INSERT INTO public.circle_source_aliases(source_subscription_id,source_stripe_subscription_id,source_stripe_customer_id,
    source_user_id,source_email,target_user_id,target_email,billing_email,approved_by,reason,expires_at)
  VALUES(s.id,s.stripe_subscription_id,s.stripe_customer_id,s.user_id,lower(btrim(s.email)),_target_user_id,
    lower(btrim(_target_email)),lower(btrim(_billing_email)),_actor,_reason,_expires_at)
  ON CONFLICT(source_subscription_id,target_user_id,target_email) DO UPDATE SET
    source_stripe_subscription_id = excluded.source_stripe_subscription_id,source_stripe_customer_id = excluded.source_stripe_customer_id,
    source_user_id = excluded.source_user_id,source_email = excluded.source_email,billing_email = excluded.billing_email,
    approved_by = excluded.approved_by,reason = excluded.reason,approved_at = now(),expires_at = excluded.expires_at,
    revoked_at = NULL,revoked_by = NULL,revocation_reason = NULL
  WHERE circle_source_aliases.revoked_at IS NOT NULL
    OR (circle_source_aliases.source_stripe_subscription_id,circle_source_aliases.source_stripe_customer_id,circle_source_aliases.source_user_id,
      circle_source_aliases.source_email,circle_source_aliases.billing_email,circle_source_aliases.reason,circle_source_aliases.expires_at)
      IS DISTINCT FROM (excluded.source_stripe_subscription_id,excluded.source_stripe_customer_id,excluded.source_user_id,
        excluded.source_email,excluded.billing_email,excluded.reason,excluded.expires_at)
  RETURNING id INTO alias_id;
  IF alias_id IS NULL THEN SELECT id INTO alias_id FROM public.circle_source_aliases
    WHERE source_subscription_id = _source_id AND target_user_id = _target_user_id AND target_email = lower(btrim(_target_email)); END IF;
  RETURN alias_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_circle_source_alias(uuid,text,text,uuid,text,uuid,text,text,uuid,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_circle_source_alias(uuid,text,text,uuid,text,uuid,text,text,uuid,boolean,text,timestamptz) TO service_role;

CREATE FUNCTION membership_private.audit_circle_source_alias() RETURNS trigger
LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  INSERT INTO public.circle_source_alias_history(alias_id,previous,current)
    VALUES(NEW.id,CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  PERFORM public.queue_circle_audience_sync(NEW.target_email);
  IF TG_OP = 'UPDATE' AND OLD.target_email <> NEW.target_email THEN PERFORM public.queue_circle_audience_sync(OLD.target_email); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER circle_source_alias_audit AFTER INSERT OR UPDATE ON public.circle_source_aliases
  FOR EACH ROW EXECUTE FUNCTION membership_private.audit_circle_source_alias();

CREATE FUNCTION membership_private.queue_dependent_circle_aliases() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_catalog AS $$
DECLARE e text;
BEGIN
  IF TG_TABLE_NAME = 'subscriptions' THEN
    FOR e IN SELECT DISTINCT target_email FROM public.circle_source_aliases WHERE source_subscription_id = NEW.id
    LOOP PERFORM public.queue_circle_audience_sync(e); END LOOP;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    FOR e IN SELECT DISTINCT target_email FROM public.circle_source_aliases
      WHERE target_user_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
        OR source_user_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    LOOP PERFORM public.queue_circle_audience_sync(e); END LOOP;
  ELSIF TG_TABLE_NAME = 'circle_legacy_reviews' THEN
    FOR e IN SELECT DISTINCT target_email FROM public.circle_source_aliases
      WHERE source_subscription_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.subscription_id ELSE NEW.subscription_id END
    LOOP PERFORM public.queue_circle_audience_sync(e); END LOOP;
  ELSE
    FOR e IN SELECT DISTINCT target_email FROM public.circle_source_aliases
      WHERE source_stripe_subscription_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.stripe_subscription_id ELSE NEW.stripe_subscription_id END
    LOOP PERFORM public.queue_circle_audience_sync(e); END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER circle_alias_source_changed AFTER UPDATE OF status,stripe_subscription_id,stripe_customer_id,user_id,email,metadata,current_period_end,is_comped,tier
  ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION membership_private.queue_dependent_circle_aliases();
CREATE TRIGGER circle_alias_payment_changed AFTER INSERT OR UPDATE OR DELETE ON public.circle_subscription_evidence
  FOR EACH ROW EXECUTE FUNCTION membership_private.queue_dependent_circle_aliases();
CREATE TRIGGER circle_alias_legacy_review_changed AFTER INSERT OR UPDATE OR DELETE ON public.circle_legacy_reviews
  FOR EACH ROW EXECUTE FUNCTION membership_private.queue_dependent_circle_aliases();
CREATE TRIGGER circle_alias_profile_changed AFTER UPDATE OF email OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION membership_private.queue_dependent_circle_aliases();

CREATE OR REPLACE FUNCTION public.queue_circle_audience_sweep() RETURNS void
LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
DECLARE e text;
BEGIN
  FOR e IN
    SELECT lower(coalesce(p.email,s.email)) FROM public.subscriptions s LEFT JOIN public.profiles p ON p.id = s.user_id WHERE s.tier IN ('circle','hardcore')
    UNION SELECT lower(coalesce(p.email,g.email)) FROM public.circle_owner_grants g LEFT JOIN public.profiles p ON p.id = g.user_id
    UNION SELECT target_email FROM public.circle_source_aliases
  LOOP
    INSERT INTO public.circle_audience_sync(email) VALUES(e)
      ON CONFLICT(email) DO UPDATE SET status = 'pending',revision = circle_audience_sync.revision + 1,updated_at = now()
      WHERE circle_audience_sync.status IN ('synced','review');
  END LOOP;
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA membership_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA membership_private TO service_role;
