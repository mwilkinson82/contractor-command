-- Stage only. Apply through the approved Cloud release, never directly from a workstation.
-- One record, one address: the submittal record page behind every log row.
-- Additive: two nullable columns on the project record, three new readers, two patched writers.
-- Nothing here removes rows, tables or grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. Which host and conversation produced an event. Null when the host sends none (Grok Bot today).
ALTER TABLE public.mcp_project_record_events
  ADD COLUMN IF NOT EXISTS host text CHECK (host IS NULL OR host ~ '^[a-z][a-z0-9_-]{0,39}$'),
  ADD COLUMN IF NOT EXISTS thread_ref text CHECK (thread_ref IS NULL OR length(thread_ref) BETWEEN 1 AND 300);
COMMENT ON COLUMN public.mcp_project_record_events.host IS 'claude, chatgpt or grokbot: the chat host whose tool call wrote this event. Null when unknown.';
COMMENT ON COLUMN public.mcp_project_record_events.thread_ref IS 'The host conversation id when the host sends one. Only the reference is stored, never the messages.';

CREATE OR REPLACE FUNCTION public.mcp_project_record_add(
  _job uuid, _kind text, _title text, _summary text,
  _counterparty_name text, _counterparty_email text,
  _ref_table text, _ref_id uuid, _payload jsonb, _actor text,
  _host text, _thread_ref text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; cid uuid; nid uuid; who text; h text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  who := coalesce(nullif(btrim(coalesce(_actor, '')), ''), 'user');
  IF who NOT IN ('user', 'athena') THEN RAISE EXCEPTION 'MCP_BAD:The record actor is the user or Athena.'; END IF;
  IF _kind !~ '^[a-z][a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'MCP_BAD:That record kind is not valid.'; END IF;
  IF coalesce(btrim(_title), '') = '' OR coalesce(btrim(_summary), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:A record needs a title and a summary.'; END IF;
  h := nullif(lower(btrim(coalesce(_host, ''))), '');
  IF h IS NOT NULL AND h !~ '^[a-z][a-z0-9_-]{0,39}$' THEN h := NULL; END IF;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id = _job;
  INSERT INTO public.mcp_project_record_events (
    company_id, job_id, actor, actor_id, kind, title, summary,
    counterparty_name, counterparty_email, ref_table, ref_id, payload, host, thread_ref
  ) VALUES (
    cid, _job, who, CASE WHEN who = 'user' THEN auth.uid() ELSE NULL END,
    _kind, left(btrim(_title), 300), left(btrim(_summary), 4000),
    nullif(btrim(coalesce(_counterparty_name, '')), ''),
    nullif(btrim(coalesce(_counterparty_email, '')), ''),
    nullif(btrim(coalesce(_ref_table, '')), ''), _ref_id, coalesce(_payload, '{}'::jsonb),
    h, left(nullif(btrim(coalesce(_thread_ref, '')), ''), 300)
  ) RETURNING id INTO nid;
  RETURN nid;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_project_record_add(uuid, text, text, text, text, text, text, uuid, jsonb, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_project_record_add(uuid, text, text, text, text, text, text, uuid, jsonb, text, text, text) TO authenticated;

-- Every existing caller keeps its ten-argument call; it records no host.
CREATE OR REPLACE FUNCTION public.mcp_project_record_add(
  _job uuid, _kind text, _title text, _summary text,
  _counterparty_name text, _counterparty_email text,
  _ref_table text, _ref_id uuid, _payload jsonb, _actor text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.mcp_project_record_add(_job, _kind, _title, _summary, _counterparty_name, _counterparty_email, _ref_table, _ref_id, _payload, _actor, NULL, NULL);
$$;

-- 2. Sends and chases carry the host that approved them. The delivery function is patched in place so its
--    receipt rules stay byte for byte; only the record call gains the two host arguments from the payload.
DO $patch$
DECLARE routine regprocedure := 'public.mcp_submittal_delivery(uuid,uuid,text,jsonb)'::regprocedure; definition text; revised text;
BEGIN
  definition := pg_get_functiondef(routine);
  revised := replace(definition,
    $old$,'package_id',m.package_id),'user');$old$,
    $new$,'package_id',m.package_id),'user',_p->>'host',_p->>'thread_ref');$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Submittal delivery format changed; review this migration before applying.'; END IF;
  EXECUTE revised;
END $patch$;

-- 3. A piece sent again without its id is the same piece: same kind and same source on the same submittal
--    updates the stored row instead of adding a twin. Hosts that never saw the id can still name a piece.
DO $patch$
DECLARE routine regprocedure := 'public.mcp_submittal_items_write(uuid,uuid,uuid,jsonb)'::regprocedure; definition text; revised text;
BEGIN
  definition := pg_get_functiondef(routine);
  revised := replace(definition,
    $old$iid := nullif(item->>'id', '')::uuid;$old$,
    $new$iid := nullif(item->>'id', '')::uuid;
    IF iid IS NULL THEN
      SELECT p.id INTO iid FROM public.mcp_submittal_package_items p
      WHERE p.submittal_id = _submittal AND p.job_id = _job AND p.kind = kind AND lower(btrim(p.source_party)) = lower(party)
      ORDER BY p.created_at, p.id LIMIT 1;
    END IF;$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Submittal items format changed; review this migration before applying.'; END IF;
  EXECUTE revised;
END $patch$;

-- 4. The record page: one submittal number on one job, every revision, every file, every event.
--    Same access as the submittal log (full or super). download_url is returned only while the link works.
CREATE FUNCTION public.mcp_submittal_record_get(_job uuid, _number text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co text; sc text; zone text; key text; cur public.mcp_submittals; current_row jsonb; revisions jsonb; packages jsonb; mail jsonb; transmittals jsonb; events jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  key := lower(btrim(coalesce(_number, '')));
  IF key = '' THEN RAISE EXCEPTION 'MCP_BAD:Which submittal number?'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT name INTO co FROM public.mcp_companies WHERE id = j.company_id;
  zone := coalesce(nullif(btrim(j.time_zone), ''), 'America/New_York');
  SELECT * INTO cur FROM public.mcp_submittals WHERE job_id = _job AND lower(btrim(number)) = key ORDER BY revision DESC, id DESC LIMIT 1;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That submittal number is not on this job''s log.'; END IF;
  current_row := to_jsonb(cur) - 'company_id' - 'created_by'
    || jsonb_build_object(
      'transmittal_number', (SELECT number FROM public.mcp_transmittals WHERE id = cur.transmittal_id),
      'submission_sent_at', (SELECT max(p.sent_at) FROM public.mcp_submittal_packages p WHERE p.submittal_id = cur.id),
      'package_items', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'kind', p.kind, 'source_party', p.source_party, 'file_ref', p.file_ref,
          'status', p.status, 'required', p.required, 'requested_at', p.requested_at, 'received_at', p.received_at,
          'chase_role', p.chase_role, 'chase_name', p.chase_name, 'chase_email', p.chase_email,
          'last_chased_at', p.last_chased_at, 'next_chase_at', p.next_chase_at, 'chase_count', p.chase_count
        ) ORDER BY p.created_at, p.id)
        FROM public.mcp_submittal_package_items p WHERE p.submittal_id = cur.id
      ), '[]'::jsonb));
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'revision', s.revision, 'status', s.status, 'title', s.title, 'spec_section', s.spec_section,
      'transmittal_number', t.number, 'submitted_on', s.submitted_on, 'due_back', s.due_back, 'returned_on', s.returned_on,
      'ball_in_court', s.ball_in_court, 'ball_in_court_name', s.ball_in_court_name, 'created_at', s.created_at, 'updated_at', s.updated_at
    ) ORDER BY s.revision DESC, s.id DESC), '[]'::jsonb) INTO revisions
    FROM public.mcp_submittals s JOIN public.mcp_transmittals t ON t.id = s.transmittal_id
    WHERE s.job_id = _job AND lower(btrim(s.number)) = key;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'submittal_id', p.submittal_id, 'revision', s.revision, 'filename', p.filename, 'path', p.path,
      'size_bytes', p.size_bytes, 'page_count', p.page_count, 'cover_date', p.cover_date, 'created_at', p.created_at,
      'approved_at', p.approved_at, 'sent_at', p.sent_at, 'revoked_at', p.revoked_at, 'expires_at', p.expires_at,
      'download_url', CASE WHEN p.approved_at IS NOT NULL AND p.revoked_at IS NULL AND p.expires_at > now() THEN p.download_url END,
      'manifest', p.manifest
    ) ORDER BY p.created_at DESC), '[]'::jsonb) INTO packages
    FROM public.mcp_submittal_packages p JOIN public.mcp_submittals s ON s.id = p.submittal_id
    WHERE p.job_id = _job AND lower(btrim(s.number)) = key;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'submittal_id', m.submittal_id, 'revision', s.revision, 'kind', m.kind, 'package_id', m.package_id, 'package_item_id', m.package_item_id,
      'to', m.draft->>'to', 'subject', m.draft->>'subject', 'created_at', m.created_at, 'approved_at', m.approved_at,
      'sent_at', m.sent_at, 'provider', m.provider, 'message_id', m.message_id
    ) ORDER BY m.created_at DESC), '[]'::jsonb) INTO mail
    FROM public.mcp_submittal_mail m JOIN public.mcp_submittals s ON s.id = m.submittal_id
    WHERE m.job_id = _job AND lower(btrim(s.number)) = key;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'number', t.number, 'revision', s.revision, 'to_name', t.to_name, 'to_email', t.to_email, 'subject', t.subject, 'sent_on', t.sent_on, 'cover_note', t.cover_note
    ) ORDER BY t.number DESC), '[]'::jsonb) INTO transmittals
    FROM public.mcp_transmittals t JOIN public.mcp_submittals s ON s.transmittal_id = t.id
    WHERE t.job_id = _job AND lower(btrim(s.number)) = key;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'occurred_at', e.occurred_at, 'actor', e.actor, 'actor_name', mem.display_name, 'mine', e.actor_id IS NOT NULL AND e.actor_id = auth.uid(),
      'kind', e.kind, 'title', e.title, 'summary', e.summary, 'counterparty_name', e.counterparty_name, 'counterparty_email', e.counterparty_email,
      'ref_table', e.ref_table, 'ref_id', e.ref_id, 'host', e.host, 'thread_ref', e.thread_ref, 'payload', e.payload
    ) ORDER BY e.occurred_at DESC, e.id DESC), '[]'::jsonb) INTO events
    FROM public.mcp_project_record_events e
    LEFT JOIN public.mcp_company_members mem ON mem.company_id = e.company_id AND mem.user_id = e.actor_id
    WHERE e.job_id = _job AND (
      e.ref_id IN (SELECT s.id FROM public.mcp_submittals s WHERE s.job_id = _job AND lower(btrim(s.number)) = key)
      OR e.ref_id IN (SELECT s.transmittal_id FROM public.mcp_submittals s WHERE s.job_id = _job AND lower(btrim(s.number)) = key)
      OR e.ref_id IN (SELECT m.id FROM public.mcp_submittal_mail m JOIN public.mcp_submittals s ON s.id = m.submittal_id WHERE m.job_id = _job AND lower(btrim(s.number)) = key)
      OR (CASE WHEN e.payload->>'submittal_id' ~ '^[0-9a-fA-F-]{36}$' THEN (e.payload->>'submittal_id')::uuid END)
        IN (SELECT s.id FROM public.mcp_submittals s WHERE s.job_id = _job AND lower(btrim(s.number)) = key)
    );
  RETURN jsonb_build_object(
    'page', 'submittal', 'company_id', j.company_id, 'company', co, 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name, 'scope', sc,
    'read_only', sc <> 'full', 'review_days', j.submittal_review_days, 'time_zone', zone,
    'today', to_char((now() AT TIME ZONE zone)::date, 'YYYY-MM-DD'),
    'number', cur.number, 'current', current_row, 'revisions', revisions, 'packages', packages,
    'mail', mail, 'transmittals', transmittals, 'events', events
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_record_get(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_record_get(uuid, text) TO authenticated;

-- A cheap change stamp so the page re-reads only when the record moved.
CREATE FUNCTION public.mcp_submittal_record_stamp(_job uuid, _number text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; key text; s text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:No access.'; END IF;
  key := lower(btrim(coalesce(_number, '')));
  SELECT coalesce((SELECT max(updated_at)::text FROM public.mcp_submittals WHERE job_id = _job AND lower(btrim(number)) = key), '')
    || '|' || coalesce((SELECT max(p.updated_at)::text FROM public.mcp_submittal_package_items p JOIN public.mcp_submittals s ON s.id = p.submittal_id WHERE p.job_id = _job AND lower(btrim(s.number)) = key), '')
    || '|' || coalesce((SELECT count(*)::text || '|' || coalesce(max(p.sent_at)::text, '') || '|' || coalesce(max(p.approved_at)::text, '') || '|' || coalesce(max(p.revoked_at)::text, '') FROM public.mcp_submittal_packages p JOIN public.mcp_submittals s ON s.id = p.submittal_id WHERE p.job_id = _job AND lower(btrim(s.number)) = key), '')
    || '|' || coalesce((SELECT count(*)::text || '|' || coalesce(max(m.sent_at)::text, '') || '|' || coalesce(max(m.approved_at)::text, '') FROM public.mcp_submittal_mail m JOIN public.mcp_submittals s ON s.id = m.submittal_id WHERE m.job_id = _job AND lower(btrim(s.number)) = key), '')
    || '|' || coalesce((SELECT count(*)::text FROM public.mcp_project_record_events e WHERE e.job_id = _job AND (e.ref_table IN ('mcp_submittals', 'mcp_transmittals', 'mcp_submittal_mail') OR e.payload ? 'submittal_id')), '0')
  INTO s;
  RETURN coalesce(s, 'none');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_record_stamp(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_record_stamp(uuid, text) TO authenticated;

-- 5. The same board token that opens the submittal log opens its records. Same checks as mcp_board_link_open.
CREATE FUNCTION public.mcp_submittal_record_open(_token_hash text, _job uuid, _number text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_board_links; payload jsonb;
BEGIN
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  SELECT * INTO r FROM public.mcp_board_links WHERE token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF r.job_id <> _job THEN RETURN jsonb_build_object('status', 'wrong_job'); END IF;
  IF r.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF r.scope NOT IN ('full', 'super') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  PERFORM set_config('request.jwt.claim.sub', r.created_by::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', r.created_by::text, 'role', 'authenticated')::text, true);
  BEGIN
    payload := public.mcp_submittal_record_get(_job, _number);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'denied');
  END;
  INSERT INTO public.mcp_board_link_opens (link_id, job_id, page) VALUES (r.id, r.job_id, 'submittal');
  UPDATE public.mcp_board_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('status', 'ok', 'payload', payload);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_record_open(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_record_open(text, uuid, text) TO anon, authenticated;

COMMIT;
