-- Customer page: a package choice follows the job's contract stage. Apply after
-- 20261104200000_athena_proposal_choice_stage.sql (it defines mcp_private.gbb_job_under_contract).
--
-- * mcp_portal_view reports job.under_contract so the page says "change order" only when it is one.
-- * mcp_portal_decide: a chosen package that changes the price on a job under contract drafts a PCO with the
--   signed choice (who, when, emailed code, decision id) attached, for the contractor to price and send.
--   Before a contract, no change order is made; the signed choice sets the proposal price, as before.
-- Plain SQL for Lovable to apply. Both functions keep their existing signatures and grants.

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
      'under_contract', mcp_private.gbb_job_under_contract(j.id),
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

CREATE OR REPLACE FUNCTION public.mcp_portal_decide(_access uuid, _session_hash text, _item uuid, _decision text, _choice text,
  _code_hash text, _typed_name text, _statement text, _fingerprint text, _note text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; chk text := 'not_needed'; did uuid; j public.mcp_jobs;
  s public.mcp_submittals; c public.mcp_change_orders; d jsonb; ev jsonb; co_count int; evidence text; stamp timestamptz := now();
  under boolean := false; diff numeric; seq int; tn int; tid uuid; tier_name text; pco text; pco_id uuid; sel_title text;
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
      -- Under contract, an upgrade is a change: draft the change order with the signed choice attached.
      -- Before a contract there is no change order; the signed choice sets the proposal price.
      under := mcp_private.gbb_job_under_contract(a.job_id);
      SELECT (x->>'difference_cents')::numeric INTO diff FROM jsonb_array_elements(it.view->'proposal'->'packages') x WHERE x->>'tier' = _choice;
      IF under AND coalesce(diff, 0) <> 0 THEN
        tier_name := initcap(_choice);
        sel_title := left(coalesce(nullif(btrim(it.view->'proposal'->>'title'), ''), 'Selections'), 150);
        SELECT coalesce(max(substring(number FROM '[0-9]+$')::int), 0) + 1 INTO seq FROM public.mcp_submittals WHERE job_id = a.job_id AND number ~ '^PCO-[0-9]{1,8}$';
        SELECT coalesce(max(number), 0) + 1 INTO tn FROM public.mcp_transmittals WHERE job_id = a.job_id;
        INSERT INTO public.mcp_transmittals (company_id, job_id, number) VALUES (j.company_id, a.job_id, tn) RETURNING id INTO tid;
        INSERT INTO public.mcp_submittals (company_id, job_id, number, revision, transmittal_id, spec_section, title, submittal_type, status, ball_in_court, source, required, package_purpose, required_by)
        VALUES (j.company_id, a.job_id, 'PCO-' || lpad(seq::text, greatest(3, length(seq::text)), '0'), 0, tid, '', left(tier_name || ' package: ' || sel_title, 200),
          'other', 'in_prep', 'gc', 'user', true, 'change_order', NULL) RETURNING * INTO s;
        d := jsonb_build_object('state', 'draft', 'record_version', 1, 'origin', 'owner',
          'condition', 'The customer chose the ' || tier_name || ' package for ' || sel_title || ' on the customer page and signed it with an emailed code.',
          'scope', 'Change from the base package to ' || tier_name || ' for ' || sel_title || '. The customer signed a package difference of '
            || CASE WHEN diff < 0 THEN '-' ELSE '' END || to_char(abs(diff) / 100, 'FM999,999,999,990.00') || ' ' || coalesce(it.view->'proposal'->>'currency', '') || '. Price this change order and send it to the customer for approval.',
          'references', jsonb_build_array(jsonb_build_object('kind', 'condition', 'citation', 'Customer page decision ' || did || ' (' || tier_name || ', fingerprint ' || it.fingerprint || ')')),
          'recipient_name', to_jsonb(a.name), 'recipient_email', to_jsonb(a.email), 'due_date', NULL, 'owner_number', NULL, 'schedule_days', NULL,
          'lines', '[]'::jsonb, 'total_cents', NULL,
          'customer_choice', jsonb_build_object('tier', _choice, 'difference_cents', diff, 'by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
            'reference', 'Customer page decision ' || did, 'channel', 'customer_page', 'fingerprint', it.fingerprint, 'email_code_verified', chk = 'ok'));
        INSERT INTO public.mcp_change_orders (submittal_id, job_id, details) VALUES (s.id, a.job_id, d);
        INSERT INTO public.mcp_change_history (submittal_id, job_id, record_version, action, snapshot, actor_id)
        VALUES (s.id, a.job_id, 1, 'create', d, a.created_by);
        pco := s.number; pco_id := s.id;
      END IF;
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
    'under_contract', under, 'difference_cents', diff, 'change_order_number', pco, 'change_order_id', pco_id,
    'label', CASE WHEN it.kind = 'change_order' THEN (it.view->>'number') || ' · ' || (it.view->>'title') ELSE it.view->'proposal'->>'title' END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) TO service_role;
