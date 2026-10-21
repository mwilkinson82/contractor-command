-- Athena 0.8.15: owner team invites, roles, job access, seat limits, tier gating, current company, team audit.
-- ADDITIVE. NOT APPLIED. Apply only after Marshall's yes.
-- Decisions (Marshall via Khan): Finance -> AP ('finance' accepted as input alias); Hardcore gets every role;
-- downgrade keeps users and locks roles the plan no longer includes (locked = read-nothing, nothing deleted);
-- Contractor Circle = owner + 5 seats (6 total); pending invites count toward the cap; extra seats are paid (placeholder).

-- 1. Finance -> AP -----------------------------------------------------------------------------------------------
ALTER TABLE public.mcp_company_members DROP CONSTRAINT IF EXISTS mcp_company_members_role_check;
UPDATE public.mcp_company_members SET role = 'ap' WHERE role = 'finance';
ALTER TABLE public.mcp_company_members ADD CONSTRAINT mcp_company_members_role_check
  CHECK (role IN ('owner','pm','all_access','ap','estimating','contracts','super'));

CREATE OR REPLACE FUNCTION public.mcp_normalize_role(_role text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(coalesce(_role,'')))
    WHEN 'finance' THEN 'ap' WHEN 'accounts payable' THEN 'ap' WHEN 'all-access' THEN 'all_access'
    WHEN 'all access' THEN 'all_access' WHEN 'superintendent' THEN 'super' ELSE lower(btrim(coalesce(_role,''))) END
$$;
CREATE OR REPLACE FUNCTION public.mcp_member_role_alias() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.role := public.mcp_normalize_role(NEW.role); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS mcp_member_role_alias ON public.mcp_company_members;
CREATE TRIGGER mcp_member_role_alias BEFORE INSERT OR UPDATE OF role ON public.mcp_company_members
  FOR EACH ROW EXECUTE FUNCTION public.mcp_member_role_alias();

-- mcp_job_settings: same body with 'finance' -> 'ap' and the message label Finance -> AP.
DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.mcp_job_settings(uuid,text,text,text,text)'::regprocedure) INTO d;
  d := replace(replace(d, '''finance''', '''ap'''), 'Owner, Finance,', 'Owner, AP,');
  EXECUTE d;
END $$;

-- 2. Plans: seats + roles per tier ----------------------------------------------------------------------------------
-- included_seats = seats on top of the owner. Every plan defaults to 5 (Khan); still configurable per plan (Cash: TBD).
-- Seat cap = 1 owner + included_seats + paid extra seats ($49/seat/mo). roles NULL = MARSHALL TO DECIDE (no gating yet).
CREATE TABLE IF NOT EXISTS public.mcp_team_plans (
  tier text PRIMARY KEY,
  included_seats integer NOT NULL DEFAULT 5 CHECK (included_seats >= 0),
  roles text[],
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_team_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_team_plans_read ON public.mcp_team_plans;
CREATE POLICY mcp_team_plans_read ON public.mcp_team_plans FOR SELECT TO authenticated USING (true);
INSERT INTO public.mcp_team_plans (tier, included_seats, roles, note) VALUES
  ('circle',        5, NULL, 'Circle: member + 5 seats free, no Stripe price. Roles included: MARSHALL TO DECIDE.'),
  ('hardcore',      5, ARRAY['owner','pm','all_access','ap','estimating','contracts','super'], 'Hardcore: every role.'),
  ('athena_pm',     5, NULL, 'PM plan $197/mo. Roles included: MARSHALL TO DECIDE.'),
  ('athena_office', 5, NULL, 'Office plan $397/mo. Roles included: MARSHALL TO DECIDE.')
ON CONFLICT (tier) DO NOTHING;

-- Athena billing entitlements, written only by the Stripe webhook (service role). One row per company.
CREATE TABLE IF NOT EXISTS public.mcp_company_entitlements (
  company_id uuid PRIMARY KEY REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  plan text CHECK (plan IS NULL OR plan IN ('athena_pm','athena_office')),
  extra_seats integer NOT NULL DEFAULT 0 CHECK (extra_seats >= 0),
  included_seats integer CHECK (included_seats IS NULL OR included_seats >= 0), -- from the Stripe product metadata included_seats
  status text NOT NULL DEFAULT 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  last_event_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_company_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_company_entitlements_owner_read ON public.mcp_company_entitlements;
CREATE POLICY mcp_company_entitlements_owner_read ON public.mcp_company_entitlements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_company_members m WHERE m.company_id = mcp_company_entitlements.company_id AND m.user_id = auth.uid() AND m.role = 'owner'));
REVOKE INSERT, UPDATE, DELETE ON public.mcp_company_entitlements FROM anon, authenticated;
GRANT SELECT ON public.mcp_company_entitlements TO authenticated;
GRANT ALL ON public.mcp_company_entitlements TO service_role;

-- Company plan: an active Athena plan wins (Office > PM); else the creator's Hub tier (hardcore, circle, ...).
CREATE OR REPLACE FUNCTION public.mcp_company_tier(_company uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT e.plan FROM public.mcp_company_entitlements e WHERE e.company_id = _company AND e.status IN ('active','trialing') AND e.plan IS NOT NULL),
    (SELECT public.get_user_tier(c.created_by)::text FROM public.mcp_companies c WHERE c.id = _company))
$$;
CREATE OR REPLACE FUNCTION public.mcp_extra_seats(_company uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT extra_seats FROM public.mcp_company_entitlements WHERE company_id = _company AND status IN ('active','trialing')), 0)
$$;
CREATE OR REPLACE FUNCTION public.mcp_role_allowed(_company uuid, _role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _role = 'owner' OR coalesce((SELECT p.roles IS NULL OR _role = ANY(p.roles)
    FROM public.mcp_team_plans p WHERE p.tier = public.mcp_company_tier(_company)), true)
$$;
CREATE OR REPLACE FUNCTION public.mcp_seat_usage(_company uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tier', public.mcp_company_tier(_company),
    'limit', (SELECT 1 + coalesce((SELECT e.included_seats FROM public.mcp_company_entitlements e WHERE e.company_id = _company
                AND e.status IN ('active','trialing') AND e.plan = p.tier), p.included_seats) + public.mcp_extra_seats(_company)
              FROM public.mcp_team_plans p WHERE p.tier = public.mcp_company_tier(_company)),
    'extra_seats', public.mcp_extra_seats(_company),
    'members', (SELECT count(*) FROM public.mcp_company_members WHERE company_id = _company),
    'pending', (SELECT count(*) FROM public.mcp_team_invites WHERE company_id = _company AND status = 'pending'))
$$;

-- 3. Invites, current company, team audit -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mcp_team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','pm','all_access','ap','estimating','contracts','super')),
  job_ids uuid[] NOT NULL DEFAULT '{}',
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_user uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_team_invites_one_pending ON public.mcp_team_invites (company_id, lower(email)) WHERE status = 'pending';
ALTER TABLE public.mcp_team_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mcp_user_settings (
  user_id uuid PRIMARY KEY,
  current_company uuid REFERENCES public.mcp_companies(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_user_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mcp_team_audit (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL,
  actor uuid NOT NULL,
  target_user uuid,
  target_email text,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_team_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mcp_is_company_owner(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role = 'owner')
$$;

-- No direct writes from clients: everything goes through the functions below.
DROP POLICY IF EXISTS mcp_team_invites_owner_read ON public.mcp_team_invites;
CREATE POLICY mcp_team_invites_owner_read ON public.mcp_team_invites FOR SELECT TO authenticated USING (public.mcp_is_company_owner(company_id));
DROP POLICY IF EXISTS mcp_team_audit_owner_read ON public.mcp_team_audit;
CREATE POLICY mcp_team_audit_owner_read ON public.mcp_team_audit FOR SELECT TO authenticated USING (public.mcp_is_company_owner(company_id));
DROP POLICY IF EXISTS mcp_user_settings_own ON public.mcp_user_settings;
CREATE POLICY mcp_user_settings_own ON public.mcp_user_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.mcp_team_invites, public.mcp_team_audit, public.mcp_user_settings, public.mcp_team_plans FROM anon, authenticated;
GRANT SELECT ON public.mcp_team_invites, public.mcp_team_audit, public.mcp_user_settings, public.mcp_team_plans TO authenticated;
GRANT ALL ON public.mcp_team_invites, public.mcp_team_audit, public.mcp_user_settings, public.mcp_team_plans TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_team_snapshot(_company uuid, _user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN m.user_id IS NULL THEN NULL ELSE jsonb_build_object('role', m.role, 'display_name', m.display_name,
    'jobs', coalesce((SELECT jsonb_agg(j.job_number ORDER BY j.job_number) FROM public.mcp_job_access a JOIN public.mcp_jobs j ON j.id = a.job_id
                      WHERE a.user_id = _user AND j.company_id = _company), '[]'::jsonb)) END
  FROM (SELECT 1) one LEFT JOIN public.mcp_company_members m ON m.company_id = _company AND m.user_id = _user
$$;

CREATE OR REPLACE FUNCTION public.mcp_team_log(_company uuid, _target uuid, _email text, _action text, _before jsonb, _after jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.mcp_team_audit (company_id, actor, target_user, target_email, action, before, after)
  VALUES (_company, auth.uid(), _target, lower(_email), _action, _before, _after)
$$;

CREATE OR REPLACE FUNCTION public.mcp_team_assert_owner(_company uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ BEGIN
  IF NOT public.mcp_is_company_owner(_company) THEN
    RAISE EXCEPTION 'MCP_BAD:Only a company owner can manage the team. Ask your owner to make this change.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_team_check_role(_company uuid, _role text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ DECLARE r text := public.mcp_normalize_role(_role); BEGIN
  IF r NOT IN ('owner','pm','all_access','ap','estimating','contracts','super') THEN
    RAISE EXCEPTION 'MCP_BAD:Role must be owner, PM, all-access, AP, estimating, contracts or super.'; END IF;
  IF NOT public.mcp_role_allowed(_company, r) THEN
    RAISE EXCEPTION 'MCP_BAD:Your plan doesn''t include that role. Upgrading adds it.'; END IF;
  RETURN r;
END $$;

-- Job numbers -> ids in this company. Unknown numbers are refused.
CREATE OR REPLACE FUNCTION public.mcp_team_job_ids(_company uuid, _jobs text[]) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ DECLARE ids uuid[]; missing text; BEGIN
  SELECT x INTO missing FROM unnest(coalesce(_jobs,'{}')) x WHERE NOT EXISTS (SELECT 1 FROM public.mcp_jobs j WHERE j.company_id = _company AND j.job_number = btrim(x)) LIMIT 1;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:No job % in this company. Nothing was changed.', missing; END IF;
  SELECT coalesce(array_agg(j.id), '{}') INTO ids FROM public.mcp_jobs j WHERE j.company_id = _company AND j.job_number = ANY(SELECT btrim(x) FROM unnest(coalesce(_jobs,'{}')) x);
  RETURN ids;
END $$;

-- Invite: owner only, seat cap (members + pending), role allowed by plan. Returns {id, seat_limit_reached:false} or raises.
CREATE OR REPLACE FUNCTION public.mcp_team_invite(_company uuid, _email text, _display_name text, _role text, _jobs text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r text; ids uuid[]; u jsonb; lim int; used int; inv uuid; em text := lower(btrim(coalesce(_email,'')));
BEGIN
  PERFORM public.mcp_assert_active();
  PERFORM public.mcp_team_assert_owner(_company);
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'MCP_BAD:That email doesn''t look valid.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_company_members m JOIN auth.users au ON au.id = m.user_id WHERE m.company_id = _company AND lower(au.email) = em) THEN
    RAISE EXCEPTION 'MCP_BAD:That person is already on the team. Change their role instead.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_team_invites WHERE company_id = _company AND lower(email) = em AND status = 'pending') THEN
    RAISE EXCEPTION 'MCP_BAD:That person already has a pending invite.'; END IF;
  r := public.mcp_team_check_role(_company, _role);
  ids := public.mcp_team_job_ids(_company, _jobs);
  PERFORM pg_advisory_xact_lock(hashtext('mcp_team_seats:' || _company::text));
  u := public.mcp_seat_usage(_company);
  lim := (u->>'limit')::int; used := (u->>'members')::int + (u->>'pending')::int;
  IF lim IS NOT NULL AND used >= lim THEN
    RAISE EXCEPTION 'MCP_SEAT_LIMIT:%:%', used, lim;
  END IF;
  INSERT INTO public.mcp_team_invites (company_id, email, display_name, role, job_ids, invited_by)
    VALUES (_company, em, btrim(_display_name), r, ids, auth.uid()) RETURNING id INTO inv;
  PERFORM public.mcp_team_log(_company, NULL, em, 'invite', NULL, jsonb_build_object('role', r, 'display_name', btrim(_display_name), 'jobs', to_jsonb(coalesce(_jobs,'{}'))));
  RETURN jsonb_build_object('id', inv, 'role', r, 'seats_used', used + 1, 'seat_limit', lim);
END $$;

-- Accept on first sign-in: the signed-in user's verified email matches a pending invite.
CREATE OR REPLACE FUNCTION public.mcp_team_accept_invites() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE em text; i record; n int := 0;
BEGIN
  SELECT lower(email) INTO em FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF em IS NULL THEN RETURN 0; END IF;
  FOR i IN SELECT * FROM public.mcp_team_invites WHERE lower(email) = em AND status = 'pending' FOR UPDATE LOOP
    INSERT INTO public.mcp_company_members (company_id, user_id, display_name, role) VALUES (i.company_id, auth.uid(), i.display_name, i.role)
      ON CONFLICT (company_id, user_id) DO NOTHING;
    INSERT INTO public.mcp_job_access (job_id, user_id, granted_by, granted_at) SELECT unnest(i.job_ids), auth.uid(), i.invited_by, now()
      ON CONFLICT DO NOTHING;
    UPDATE public.mcp_team_invites SET status = 'accepted', accepted_at = now(), accepted_user = auth.uid() WHERE id = i.id;
    INSERT INTO public.mcp_team_audit (company_id, actor, target_user, target_email, action, before, after)
      VALUES (i.company_id, auth.uid(), auth.uid(), em, 'invite_accept', NULL, public.mcp_team_snapshot(i.company_id, auth.uid()));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Update role and/or job access (owner only). _jobs NULL = leave job access unchanged.
CREATE OR REPLACE FUNCTION public.mcp_team_update_member(_company uuid, _user uuid, _role text, _jobs text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b jsonb; a jsonb; r text; ids uuid[];
BEGIN
  PERFORM public.mcp_assert_active();
  PERFORM public.mcp_team_assert_owner(_company);
  b := public.mcp_team_snapshot(_company, _user);
  IF b IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That person isn''t on this team.'; END IF;
  IF _role IS NOT NULL THEN
    r := public.mcp_team_check_role(_company, _role);
    IF b->>'role' = 'owner' AND r <> 'owner' AND (SELECT count(*) FROM public.mcp_company_members WHERE company_id = _company AND role = 'owner') <= 1 THEN
      RAISE EXCEPTION 'MCP_BAD:A company needs at least one owner. Make someone else an owner first.'; END IF;
    UPDATE public.mcp_company_members SET role = r WHERE company_id = _company AND user_id = _user;
  END IF;
  IF _jobs IS NOT NULL THEN
    ids := public.mcp_team_job_ids(_company, _jobs);
    DELETE FROM public.mcp_job_access a USING public.mcp_jobs j WHERE a.job_id = j.id AND j.company_id = _company AND a.user_id = _user AND NOT (j.id = ANY(ids));
    INSERT INTO public.mcp_job_access (job_id, user_id, granted_by, granted_at) SELECT unnest(ids), _user, auth.uid(), now() ON CONFLICT DO NOTHING;
  END IF;
  a := public.mcp_team_snapshot(_company, _user);
  PERFORM public.mcp_team_log(_company, _user, NULL, 'update', b, a);
  RETURN jsonb_build_object('before', b, 'after', a);
END $$;

-- Remove a member or revoke a pending invite (owner only). Removes membership and job access rows only; job data stays.
CREATE OR REPLACE FUNCTION public.mcp_team_remove_member(_company uuid, _user uuid, _email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b jsonb; inv uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  PERFORM public.mcp_team_assert_owner(_company);
  IF _user IS NULL THEN
    UPDATE public.mcp_team_invites SET status = 'revoked' WHERE company_id = _company AND lower(email) = lower(btrim(_email)) AND status = 'pending'
      RETURNING id INTO inv;
    IF inv IS NULL THEN RAISE EXCEPTION 'MCP_BAD:No pending invite for that email.'; END IF;
    PERFORM public.mcp_team_log(_company, NULL, _email, 'invite_revoke', jsonb_build_object('status','pending'), jsonb_build_object('status','revoked'));
    RETURN jsonb_build_object('revoked_invite', inv);
  END IF;
  IF _user = auth.uid() THEN RAISE EXCEPTION 'MCP_BAD:You can''t remove yourself. Another owner can.'; END IF;
  b := public.mcp_team_snapshot(_company, _user);
  IF b IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That person isn''t on this team.'; END IF;
  IF b->>'role' = 'owner' AND (SELECT count(*) FROM public.mcp_company_members WHERE company_id = _company AND role = 'owner') <= 1 THEN
    RAISE EXCEPTION 'MCP_BAD:A company needs at least one owner.'; END IF;
  DELETE FROM public.mcp_job_access a USING public.mcp_jobs j WHERE a.job_id = j.id AND j.company_id = _company AND a.user_id = _user;
  DELETE FROM public.mcp_company_members WHERE company_id = _company AND user_id = _user;
  UPDATE public.mcp_user_settings SET current_company = NULL WHERE user_id = _user AND current_company = _company;
  PERFORM public.mcp_team_log(_company, _user, NULL, 'remove', b, NULL);
  RETURN jsonb_build_object('before', b);
END $$;

-- Team list: owners see everyone, roles, jobs, locks, pending invites and seats. Others are refused.
CREATE OR REPLACE FUNCTION public.mcp_team_list(_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.mcp_team_assert_owner(_company);
  RETURN jsonb_build_object(
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', m.display_name, 'role', m.role,
        'email', (SELECT email FROM auth.users WHERE id = m.user_id), 'locked', NOT public.mcp_role_allowed(_company, m.role),
        'jobs', public.mcp_team_snapshot(_company, m.user_id)->'jobs') ORDER BY m.display_name)
      FROM public.mcp_company_members m WHERE m.company_id = _company), '[]'::jsonb),
    'pending', coalesce((SELECT jsonb_agg(jsonb_build_object('email', i.email, 'display_name', i.display_name, 'role', i.role, 'invited_at', i.created_at))
      FROM public.mcp_team_invites i WHERE i.company_id = _company AND i.status = 'pending'), '[]'::jsonb),
    'jobs', coalesce((SELECT jsonb_agg(jsonb_build_object('job_number', j.job_number, 'name', j.name, 'restricted', j.restricted) ORDER BY j.job_number)
      FROM public.mcp_jobs j WHERE j.company_id = _company), '[]'::jsonb),
    'seats', public.mcp_seat_usage(_company),
    'roles_allowed', (SELECT jsonb_agg(r) FROM unnest(ARRAY['owner','pm','all_access','ap','estimating','contracts','super']) r WHERE public.mcp_role_allowed(_company, r)));
END $$;

CREATE OR REPLACE FUNCTION public.mcp_set_current_company(_company uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  INSERT INTO public.mcp_user_settings (user_id, current_company, updated_at) VALUES (auth.uid(), _company, now())
    ON CONFLICT (user_id) DO UPDATE SET current_company = EXCLUDED.current_company, updated_at = now();
END $$;

-- 4. Locked roles read nothing ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mcp_job_scope(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN NOT public.mcp_role_allowed(j.company_id, m.role) THEN NULL
    WHEN m.role = 'super' THEN CASE WHEN EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid())
      THEN 'super' ELSE NULL END
    WHEN m.role IN ('owner','all_access','ap') THEN 'full'
    WHEN m.role = 'pm' THEN CASE WHEN j.pm_user_id = auth.uid() OR j.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN 'full' ELSE NULL END
    WHEN j.restricted AND NOT EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = auth.uid()) THEN NULL
    WHEN m.role IN ('estimating','contracts') THEN 'contract'
    ELSE 'full' END
  FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
  WHERE j.id = _job
$$;
CREATE OR REPLACE FUNCTION public.mcp_is_company_member(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid()
    AND role <> 'super' AND public.mcp_role_allowed(_company, role))
$$;

REVOKE ALL ON FUNCTION public.mcp_team_invite(uuid,text,text,text,text[]), public.mcp_team_update_member(uuid,uuid,text,text[]),
  public.mcp_team_remove_member(uuid,uuid,text), public.mcp_team_list(uuid), public.mcp_set_current_company(uuid),
  public.mcp_team_accept_invites(), public.mcp_team_log(uuid,uuid,text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_team_invite(uuid,text,text,text,text[]), public.mcp_team_update_member(uuid,uuid,text,text[]),
  public.mcp_team_remove_member(uuid,uuid,text), public.mcp_team_list(uuid), public.mcp_set_current_company(uuid),
  public.mcp_team_accept_invites(), public.mcp_seat_usage(uuid), public.mcp_is_company_owner(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_team_log(uuid,uuid,text,text,jsonb,jsonb) FROM authenticated;

-- 5. Seats get Athena through the company plan ------------------------------------------------------------------------
-- An invited person usually has no Circle membership of their own. The gate now: accepts any pending invite for the
-- signed-in verified email (first sign-in), then grants access if the user is Circle-active OR holds a seat in a company
-- whose plan is live (creator Circle/Hardcore-active, or an active/trialing Athena PM/Office plan).
CREATE INDEX IF NOT EXISTS mcp_team_invites_pending_email ON public.mcp_team_invites (lower(email)) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.mcp_company_plan_live(_company uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.mcp_company_entitlements e WHERE e.company_id = _company AND e.status IN ('active','trialing') AND e.plan IS NOT NULL)
      OR coalesce((SELECT mcp_private.is_circle_active(c.created_by) FROM public.mcp_companies c WHERE c.id = _company), false)
$$;

CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  BEGIN PERFORM public.mcp_team_accept_invites(); EXCEPTION WHEN OTHERS THEN NULL; END; -- never block the gate
  IF mcp_private.is_circle_active(auth.uid()) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.mcp_company_members m WHERE m.user_id = auth.uid()
    AND public.mcp_role_allowed(m.company_id, m.role) AND public.mcp_company_plan_live(m.company_id));
END $$;
