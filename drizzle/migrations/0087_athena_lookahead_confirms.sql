-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105150000_athena_job_notices.sql (job notices; renamed 20261105151500 at merge).
--
-- Look-ahead date confirmations: a supplier locks in a delivery date and a sub locks in their crew start or work
-- date on the two-week look-ahead, from a link Athena emails them.
-- Before: look-ahead lines had no commitment from the supplier or sub. The PM or super called around and kept the
-- answers in their head or their inbox.
-- After:
--   * mcp_lookahead_confirms holds one request per party and date: which job, which look-ahead and which line
--     (an open item on it or a CPM activity id), who was asked (supplier or sub, name and email), what is being
--     confirmed and the date asked (with an optional window end). The link token is stored only as a hash and
--     expires.
--   * The party answers on a public page: confirm the date, propose another date, or say they can't make it, with
--     their typed name. A proposed date never moves the schedule; it waits for the super's or PM's call.
--   * The page server records each answer as a field_confirm job notice (board page lookahead) through
--     recordJobNotice, which emails the job's PM and the supers on the job.
--   * Members with full or super scope on the job send and cancel requests; anyone who can see the job can list them.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mcp_lookahead_confirms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  -- The look-ahead it was sent from and the line on it: an open item, a CPM activity id, or neither for a line the
  -- PM typed. Items move between look-aheads when carried forward, so the item is kept on its own.
  lookahead_id uuid REFERENCES public.mcp_lookaheads(id) ON DELETE SET NULL,
  item_id uuid REFERENCES public.mcp_open_items(id) ON DELETE SET NULL,
  activity_id text CHECK (activity_id IS NULL OR length(btrim(activity_id)) BETWEEN 1 AND 80),
  party_kind text NOT NULL CHECK (party_kind IN ('supplier', 'sub')),
  party_name text NOT NULL CHECK (length(btrim(party_name)) BETWEEN 2 AND 120),
  party_email text NOT NULL CHECK (party_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(party_email) <= 320),
  -- delivery: a supplier's delivery date; start: a sub's crew start; work: a sub's work date.
  ask_kind text NOT NULL CHECK (ask_kind IN ('delivery', 'start', 'work')),
  what text NOT NULL CHECK (length(btrim(what)) BETWEEN 2 AND 200),
  asked_date date NOT NULL,
  window_end date CHECK (window_end IS NULL OR window_end >= asked_date),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'asked' CHECK (status IN ('asked', 'confirmed', 'proposed_new_date', 'declined')),
  -- The date the party confirmed (the asked date) or proposed instead; empty when they declined.
  response_date date,
  responder_name text CHECK (responder_name IS NULL OR length(responder_name) BETWEEN 2 AND 120),
  response_note text CHECK (response_note IS NULL OR length(response_note) <= 2000),
  responded_at timestamptz,
  response_ip text CHECK (response_ip IS NULL OR length(response_ip) <= 100),
  response_user_agent text CHECK (response_user_agent IS NULL OR length(response_user_agent) <= 400),
  -- Posts to the page, answered or not. The page stops taking answers after 20.
  tries integer NOT NULL DEFAULT 0,
  email_status text NOT NULL DEFAULT 'queued' CHECK (email_status IN ('queued', 'sent', 'off', 'failed')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'asked') = (responded_at IS NULL)),
  CHECK (status <> 'proposed_new_date' OR (response_date IS NOT NULL AND response_date <> asked_date))
);
CREATE INDEX IF NOT EXISTS mcp_lookahead_confirms_job ON public.mcp_lookahead_confirms (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_lookahead_confirms_lookahead ON public.mcp_lookahead_confirms (lookahead_id);
CREATE INDEX IF NOT EXISTS mcp_lookahead_confirms_item ON public.mcp_lookahead_confirms (item_id);

ALTER TABLE public.mcp_lookahead_confirms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_lookahead_confirms FROM PUBLIC, anon, authenticated;

-- Where a request stands: asked, confirmed, proposed_new_date or declined, or cancelled or expired while unanswered.
CREATE OR REPLACE FUNCTION mcp_private.lookahead_confirm_state(c public.mcp_lookahead_confirms) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN c.status <> 'asked' THEN c.status
    WHEN c.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN c.expires_at <= now() THEN 'expired'
    ELSE 'asked' END
$$;
REVOKE ALL ON FUNCTION mcp_private.lookahead_confirm_state(public.mcp_lookahead_confirms) FROM PUBLIC, anon, authenticated, service_role;

-- One request as the team sees it.
CREATE OR REPLACE FUNCTION mcp_private.lookahead_confirm_json(c public.mcp_lookahead_confirms) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', c.id, 'job_id', c.job_id, 'lookahead_id', c.lookahead_id, 'item_id', c.item_id,
    'activity_id', c.activity_id, 'party_kind', c.party_kind, 'party_name', c.party_name, 'party_email', c.party_email,
    'ask_kind', c.ask_kind, 'what', c.what, 'asked_date', c.asked_date, 'window_end', c.window_end,
    'expires_at', c.expires_at, 'status', c.status, 'state', mcp_private.lookahead_confirm_state(c),
    'response_date', c.response_date, 'responder_name', c.responder_name, 'response_note', c.response_note,
    'responded_at', c.responded_at, 'email_status', c.email_status, 'cancelled_at', c.cancelled_at,
    -- A new date or a "can't make it" waits on the super or the PM; the look-ahead still shows the asked date.
    'needs_call', c.status IN ('proposed_new_date', 'declined'),
    'created_at', c.created_at, 'created_by', c.created_by,
    'created_by_name', (SELECT m.display_name FROM public.mcp_company_members m WHERE m.company_id = c.company_id AND m.user_id = c.created_by))
$$;
REVOKE ALL ON FUNCTION mcp_private.lookahead_confirm_json(public.mcp_lookahead_confirms) FROM PUBLIC, anon, authenticated, service_role;

-- True when the caller may send or cancel a job's requests: full or super scope on the job.
CREATE OR REPLACE FUNCTION mcp_private.lookahead_confirm_sender(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(public.mcp_job_scope(_job) IN ('full', 'super'), false)
$$;
REVOKE ALL ON FUNCTION mcp_private.lookahead_confirm_sender(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A member sends a request. The server makes the token, passes only its hash, and emails the party the link.
CREATE OR REPLACE FUNCTION public.mcp_lookahead_confirm_create(_job uuid, _lookahead uuid, _item uuid, _activity text,
  _party_kind text, _party_name text, _party_email text, _ask_kind text, _what text, _asked_date date, _window_end date,
  _token_hash text, _expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; c public.mcp_lookahead_confirms; email text := lower(btrim(coalesce(_party_email, '')));
BEGIN
  IF NOT mcp_private.lookahead_confirm_sender(_job) THEN
    RAISE EXCEPTION 'MCP_BAD:Only the job''s PM, a super on the job or a member with full access can send date confirmations.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF _party_kind IS NULL OR _party_kind NOT IN ('supplier', 'sub') THEN RAISE EXCEPTION 'MCP_BAD:Say whether this goes to a supplier or a sub.'; END IF;
  IF _ask_kind IS NULL OR (_party_kind = 'supplier' AND _ask_kind <> 'delivery') OR (_party_kind = 'sub' AND _ask_kind NOT IN ('start', 'work')) THEN
    RAISE EXCEPTION 'MCP_BAD:A supplier confirms a delivery date. A sub confirms a crew start or a work date.';
  END IF;
  IF length(btrim(coalesce(_party_name, ''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Give the supplier''s or sub''s company name.'; END IF;
  IF email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(email) > 320 THEN RAISE EXCEPTION 'MCP_BAD:That email address doesn''t look right.'; END IF;
  IF length(btrim(coalesce(_what, ''))) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:Say what is being confirmed, like delivery of switchgear.'; END IF;
  IF _asked_date IS NULL OR _asked_date < current_date - 1 OR _asked_date > current_date + 365 THEN
    RAISE EXCEPTION 'MCP_BAD:Pick a date from today on.';
  END IF;
  IF _window_end IS NOT NULL AND (_window_end < _asked_date OR _window_end > _asked_date + 30) THEN
    RAISE EXCEPTION 'MCP_BAD:The window ends on or after the date asked, within 30 days.';
  END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:The link could not be made.'; END IF;
  IF _expires_at IS NULL OR _expires_at <= now() OR _expires_at > now() + interval '31 days' THEN
    RAISE EXCEPTION 'MCP_BAD:The link must expire within 30 days.';
  END IF;
  IF _lookahead IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mcp_lookaheads l WHERE l.id = _lookahead AND l.job_id = _job) THEN
    RAISE EXCEPTION 'MCP_BAD:That look-ahead isn''t on this job.';
  END IF;
  IF _item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.id = _item AND i.job_id = _job) THEN
    RAISE EXCEPTION 'MCP_BAD:That look-ahead line isn''t on this job.';
  END IF;
  IF (SELECT count(*) FROM public.mcp_lookahead_confirms x WHERE x.job_id = _job AND x.created_at > now() - interval '1 day') >= 100 THEN
    RAISE EXCEPTION 'MCP_BAD:That''s 100 confirmation requests on this job today. Try again tomorrow.';
  END IF;
  INSERT INTO public.mcp_lookahead_confirms (company_id, job_id, lookahead_id, item_id, activity_id, party_kind, party_name,
    party_email, ask_kind, what, asked_date, window_end, token_hash, expires_at, created_by)
  VALUES (j.company_id, _job, _lookahead, _item, nullif(btrim(coalesce(_activity, '')), ''), _party_kind, btrim(_party_name),
    email, _ask_kind, btrim(_what), _asked_date, _window_end, _token_hash, _expires_at, auth.uid())
  RETURNING * INTO c;
  RETURN mcp_private.lookahead_confirm_json(c) || jsonb_build_object('job_number', j.job_number, 'job_name', j.name,
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id),
    'logo_url', (SELECT logo_url FROM public.mcp_companies WHERE id = j.company_id));
END $$;
REVOKE ALL ON FUNCTION public.mcp_lookahead_confirm_create(uuid, uuid, uuid, text, text, text, text, text, text, date, date, text, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_lookahead_confirm_create(uuid, uuid, uuid, text, text, text, text, text, text, date, date, text, timestamptz) TO authenticated;

-- Whether the request email went out, kept so the team knows to pass the link on themselves.
CREATE OR REPLACE FUNCTION public.mcp_lookahead_confirm_email_result(_job uuid, _id uuid, _status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT mcp_private.lookahead_confirm_sender(_job) THEN RAISE EXCEPTION 'MCP_BAD:You don''t have access to this job.'; END IF;
  UPDATE public.mcp_lookahead_confirms SET email_status = _status
   WHERE id = _id AND job_id = _job AND _status IN ('sent', 'off', 'failed');
END $$;
REVOKE ALL ON FUNCTION public.mcp_lookahead_confirm_email_result(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_lookahead_confirm_email_result(uuid, uuid, text) TO authenticated;

-- A job's requests, newest first, optionally for one look-ahead. Anyone who can see the job can read them; no money
-- is on a request.
CREATE OR REPLACE FUNCTION public.mcp_lookahead_confirms_list(_job uuid, _lookahead uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE rows jsonb;
BEGIN
  IF public.mcp_job_scope(_job) IS NULL THEN RAISE EXCEPTION 'MCP_BAD:You don''t have access to this job.'; END IF;
  SELECT coalesce(jsonb_agg(mcp_private.lookahead_confirm_json(c) ORDER BY c.created_at DESC), '[]'::jsonb) INTO rows
    FROM (SELECT * FROM public.mcp_lookahead_confirms x WHERE x.job_id = _job AND (_lookahead IS NULL OR x.lookahead_id = _lookahead)
           ORDER BY x.created_at DESC LIMIT 200) c;
  RETURN jsonb_build_object('requests', rows, 'can_send', mcp_private.lookahead_confirm_sender(_job),
    'counts', jsonb_build_object(
      'asked', (SELECT count(*) FROM jsonb_array_elements(rows) r WHERE r->>'state' = 'asked'),
      'confirmed', (SELECT count(*) FROM jsonb_array_elements(rows) r WHERE r->>'state' = 'confirmed'),
      'needs_call', (SELECT count(*) FROM jsonb_array_elements(rows) r WHERE (r->>'needs_call')::boolean)));
END $$;
REVOKE ALL ON FUNCTION public.mcp_lookahead_confirms_list(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_lookahead_confirms_list(uuid, uuid) TO authenticated;

-- Takes back an unanswered request. Its link stops working at once.
CREATE OR REPLACE FUNCTION public.mcp_lookahead_confirm_cancel(_job uuid, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_lookahead_confirms;
BEGIN
  IF NOT mcp_private.lookahead_confirm_sender(_job) THEN
    RAISE EXCEPTION 'MCP_BAD:Only the job''s PM, a super on the job or a member with full access can cancel date confirmations.';
  END IF;
  SELECT * INTO c FROM public.mcp_lookahead_confirms WHERE id = _id AND job_id = _job FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That confirmation request isn''t on this job.'; END IF;
  IF c.status <> 'asked' THEN RAISE EXCEPTION 'MCP_BAD:They already answered, so it can''t be cancelled. Send a new request if the date changed.'; END IF;
  IF c.cancelled_at IS NULL THEN
    UPDATE public.mcp_lookahead_confirms SET cancelled_at = now(), cancelled_by = auth.uid() WHERE id = c.id RETURNING * INTO c;
  END IF;
  RETURN mcp_private.lookahead_confirm_json(c);
END $$;
REVOKE ALL ON FUNCTION public.mcp_lookahead_confirm_cancel(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_lookahead_confirm_cancel(uuid, uuid) TO authenticated;

-- What the supplier or sub sees: the contractor, the job's name and number, what is being confirmed and the date.
-- Never cost, the team's emails or anything else on the job.
CREATE OR REPLACE FUNCTION mcp_private.lookahead_confirm_public(c public.mcp_lookahead_confirms) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', c.id, 'company', co.name, 'logo_url', co.logo_url, 'job_number', j.job_number, 'job_name', j.name,
    'pm_name', (SELECT m.display_name FROM public.mcp_company_members m WHERE m.company_id = j.company_id AND m.user_id = j.pm_user_id),
    'party_kind', c.party_kind, 'party_name', c.party_name, 'ask_kind', c.ask_kind, 'what', c.what,
    'asked_date', c.asked_date, 'window_end', c.window_end, 'expires_at', c.expires_at, 'answer', c.status,
    'response_date', c.response_date, 'responder_name', c.responder_name, 'response_note', c.response_note, 'responded_at', c.responded_at)
  FROM public.mcp_jobs j JOIN public.mcp_companies co ON co.id = j.company_id WHERE j.id = c.job_id
$$;
REVOKE ALL ON FUNCTION mcp_private.lookahead_confirm_public(public.mcp_lookahead_confirms) FROM PUBLIC, anon, authenticated, service_role;

-- The page server opens a link by its token hash. status: ok (asked or already answered), unknown, expired or
-- cancelled. Expired and cancelled still name the contractor, so the page can say who to call.
CREATE OR REPLACE FUNCTION public.mcp_lookahead_confirm_open(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_lookahead_confirms; st text;
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO c FROM public.mcp_lookahead_confirms WHERE token_hash = _token_hash;
  IF c.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  st := mcp_private.lookahead_confirm_state(c);
  IF st IN ('expired', 'cancelled') THEN
    RETURN jsonb_build_object('status', st, 'company', (SELECT name FROM public.mcp_companies WHERE id = c.company_id),
      'logo_url', (SELECT logo_url FROM public.mcp_companies WHERE id = c.company_id));
  END IF;
  RETURN jsonb_build_object('status', 'ok') || mcp_private.lookahead_confirm_public(c);
END $$;
REVOKE ALL ON FUNCTION public.mcp_lookahead_confirm_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_lookahead_confirm_open(text) TO service_role;

-- The party's answer. status: ok, answered (an answer is already on file), invalid (with reason), slow_down,
-- unknown, expired or cancelled. ok also returns job_id and the request, for the server's job notice.
CREATE OR REPLACE FUNCTION public.mcp_lookahead_confirm_respond(_token_hash text, _answer text, _date date, _name text,
  _note text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_lookahead_confirms; st text; nm text := regexp_replace(btrim(coalesce(_name, '')), '\s+', ' ', 'g');
  nt text := nullif(btrim(coalesce(_note, '')), '');
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  UPDATE public.mcp_lookahead_confirms SET tries = tries + 1 WHERE token_hash = _token_hash RETURNING * INTO c;
  IF c.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  st := mcp_private.lookahead_confirm_state(c);
  IF st IN ('expired', 'cancelled') THEN RETURN jsonb_build_object('status', st); END IF;
  IF st <> 'asked' THEN RETURN jsonb_build_object('status', 'answered', 'job_id', c.job_id) || mcp_private.lookahead_confirm_public(c); END IF;
  IF c.tries > 20 THEN RETURN jsonb_build_object('status', 'slow_down'); END IF;
  IF _answer IS NULL OR _answer NOT IN ('confirmed', 'proposed_new_date', 'declined') THEN
    RETURN jsonb_build_object('status', 'invalid', 'reason', 'answer');
  END IF;
  IF length(nm) NOT BETWEEN 2 AND 120 THEN RETURN jsonb_build_object('status', 'invalid', 'reason', 'name'); END IF;
  IF nt IS NOT NULL AND length(nt) > 2000 THEN RETURN jsonb_build_object('status', 'invalid', 'reason', 'note'); END IF;
  IF _answer = 'proposed_new_date' THEN
    IF _date IS NULL OR _date < current_date - 1 OR _date > current_date + 365 THEN
      RETURN jsonb_build_object('status', 'invalid', 'reason', 'date');
    END IF;
    IF _date = c.asked_date THEN RETURN jsonb_build_object('status', 'invalid', 'reason', 'same_date'); END IF;
  END IF;
  IF _answer = 'declined' AND (nt IS NULL OR length(nt) < 2) THEN RETURN jsonb_build_object('status', 'invalid', 'reason', 'note'); END IF;
  UPDATE public.mcp_lookahead_confirms SET status = _answer,
    response_date = CASE _answer WHEN 'confirmed' THEN c.asked_date WHEN 'proposed_new_date' THEN _date ELSE NULL END,
    responder_name = nm, response_note = nt, responded_at = now(),
    response_ip = left(_ip, 100), response_user_agent = left(_user_agent, 400)
   WHERE id = c.id RETURNING * INTO c;
  RETURN jsonb_build_object('status', 'ok', 'job_id', c.job_id) || mcp_private.lookahead_confirm_public(c);
END $$;
REVOKE ALL ON FUNCTION public.mcp_lookahead_confirm_respond(text, text, date, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_lookahead_confirm_respond(text, text, date, text, text, text, text) TO service_role;
