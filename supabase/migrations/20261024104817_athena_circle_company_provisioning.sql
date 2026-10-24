-- T-004. Athena-only provisioning; no auth/profile/Hub triggers, emails or billing mutations.
-- Unclaimed workspaces have no creator/member until a verified identity claims them.
ALTER TABLE public.mcp_companies ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.mcp_company_entitlements DROP CONSTRAINT mcp_company_entitlements_plan_check;
ALTER TABLE public.mcp_company_entitlements ADD CONSTRAINT mcp_company_entitlements_plan_check
  CHECK (plan IS NULL OR plan IN ('athena_pm','athena_office','circle','hardcore'));

CREATE TABLE public.mcp_circle_provisioning (
  source_subscription_id uuid PRIMARY KEY REFERENCES public.subscriptions(id),
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  payment_email text NOT NULL CHECK (payment_email = lower(btrim(payment_email))),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  owner_user_id uuid REFERENCES auth.users(id),
  display_name text NOT NULL,
  state text NOT NULL CHECK (state IN ('ready','unclaimed','review','inactive')),
  override_until timestamptz,
  override_reason text,
  override_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((override_until IS NULL AND override_reason IS NULL AND override_by IS NULL)
    OR (override_until IS NOT NULL AND btrim(override_reason) <> '' AND override_by IS NOT NULL))
);
CREATE INDEX mcp_circle_provisioning_owner ON public.mcp_circle_provisioning(owner_user_id);
CREATE INDEX mcp_circle_provisioning_email ON public.mcp_circle_provisioning(payment_email);
CREATE INDEX mcp_circle_provisioning_company ON public.mcp_circle_provisioning(company_id);
CREATE TABLE public.mcp_circle_provisioning_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_subscription_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  previous jsonb,
  current jsonb NOT NULL
);
ALTER TABLE public.mcp_circle_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_circle_provisioning_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_circle_provisioning, public.mcp_circle_provisioning_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.mcp_circle_provisioning TO service_role;
GRANT SELECT,INSERT ON public.mcp_circle_provisioning_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.mcp_circle_provisioning_audit_id_seq TO service_role;

CREATE FUNCTION mcp_private.circle_provisioning_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
BEGIN
  INSERT INTO public.mcp_circle_provisioning_audit(source_subscription_id,previous,current)
    VALUES(NEW.source_subscription_id,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
  RETURN NEW;
END $$;
CREATE TRIGGER mcp_circle_provisioning_audit AFTER INSERT OR UPDATE ON public.mcp_circle_provisioning
  FOR EACH ROW EXECUTE FUNCTION mcp_private.circle_provisioning_audit();

-- Live decisions use canonical payment/grant evidence, not a forever-active entitlement row.
-- An explicit, bounded owner override is Athena-only and remains separately audited.
CREATE FUNCTION mcp_private.circle_company_live(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public,pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_circle_provisioning p
    JOIN public.subscriptions s ON s.id=p.source_subscription_id
    JOIN auth.users u ON u.id=p.owner_user_id
    WHERE p.company_id=_company AND p.owner_user_id IS NOT NULL
      AND s.stripe_subscription_id=p.stripe_subscription_id
      AND s.stripe_customer_id=p.stripe_customer_id
      AND (s.user_id=p.owner_user_id OR s.user_id IS NULL)
      AND u.email_confirmed_at IS NOT NULL
      AND s.tier IN ('circle','hardcore')
      AND (membership_private.subscription_state(s,now())='eligible'
        OR (p.override_until>now() AND s.status='active'))
  )
$$;

CREATE FUNCTION mcp_private.ensure_circle_company(_source uuid, _claim_user uuid DEFAULT NULL,
  _reserve boolean DEFAULT false, _display_name text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_catalog AS $$
DECLARE s public.subscriptions; p public.mcp_circle_provisioning; cid uuid; uid uuid;
  billing text; label text; em text; source_state text; next_state text;
BEGIN
  SELECT * INTO s FROM public.subscriptions WHERE id=_source;
  IF NOT FOUND OR s.tier NOT IN ('circle','hardcore') OR coalesce(s.stripe_subscription_id,'') !~ '^sub_[A-Za-z0-9]+$'
    OR coalesce(s.stripe_customer_id,'') !~ '^cus_[A-Za-z0-9]+$' THEN RETURN NULL; END IF;
  -- Serialize source renewals and a first verified claim before selecting/creating a workspace.
  PERFORM pg_advisory_xact_lock(hashtextextended('athena-circle-customer:'||s.stripe_customer_id,0));
  SELECT * INTO p FROM public.mcp_circle_provisioning WHERE source_subscription_id=s.id FOR UPDATE;
  billing := lower(btrim(coalesce(nullif(s.metadata->>'stripe_customer_email',''),s.email)));
  source_state := membership_private.subscription_state(s,now());
  IF p.source_subscription_id IS NULL AND source_state<>'eligible' AND NOT _reserve THEN RETURN NULL; END IF;
  IF p.source_subscription_id IS NOT NULL AND (p.stripe_customer_id<>s.stripe_customer_id
    OR p.stripe_subscription_id<>s.stripe_subscription_id OR p.payment_email<>billing
    OR (p.owner_user_id IS NOT NULL AND s.user_id IS NOT NULL AND p.owner_user_id<>s.user_id)) THEN
    UPDATE public.mcp_circle_provisioning SET state='review',updated_at=now()
      WHERE source_subscription_id=s.id AND state<>'review';
    RETURN p.company_id;
  END IF;
  uid := coalesce(p.owner_user_id,s.user_id);
  IF _claim_user IS NOT NULL THEN
    SELECT lower(email) INTO em FROM auth.users WHERE id=_claim_user AND email_confirmed_at IS NOT NULL;
    -- Never trust a typed payment email or mutable auth metadata. A different account
    -- cannot replace a previously bound owner just because it claims the same name.
    IF em IS NULL OR (uid IS NOT NULL AND uid<>_claim_user)
      OR (uid IS NULL AND em<>billing AND em<>lower(s.email)) THEN RETURN p.company_id; END IF;
    uid := _claim_user;
  END IF;
  IF uid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND email_confirmed_at IS NOT NULL)
    THEN uid := NULL; END IF;
  IF uid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('athena-circle-owner:'||uid::text,0));
  END IF;
  cid := p.company_id;
  IF cid IS NULL THEN
    SELECT old.company_id INTO cid FROM public.mcp_circle_provisioning old
      WHERE old.stripe_customer_id=s.stripe_customer_id AND old.payment_email=billing
        AND (old.owner_user_id IS NULL OR old.owner_user_id=uid)
      ORDER BY old.created_at,old.source_subscription_id LIMIT 1;
  END IF;
  IF cid IS NULL AND uid IS NOT NULL THEN
    SELECT c.id INTO cid FROM public.mcp_companies c JOIN public.mcp_company_members m ON m.company_id=c.id
      WHERE m.user_id=uid AND m.role='owner' AND NOT c.is_test
      ORDER BY (SELECT count(*) FROM public.mcp_jobs j WHERE j.company_id=c.id) DESC,c.created_at,c.id LIMIT 1;
  END IF;
  label := coalesce(nullif(btrim(_display_name),''),nullif(p.display_name,''),
    (SELECT nullif(full_name,'') FROM public.profiles WHERE id=uid),s.email);
  IF cid IS NULL THEN
    INSERT INTO public.mcp_companies(name,created_by)
      VALUES(label||' — Athena',uid) RETURNING id INTO cid;
  END IF;
  IF uid IS NOT NULL THEN
    INSERT INTO public.mcp_company_members(company_id,user_id,display_name,role)
      VALUES(cid,uid,label,'owner') ON CONFLICT(company_id,user_id) DO NOTHING;
    UPDATE public.mcp_companies SET created_by=uid WHERE id=cid AND created_by IS NULL;
    INSERT INTO public.mcp_user_settings(user_id,current_company) VALUES(uid,cid)
      ON CONFLICT(user_id) DO UPDATE SET current_company=EXCLUDED.current_company
      WHERE mcp_user_settings.current_company IS NULL;
  END IF;
  next_state := CASE WHEN source_state='eligible' OR (p.override_until>now() AND s.status='active')
    THEN CASE WHEN uid IS NULL THEN 'unclaimed' ELSE 'ready' END
    WHEN source_state='review' THEN 'review' ELSE 'inactive' END;
  INSERT INTO public.mcp_circle_provisioning(source_subscription_id,stripe_subscription_id,stripe_customer_id,
    payment_email,company_id,owner_user_id,display_name,state)
    VALUES(s.id,s.stripe_subscription_id,s.stripe_customer_id,billing,cid,uid,label,next_state)
    ON CONFLICT(source_subscription_id) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,
      display_name=EXCLUDED.display_name,state=EXCLUDED.state,updated_at=now()
    WHERE (mcp_circle_provisioning.owner_user_id,mcp_circle_provisioning.display_name,mcp_circle_provisioning.state)
      IS DISTINCT FROM (EXCLUDED.owner_user_id,EXCLUDED.display_name,EXCLUDED.state);
  -- Keep independently purchased plans/extra seats. Circle priority comes from the binding above.
  INSERT INTO public.mcp_company_entitlements(company_id,plan,included_seats,status)
    VALUES(cid,s.tier::text,5,CASE WHEN next_state='ready' THEN 'active' ELSE 'inactive' END)
    ON CONFLICT(company_id) DO UPDATE SET plan=EXCLUDED.plan,included_seats=5,status=EXCLUDED.status,updated_at=now()
      WHERE (mcp_company_entitlements.plan IS NULL OR mcp_company_entitlements.plan IN ('circle','hardcore'))
      AND (mcp_company_entitlements.plan,mcp_company_entitlements.included_seats,mcp_company_entitlements.status)
        IS DISTINCT FROM (EXCLUDED.plan,5,EXCLUDED.status);
  RETURN cid;
END $$;

CREATE FUNCTION mcp_private.circle_sync_user(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_catalog AS $$
DECLARE em text; r record;
BEGIN
  SELECT lower(email) INTO em FROM auth.users WHERE id=_user AND email_confirmed_at IS NOT NULL;
  IF em IS NULL THEN RETURN; END IF;
  FOR r IN SELECT s.id FROM public.subscriptions s
    WHERE s.tier IN ('circle','hardcore') AND (s.user_id=_user
      OR (s.user_id IS NULL AND (lower(s.email)=em OR lower(s.metadata->>'stripe_customer_email')=em))
      OR EXISTS(SELECT 1 FROM public.mcp_circle_provisioning p WHERE p.source_subscription_id=s.id AND p.owner_user_id=_user))
    ORDER BY s.stripe_customer_id,s.id
  LOOP
    PERFORM mcp_private.ensure_circle_company(r.id,_user);
  END LOOP;
END $$;

-- Provision after the verified snapshot/evidence commit, irrespective of event ordering.
-- Failure rolls the webhook back for its existing retry mechanism; it never sends mail.
CREATE FUNCTION mcp_private.circle_subscription_provision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_catalog AS $$
BEGIN
  PERFORM mcp_private.ensure_circle_company(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER mcp_circle_subscription_provision AFTER INSERT OR UPDATE OF user_id,email,status,tier,metadata,stripe_customer_id,stripe_subscription_id
  ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION mcp_private.circle_subscription_provision();
CREATE FUNCTION mcp_private.circle_evidence_provision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_catalog AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.subscriptions WHERE stripe_subscription_id=NEW.stripe_subscription_id LOOP
    PERFORM mcp_private.ensure_circle_company(r.id);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER mcp_circle_evidence_provision AFTER INSERT OR UPDATE ON public.circle_subscription_evidence
  FOR EACH ROW EXECUTE FUNCTION mcp_private.circle_evidence_provision();

CREATE OR REPLACE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN mcp_private.circle_company_live(_company) THEN 'circle' ELSE coalesce(
    (SELECT e.plan FROM public.mcp_company_entitlements e WHERE e.company_id=_company
      AND e.status IN ('active','trialing') AND e.plan IN ('athena_pm','athena_office')),
    (SELECT public.get_user_tier(c.created_by)::text FROM public.mcp_companies c WHERE c.id=_company)) END
$$;
CREATE OR REPLACE FUNCTION public.mcp_company_plan_live(_company uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT mcp_private.circle_company_live(_company)
    OR EXISTS(SELECT 1 FROM public.mcp_company_entitlements e WHERE e.company_id=_company
      AND e.status IN ('active','trialing') AND e.plan IN ('athena_pm','athena_office'))
    OR coalesce((SELECT mcp_private.is_circle_active(c.created_by) FROM public.mcp_companies c WHERE c.id=_company),false)
$$;
CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  PERFORM mcp_private.circle_sync_user(auth.uid());
  BEGIN PERFORM public.mcp_team_accept_invites(); EXCEPTION WHEN OTHERS THEN NULL; END;
  IF mcp_private.is_circle_active(auth.uid()) THEN RETURN true; END IF;
  RETURN EXISTS(SELECT 1 FROM public.mcp_company_members m WHERE m.user_id=auth.uid()
    AND public.mcp_role_allowed(m.company_id,m.role) AND public.mcp_company_plan_live(m.company_id));
END $$;

REVOKE ALL ON FUNCTION mcp_private.circle_provisioning_audit(),mcp_private.circle_company_live(uuid),
  mcp_private.ensure_circle_company(uuid,uuid,boolean,text),mcp_private.circle_sync_user(uuid),
  mcp_private.circle_subscription_provision(),mcp_private.circle_evidence_provision() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mcp_private.ensure_circle_company(uuid,uuid,boolean,text) TO service_role;
