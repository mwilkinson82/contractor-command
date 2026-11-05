-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105130000_athena_portal_pay_app_client_number.sql.
--
-- Job notices: one record of everything that comes back to Athena from outside the company.
-- Before: a customer decision emailed the job's PM and nothing else. Nothing showed on the project board, the
-- account page or the morning brief, and there was nowhere for submittal returns, sub or supplier confirmations, or
-- customer messages to land.
-- After:
--   * mcp_job_notices holds each event on a job, by topic:
--       client_decision: a customer approved, declined or chose on the customer page.
--       client_message:  a customer wrote to the team.
--       submittal_reply: a reviewer returned a submittal.
--       field_confirm:   a sub or supplier confirmed or questioned look-ahead dates.
--       sub_contract:    a sub signed or declined their subcontract.
--   * Who gets the email, per job and per role, with these defaults:
--       the job's PM: every topic;
--       company owners: client messages;
--       supers on the job: submittal replies, field confirmations and subcontracts.
--     The job's PM, an owner or an all-access member can change any role's choice for a job.
--   * Members read the notices on the project board (unread marks per person), across their jobs on the account
--     page and in the morning brief. Supers see only the field topics, never money.
--   * Server code records a notice with mcp_job_notice_record (service role only), which returns who to email.
--     Each email's outcome is kept, so a resend never double-sends.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mcp_job_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (topic IN ('client_decision', 'client_message', 'submittal_reply', 'field_confirm', 'sub_contract')),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{1,39}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  detail text CHECK (detail IS NULL OR length(detail) <= 2000),
  actor text CHECK (actor IS NULL OR length(actor) <= 120),
  ref_table text CHECK (ref_table IS NULL OR ref_table ~ '^mcp_[a-z_]{1,60}$'),
  ref_id uuid,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(facts) = 'object' AND length(facts::text) <= 4000),
  -- A page of the project board, like "cos" or "submittals"; never a full address.
  board_page text CHECK (board_page IS NULL OR board_page ~ '^[a-z][a-z0-9-]{0,39}$'),
  dedupe_key text UNIQUE CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_job_notices_job ON public.mcp_job_notices (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_job_notices_company ON public.mcp_job_notices (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mcp_job_notice_reads (
  notice_id uuid NOT NULL REFERENCES public.mcp_job_notices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.mcp_job_notice_prefs (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('job_pm', 'owner', 'all_access', 'pm', 'super', 'ap', 'estimating', 'contracts')),
  topic text NOT NULL CHECK (topic IN ('client_decision', 'client_message', 'submittal_reply', 'field_confirm', 'sub_contract')),
  email boolean NOT NULL,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, role, topic)
);

CREATE TABLE IF NOT EXISTS public.mcp_job_notice_emails (
  notice_id uuid NOT NULL REFERENCES public.mcp_job_notices(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(email) <= 320),
  user_id uuid,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'off')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, email)
);

ALTER TABLE public.mcp_job_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_notice_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_notice_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_notice_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_job_notices, public.mcp_job_notice_reads, public.mcp_job_notice_prefs, public.mcp_job_notice_emails
  FROM PUBLIC, anon, authenticated;

-- Topics a super may see: the field tracks, never money or the customer conversation.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_field_topic(_topic text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT _topic IN ('submittal_reply', 'field_confirm', 'sub_contract')
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_field_topic(text) FROM PUBLIC, anon, authenticated, service_role;

-- Who gets an email when nobody chose otherwise.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_default(_role text, _topic text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE _role
    WHEN 'job_pm' THEN true
    WHEN 'owner' THEN _topic = 'client_message'
    WHEN 'super' THEN mcp_private.job_notice_field_topic(_topic)
    ELSE false END
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_default(text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.job_notice_wants(_job uuid, _role text, _topic text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT p.email FROM public.mcp_job_notice_prefs p WHERE p.job_id = _job AND p.role = _role AND p.topic = _topic),
    mcp_private.job_notice_default(_role, _topic))
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_wants(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Everyone who should get this topic's email on this job, one row per address. The job's PM comes first; a member
-- who is both the job's PM and an owner is emailed once.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_recipients(_job uuid, _topic text)
RETURNS TABLE (email text, user_id uuid, role text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH j AS (SELECT * FROM public.mcp_jobs WHERE id = _job),
  people AS (
    SELECT coalesce(nullif(btrim(u.email), ''), nullif(btrim(j.pm_email), '')) AS email, j.pm_user_id AS user_id, 'job_pm'::text AS role, 0 AS rank
      FROM j LEFT JOIN auth.users u ON u.id = j.pm_user_id
     WHERE mcp_private.job_notice_wants(_job, 'job_pm', _topic)
    UNION ALL
    SELECT u.email, m.user_id, m.role, 1
      FROM j JOIN public.mcp_company_members m ON m.company_id = j.company_id
      JOIN auth.users u ON u.id = m.user_id
     WHERE m.role IN ('owner', 'all_access', 'pm', 'ap', 'estimating', 'contracts', 'super')
       AND public.mcp_role_allowed(m.company_id, m.role)
       AND mcp_private.job_notice_wants(_job, m.role, _topic)
       -- Supers and PMs only hear about jobs they are on; a super never gets a money or customer topic.
       AND (m.role NOT IN ('super', 'pm') OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = m.user_id) OR j.pm_user_id = m.user_id)
       AND (m.role <> 'super' OR mcp_private.job_notice_field_topic(_topic))
       AND (j.restricted IS NOT TRUE OR m.role IN ('owner', 'all_access', 'ap')
            OR EXISTS (SELECT 1 FROM public.mcp_job_access a WHERE a.job_id = j.id AND a.user_id = m.user_id))
  )
  SELECT DISTINCT ON (lower(p.email)) lower(btrim(p.email)), p.user_id, p.role
    FROM people p
   WHERE p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   ORDER BY lower(p.email), p.rank
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_recipients(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Records a notice and queues its emails. Called by other Athena functions and, through mcp_job_notice_record, by
-- server code. A repeated dedupe_key returns the first notice and queues nothing new.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_add(_job uuid, _topic text, _kind text, _title text, _detail text,
  _actor text, _ref_table text, _ref_id uuid, _facts jsonb, _board_page text, _dedupe_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; n public.mcp_job_notices; fresh boolean := true;
BEGIN
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That job is not on file.'; END IF;
  IF _dedupe_key IS NOT NULL THEN
    SELECT * INTO n FROM public.mcp_job_notices WHERE dedupe_key = _dedupe_key;
    IF n.id IS NOT NULL THEN
      IF n.job_id <> _job THEN RAISE EXCEPTION 'MCP_BAD:That notice belongs to another job.'; END IF;
      fresh := false;
    END IF;
  END IF;
  IF fresh THEN
    INSERT INTO public.mcp_job_notices (company_id, job_id, topic, kind, title, detail, actor, ref_table, ref_id, facts, board_page, dedupe_key)
    VALUES (j.company_id, _job, _topic, _kind, btrim(_title), nullif(btrim(coalesce(_detail, '')), ''), nullif(btrim(coalesce(_actor, '')), ''),
      _ref_table, _ref_id, coalesce(_facts, '{}'::jsonb), _board_page, _dedupe_key)
    RETURNING * INTO n;
    INSERT INTO public.mcp_job_notice_emails (notice_id, email, user_id, role)
    SELECT n.id, r.email, r.user_id, r.role FROM mcp_private.job_notice_recipients(_job, _topic) r
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('notice_id', n.id, 'created', fresh, 'topic', n.topic, 'kind', n.kind, 'title', n.title,
    'detail', n.detail, 'actor', n.actor, 'facts', n.facts, 'board_page', n.board_page, 'created_at', n.created_at,
    'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id),
    'recipients', coalesce((SELECT jsonb_agg(jsonb_build_object('email', e.email, 'role', e.role) ORDER BY e.email)
      FROM public.mcp_job_notice_emails e WHERE e.notice_id = n.id AND e.status = 'queued' AND fresh), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_add(uuid, text, text, text, text, text, text, uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Server code only (the customer page, the reviewer and confirm pages, inbound mail).
CREATE OR REPLACE FUNCTION public.mcp_job_notice_record(_job uuid, _topic text, _kind text, _title text, _detail text,
  _actor text, _ref_table text, _ref_id uuid, _facts jsonb, _board_page text, _dedupe_key text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT mcp_private.job_notice_add(_job, _topic, _kind, _title, _detail, _actor, _ref_table, _ref_id, _facts, _board_page, _dedupe_key)
$$;
REVOKE ALL ON FUNCTION public.mcp_job_notice_record(uuid, text, text, text, text, text, text, uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_job_notice_record(uuid, text, text, text, text, text, text, uuid, jsonb, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_job_notice_email_result(_notice uuid, _email text, _status text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.mcp_job_notice_emails SET status = _status, updated_at = now()
   WHERE notice_id = _notice AND email = lower(btrim(_email)) AND _status IN ('sent', 'failed', 'off')
$$;
REVOKE ALL ON FUNCTION public.mcp_job_notice_email_result(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_job_notice_email_result(uuid, text, text) TO service_role;

-- One notice as a member sees it.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_json(n public.mcp_job_notices, _user uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', n.id, 'job_id', n.job_id, 'topic', n.topic, 'kind', n.kind, 'title', n.title, 'detail', n.detail,
    'actor', n.actor, 'facts', n.facts, 'board_page', n.board_page, 'ref_table', n.ref_table, 'ref_id', n.ref_id, 'created_at', n.created_at,
    'read', EXISTS (SELECT 1 FROM public.mcp_job_notice_reads r WHERE r.notice_id = n.id AND r.user_id = _user))
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_json(public.mcp_job_notices, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A job's notices for the project board, newest first. Supers see the field topics only.
CREATE OR REPLACE FUNCTION public.mcp_job_notices_list(_job uuid, _limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE scope text := public.mcp_job_scope(_job); lim integer := least(greatest(coalesce(_limit, 30), 1), 100);
BEGIN
  IF scope IS NULL THEN RAISE EXCEPTION 'MCP_BAD:You don''t have access to this job.'; END IF;
  RETURN jsonb_build_object(
    'notices', coalesce((SELECT jsonb_agg(mcp_private.job_notice_json(n, auth.uid()) ORDER BY n.created_at DESC)
      FROM (SELECT * FROM public.mcp_job_notices x WHERE x.job_id = _job AND (scope <> 'super' OR mcp_private.job_notice_field_topic(x.topic))
             ORDER BY x.created_at DESC LIMIT lim) n), '[]'::jsonb),
    'unread', (SELECT count(*) FROM public.mcp_job_notices x WHERE x.job_id = _job
       AND (scope <> 'super' OR mcp_private.job_notice_field_topic(x.topic))
       AND NOT EXISTS (SELECT 1 FROM public.mcp_job_notice_reads r WHERE r.notice_id = x.id AND r.user_id = auth.uid())));
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_notices_list(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_notices_list(uuid, integer) TO authenticated;

-- Marks notices read for the caller: the ones named, or every one on the job when none is named.
CREATE OR REPLACE FUNCTION public.mcp_job_notices_mark_read(_job uuid, _ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE scope text := public.mcp_job_scope(_job); k integer;
BEGIN
  IF scope IS NULL THEN RAISE EXCEPTION 'MCP_BAD:You don''t have access to this job.'; END IF;
  INSERT INTO public.mcp_job_notice_reads (notice_id, user_id)
  SELECT x.id, auth.uid() FROM public.mcp_job_notices x
   WHERE x.job_id = _job AND (_ids IS NULL OR x.id = ANY(_ids)) AND (scope <> 'super' OR mcp_private.job_notice_field_topic(x.topic))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT;
  RETURN k;
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_notices_mark_read(uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_notices_mark_read(uuid, uuid[]) TO authenticated;

-- The caller's notices across every job they can see: the account page and the morning brief.
CREATE OR REPLACE FUNCTION public.mcp_my_notices(_since timestamptz DEFAULT NULL, _unread_only boolean DEFAULT false, _limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH mine AS (
    SELECT x.*, public.mcp_job_scope(x.job_id) AS scope FROM public.mcp_job_notices x
     WHERE x.company_id IN (SELECT m.company_id FROM public.mcp_company_members m WHERE m.user_id = auth.uid())
       AND (_since IS NULL OR x.created_at >= _since)
  ), seen AS (
    SELECT m.*, j.job_number, j.name AS job_name FROM mine m JOIN public.mcp_jobs j ON j.id = m.job_id
     WHERE m.scope IS NOT NULL AND (m.scope <> 'super' OR mcp_private.job_notice_field_topic(m.topic))
       AND (NOT coalesce(_unread_only, false) OR NOT EXISTS (SELECT 1 FROM public.mcp_job_notice_reads r WHERE r.notice_id = m.id AND r.user_id = auth.uid()))
     ORDER BY m.created_at DESC LIMIT least(greatest(coalesce(_limit, 30), 1), 100)
  )
  SELECT jsonb_build_object('notices', coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'job_id', s.job_id, 'job_number', s.job_number,
      'job_name', s.job_name, 'topic', s.topic, 'kind', s.kind, 'title', s.title, 'detail', s.detail, 'actor', s.actor, 'facts', s.facts,
      'board_page', s.board_page, 'created_at', s.created_at,
      'read', EXISTS (SELECT 1 FROM public.mcp_job_notice_reads r WHERE r.notice_id = s.id AND r.user_id = auth.uid()))
    ORDER BY s.created_at DESC), '[]'::jsonb))
  FROM seen s
$$;
REVOKE ALL ON FUNCTION public.mcp_my_notices(timestamptz, boolean, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_my_notices(timestamptz, boolean, integer) TO authenticated;

-- True when the caller may choose who gets a job's emails: the job's PM, an owner or an all-access member.
CREATE OR REPLACE FUNCTION mcp_private.job_notice_manager(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.mcp_job_scope(_job) = 'full' AND EXISTS (
    SELECT 1 FROM public.mcp_jobs j JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = auth.uid()
     WHERE j.id = _job AND (m.role IN ('owner', 'all_access') OR j.pm_user_id = auth.uid()))
$$;
REVOKE ALL ON FUNCTION mcp_private.job_notice_manager(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Every role's email choice for every topic on a job, with the defaults filled in.
CREATE OR REPLACE FUNCTION public.mcp_job_notice_prefs_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:You don''t have full access to this job.'; END IF;
  RETURN jsonb_build_object('can_change', mcp_private.job_notice_manager(_job), 'prefs',
    (SELECT jsonb_agg(jsonb_build_object('role', r, 'topic', t, 'email', mcp_private.job_notice_wants(_job, r, t),
        'default', mcp_private.job_notice_default(r, t)) ORDER BY ri, ti)
       FROM unnest(ARRAY['job_pm', 'owner', 'all_access', 'pm', 'super', 'ap', 'estimating', 'contracts']) WITH ORDINALITY AS rr(r, ri),
            unnest(ARRAY['client_decision', 'client_message', 'submittal_reply', 'field_confirm', 'sub_contract']) WITH ORDINALITY AS tt(t, ti)
      WHERE r <> 'super' OR mcp_private.job_notice_field_topic(t)));
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_notice_prefs_get(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_notice_prefs_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_job_notice_prefs_set(_job uuid, _role text, _topic text, _email boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT mcp_private.job_notice_manager(_job) THEN
    RAISE EXCEPTION 'MCP_BAD:Only the job''s PM, an owner or an all-access member can choose who gets this job''s emails.';
  END IF;
  IF _role NOT IN ('job_pm', 'owner', 'all_access', 'pm', 'super', 'ap', 'estimating', 'contracts')
     OR _topic NOT IN ('client_decision', 'client_message', 'submittal_reply', 'field_confirm', 'sub_contract') OR _email IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Pick a role, a kind of notice and on or off.';
  END IF;
  IF _role = 'super' AND _email AND NOT mcp_private.job_notice_field_topic(_topic) THEN
    RAISE EXCEPTION 'MCP_BAD:Supers get field notices only: submittal replies, sub and supplier confirmations and subcontracts.';
  END IF;
  INSERT INTO public.mcp_job_notice_prefs (job_id, role, topic, email, updated_by) VALUES (_job, _role, _topic, _email, auth.uid())
  ON CONFLICT (job_id, role, topic) DO UPDATE SET email = EXCLUDED.email, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN public.mcp_job_notice_prefs_get(_job);
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_notice_prefs_set(uuid, text, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_notice_prefs_set(uuid, text, text, boolean) TO authenticated;
