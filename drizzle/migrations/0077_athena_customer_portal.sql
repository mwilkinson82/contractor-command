-- Apply through Lovable Cloud only. Plain SQL for Lovable to apply; nothing in this repo applies it.
-- Athena customer page: one private page per job for the contractor's customer (the owner or homeowner).
--
-- How it works:
-- * A member with full job access invites the customer by email. The invite link holds a random token; only its
--   SHA-256 hash is stored. Opening it asks for a 6-digit code emailed to that address, then starts a session
--   (30 days on a remembered device, 12 hours otherwise). Sessions and codes are stored as hashes only.
-- * Customers get no table access and no anon RPC. Every customer read and action runs through the functions
--   below, which are granted to service_role only, so the app server is the only caller. Each one checks the
--   session, and checks that the member who sent the invite still has full access to the job. If that member
--   loses access, the page closes.
-- * The customer sees only what the contractor shares: weekly updates the member posts, the job's customer-safe
--   photos (client_safe), a short daily summary (date, weather, manpower, work done; no issues, delays, safety,
--   deliveries or costs), schedule milestones, and the change orders and Good/Better/Best proposals the member
--   shares. A shared change order or proposal is frozen when shared, with a SHA-256 fingerprint of exactly what the
--   customer sees.
-- * Approving a change order or choosing a package needs a fresh emailed code, the customer's typed name and the
--   approval statement. The decision is stored with who, when, IP, browser and the fingerprint. An approved change
--   order moves to approved (with that evidence), exactly as change_order_record approve would record it; it is not
--   executed and billing is untouched. A chosen package is recorded with mcp_residential_selections_record_choice.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS mcp_private;

CREATE TABLE IF NOT EXISTS public.mcp_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND length(email) <= 320 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  invite_hash text NOT NULL UNIQUE CHECK (invite_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  last_seen_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_portal_access_one_live ON public.mcp_portal_access (job_id, email) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mcp_portal_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id uuid NOT NULL REFERENCES public.mcp_portal_access(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('sign_in', 'decide')),
  item_id uuid,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_portal_codes_access ON public.mcp_portal_codes (access_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mcp_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id uuid NOT NULL REFERENCES public.mcp_portal_access(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  ip text CHECK (length(ip) <= 100),
  user_agent text CHECK (length(user_agent) <= 400)
);

CREATE TABLE IF NOT EXISTS public.mcp_portal_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  week_of date NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 6000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.mcp_portal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('change_order', 'selection')),
  ref_id uuid NOT NULL,
  ref_version bigint NOT NULL CHECK (ref_version >= 1),
  view jsonb NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  due_on date,
  shared_by uuid NOT NULL,
  shared_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  UNIQUE (kind, ref_id, ref_version)
);

CREATE TABLE IF NOT EXISTS public.mcp_portal_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES public.mcp_portal_items(id) ON DELETE CASCADE,
  access_id uuid NOT NULL REFERENCES public.mcp_portal_access(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'declined', 'chosen')),
  choice text CHECK (choice IS NULL OR choice IN ('good', 'better', 'best')),
  typed_name text NOT NULL CHECK (length(btrim(typed_name)) BETWEEN 2 AND 120),
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 1 AND 1000),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  email text NOT NULL,
  code_verified boolean NOT NULL,
  ip text CHECK (length(ip) <= 100),
  user_agent text CHECK (length(user_agent) <= 400),
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_portal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id uuid REFERENCES public.mcp_portal_access(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text CHECK (length(ip) <= 100),
  user_agent text CHECK (length(user_agent) <= 400),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_portal_events_job ON public.mcp_portal_events (job_id, at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_portal_access','mcp_portal_codes','mcp_portal_sessions','mcp_portal_updates','mcp_portal_items','mcp_portal_decisions','mcp_portal_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------- helpers (private) ----------

-- Run the rest of this transaction as the inviting member, so every existing access rule applies to the customer page.
CREATE OR REPLACE FUNCTION mcp_private.portal_act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_act_as(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.portal_fingerprint(_view jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT encode(sha256(convert_to(_view::text, 'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_fingerprint(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 'ok', 'revoked' or 'closed' (the inviting member no longer has full job access). Leaves the caller acting as that member.
CREATE OR REPLACE FUNCTION mcp_private.portal_state(_a public.mcp_portal_access) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sc text;
BEGIN
  IF _a.id IS NULL THEN RETURN 'unknown'; END IF;
  IF _a.revoked_at IS NOT NULL THEN RETURN 'revoked'; END IF;
  PERFORM mcp_private.portal_act_as(_a.created_by);
  BEGIN
    sc := public.mcp_job_scope(_a.job_id);
  EXCEPTION WHEN OTHERS THEN
    sc := NULL;
  END;
  RETURN CASE WHEN sc = 'full' THEN 'ok' ELSE 'closed' END;
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_state(public.mcp_portal_access) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.portal_full_job(_job uuid) RETURNS public.mcp_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:The customer page needs full access to the job.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_full_job(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Live session for this access, or NULL. Also returns NULL for a revoked or closed access.
CREATE OR REPLACE FUNCTION mcp_private.portal_session(_access uuid, _session_hash text) RETURNS public.mcp_portal_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.mcp_portal_sessions;
BEGIN
  IF _session_hash IS NULL OR _session_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.mcp_portal_sessions
   WHERE token_hash = _session_hash AND access_id = _access AND revoked_at IS NULL AND expires_at > now();
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_session(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- member functions (the contractor, from chat) ----------

CREATE OR REPLACE FUNCTION public.mcp_portal_invite(_job uuid, _email text, _name text, _invite_hash text, _expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; co public.mcp_companies; a public.mcp_portal_access; e text := lower(btrim(coalesce(_email, ''))); again boolean := false;
BEGIN
  j := mcp_private.portal_full_job(_job);
  IF e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(e) > 320 THEN RAISE EXCEPTION 'MCP_BAD:Use the customer''s email address.'; END IF;
  IF length(btrim(coalesce(_name, ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Give the customer''s name.'; END IF;
  IF _invite_hash IS NULL OR _invite_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Invalid invite token.'; END IF;
  IF _expires_at IS NULL OR _expires_at <= now() OR _expires_at > now() + interval '30 days 1 hour' THEN
    RAISE EXCEPTION 'MCP_BAD:Invite links last 1 to 30 days.';
  END IF;
  SELECT * INTO co FROM public.mcp_companies WHERE id = j.company_id;
  SELECT * INTO a FROM public.mcp_portal_access WHERE job_id = _job AND email = e AND revoked_at IS NULL FOR UPDATE;
  IF a.id IS NOT NULL THEN
    again := true;
    UPDATE public.mcp_portal_access SET invite_hash = _invite_hash, invite_expires_at = _expires_at, name = btrim(_name)
     WHERE id = a.id RETURNING * INTO a;
  ELSE
    INSERT INTO public.mcp_portal_access (company_id, job_id, email, name, invite_hash, invite_expires_at, created_by)
    VALUES (j.company_id, _job, e, btrim(_name), _invite_hash, _expires_at, auth.uid()) RETURNING * INTO a;
  END IF;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail)
  VALUES (a.id, _job, CASE WHEN again THEN 'reinvited' ELSE 'invited' END, jsonb_build_object('by', auth.uid()));
  RETURN jsonb_build_object('access_id', a.id, 'email', a.email, 'name', a.name, 'reinvited', again,
    'invite_expires_at', a.invite_expires_at, 'company', co.name, 'job_name', j.name, 'job_number', j.job_number,
    'pm_name', j.pm_name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_invite(uuid, text, text, text, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_invite(uuid, text, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_portal_revoke(_job uuid, _access uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access;
BEGIN
  PERFORM mcp_private.portal_full_job(_job);
  UPDATE public.mcp_portal_access SET revoked_at = now(), revoked_by = auth.uid()
   WHERE id = _access AND job_id = _job AND revoked_at IS NULL RETURNING * INTO a;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:No active customer access like that on this job. Nothing was changed.'; END IF;
  UPDATE public.mcp_portal_sessions SET revoked_at = now() WHERE access_id = a.id AND revoked_at IS NULL;
  UPDATE public.mcp_portal_codes SET used_at = now() WHERE access_id = a.id AND used_at IS NULL;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail) VALUES (a.id, _job, 'revoked', jsonb_build_object('by', auth.uid()));
  RETURN jsonb_build_object('revoked', true, 'access_id', a.id, 'email', a.email, 'name', a.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_revoke(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_revoke(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_portal_post_update(_job uuid, _week_of date, _title text, _body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; nid uuid;
BEGIN
  j := mcp_private.portal_full_job(_job);
  IF _week_of IS NULL OR _week_of > current_date + 7 OR _week_of < current_date - 400 THEN RAISE EXCEPTION 'MCP_BAD:Give the week this update covers.'; END IF;
  IF length(btrim(coalesce(_title, ''))) NOT BETWEEN 1 AND 120 OR length(btrim(coalesce(_body, ''))) NOT BETWEEN 1 AND 6000 THEN
    RAISE EXCEPTION 'MCP_BAD:An update needs a short title and up to 6,000 characters of text.';
  END IF;
  INSERT INTO public.mcp_portal_updates (company_id, job_id, week_of, title, body, created_by)
  VALUES (j.company_id, _job, _week_of, btrim(_title), btrim(_body), auth.uid()) RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'week_of', _week_of,
    'recipients', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', id, 'email', email, 'name', name)) FROM public.mcp_portal_access WHERE job_id = _job AND revoked_at IS NULL), '[]'::jsonb),
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id), 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_post_update(uuid, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_post_update(uuid, date, text, text) TO authenticated;

-- Shares the current priced change order. The customer view is frozen here and never carries cost lines or markup.
CREATE OR REPLACE FUNCTION public.mcp_portal_share_change_order(_job uuid, _submittal uuid, _expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; s public.mcp_submittals; c public.mcp_change_orders; d jsonb; v_view jsonb; it public.mcp_portal_items;
BEGIN
  j := mcp_private.portal_full_job(_job);
  SELECT * INTO s FROM public.mcp_submittals WHERE id = _submittal AND job_id = _job AND package_purpose = 'change_order';
  IF s.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That change order is not on this job.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_submittals x WHERE x.job_id = _job AND x.number = s.number AND x.revision > s.revision) THEN
    RAISE EXCEPTION 'MCP_BAD:Share the current revision.';
  END IF;
  SELECT * INTO c FROM public.mcp_change_orders WHERE submittal_id = s.id FOR UPDATE;
  d := c.details;
  IF (d->>'record_version')::int IS DISTINCT FROM _expected_version THEN RAISE EXCEPTION 'MCP_BAD:The change order changed; read it again before sharing.'; END IF;
  IF d->>'state' IS DISTINCT FROM 'priced' OR d->>'total_cents' IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Only a priced change order that is not yet approved or rejected can go to the customer.';
  END IF;
  v_view := jsonb_build_object(
    'number', s.number, 'title', s.title, 'why', d->>'condition', 'scope', d->>'scope',
    'price_cents', (d->>'total_cents')::bigint,
    'schedule_days', CASE WHEN nullif(d->>'schedule_days', '') IS NULL THEN NULL ELSE (d->>'schedule_days')::numeric END,
    'due_on', nullif(d->>'due_date', ''));
  UPDATE public.mcp_portal_items i SET withdrawn_at = now(), withdrawn_by = auth.uid()
   WHERE i.kind = 'change_order' AND i.job_id = _job AND i.ref_id = s.id AND i.withdrawn_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id);
  INSERT INTO public.mcp_portal_items (company_id, job_id, kind, ref_id, ref_version, view, fingerprint, due_on, shared_by)
  VALUES (j.company_id, _job, 'change_order', s.id, _expected_version, v_view, mcp_private.portal_fingerprint(v_view), nullif(d->>'due_date', '')::date, auth.uid())
  ON CONFLICT (kind, ref_id, ref_version) DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL
  RETURNING * INTO it;
  RETURN jsonb_build_object('item_id', it.id, 'kind', 'change_order', 'number', s.number, 'title', s.title, 'view', v_view, 'fingerprint', it.fingerprint,
    'recipients', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', id, 'email', email, 'name', name)) FROM public.mcp_portal_access WHERE job_id = _job AND revoked_at IS NULL), '[]'::jsonb),
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id), 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_share_change_order(uuid, uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_share_change_order(uuid, uuid, integer) TO authenticated;

-- Shares the current Good/Better/Best proposal (the same customer view as the proposal link).
CREATE OR REPLACE FUNCTION public.mcp_portal_share_selection(_job uuid, _expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; version_now bigint; body_now jsonb; v_view jsonb; it public.mcp_portal_items;
BEGIN
  j := mcp_private.portal_full_job(_job);
  PERFORM mcp_private.gbb_full_scope(_job);
  PERFORM pg_advisory_xact_lock(hashtextextended('residential-selections:' || _job::text, 0));
  SELECT version, body INTO version_now, body_now FROM mcp_private.residential_selection_boards WHERE job_id = _job;
  IF version_now IS NULL OR version_now IS DISTINCT FROM _expected_version THEN
    RAISE EXCEPTION 'MCP_BAD:Selections changed. Refresh and preview before sharing.';
  END IF;
  IF jsonb_typeof(body_now->'accepted') = 'object' THEN RAISE EXCEPTION 'MCP_BAD:A package is already chosen on this board.'; END IF;
  v_view := jsonb_build_object('proposal', mcp_private.gbb_customer_proposal(body_now, version_now));
  UPDATE public.mcp_portal_items i SET withdrawn_at = now(), withdrawn_by = auth.uid()
   WHERE i.kind = 'selection' AND i.job_id = _job AND i.withdrawn_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id);
  INSERT INTO public.mcp_portal_items (company_id, job_id, kind, ref_id, ref_version, view, fingerprint, due_on, shared_by)
  VALUES (j.company_id, _job, 'selection', _job, version_now, v_view, mcp_private.portal_fingerprint(v_view),
    nullif(v_view->'proposal'->>'valid_until', '')::date, auth.uid())
  ON CONFLICT (kind, ref_id, ref_version) DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL
  RETURNING * INTO it;
  RETURN jsonb_build_object('item_id', it.id, 'kind', 'selection', 'title', v_view->'proposal'->>'title', 'view', v_view, 'fingerprint', it.fingerprint,
    'recipients', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', id, 'email', email, 'name', name)) FROM public.mcp_portal_access WHERE job_id = _job AND revoked_at IS NULL), '[]'::jsonb),
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id), 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_share_selection(uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_share_selection(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_portal_withdraw(_job uuid, _item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it public.mcp_portal_items;
BEGIN
  PERFORM mcp_private.portal_full_job(_job);
  UPDATE public.mcp_portal_items i SET withdrawn_at = now(), withdrawn_by = auth.uid()
   WHERE i.id = _item AND i.job_id = _job AND i.withdrawn_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id)
  RETURNING * INTO it;
  IF it.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Nothing open like that to take back. A decided item stays on the record.'; END IF;
  RETURN jsonb_build_object('withdrawn', true, 'item_id', it.id, 'kind', it.kind);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_withdraw(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_withdraw(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_portal_list(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs;
BEGIN
  j := mcp_private.portal_full_job(_job);
  RETURN jsonb_build_object(
    'job_number', j.job_number, 'job_name', j.name,
    'customers', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', a.id, 'email', a.email, 'name', a.name,
        'invited_at', a.created_at, 'invite_expires_at', a.invite_expires_at, 'last_seen_at', a.last_seen_at, 'revoked_at', a.revoked_at)
        ORDER BY a.created_at) FROM public.mcp_portal_access a WHERE a.job_id = _job), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'kind', i.kind,
        'label', CASE WHEN i.kind = 'change_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title') ELSE i.view->'proposal'->>'title' END,
        'shared_at', i.shared_at, 'withdrawn_at', i.withdrawn_at, 'fingerprint', i.fingerprint,
        'decision', (SELECT jsonb_build_object('decision', x.decision, 'choice', x.choice, 'typed_name', x.typed_name, 'email', x.email,
            'decided_at', x.decided_at, 'note', x.note, 'reference', 'Customer page decision ' || x.id)
          FROM public.mcp_portal_decisions x WHERE x.item_id = i.id))
        ORDER BY i.shared_at DESC) FROM public.mcp_portal_items i WHERE i.job_id = _job), '[]'::jsonb),
    'updates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'week_of', u.week_of, 'title', u.title, 'posted_at', u.created_at) ORDER BY u.week_of DESC)
        FROM public.mcp_portal_updates u WHERE u.job_id = _job AND u.withdrawn_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_list(uuid) TO authenticated;

-- ---------- customer functions (the app server only) ----------

CREATE OR REPLACE FUNCTION public.mcp_portal_invite_open(_invite_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; j public.mcp_jobs; co public.mcp_companies; st text;
BEGIN
  IF _invite_hash IS NULL OR _invite_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO a FROM public.mcp_portal_access WHERE invite_hash = _invite_hash;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF a.invite_expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = a.company_id;
  RETURN jsonb_build_object('status', 'ok', 'access_id', a.id, 'email', a.email, 'name', a.name,
    'company', co.name, 'job_name', j.name, 'job_number', j.job_number);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_invite_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_invite_open(text) TO service_role;

-- Stores a new code hash and returns where to send it. Five codes per 15 minutes and 20 a day per customer.
-- sign_in: _invite_hash must be the live invite. decide: _session_hash must be live and _item open on the job.
CREATE OR REPLACE FUNCTION public.mcp_portal_code_issue(_access uuid, _purpose text, _code_hash text, _invite_hash text, _session_hash text, _item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; j public.mcp_jobs; co public.mcp_companies; st text; it public.mcp_portal_items;
BEGIN
  IF _code_hash IS NULL OR _code_hash !~ '^[0-9a-f]{64}$' OR _purpose NOT IN ('sign_in', 'decide') THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access FOR UPDATE;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF _purpose = 'sign_in' THEN
    IF _invite_hash IS DISTINCT FROM a.invite_hash THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
    IF a.invite_expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  ELSE
    IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
    SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL;
    IF it.id IS NULL OR EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = it.id) THEN
      RETURN jsonb_build_object('status', 'not_open');
    END IF;
  END IF;
  IF (SELECT count(*) FROM public.mcp_portal_codes WHERE access_id = a.id AND created_at > now() - interval '15 minutes') >= 5
     OR (SELECT count(*) FROM public.mcp_portal_codes WHERE access_id = a.id AND created_at > now() - interval '1 day') >= 20 THEN
    RETURN jsonb_build_object('status', 'slow_down');
  END IF;
  UPDATE public.mcp_portal_codes SET used_at = now() WHERE access_id = a.id AND purpose = _purpose AND used_at IS NULL;
  INSERT INTO public.mcp_portal_codes (access_id, purpose, item_id, code_hash, expires_at)
  VALUES (a.id, _purpose, CASE WHEN _purpose = 'decide' THEN _item END, _code_hash, now() + interval '10 minutes');
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = a.company_id;
  RETURN jsonb_build_object('status', 'ok', 'email', a.email, 'name', a.name, 'company', co.name, 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_code_issue(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_code_issue(uuid, text, text, text, text, uuid) TO service_role;

-- Checks the newest unused code of a purpose. Five wrong tries lock that code. Returns 'ok', 'wrong', 'locked' or 'expired'.
CREATE OR REPLACE FUNCTION mcp_private.portal_code_check(_access uuid, _purpose text, _item uuid, _code_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_portal_codes;
BEGIN
  SELECT * INTO c FROM public.mcp_portal_codes
   WHERE access_id = _access AND purpose = _purpose AND used_at IS NULL AND (_purpose = 'sign_in' OR item_id = _item)
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF c.id IS NULL OR c.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF c.attempts >= 5 THEN RETURN 'locked'; END IF;
  IF _code_hash IS NULL OR c.code_hash <> _code_hash THEN
    UPDATE public.mcp_portal_codes SET attempts = attempts + 1 WHERE id = c.id;
    RETURN CASE WHEN c.attempts + 1 >= 5 THEN 'locked' ELSE 'wrong' END;
  END IF;
  UPDATE public.mcp_portal_codes SET used_at = now() WHERE id = c.id;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_code_check(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_portal_sign_in(_invite_hash text, _code_hash text, _session_hash text, _remember boolean, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; chk text; exp timestamptz;
BEGIN
  IF _invite_hash IS NULL OR _invite_hash !~ '^[0-9a-f]{64}$' OR _session_hash IS NULL OR _session_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'unknown');
  END IF;
  SELECT * INTO a FROM public.mcp_portal_access WHERE invite_hash = _invite_hash FOR UPDATE;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF a.invite_expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  chk := mcp_private.portal_code_check(a.id, 'sign_in', NULL, _code_hash);
  IF chk <> 'ok' THEN
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
    VALUES (a.id, a.job_id, 'sign_in_failed', jsonb_build_object('reason', chk), left(_ip, 100), left(_user_agent, 400));
    RETURN jsonb_build_object('status', chk);
  END IF;
  exp := now() + CASE WHEN coalesce(_remember, false) THEN interval '30 days' ELSE interval '12 hours' END;
  INSERT INTO public.mcp_portal_sessions (access_id, token_hash, expires_at, last_seen_at, ip, user_agent)
  VALUES (a.id, _session_hash, exp, now(), left(_ip, 100), left(_user_agent, 400));
  UPDATE public.mcp_portal_access SET last_seen_at = now() WHERE id = a.id;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
  VALUES (a.id, a.job_id, 'signed_in', jsonb_build_object('remember', coalesce(_remember, false)), left(_ip, 100), left(_user_agent, 400));
  RETURN jsonb_build_object('status', 'ok', 'access_id', a.id, 'expires_at', exp);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_sign_in(text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_sign_in(text, text, text, boolean, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_portal_sign_out(_access uuid, _session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.mcp_portal_sessions;
BEGIN
  s := mcp_private.portal_session(_access, _session_hash);
  IF s.id IS NOT NULL THEN
    UPDATE public.mcp_portal_sessions SET revoked_at = now() WHERE id = s.id;
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind)
    SELECT a.id, a.job_id, 'signed_out' FROM public.mcp_portal_access a WHERE a.id = _access;
  END IF;
  RETURN jsonb_build_object('status', 'ok');
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_sign_out(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_sign_out(uuid, text) TO service_role;

-- The whole customer page in one read. Only whitelisted fields leave this function.
CREATE OR REPLACE FUNCTION public.mcp_portal_view(_access uuid, _session_hash text, _ip text, _user_agent text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; s public.mcp_portal_sessions; st text; j public.mcp_jobs; co public.mcp_companies; cpm jsonb;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  s := mcp_private.portal_session(a.id, _session_hash);
  IF s.id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '10 minutes' THEN
    UPDATE public.mcp_portal_sessions SET last_seen_at = now() WHERE id = s.id;
    UPDATE public.mcp_portal_access SET last_seen_at = now() WHERE id = a.id;
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, ip, user_agent) VALUES (a.id, a.job_id, 'viewed', left(_ip, 100), left(_user_agent, 400));
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = a.company_id;
  SELECT r.data INTO cpm FROM public.mcp_living_reports r WHERE r.job_id = a.job_id AND r.report_type = 'cpm' ORDER BY r.version DESC LIMIT 1;
  RETURN jsonb_build_object(
    'status', 'ok',
    'customer', jsonb_build_object('name', a.name, 'email', a.email),
    'contractor', jsonb_build_object('name', co.name, 'pm_name', j.pm_name, 'pm_title', j.pm_title, 'pm_email', j.pm_email),
    'job', jsonb_build_object('number', j.job_number, 'name', j.name, 'completion_date', j.contract_completion_date,
      'today', (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date),
    'updates', coalesce((SELECT jsonb_agg(x ORDER BY x->>'week_of' DESC) FROM (
        SELECT jsonb_build_object('week_of', u.week_of, 'title', u.title, 'body', u.body) AS x
        FROM public.mcp_portal_updates u WHERE u.job_id = a.job_id AND u.withdrawn_at IS NULL ORDER BY u.week_of DESC, u.created_at DESC LIMIT 12) q), '[]'::jsonb),
    'dailies', coalesce((SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (
        SELECT jsonb_build_object('date', d.report_date, 'weather', d.weather, 'manpower', d.manpower,
          'work', coalesce((SELECT jsonb_agg(w.work ORDER BY w.line_no) FROM public.mcp_daily_work_lines w WHERE w.daily_id = d.id), '[]'::jsonb)) AS x
        FROM public.mcp_daily_reports d WHERE d.job_id = a.job_id ORDER BY d.report_date DESC LIMIT 10) q), '[]'::jsonb),
    'photos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'taken_on' DESC) FROM (
        SELECT jsonb_build_object('id', p.id, 'taken_on', p.taken_on, 'area', p.area, 'work', p.work, 'storage_path', p.storage_path) AS x
        FROM public.mcp_progress_photos p WHERE p.job_id = a.job_id AND p.client_safe AND p.removed_at IS NULL
        ORDER BY p.taken_on DESC, p.created_at DESC LIMIT 60) q), '[]'::jsonb),
    'milestones', coalesce((SELECT jsonb_agg(x ORDER BY x->>'date') FROM (
        SELECT jsonb_build_object('name', m->>'name',
          'date', coalesce(nullif(m->>'actual_finish', ''), nullif(m->>'finish', ''), nullif(m->>'actual_start', ''), nullif(m->>'start', '')),
          'done', (nullif(m->>'actual_finish', '') IS NOT NULL OR coalesce(nullif(m->>'pct_complete', '')::numeric, 0) >= 100)) AS x
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cpm->'activities') = 'array' THEN cpm->'activities' ELSE '[]'::jsonb END) m
        WHERE (m->>'activity_type' IN ('milestone-start', 'milestone-finish') OR (m->>'duration' ~ '^-?[0-9.]+$' AND (m->>'duration')::numeric = 0))
          AND length(btrim(coalesce(m->>'name', ''))) > 0
          AND coalesce(nullif(m->>'actual_finish', ''), nullif(m->>'finish', ''), nullif(m->>'actual_start', ''), nullif(m->>'start', '')) IS NOT NULL
        LIMIT 40) q), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'shared_on', (i.shared_at AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date,
          'due_on', i.due_on, 'fingerprint', i.fingerprint, 'view', i.view,
          'decision', (SELECT jsonb_build_object('decision', x.decision, 'choice', x.choice, 'typed_name', x.typed_name, 'decided_at', x.decided_at,
              'note', x.note, 'code_verified', x.code_verified) FROM public.mcp_portal_decisions x WHERE x.item_id = i.id))
        ORDER BY i.shared_at DESC)
      FROM public.mcp_portal_items i WHERE i.job_id = a.job_id AND i.withdrawn_at IS NULL
        -- An undecided item shows only while it still matches the record; an edit hides it until it is shared again.
        AND (EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id)
          OR (i.kind = 'change_order' AND EXISTS (SELECT 1 FROM public.mcp_change_orders c WHERE c.submittal_id = i.ref_id
                AND (c.details->>'record_version')::bigint = i.ref_version AND c.details->>'state' = 'priced'))
          OR (i.kind = 'selection' AND EXISTS (SELECT 1 FROM mcp_private.residential_selection_boards b WHERE b.job_id = i.job_id
                AND b.version = i.ref_version AND jsonb_typeof(b.body->'accepted') IS DISTINCT FROM 'object')))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_view(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_view(uuid, text, text, text) TO service_role;

-- Records the customer's decision and applies it, all or nothing.
-- approved / chosen need a fresh code; declined needs the typed name only.
CREATE OR REPLACE FUNCTION public.mcp_portal_decide(_access uuid, _session_hash text, _item uuid, _decision text, _choice text,
  _code_hash text, _typed_name text, _statement text, _fingerprint text, _note text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; chk text := 'not_needed'; did uuid; j public.mcp_jobs;
  s public.mcp_submittals; c public.mcp_change_orders; d jsonb; ev jsonb; co_count int; evidence text; stamp timestamptz := now();
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL FOR UPDATE;
  IF it.id IS NULL OR EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = it.id) THEN RETURN jsonb_build_object('status', 'not_open'); END IF;
  IF _fingerprint IS DISTINCT FROM it.fingerprint THEN RETURN jsonb_build_object('status', 'changed'); END IF;
  IF NOT ((it.kind = 'change_order' AND _decision IN ('approved', 'declined') AND _choice IS NULL)
       OR (it.kind = 'selection' AND _decision = 'chosen' AND _choice IN ('good', 'better', 'best'))) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF length(btrim(coalesce(_typed_name, ''))) NOT BETWEEN 2 AND 120 OR length(btrim(coalesce(_statement, ''))) NOT BETWEEN 1 AND 1000
     OR length(coalesce(_note, '')) > 2000 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF _decision IN ('approved', 'chosen') THEN
    chk := mcp_private.portal_code_check(a.id, 'decide', it.id, _code_hash);
    IF chk <> 'ok' THEN RETURN jsonb_build_object('status', chk); END IF;
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  BEGIN
    INSERT INTO public.mcp_portal_decisions (item_id, access_id, decision, choice, typed_name, statement, fingerprint, note, email, code_verified, ip, user_agent, decided_at)
    VALUES (it.id, a.id, _decision, _choice, btrim(_typed_name), btrim(_statement), it.fingerprint, nullif(btrim(coalesce(_note, '')), ''), a.email,
      chk = 'ok', left(_ip, 100), left(_user_agent, 400), stamp)
    RETURNING id INTO did;
    IF it.kind = 'change_order' THEN
      SELECT * INTO s FROM public.mcp_submittals WHERE id = it.ref_id AND job_id = a.job_id FOR UPDATE;
      SELECT * INTO c FROM public.mcp_change_orders WHERE submittal_id = it.ref_id FOR UPDATE;
      d := c.details;
      IF s.id IS NULL OR c.submittal_id IS NULL OR (d->>'record_version')::bigint IS DISTINCT FROM it.ref_version OR d->>'state' IS DISTINCT FROM 'priced'
         OR EXISTS (SELECT 1 FROM public.mcp_submittals x WHERE x.job_id = a.job_id AND x.number = s.number AND x.revision > s.revision) THEN
        RAISE EXCEPTION 'MCP_PORTAL_CHANGED';
      END IF;
      ev := jsonb_build_object('by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
        'reference', 'Customer page decision ' || did, 'channel', 'customer_page', 'fingerprint', it.fingerprint,
        'email_code_verified', chk = 'ok');
      d := d || jsonb_build_object('state', CASE WHEN _decision = 'approved' THEN 'approved' ELSE 'rejected' END, 'decision', ev);
      IF _decision = 'approved' THEN
        SELECT coalesce(max(substring(details->>'co_number' FROM '[0-9]+$')::int), 0) + 1 INTO co_count
          FROM public.mcp_change_orders WHERE job_id = a.job_id AND details->>'co_number' ~ '^CO-[0-9]{1,8}$';
        d := d || jsonb_build_object('co_number', 'CO-' || lpad(co_count::text, greatest(3, length(co_count::text)), '0'));
      END IF;
      d := jsonb_set(d, '{record_version}', to_jsonb((d->>'record_version')::int + 1));
      UPDATE public.mcp_change_orders SET details = d, updated_at = now() WHERE submittal_id = s.id;
      UPDATE public.mcp_submittals SET status = 'in_review', returned_on = (stamp AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'UTC'))::date,
        ball_in_court = 'gc', updated_at = now() WHERE id = s.id;
      INSERT INTO public.mcp_change_history (submittal_id, job_id, record_version, action, snapshot, actor_id)
      VALUES (s.id, a.job_id, (d->>'record_version')::int, CASE WHEN _decision = 'approved' THEN 'approve' ELSE 'reject' END, d, a.created_by);
      PERFORM public.mcp_project_record_add(a.job_id, 'change_order_' || CASE WHEN _decision = 'approved' THEN 'approve' ELSE 'reject' END,
        s.number || ' · ' || s.title, 'Customer decision recorded on the customer page; commercial details require full job access.',
        NULL, NULL, 'mcp_submittals', s.id, jsonb_build_object('submittal_id', s.id, 'state', d->>'state', 'portal_decision', did), 'user');
    ELSE
      evidence := left('Chosen on the customer page by ' || btrim(_typed_name) || ' <' || a.email || '> with an emailed code. Decision '
        || did || ', fingerprint ' || it.fingerprint || '.', 500);
      PERFORM public.mcp_residential_selections_record_choice(a.job_id, it.ref_version, _choice, current_date, evidence);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
    VALUES (a.id, a.job_id, 'decision_refused', jsonb_build_object('item', it.id, 'reason', left(SQLERRM, 200)), left(_ip, 100), left(_user_agent, 400));
    RETURN jsonb_build_object('status', 'changed');
  END;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
  VALUES (a.id, a.job_id, 'decided', jsonb_build_object('item', it.id, 'decision', _decision, 'choice', _choice, 'decision_id', did), left(_ip, 100), left(_user_agent, 400));
  RETURN jsonb_build_object('status', 'ok', 'decision_id', did, 'decided_at', stamp, 'customer', a.name, 'customer_email', a.email,
    'job_name', j.name, 'job_number', j.job_number, 'pm_email', j.pm_email, 'pm_name', j.pm_name,
    'label', CASE WHEN it.kind = 'change_order' THEN (it.view->>'number') || ' · ' || (it.view->>'title') ELSE it.view->'proposal'->>'title' END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) TO service_role;
