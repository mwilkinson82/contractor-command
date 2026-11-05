-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105151500_athena_job_notices.sql (and the customer page migrations before it).
--
-- Client messages on the customer page.
-- Before: a customer could only approve, decline or choose. A question meant an email outside Athena, and nothing
-- reached the project board.
-- After:
--   * mcp_portal_messages holds one conversation per customer access on a job. The customer writes from their page,
--     about anything on the job or about one shared item. A full-access team member replies from the board or from
--     chat, and Athena emails the reply to the customer.
--   * A message about an item only points at it. The item, its frozen view and its fingerprint never change.
--   * The page server records a client_message notice for every customer message (src/lib/notices/send.ts), so the
--     job's PM and owners get it on the board, the account page and by email. Per person unread marks are the
--     notice reads; team_read_at marks a customer message answered once anyone on the team replies.
--   * The customer can post at most 20 messages an hour on one access.
--   * Supers and members without full job access can't read or reply: the conversation can be about money.
--   * mcp_portal_decision_job gives the page server the job of a decision it just recorded, so it can record the
--     client_decision notice without changing mcp_portal_decide.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mcp_portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  access_id uuid NOT NULL REFERENCES public.mcp_portal_access(id) ON DELETE CASCADE,
  -- The shared item the message is about, if any. Never changes the item.
  item_id uuid REFERENCES public.mcp_portal_items(id) ON DELETE SET NULL,
  author_kind text NOT NULL CHECK (author_kind IN ('client', 'team')),
  author_name text NOT NULL CHECK (length(btrim(author_name)) BETWEEN 1 AND 120),
  author_user_id uuid,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A team message the customer has opened on their page.
  client_read_at timestamptz,
  -- A customer message someone on the team answered.
  team_read_at timestamptz,
  team_read_by uuid,
  CHECK ((author_kind = 'team') = (author_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mcp_portal_messages_job ON public.mcp_portal_messages (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_portal_messages_access ON public.mcp_portal_messages (access_id, created_at DESC);

ALTER TABLE public.mcp_portal_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_portal_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_portal_messages TO service_role;

-- The name the customer reads for a shared item, the same words as mcp_portal_list.
CREATE OR REPLACE FUNCTION mcp_private.portal_item_label(_item uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN i.kind = 'change_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(i.view->>'number') ELSE i.view->'proposal'->>'title' END
    FROM public.mcp_portal_items i WHERE i.id = _item
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_item_label(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- One message as the customer sees it: no user ids, no team read marks.
CREATE OR REPLACE FUNCTION mcp_private.portal_message_client_json(m public.mcp_portal_messages) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', m.id, 'author_kind', m.author_kind, 'author_name', m.author_name, 'body', m.body,
    'created_at', m.created_at, 'item_id', m.item_id, 'about_label', CASE WHEN m.item_id IS NULL THEN NULL ELSE mcp_private.portal_item_label(m.item_id) END)
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_message_client_json(public.mcp_portal_messages) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- customer functions (the app server only) ----------

-- The customer posts a message, about the job or one item shared with them. Returns what the page server needs to
-- record the client_message notice.
CREATE OR REPLACE FUNCTION public.mcp_portal_message_post(_access uuid, _session_hash text, _item uuid, _body text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; j public.mcp_jobs; m public.mcp_portal_messages;
  b text := btrim(coalesce(_body, ''));
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access FOR UPDATE;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF length(b) NOT BETWEEN 1 AND 4000 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF _item IS NOT NULL THEN
    SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL;
    IF it.id IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  END IF;
  -- At most 20 messages an hour from one access. The access row is locked above, so two posts can't both slip in.
  IF (SELECT count(*) FROM public.mcp_portal_messages x WHERE x.access_id = a.id AND x.author_kind = 'client'
       AND x.created_at > now() - interval '1 hour') >= 20 THEN
    RETURN jsonb_build_object('status', 'slow_down');
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  INSERT INTO public.mcp_portal_messages (company_id, job_id, access_id, item_id, author_kind, author_name, body)
  VALUES (a.company_id, a.job_id, a.id, it.id, 'client', a.name, b) RETURNING * INTO m;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
  VALUES (a.id, a.job_id, 'message_posted', jsonb_build_object('message_id', m.id, 'item', it.id), left(_ip, 100), left(_user_agent, 400));
  RETURN jsonb_build_object('status', 'ok', 'message_id', m.id, 'created_at', m.created_at, 'job_id', j.id,
    'job_number', j.job_number, 'job_name', j.name, 'customer', a.name, 'item_id', it.id, 'about_kind', it.kind,
    'about_label', CASE WHEN it.id IS NULL THEN NULL ELSE mcp_private.portal_item_label(it.id) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_message_post(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_message_post(uuid, text, uuid, text, text, text) TO service_role;

-- The customer's conversation, oldest first (the newest 200). With _mark_read, the team's messages count as read.
-- unread is the team messages the customer hadn't opened before this call.
CREATE OR REPLACE FUNCTION public.mcp_portal_messages(_access uuid, _session_hash text, _mark_read boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; n integer; out jsonb;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  SELECT count(*) INTO n FROM public.mcp_portal_messages x WHERE x.access_id = a.id AND x.author_kind = 'team' AND x.client_read_at IS NULL;
  out := jsonb_build_object('status', 'ok', 'unread', n,
    'messages', coalesce((SELECT jsonb_agg(mcp_private.portal_message_client_json(q) ORDER BY q.created_at, q.id)
      FROM (SELECT * FROM public.mcp_portal_messages x WHERE x.access_id = a.id ORDER BY x.created_at DESC LIMIT 200) q), '[]'::jsonb));
  IF coalesce(_mark_read, false) AND n > 0 THEN
    UPDATE public.mcp_portal_messages SET client_read_at = now() WHERE access_id = a.id AND author_kind = 'team' AND client_read_at IS NULL;
  END IF;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_messages(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_messages(uuid, text, boolean) TO service_role;

-- The job of a decision this customer just recorded, for its client_decision notice. NULL when it isn't theirs.
CREATE OR REPLACE FUNCTION public.mcp_portal_decision_job(_access uuid, _session_hash text, _decision uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (mcp_private.portal_session(_access, _session_hash)).id IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT i.job_id FROM public.mcp_portal_decisions d JOIN public.mcp_portal_items i ON i.id = d.item_id
           WHERE d.id = _decision AND d.access_id = _access);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_decision_job(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_decision_job(uuid, text, uuid) TO service_role;

-- ---------- member functions (the board and chat) ----------

-- Every customer conversation on a job, one thread per customer access, for full-access members. Each customer
-- message carries its notice id and whether the caller has read it, so the board can mark it read with
-- mcp_job_notices_mark_read.
CREATE OR REPLACE FUNCTION public.mcp_job_messages_list(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; me uuid;
BEGIN
  j := mcp_private.portal_full_job(_job);
  me := auth.uid();
  RETURN (WITH msgs AS (
      SELECT x.*, nt.id AS notice_id,
        CASE WHEN x.author_kind = 'team' THEN true
          ELSE EXISTS (SELECT 1 FROM public.mcp_job_notice_reads r WHERE r.notice_id = nt.id AND r.user_id = me) END AS seen
        FROM (SELECT * FROM public.mcp_portal_messages y WHERE y.job_id = _job ORDER BY y.created_at DESC LIMIT 300) x
        LEFT JOIN LATERAL (SELECT n.id FROM public.mcp_job_notices n WHERE n.job_id = _job AND n.ref_table = 'mcp_portal_messages'
          AND n.ref_id = x.id ORDER BY n.created_at LIMIT 1) nt ON true
    ), threads AS (
      SELECT a.id AS access_id, a.name, a.email, a.revoked_at, max(m.created_at) AS last_at,
        count(*) FILTER (WHERE m.author_kind = 'client' AND m.team_read_at IS NULL) AS awaiting,
        count(*) FILTER (WHERE NOT m.seen) AS unread,
        jsonb_agg(jsonb_build_object('id', m.id, 'author_kind', m.author_kind, 'author_name', m.author_name,
          'author_user_id', m.author_user_id, 'body', m.body, 'created_at', m.created_at, 'item_id', m.item_id,
          'about_kind', (SELECT i.kind FROM public.mcp_portal_items i WHERE i.id = m.item_id),
          'about_label', CASE WHEN m.item_id IS NULL THEN NULL ELSE mcp_private.portal_item_label(m.item_id) END,
          'client_read_at', m.client_read_at, 'team_read_at', m.team_read_at, 'notice_id', m.notice_id, 'read', m.seen)
          ORDER BY m.created_at, m.id) AS messages
        FROM msgs m JOIN public.mcp_portal_access a ON a.id = m.access_id
       GROUP BY a.id, a.name, a.email, a.revoked_at
    )
    SELECT jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
      'unread', coalesce(sum(t.unread), 0), 'awaiting_reply', coalesce(sum(t.awaiting), 0),
      'threads', coalesce(jsonb_agg(jsonb_build_object('access_id', t.access_id, 'customer_name', t.name, 'customer_email', t.email,
          'can_reply', t.revoked_at IS NULL, 'last_at', t.last_at, 'awaiting_reply', t.awaiting, 'unread', t.unread,
          'messages', t.messages) ORDER BY t.last_at DESC) FILTER (WHERE t.access_id IS NOT NULL), '[]'::jsonb))
      FROM (SELECT 1) one LEFT JOIN threads t ON true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_messages_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_messages_list(uuid) TO authenticated;

-- A full-access member replies to one customer, optionally about one shared item. Marks that customer's earlier
-- messages answered and the caller's notices for them read. Returns what the server needs to email the customer.
CREATE OR REPLACE FUNCTION public.mcp_job_message_reply(_job uuid, _access uuid, _body text, _about_item uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; a public.mcp_portal_access; it public.mcp_portal_items; m public.mcp_portal_messages; me uuid;
  who text; b text := btrim(coalesce(_body, ''));
BEGIN
  j := mcp_private.portal_full_job(_job);
  me := auth.uid();
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access AND job_id = _job;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That customer isn''t on this job''s customer page.'; END IF;
  IF a.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:That customer no longer has access to their page, so they can''t read a reply.'; END IF;
  IF length(b) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'MCP_BAD:Write a reply of up to 4,000 characters.'; END IF;
  IF _about_item IS NOT NULL THEN
    SELECT * INTO it FROM public.mcp_portal_items WHERE id = _about_item AND job_id = _job;
    IF it.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That item isn''t on this job''s customer page.'; END IF;
  END IF;
  who := left(coalesce(
    CASE WHEN j.pm_user_id = me THEN nullif(btrim(j.pm_name), '') END,
    (SELECT nullif(btrim(cm.display_name), '') FROM public.mcp_company_members cm WHERE cm.company_id = j.company_id AND cm.user_id = me LIMIT 1),
    (SELECT name FROM public.mcp_companies WHERE id = j.company_id)), 120);
  INSERT INTO public.mcp_portal_messages (company_id, job_id, access_id, item_id, author_kind, author_name, author_user_id, body)
  VALUES (j.company_id, _job, a.id, it.id, 'team', who, me, b) RETURNING * INTO m;
  UPDATE public.mcp_portal_messages SET team_read_at = now(), team_read_by = me
   WHERE access_id = a.id AND author_kind = 'client' AND team_read_at IS NULL AND created_at <= m.created_at;
  INSERT INTO public.mcp_job_notice_reads (notice_id, user_id)
  SELECT n.id, me FROM public.mcp_job_notices n JOIN public.mcp_portal_messages x ON x.id = n.ref_id
   WHERE n.job_id = _job AND n.ref_table = 'mcp_portal_messages' AND x.access_id = a.id
  ON CONFLICT DO NOTHING;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail)
  VALUES (a.id, _job, 'message_replied', jsonb_build_object('message_id', m.id, 'item', it.id, 'by', me));
  RETURN jsonb_build_object('message_id', m.id, 'created_at', m.created_at, 'author_name', m.author_name, 'body', m.body,
    'item_id', it.id, 'about_label', CASE WHEN it.id IS NULL THEN NULL ELSE mcp_private.portal_item_label(it.id) END,
    'access_id', a.id, 'customer_name', a.name, 'customer_email', a.email,
    'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id));
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_message_reply(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_message_reply(uuid, uuid, text, uuid) TO authenticated;
