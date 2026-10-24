-- Company creation is an explicit onboarding action, not a prerequisite for access.
-- Forward-only correction to #259/#260. Existing companies, owners, verified
-- payment-email claims, renewal/expiry handling, and permissions are preserved.
-- Apply only through the existing Lovable Cloud project after release approval.

CREATE OR REPLACE FUNCTION mcp_private.ensure_circle_company(_source uuid, _claim_user uuid DEFAULT NULL,
  _reserve boolean DEFAULT false, _display_name text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_catalog AS $$
DECLARE s public.subscriptions; p public.mcp_circle_provisioning; cid uuid; uid uuid;
  billing text; label text; em text; source_state text; next_state text; claim_uid uuid; before_member jsonb;
BEGIN
  SELECT * INTO s FROM public.subscriptions WHERE id=_source;
  IF NOT FOUND OR s.tier NOT IN ('circle','hardcore') OR coalesce(s.stripe_subscription_id,'') !~ '^sub_[A-Za-z0-9]+$'
    OR coalesce(s.stripe_customer_id,'') !~ '^cus_[A-Za-z0-9]+$' THEN RETURN NULL; END IF;
  -- Always lock owner before customer: a webhook for a second customer must not
  -- invert the first-request sweep's lock order for the same owner.
  uid := coalesce((SELECT owner_user_id FROM public.mcp_circle_provisioning
    WHERE source_subscription_id=s.id),s.user_id,_claim_user);
  IF uid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('athena-circle-owner:'||uid::text,0));
  END IF;
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
    IF em IS NULL THEN RETURN p.company_id; END IF;
    IF uid IS NOT NULL AND uid<>_claim_user THEN
      IF p.payment_user_id IS NULL THEN
        IF em<>billing OR NOT (source_state='eligible' OR coalesce((p.override_until>now() AND s.status='active' AND EXISTS (
          SELECT 1 FROM public.circle_subscription_evidence e WHERE e.stripe_subscription_id=s.stripe_subscription_id
            AND e.review_reason='renewal_payment_pending')),false)) THEN RETURN p.company_id; END IF;
      ELSIF p.payment_user_id<>_claim_user THEN RETURN p.company_id;
      END IF;
      claim_uid := _claim_user;
    ELSE
      IF uid IS NULL AND em<>billing AND em<>lower(s.email) THEN RETURN p.company_id; END IF;
      uid := _claim_user;
    END IF;
  END IF;
  -- A backend-bound subscription UUID can be provisioned before its next login;
  -- this never confirms its email or authenticates it. Unclaimed-email claims still require verification above.
  IF uid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid
    AND (email_confirmed_at IS NOT NULL OR id=s.user_id))
    THEN uid := NULL; END IF;
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
  -- Access is independent of company setup. A Circle subscription or grant
  -- permits entry; the member supplies their company name during onboarding.
  -- Keep existing bindings/claims, but never invent a company from a payment.
  IF cid IS NULL THEN RETURN NULL; END IF;
  IF uid IS NOT NULL THEN
    INSERT INTO public.mcp_company_members(company_id,user_id,display_name,role)
      VALUES(cid,uid,label,'owner') ON CONFLICT(company_id,user_id) DO NOTHING;
    UPDATE public.mcp_companies SET created_by=uid WHERE id=cid AND created_by IS NULL;
    INSERT INTO public.mcp_user_settings(user_id,current_company) VALUES(uid,cid)
      ON CONFLICT(user_id) DO UPDATE SET current_company=EXCLUDED.current_company
      WHERE mcp_user_settings.current_company IS NULL;
  END IF;
  next_state := CASE WHEN source_state='eligible' OR (p.override_until>now() AND s.status='active' AND EXISTS (
    SELECT 1 FROM public.circle_subscription_evidence e WHERE e.stripe_subscription_id=s.stripe_subscription_id
      AND e.review_reason='renewal_payment_pending'))
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
  IF claim_uid IS NOT NULL THEN
    UPDATE public.mcp_circle_provisioning SET payment_user_id=claim_uid,
      payment_claimed_at=now(),updated_at=now()
      WHERE source_subscription_id=s.id AND payment_user_id IS NULL;
    SELECT to_jsonb(m) INTO before_member FROM public.mcp_company_members m
      WHERE company_id=cid AND user_id=claim_uid;
    IF before_member IS NULL OR before_member->>'role'<>'owner' THEN
      INSERT INTO public.mcp_company_members(company_id,user_id,display_name,role)
        VALUES(cid,claim_uid,label,'owner') ON CONFLICT(company_id,user_id) DO UPDATE SET role='owner';
      INSERT INTO public.mcp_team_audit(company_id,actor,target_user,action,before,after)
        VALUES(cid,claim_uid,claim_uid,'circle_payment_claim',before_member,
          jsonb_build_object('role','owner','source_subscription_id',s.id,'proof','verified payment email'));
    END IF;
    INSERT INTO public.mcp_user_settings(user_id,current_company) VALUES(claim_uid,cid)
      ON CONFLICT(user_id) DO UPDATE SET current_company=EXCLUDED.current_company
      WHERE mcp_user_settings.current_company IS NULL;
  END IF;
  RETURN cid;
END $$;
