-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105150000_athena_job_notices.sql (also staged as 20261105151500_athena_job_notices.sql).
--
-- Submittal replies: the architect or engineer's return comes back into Athena.
-- Before: a package went out through the member's own email with a file link, and nothing captured the answer.
-- The PM retyped the status from the reviewer's email, if they saw it.
-- After:
--   * Every package email carries a return link and a capture address, both from one reply code per package link.
--     Only the code's SHA-256 is stored here (mcp_submittal_reply_links). Links last 180 days.
--   * The return page (/r/submittal-return/<code>) lets the reviewer pick Approved, Approved as noted, Revise and
--     resubmit, Rejected or For record only, attach a stamped copy, and sign with their name. That is a status
--     decision: the submittal's status, returned date and ball in court change, and the history records it.
--   * A plain email reply to submittals+<code>@meetathena.io is kept as a reply that needs review. It never changes
--     the status. The PM confirms the status from the board or chat (mcp_submittal_reply_confirm), which updates the
--     log and writes history the same way every other submittal status change does (mcp_submittal_record).
--   * Every reply is a submittal_reply job notice, recorded by the server (recordJobNotice), so the job's PM and the
--     job's supers get the email and the board shows it.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mcp_submittal_reply_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.mcp_submittal_packages(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  -- Page tries in the current hour, so a leaked link cannot be used to flood storage.
  try_window timestamptz,
  try_count integer NOT NULL DEFAULT 0 CHECK (try_count >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_submittal_reply_links_package ON public.mcp_submittal_reply_links (package_id);

CREATE TABLE IF NOT EXISTS public.mcp_submittal_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.mcp_submittal_packages(id) ON DELETE CASCADE,
  link_id uuid REFERENCES public.mcp_submittal_reply_links(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('page', 'email')),
  -- The reviewer's action. An emailed reply has none until the PM confirms it.
  action text CHECK (action IS NULL OR action IN ('approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'for_record')),
  -- recorded: the page decision is on the log. needs_review: an emailed reply waits for the PM.
  -- confirmed: the PM set the status from it. dismissed: the PM said it was not a return.
  review_status text NOT NULL CHECK (review_status IN ('recorded', 'needs_review', 'confirmed', 'dismissed')),
  applied_status text,
  reviewer_name text CHECK (reviewer_name IS NULL OR length(reviewer_name) <= 120),
  reviewer_email text CHECK (reviewer_email IS NULL OR length(reviewer_email) <= 320),
  -- False when an emailed reply came from an address the package email did not go to.
  sender_known boolean,
  comments text CHECK (comments IS NULL OR length(comments) <= 8000),
  subject text CHECK (subject IS NULL OR length(subject) <= 300),
  -- The first stored file; files holds every one as {path, filename, content_type, size_bytes}.
  file_path text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(files) = 'array'),
  raw_message_id text CHECK (raw_message_id IS NULL OR length(raw_message_id) <= 300),
  inbound_email_id text UNIQUE CHECK (inbound_email_id IS NULL OR length(inbound_email_id) <= 200),
  ip text,
  user_agent text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  CHECK ((source = 'page') = (review_status = 'recorded') OR review_status IN ('confirmed', 'dismissed')),
  CHECK (source <> 'page' OR action IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS mcp_submittal_responses_job ON public.mcp_submittal_responses (job_id, created_at DESC);
-- One page decision per package. Later emails are still kept.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_submittal_responses_one_page
  ON public.mcp_submittal_responses (package_id) WHERE source = 'page';

ALTER TABLE public.mcp_submittal_reply_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_submittal_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_submittal_reply_links, public.mcp_submittal_responses FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION mcp_private.submittal_reply_status(_action text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE _action
    WHEN 'approved' THEN 'approved'
    WHEN 'approved_as_noted' THEN 'approved_as_noted'
    WHEN 'revise_and_resubmit' THEN 'revise_and_resubmit'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'for_record' THEN 'closed'
  END
$$;
REVOKE ALL ON FUNCTION mcp_private.submittal_reply_status(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.submittal_reply_label(_action text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE _action
    WHEN 'approved' THEN 'Approved'
    WHEN 'approved_as_noted' THEN 'Approved as noted'
    WHEN 'revise_and_resubmit' THEN 'Revise and resubmit'
    WHEN 'rejected' THEN 'Rejected'
    WHEN 'for_record' THEN 'For record only'
    ELSE 'Received, needs review'
  END
$$;
REVOKE ALL ON FUNCTION mcp_private.submittal_reply_label(text) FROM PUBLIC, anon, authenticated, service_role;

-- What the server needs about one reply link, and whether it still works.
CREATE OR REPLACE FUNCTION mcp_private.submittal_reply_find(_token_hash text)
RETURNS TABLE (link public.mcp_submittal_reply_links, state text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE l public.mcp_submittal_reply_links; s public.mcp_submittals; p public.mcp_submittal_packages;
BEGIN
  IF coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' THEN link := NULL; state := 'unknown'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO l FROM public.mcp_submittal_reply_links WHERE token_hash = _token_hash;
  IF l.id IS NULL THEN link := NULL; state := 'unknown'; RETURN NEXT; RETURN; END IF;
  SELECT * INTO s FROM public.mcp_submittals WHERE id = l.submittal_id;
  SELECT * INTO p FROM public.mcp_submittal_packages WHERE id = l.package_id;
  link := l;
  state := CASE
    WHEN l.revoked_at IS NOT NULL THEN 'revoked'
    WHEN l.expires_at <= now() THEN 'expired'
    WHEN s.id IS NULL OR p.id IS NULL THEN 'unknown'
    WHEN s.status = 'void' THEN 'void'
    WHEN p.revoked_at IS NOT NULL THEN 'revoked'
    WHEN EXISTS (SELECT 1 FROM public.mcp_submittals x WHERE x.job_id = s.job_id AND x.number = s.number AND x.revision > s.revision) THEN 'replaced'
    ELSE 'ok' END;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION mcp_private.submittal_reply_find(text) FROM PUBLIC, anon, authenticated, service_role;

-- The same history row mcp_submittal_record writes, for a change made with no member signed in (the return page).
CREATE OR REPLACE FUNCTION mcp_private.submittal_reply_history(_s public.mcp_submittals, _who text, _email text, _payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tnum int;
BEGIN
  SELECT number INTO tnum FROM public.mcp_transmittals WHERE id = _s.transmittal_id;
  INSERT INTO public.mcp_project_record_events (
    company_id, job_id, actor, actor_id, kind, title, summary, counterparty_name, counterparty_email, ref_table, ref_id, payload
  ) VALUES (
    _s.company_id, _s.job_id, 'athena', NULL, 'submittal_status',
    'Submittal ' || _s.number || ' revision ' || _s.revision::text,
    _s.title || '. Spec ' || _s.spec_section || '. ' || replace(_s.status, '_', ' ') || '.',
    nullif(btrim(coalesce(_who, '')), ''), nullif(btrim(coalesce(_email, '')), ''), 'mcp_submittals', _s.id,
    jsonb_build_object('number', _s.number, 'revision', _s.revision, 'status', _s.status, 'transmittal_number', tnum,
      'spec_section', _s.spec_section) || coalesce(_payload, '{}'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION mcp_private.submittal_reply_history(public.mcp_submittals, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- What a notice and a page need about a reply, in one shape.
CREATE OR REPLACE FUNCTION mcp_private.submittal_reply_json(r public.mcp_submittal_responses) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('response_id', r.id, 'job_id', r.job_id, 'company_id', r.company_id, 'submittal_id', r.submittal_id,
    'package_id', r.package_id, 'source', r.source, 'action', r.action, 'action_label', mcp_private.submittal_reply_label(r.action),
    'review_status', r.review_status, 'applied_status', r.applied_status, 'reviewer_name', r.reviewer_name,
    'reviewer_email', r.reviewer_email, 'sender_known', r.sender_known, 'file_count', jsonb_array_length(r.files),
    'created_at', r.created_at,
    'number', s.number, 'revision', s.revision, 'title', s.title, 'spec_section', s.spec_section,
    'job_number', j.job_number, 'job_name', j.name, 'company', co.name)
  FROM public.mcp_submittals s JOIN public.mcp_jobs j ON j.id = s.job_id JOIN public.mcp_companies co ON co.id = s.company_id
  WHERE s.id = r.submittal_id
$$;
REVOKE ALL ON FUNCTION mcp_private.submittal_reply_json(public.mcp_submittal_responses) FROM PUBLIC, anon, authenticated, service_role;

-- Member, full access: issues the reply code for one package link when the package email is drafted.
-- The same code twice is the same link. Returns the link's expiry.
CREATE OR REPLACE FUNCTION public.mcp_submittal_reply_link_issue(_job uuid, _submittal uuid, _package uuid, _token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_submittal_packages; l public.mcp_submittal_reply_links;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job), 'none') <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full job access is required.'; END IF;
  IF coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:That reply code is not valid.'; END IF;
  SELECT * INTO p FROM public.mcp_submittal_packages WHERE id = _package AND submittal_id = _submittal AND job_id = _job;
  IF p.id IS NULL OR p.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Build a current package first.'; END IF;
  SELECT * INTO l FROM public.mcp_submittal_reply_links WHERE token_hash = _token_hash;
  IF l.id IS NOT NULL AND l.package_id <> p.id THEN RAISE EXCEPTION 'MCP_BAD:That reply code belongs to another package.'; END IF;
  IF l.id IS NULL THEN
    INSERT INTO public.mcp_submittal_reply_links (company_id, job_id, submittal_id, package_id, token_hash, expires_at, created_by)
    VALUES (p.company_id, _job, _submittal, p.id, _token_hash, now() + interval '180 days', auth.uid())
    RETURNING * INTO l;
  END IF;
  RETURN jsonb_build_object('link_id', l.id, 'expires_at', l.expires_at, 'revoked', l.revoked_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_reply_link_issue(uuid, uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_reply_link_issue(uuid, uuid, uuid, text) TO authenticated;

-- Server only: what the return page shows. Never cost, the package file, or anything of the team's.
CREATE OR REPLACE FUNCTION public.mcp_submittal_reply_page_open(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f record; s public.mcp_submittals; j public.mcp_jobs; co public.mcp_companies; r public.mcp_submittal_responses; tnum int;
BEGIN
  SELECT * INTO f FROM mcp_private.submittal_reply_find(_token_hash);
  IF (f.link).id IS NULL THEN RETURN jsonb_build_object('status', f.state); END IF;
  SELECT * INTO s FROM public.mcp_submittals WHERE id = (f.link).submittal_id;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = (f.link).job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = (f.link).company_id;
  SELECT number INTO tnum FROM public.mcp_transmittals WHERE id = s.transmittal_id;
  SELECT * INTO r FROM public.mcp_submittal_responses WHERE package_id = (f.link).package_id AND source = 'page';
  RETURN jsonb_build_object('status', f.state, 'company', co.name, 'logo_url', to_jsonb(co)->>'logo_url',
    'company_id', co.id, 'job_id', j.id, 'submittal_id', s.id, 'package_id', (f.link).package_id,
    'job_number', j.job_number, 'job_name', j.name, 'number', s.number, 'revision', s.revision, 'title', s.title,
    'spec_section', s.spec_section, 'transmittal_number', tnum,
    'returned', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('action', r.action,
      'action_label', mcp_private.submittal_reply_label(r.action), 'reviewer_name', r.reviewer_name, 'created_at', r.created_at,
      'file_count', jsonb_array_length(r.files)) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_reply_page_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_reply_page_open(text) TO service_role;

-- Server only: counts one page submit before any file is stored. Twenty an hour per link, then slow_down.
CREATE OR REPLACE FUNCTION public.mcp_submittal_reply_page_try(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f record; n integer;
BEGIN
  SELECT * INTO f FROM mcp_private.submittal_reply_find(_token_hash);
  IF f.state <> 'ok' THEN RETURN jsonb_build_object('status', f.state); END IF;
  UPDATE public.mcp_submittal_reply_links
     SET try_window = CASE WHEN try_window IS NULL OR try_window <= now() - interval '1 hour' THEN now() ELSE try_window END,
         try_count = CASE WHEN try_window IS NULL OR try_window <= now() - interval '1 hour' THEN 1 ELSE try_count + 1 END
   WHERE id = (f.link).id RETURNING try_count INTO n;
  RETURN jsonb_build_object('status', CASE WHEN n > 20 THEN 'slow_down' ELSE 'ok' END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_reply_page_try(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_reply_page_try(text) TO service_role;

-- Files kept with a reply must sit under <company>/<job>/returns/<response>/ in the submittals bucket.
CREATE OR REPLACE FUNCTION mcp_private.submittal_reply_files_ok(_company uuid, _job uuid, _response uuid, _files jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_typeof(coalesce(_files, '[]'::jsonb)) = 'array' AND jsonb_array_length(coalesce(_files, '[]'::jsonb)) <= 10
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(_files, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) <> 'object'
           OR coalesce(e->>'path', '') NOT LIKE _company::text || '/' || _job::text || '/returns/' || _response::text || '/%'
           OR e->>'path' LIKE '%..%'
           OR coalesce(e->>'content_type', '') NOT IN ('application/pdf', 'image/png', 'image/jpeg')
           OR coalesce((e->>'size_bytes')::bigint, 0) NOT BETWEEN 1 AND 26214400
           OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'athena-submittals' AND o.name = e->>'path'))
$$;
REVOKE ALL ON FUNCTION mcp_private.submittal_reply_files_ok(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Server only: the reviewer's decision from the return page. Records the reply, sets the submittal's status,
-- returned date and ball in court, and writes the history. The caller records the job notice.
CREATE OR REPLACE FUNCTION public.mcp_submittal_reply_page_submit(_token_hash text, _response uuid, _action text,
  _reviewer_name text, _reviewer_email text, _comments text, _files jsonb, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f record; s public.mcp_submittals; j public.mcp_jobs; r public.mcp_submittal_responses;
  who text := regexp_replace(btrim(coalesce(_reviewer_name, '')), '\s+', ' ', 'g');
  mail text := nullif(lower(btrim(coalesce(_reviewer_email, ''))), '');
  st text := mcp_private.submittal_reply_status(_action);
  files jsonb := coalesce(_files, '[]'::jsonb);
BEGIN
  SELECT * INTO f FROM mcp_private.submittal_reply_find(_token_hash);
  IF f.state <> 'ok' THEN RETURN jsonb_build_object('status', f.state); END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_submittal_responses WHERE package_id = (f.link).package_id AND source = 'page') THEN
    RETURN jsonb_build_object('status', 'already');
  END IF;
  IF _response IS NULL OR st IS NULL OR length(who) NOT BETWEEN 2 AND 120 OR length(coalesce(_comments, '')) > 4000
     OR (mail IS NOT NULL AND (mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(mail) > 320))
     OR jsonb_array_length(files) > 1
     OR NOT mcp_private.submittal_reply_files_ok((f.link).company_id, (f.link).job_id, _response, files) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = (f.link).job_id FOR UPDATE;
  SELECT * INTO s FROM public.mcp_submittals WHERE id = (f.link).submittal_id FOR UPDATE;
  INSERT INTO public.mcp_submittal_responses (id, company_id, job_id, submittal_id, package_id, link_id, source, action, review_status,
    applied_status, reviewer_name, reviewer_email, sender_known, comments, file_path, files, ip, user_agent)
  VALUES (_response, s.company_id, s.job_id, s.id, (f.link).package_id, (f.link).id, 'page', _action, 'recorded', st, who, mail, NULL,
    nullif(btrim(coalesce(_comments, '')), ''), files->0->>'path', files, left(_ip, 100), left(_user_agent, 400))
  RETURNING * INTO r;
  UPDATE public.mcp_submittals SET status = st, ball_in_court = 'gc', ball_in_court_name = NULL,
    returned_on = (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/New_York'))::date, updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  PERFORM mcp_private.submittal_reply_history(s, who, mail,
    jsonb_build_object('response_id', r.id, 'source', 'page', 'action', _action, 'file_count', jsonb_array_length(files)));
  RETURN jsonb_build_object('status', 'ok', 'created', true) || mcp_private.submittal_reply_json(r);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_reply_page_submit(text, uuid, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_reply_page_submit(text, uuid, text, text, text, text, jsonb, text, text) TO service_role;

-- Server only: an email sent to the package's capture address. Kept as a reply that needs review; it never changes
-- the submittal. The team's own copy of the package email (the member's send, CC'd to the capture address) and the
-- team's own mail are ignored. A repeated inbound id returns the first reply.
CREATE OR REPLACE FUNCTION public.mcp_submittal_reply_email(_token_hash text, _inbound_email_id text, _message_id text,
  _from text, _from_name text, _subject text, _text text, _in_reply boolean, _received_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f record; r public.mcp_submittal_responses; j public.mcp_jobs; known boolean;
  sender text := lower(btrim(coalesce(_from, '')));
  subj text := left(btrim(coalesce(_subject, '')), 300);
BEGIN
  IF coalesce(btrim(_inbound_email_id), '') = '' OR length(_inbound_email_id) > 200 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO r FROM public.mcp_submittal_responses WHERE inbound_email_id = _inbound_email_id;
  IF r.id IS NOT NULL THEN RETURN jsonb_build_object('status', 'ok', 'created', false, 'files', r.files) || mcp_private.submittal_reply_json(r); END IF;
  SELECT * INTO f FROM mcp_private.submittal_reply_find(_token_hash);
  -- A replaced revision or a turned-off package still gets its reviewer's email kept; only unknown and expired codes stop.
  IF (f.link).id IS NULL OR f.state IN ('unknown', 'expired') OR (f.link).revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', coalesce(f.state, 'unknown'));
  END IF;
  IF sender !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(sender) > 320 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = (f.link).job_id;
  -- The team's own mail: a member of the company, or the job's PM address.
  IF EXISTS (SELECT 1 FROM public.mcp_company_members m JOIN auth.users u ON u.id = m.user_id
              WHERE m.company_id = j.company_id AND lower(u.email) = sender)
     OR lower(btrim(coalesce(j.pm_email, ''))) = sender
     -- The package email itself, copied to the capture address when it was sent: same subject, not a reply.
     OR (NOT coalesce(_in_reply, false) AND subj <> '' AND EXISTS (
          SELECT 1 FROM public.mcp_submittal_mail m WHERE m.package_id = (f.link).package_id AND btrim(m.draft->>'subject') = subj)) THEN
    RETURN jsonb_build_object('status', 'own_copy');
  END IF;
  IF (SELECT count(*) FROM public.mcp_submittal_responses x WHERE x.link_id = (f.link).id AND x.source = 'email'
       AND x.created_at > now() - interval '1 day') >= 30 THEN
    RETURN jsonb_build_object('status', 'slow_down');
  END IF;
  known := EXISTS (SELECT 1 FROM public.mcp_submittal_mail m WHERE m.package_id = (f.link).package_id
    AND (lower(m.draft->>'to') = sender OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(m.draft->'cc', '[]'::jsonb)) c WHERE lower(c) = sender)));
  INSERT INTO public.mcp_submittal_responses (company_id, job_id, submittal_id, package_id, link_id, source, action, review_status,
    reviewer_name, reviewer_email, sender_known, comments, subject, raw_message_id, inbound_email_id, received_at)
  VALUES ((f.link).company_id, (f.link).job_id, (f.link).submittal_id, (f.link).package_id, (f.link).id, 'email', NULL, 'needs_review',
    nullif(left(regexp_replace(btrim(coalesce(_from_name, '')), '\s+', ' ', 'g'), 120), ''), sender, known,
    nullif(left(btrim(coalesce(_text, '')), 8000), ''), nullif(subj, ''), nullif(left(btrim(coalesce(_message_id, '')), 300), ''),
    _inbound_email_id, coalesce(_received_at, now()))
  RETURNING * INTO r;
  RETURN jsonb_build_object('status', 'ok', 'created', true, 'files', r.files) || mcp_private.submittal_reply_json(r);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_reply_email(text, text, text, text, text, text, text, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_reply_email(text, text, text, text, text, text, text, boolean, timestamptz) TO service_role;

-- Server only: attaches stored files to an emailed reply once. A retried webhook finds them already set.
CREATE OR REPLACE FUNCTION public.mcp_submittal_reply_files(_response uuid, _files jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.mcp_submittal_responses;
BEGIN
  SELECT * INTO r FROM public.mcp_submittal_responses WHERE id = _response FOR UPDATE;
  IF r.id IS NULL OR r.source <> 'email' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF jsonb_array_length(r.files) > 0 THEN RETURN jsonb_build_object('status', 'ok', 'files', r.files); END IF;
  IF NOT mcp_private.submittal_reply_files_ok(r.company_id, r.job_id, r.id, _files) THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  UPDATE public.mcp_submittal_responses SET files = _files, file_path = _files->0->>'path' WHERE id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('status', 'ok', 'files', r.files);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_reply_files(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_reply_files(uuid, jsonb) TO service_role;

-- Member, full access: sets the status from an emailed reply, or marks it as not a return ('none').
-- The log and its history change the same way as any other status change.
CREATE OR REPLACE FUNCTION public.mcp_submittal_reply_confirm(_job uuid, _response uuid, _action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.mcp_submittal_responses; s public.mcp_submittals; j public.mcp_jobs; st text := mcp_private.submittal_reply_status(_action);
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job), 'none') <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full job access is required.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job FOR UPDATE;
  SELECT * INTO r FROM public.mcp_submittal_responses WHERE id = _response AND job_id = _job FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That reply is not on this job.'; END IF;
  IF r.review_status <> 'needs_review' THEN
    RAISE EXCEPTION 'MCP_BAD:That reply is already %.', CASE r.review_status WHEN 'dismissed' THEN 'marked as not a return' ELSE 'on the log' END;
  END IF;
  IF _action = 'none' THEN
    UPDATE public.mcp_submittal_responses SET review_status = 'dismissed', confirmed_by = auth.uid(), confirmed_at = now()
     WHERE id = r.id RETURNING * INTO r;
    RETURN jsonb_build_object('status', 'ok') || mcp_private.submittal_reply_json(r);
  END IF;
  IF st IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Pick approved, approved as noted, revise and resubmit, rejected, for record only, or none.'; END IF;
  SELECT * INTO s FROM public.mcp_submittals WHERE id = r.submittal_id FOR UPDATE;
  IF s.status = 'void' THEN RAISE EXCEPTION 'MCP_BAD:That submittal is void.'; END IF;
  UPDATE public.mcp_submittals SET status = st, ball_in_court = 'gc', ball_in_court_name = NULL,
    returned_on = (r.received_at AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/New_York'))::date, updated_at = now()
   WHERE id = s.id;
  UPDATE public.mcp_submittal_responses SET action = _action, applied_status = st, review_status = 'confirmed',
    confirmed_by = auth.uid(), confirmed_at = now() WHERE id = r.id RETURNING * INTO r;
  PERFORM public.mcp_submittal_record(_job, s.id, 'submittal_status', false);
  RETURN jsonb_build_object('status', 'ok') || mcp_private.submittal_reply_json(r);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_reply_confirm(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_reply_confirm(uuid, uuid, text) TO authenticated;

-- Member, full or super: a job's returned submittals for the board and chat, newest first, with the replies that
-- still need the PM counted.
CREATE OR REPLACE FUNCTION public.mcp_submittal_replies_list(_job uuid, _submittal uuid DEFAULT NULL,
  _needs_review_only boolean DEFAULT false, _limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE scope text := public.mcp_job_scope(_job); lim integer := least(greatest(coalesce(_limit, 50), 1), 200);
BEGIN
  IF scope IS NULL OR scope NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:You don''t have access to this job''s submittals.'; END IF;
  RETURN jsonb_build_object(
    'can_confirm', scope = 'full',
    'needs_review', (SELECT count(*) FROM public.mcp_submittal_responses x WHERE x.job_id = _job AND x.review_status = 'needs_review'
                      AND (_submittal IS NULL OR x.submittal_id = _submittal)),
    'replies', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'submittal_id', r.submittal_id, 'package_id', r.package_id,
        'number', s.number, 'revision', s.revision, 'title', s.title, 'submittal_status', s.status,
        'source', r.source, 'action', r.action, 'action_label', mcp_private.submittal_reply_label(r.action),
        'review_status', r.review_status, 'reviewer_name', r.reviewer_name, 'reviewer_email', r.reviewer_email,
        'sender_known', r.sender_known, 'subject', r.subject, 'comments', r.comments, 'files', r.files,
        'received_at', r.received_at, 'created_at', r.created_at, 'confirmed_at', r.confirmed_at,
        'confirmed_by_name', (SELECT m.display_name FROM public.mcp_company_members m WHERE m.company_id = r.company_id AND m.user_id = r.confirmed_by LIMIT 1))
      ORDER BY r.created_at DESC)
      FROM (SELECT * FROM public.mcp_submittal_responses x WHERE x.job_id = _job
              AND (_submittal IS NULL OR x.submittal_id = _submittal)
              AND (NOT coalesce(_needs_review_only, false) OR x.review_status = 'needs_review')
             ORDER BY x.created_at DESC LIMIT lim) r
      JOIN public.mcp_submittals s ON s.id = r.submittal_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_replies_list(uuid, uuid, boolean, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_replies_list(uuid, uuid, boolean, integer) TO authenticated;
