-- Rollback for 20261105230000_athena_service_calls.sql.
-- 1. Puts the client page functions back exactly as their last earlier migrations defined them
--    (20261105181000, 20261105120000, 20261105150000 and 20261105190000). Shared work orders and service invoices
--    then drop off the client page.
-- 2. Drops the service call, work order, service rate and change order pricing functions and tables. Service call
--    jobs stay as plain jobs; their billing invoices, receipts and recorded payments stay on the job.
-- 3. Drops mcp_jobs.job_kind and mcp_jobs.contract_type (the contract types recorded are lost).
-- 4. Client page items and decisions are the customer's record and are KEPT. The kind check is narrowed back only
--    when no work order or service invoice items exist.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The name the customer reads for a shared item, the same words as mcp_portal_list.
CREATE OR REPLACE FUNCTION mcp_private.portal_item_label(_item uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN i.kind = 'change_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(i.view->>'number') ELSE i.view->'proposal'->>'title' END
    FROM public.mcp_portal_items i WHERE i.id = _item
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_item_label(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Lists pay applications with their label.
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
        'label', CASE WHEN i.kind = 'change_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
          WHEN i.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(i.view->>'number') ELSE i.view->'proposal'->>'title' END,
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

-- As in 20261104200100, plus pay applications that still match their current version.
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
                AND b.version = i.ref_version AND jsonb_typeof(b.body->'accepted') IS DISTINCT FROM 'object'))
          OR (i.kind = 'pay_app' AND mcp_private.portal_pay_app_open(i.job_id, i.ref_id, i.ref_version)))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_view(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_view(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_portal_decide(_access uuid, _session_hash text, _item uuid, _decision text, _choice text,
  _code_hash text, _typed_name text, _statement text, _fingerprint text, _note text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; chk text := 'not_needed'; did uuid; j public.mcp_jobs;
  s public.mcp_submittals; c public.mcp_change_orders; d jsonb; ev jsonb; co_count int; evidence text; stamp timestamptz := now();
  under boolean := false; diff numeric; seq int; tn int; tid uuid; tier_name text; pco text; pco_id uuid; sel_title text;
  pkg jsonb; days int := 0; added numeric := 0; base_name text; cur text; time_text text; co_lines jsonb; co_no text;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL FOR UPDATE;
  IF it.id IS NULL OR EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = it.id) THEN RETURN jsonb_build_object('status', 'not_open'); END IF;
  IF _fingerprint IS DISTINCT FROM it.fingerprint THEN RETURN jsonb_build_object('status', 'changed'); END IF;
  IF NOT ((it.kind IN ('change_order', 'pay_app') AND _decision IN ('approved', 'declined') AND _choice IS NULL)
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
    ELSIF it.kind = 'pay_app' THEN
      -- The customer's approval is recorded as their decision on exactly this frozen version. It does not certify the
      -- application, post billing or record a payment; the contractor records the actual certificate as before.
      IF NOT mcp_private.portal_pay_app_open(a.job_id, it.ref_id, it.ref_version) THEN RAISE EXCEPTION 'MCP_PORTAL_CHANGED'; END IF;
      PERFORM public.mcp_project_record_add(a.job_id, 'pay_application_customer_' || CASE WHEN _decision = 'approved' THEN 'approve' ELSE 'decline' END,
        mcp_private.portal_pay_app_label(it.view->>'number'),
        'Customer decision recorded on the customer page. The pay application, its certificate and billing are unchanged.',
        NULL, NULL, 'mcp_payment_applications', it.ref_id,
        jsonb_build_object('application_id', it.ref_id, 'version', it.ref_version, 'decision', _decision, 'portal_decision', did,
          'fingerprint', it.fingerprint), 'user');
    ELSE
      evidence := left('Chosen on the customer page by ' || btrim(_typed_name) || ' <' || a.email || '> with an emailed code. Decision '
        || did || ', fingerprint ' || it.fingerprint || '.', 500);
      PERFORM public.mcp_residential_selections_record_choice(a.job_id, it.ref_version, _choice, current_date, evidence);
      -- Under contract, a package that changes the price or the time is a change order, and the customer's
      -- signed choice approves it: the signed difference (products plus any added cost) and the stated time.
      -- Before a contract there is no change order; the signed choice sets the proposal price.
      under := mcp_private.gbb_job_under_contract(a.job_id);
      SELECT x INTO pkg FROM jsonb_array_elements(it.view->'proposal'->'packages') x WHERE x->>'tier' = _choice;
      diff := (pkg->>'difference_cents')::numeric;
      days := coalesce((pkg->>'schedule_days')::int, 0);
      added := coalesce((pkg->>'added_cents')::numeric, 0);
      IF under AND (coalesce(diff, 0) <> 0 OR days > 0) THEN
        tier_name := initcap(_choice);
        base_name := initcap(it.view->'proposal'->>'base_tier');
        cur := coalesce(it.view->'proposal'->>'currency', '');
        sel_title := left(coalesce(nullif(btrim(it.view->'proposal'->>'title'), ''), 'Selections'), 150);
        time_text := CASE WHEN days > 0 THEN 'The additional time necessary for this change is ' || days || CASE WHEN days = 1 THEN ' day.' ELSE ' days.' END
          ELSE 'No additional time is necessary for this change.' END;
        -- One line per selection whose product changes, plus the added cost, so the lines add up to the signed total.
        SELECT coalesce(jsonb_agg(jsonb_build_object('category', 'material',
            'description', left((sl->>'title') || ': ' || tier_name || ' · ' || coalesce(nullif(btrim(concat_ws(' ', sl->'options'->_choice->>'manufacturer', sl->'options'->_choice->>'model')), ''), sl->'options'->_choice->>'description'), 1000),
            'quantity', (sl->>'quantity')::numeric, 'unit', sl->>'unit',
            'source', 'Signed package choice, customer page decision ' || did,
            'amount_cents', (sl->'options'->_choice->>'difference_cents')::numeric)), '[]'::jsonb)
          INTO co_lines
          FROM jsonb_array_elements(it.view->'proposal'->'selections') sl
         WHERE coalesce((sl->'options'->_choice->>'difference_cents')::numeric, 0) <> 0;
        IF added <> 0 THEN
          co_lines := co_lines || jsonb_build_array(jsonb_build_object('category', 'other',
            'description', left(coalesce(nullif(btrim(pkg->>'added_note'), ''), 'Added cost for the ' || tier_name || ' package'), 1000),
            'source', 'Signed package choice, customer page decision ' || did, 'amount_cents', added));
        END IF;
        SELECT coalesce(max(substring(number FROM '[0-9]+$')::int), 0) + 1 INTO seq FROM public.mcp_submittals WHERE job_id = a.job_id AND number ~ '^PCO-[0-9]{1,8}$';
        SELECT coalesce(max(substring(details->>'co_number' FROM '[0-9]+$')::int), 0) + 1 INTO co_count
          FROM public.mcp_change_orders WHERE job_id = a.job_id AND details->>'co_number' ~ '^CO-[0-9]{1,8}$';
        SELECT coalesce(max(number), 0) + 1 INTO tn FROM public.mcp_transmittals WHERE job_id = a.job_id;
        INSERT INTO public.mcp_transmittals (company_id, job_id, number) VALUES (j.company_id, a.job_id, tn) RETURNING id INTO tid;
        INSERT INTO public.mcp_submittals (company_id, job_id, number, revision, transmittal_id, spec_section, title, submittal_type, status, ball_in_court, source, required, package_purpose, required_by, returned_on)
        VALUES (j.company_id, a.job_id, 'PCO-' || lpad(seq::text, greatest(3, length(seq::text)), '0'), 0, tid, '', left(tier_name || ' package: ' || sel_title, 200),
          'other', 'in_review', 'gc', 'user', true, 'change_order', NULL, (stamp AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'UTC'))::date) RETURNING * INTO s;
        ev := jsonb_build_object('by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
          'reference', 'Customer page decision ' || did, 'channel', 'customer_page', 'fingerprint', it.fingerprint,
          'email_code_verified', chk = 'ok');
        d := jsonb_build_object('state', 'approved', 'record_version', 1, 'origin', 'owner',
          'co_number', 'CO-' || lpad(co_count::text, greatest(3, length(co_count::text)), '0'),
          'condition', 'The customer chose the ' || tier_name || ' package for ' || sel_title || ' on the customer page and signed it with an emailed code.',
          'scope', 'Change from the ' || base_name || ' package to ' || tier_name || ' for ' || sel_title || ', approved by the customer for '
            || CASE WHEN diff < 0 THEN '-' ELSE '+' END || to_char(abs(diff) / 100, 'FM999,999,999,990.00') || ' ' || cur || '. ' || time_text,
          'references', jsonb_build_array(jsonb_build_object('kind', 'condition', 'citation', 'Customer page decision ' || did || ' (' || tier_name || ', fingerprint ' || it.fingerprint || ')')),
          'recipient_name', to_jsonb(a.name), 'recipient_email', to_jsonb(a.email), 'due_date', NULL, 'owner_number', NULL,
          'schedule_days', days, 'lines', co_lines, 'total_cents', diff, 'decision', ev,
          'customer_choice', jsonb_build_object('tier', _choice, 'difference_cents', diff, 'schedule_days', days, 'added_cents', added,
            'by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
            'reference', 'Customer page decision ' || did, 'channel', 'customer_page', 'fingerprint', it.fingerprint, 'email_code_verified', chk = 'ok'));
        INSERT INTO public.mcp_change_orders (submittal_id, job_id, details) VALUES (s.id, a.job_id, d);
        INSERT INTO public.mcp_change_history (submittal_id, job_id, record_version, action, snapshot, actor_id)
        VALUES (s.id, a.job_id, 1, 'approve', d, a.created_by);
        PERFORM public.mcp_project_record_add(a.job_id, 'change_order_approve', s.number || ' · ' || s.title,
          'Customer approved the change order by choosing a package on the customer page; commercial details require full job access.',
          NULL, NULL, 'mcp_submittals', s.id, jsonb_build_object('submittal_id', s.id, 'state', 'approved', 'portal_decision', did), 'user');
        pco := s.number; pco_id := s.id; co_no := d->>'co_number';
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
    'under_contract', under, 'difference_cents', diff, 'schedule_days', CASE WHEN it.kind = 'selection' THEN days END,
    'change_order_number', pco, 'change_order_id', pco_id, 'co_number', co_no,
    'label', CASE WHEN it.kind = 'change_order' THEN (it.view->>'number') || ' · ' || (it.view->>'title')
      WHEN it.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(it.view->>'number') ELSE it.view->'proposal'->>'title' END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) TO service_role;

-- Payment state of every shared item on the customer's page, so the page can show Pay, Processing or Paid.
CREATE OR REPLACE FUNCTION public.mcp_portal_payments_state(_access uuid, _session_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; cp public.mcp_company_payments;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL OR (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  SELECT * INTO cp FROM public.mcp_company_payments WHERE company_id = a.company_id;
  RETURN jsonb_build_object('status', 'ok',
    'accepting', coalesce(CASE WHEN cp.mode = 'live' THEN cp.status_live = 'ready' ELSE cp.status_test = 'ready' END, false),
    'test', coalesce(cp.mode, 'test') = 'test',
    'card', coalesce(cp.card_enabled, false), 'bank', coalesce(cp.bank_enabled, false), 'card_max_cents', coalesce(cp.card_max_cents, 0),
    'payments', coalesce((SELECT jsonb_agg(mcp_private.portal_payment_json(p) ORDER BY p.created_at DESC)
      FROM public.mcp_portal_payments p WHERE p.access_id IN (SELECT x.id FROM public.mcp_portal_access x WHERE x.job_id = a.job_id)
        AND p.status <> 'expired'), '[]'::jsonb),
    -- Wire and check payments the team recorded, per shared pay application: the total and the latest one.
    'recorded', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'amount_cents', r.total,
        'method', r.method, 'received_on', r.received_on) ORDER BY i.shared_at DESC)
      FROM public.mcp_portal_items i
      JOIN LATERAL (SELECT sum(x.amount_cents) AS total,
          CASE WHEN count(DISTINCT x.method) > 1 THEN 'mixed' ELSE min(x.method) END AS method, max(x.received_on) AS received_on
        FROM public.mcp_recorded_payments x WHERE x.invoice_id = i.ref_id AND x.job_id = i.job_id AND x.voided_at IS NULL) r ON r.total IS NOT NULL
      WHERE i.job_id = a.job_id AND i.kind = 'pay_app' AND i.withdrawn_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_payments_state(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_payments_state(uuid, text) TO service_role;

-- The customer asks to pay an approved pay application. Returns what the app server needs to open a Checkout
-- session on the contractor's account, or why it can't. An open session that can still be used is returned as is.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_start(_access uuid, _session_hash text, _item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; d public.mcp_portal_decisions;
  cp public.mcp_company_payments; j public.mcp_jobs; c public.mcp_companies; p public.mcp_portal_payments; due bigint; acct text;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL FOR UPDATE;
  IF it.id IS NULL OR it.kind <> 'pay_app' THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO d FROM public.mcp_portal_decisions WHERE item_id = it.id;
  IF d.decision IS DISTINCT FROM 'approved' THEN RETURN jsonb_build_object('status', 'not_approved'); END IF;
  due := nullif(it.view->'totals'->>'current_due_cents', '')::bigint
    - coalesce((SELECT sum(amount_cents) FROM public.mcp_recorded_payments
                 WHERE invoice_id = it.ref_id AND job_id = it.job_id AND voided_at IS NULL), 0);
  IF due IS NULL OR due <= 0 THEN RETURN jsonb_build_object('status', 'nothing_due'); END IF;
  SELECT * INTO cp FROM public.mcp_company_payments WHERE company_id = a.company_id;
  acct := CASE WHEN cp.mode = 'live' THEN cp.account_live ELSE cp.account_test END;
  IF acct IS NULL OR (CASE WHEN cp.mode = 'live' THEN cp.status_live ELSE cp.status_test END) <> 'ready' THEN
    RETURN jsonb_build_object('status', 'not_accepting');
  END IF;
  SELECT * INTO p FROM public.mcp_portal_payments WHERE item_id = it.id AND status IN ('open', 'processing', 'paid', 'partially_refunded');
  IF p.status IN ('processing', 'paid', 'partially_refunded') THEN RETURN jsonb_build_object('status', 'already_paid', 'payment', mcp_private.portal_payment_json(p)); END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO c FROM public.mcp_companies WHERE id = a.company_id;
  RETURN jsonb_build_object('status', 'ok', 'company_id', a.company_id, 'job_id', a.job_id, 'item_id', it.id, 'access_id', a.id,
    'mode', cp.mode, 'account_id', acct, 'amount_cents', due, 'email', a.email, 'customer', a.name,
    'label', mcp_private.portal_item_label(it.id), 'job_number', j.job_number, 'job_name', j.name, 'company', c.name,
    'card', cp.card_enabled AND due <= cp.card_max_cents, 'bank', cp.bank_enabled,
    'open_session', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('checkout_session_id', p.checkout_session_id,
      'methods', to_jsonb(p.methods), 'amount_cents', p.amount_cents, 'mode', p.mode, 'account_id', p.account_id, 'created_at', p.created_at) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_pay_start(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_pay_start(uuid, text, uuid) TO service_role;

-- Keeps the Checkout session the app server opened. An older open session for the same item is closed first: the
-- app server expires it at Stripe before calling this.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_opened(_item uuid, _access uuid, _mode text, _account text, _session text,
  _methods text[], _amount_cents bigint, _fee_cents bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it public.mcp_portal_items; p public.mcp_portal_payments;
BEGIN
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND kind = 'pay_app' FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Unknown pay application.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_portal_payments WHERE item_id = _item AND status IN ('processing', 'paid', 'partially_refunded')) THEN
    RAISE EXCEPTION 'MCP_BAD:This pay application is already paid.';
  END IF;
  UPDATE public.mcp_portal_payments SET status = 'expired', updated_at = now() WHERE item_id = _item AND status = 'open';
  INSERT INTO public.mcp_portal_payments (company_id, job_id, item_id, access_id, mode, account_id, checkout_session_id, methods, amount_cents, fee_cents)
  VALUES (it.company_id, it.job_id, it.id, _access, _mode, _account, _session, _methods, _amount_cents, _fee_cents) RETURNING * INTO p;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail)
  VALUES (_access, it.job_id, 'payment_started', jsonb_build_object('item', it.id, 'payment', p.id, 'amount_cents', _amount_cents, 'mode', _mode));
  RETURN jsonb_build_object('status', 'ok', 'payment_id', p.id);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_pay_opened(uuid, uuid, text, text, text, text[], bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_pay_opened(uuid, uuid, text, text, text, text[], bigint, bigint) TO service_role;

-- A Checkout session moved on, as the app server re-read it from Stripe: processing (a bank payment on its way),
-- paid, failed or expired. Paid books the money on the job: a billing receipt, applied to the pay application when
-- its billing record is submitted or certified and still has that much due. Repeats change nothing.
-- _amount_cents is what the customer paid (Stripe's amount_total); it must match the session's amount.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_update(_session text, _account text, _status text, _payment_intent text,
  _charge text, _method text, _amount_cents bigint, _fee_cents bigint, _paid_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_portal_payments; it public.mcp_portal_items; cp public.mcp_company_payments; j public.mcp_jobs;
  inv public.mcp_billing_invoices; v public.mcp_billing_invoice_versions; was text; rid uuid; aid uuid; applied bigint; label text;
BEGIN
  IF _status NOT IN ('processing', 'paid', 'failed', 'expired') THEN RAISE EXCEPTION 'MCP_BAD:Unknown payment status.'; END IF;
  SELECT * INTO p FROM public.mcp_portal_payments WHERE checkout_session_id = _session FOR UPDATE;
  IF p.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown_session'); END IF;
  IF p.account_id <> _account THEN RAISE EXCEPTION 'MCP_BAD:Payment account does not match.'; END IF;
  was := p.status;
  -- Final states don't move back; a refund has its own function.
  IF was IN ('paid', 'refunded', 'partially_refunded') OR (was IN ('failed', 'expired') AND _status <> 'paid')
     OR (was = 'processing' AND _status = 'processing') OR was = _status THEN
    RETURN jsonb_build_object('status', 'unchanged', 'payment_id', p.id, 'payment_status', was);
  END IF;
  IF _status IN ('processing', 'paid') THEN
    IF _payment_intent IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A paid session needs its payment.'; END IF;
    IF _amount_cents IS DISTINCT FROM p.amount_cents THEN RAISE EXCEPTION 'MCP_BAD:Paid amount does not match the session.'; END IF;
  END IF;
  -- An expired session that still got paid (a late bank payment) takes the item's active slot back.
  IF _status = 'paid' AND was IN ('failed', 'expired') THEN
    UPDATE public.mcp_portal_payments SET status = 'expired', updated_at = now() WHERE item_id = p.item_id AND id <> p.id AND status = 'open';
    IF EXISTS (SELECT 1 FROM public.mcp_portal_payments WHERE item_id = p.item_id AND id <> p.id AND status IN ('processing', 'paid', 'partially_refunded')) THEN
      RAISE EXCEPTION 'MCP_BAD:This pay application was paid twice; refund one of the payments in Stripe.';
    END IF;
  END IF;
  UPDATE public.mcp_portal_payments SET status = _status,
    payment_intent_id = coalesce(_payment_intent, payment_intent_id), charge_id = coalesce(_charge, charge_id),
    method = coalesce(_method, method), fee_cents = coalesce(_fee_cents, fee_cents),
    paid_at = CASE WHEN _status = 'paid' THEN coalesce(_paid_at, now()) ELSE paid_at END, updated_at = now()
   WHERE id = p.id RETURNING * INTO p;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = p.item_id;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = p.job_id;
  label := mcp_private.portal_item_label(it.id);
  IF _status = 'paid' THEN
    SELECT * INTO cp FROM public.mcp_company_payments WHERE company_id = p.company_id;
    rid := gen_random_uuid();
    INSERT INTO public.mcp_billing_receipts (id, job_id, company_id, receipt_date, source, amount_cents, recorded_by)
    VALUES (rid, p.job_id, p.company_id, (p.paid_at AT TIME ZONE 'UTC')::date,
      'Client page payment ' || p.payment_intent_id || CASE WHEN p.mode = 'test' THEN ' (Stripe test mode)' ELSE '' END || ' for ' || coalesce(label, 'pay application'),
      p.amount_cents, cp.connected_by);
    -- Apply it to the pay application's billing record when that record can take it.
    SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = it.ref_id AND job_id = p.job_id AND kind = 'pay_application';
    IF inv.id IS NOT NULL THEN
      SELECT * INTO v FROM public.mcp_billing_invoice_versions WHERE invoice_id = inv.id ORDER BY version DESC LIMIT 1;
      applied := coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE invoice_id = inv.id), 0);
      IF v.status IN ('submitted', 'certified') AND v.net_due_cents - public.mcp_billing_posted_credits(p.job_id, inv.id, NULL) - applied >= p.amount_cents THEN
        aid := gen_random_uuid();
        INSERT INTO public.mcp_billing_allocations (id, job_id, receipt_id, invoice_id, amount_cents, effective_date, source, recorded_by)
        VALUES (aid, p.job_id, rid, inv.id, p.amount_cents, (p.paid_at AT TIME ZONE 'UTC')::date, 'Client page payment ' || p.payment_intent_id, cp.connected_by);
      END IF;
    END IF;
    UPDATE public.mcp_portal_payments SET receipt_id = rid, allocation_id = aid WHERE id = p.id RETURNING * INTO p;
  END IF;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail)
  VALUES (p.access_id, p.job_id, 'payment_' || _status, jsonb_build_object('item', p.item_id, 'payment', p.id, 'amount_cents', p.amount_cents));
  RETURN jsonb_build_object('status', 'changed', 'payment_id', p.id, 'payment_status', p.status, 'was', was,
    'job_id', p.job_id, 'job_number', j.job_number, 'job_name', j.name, 'item_id', p.item_id, 'label', label,
    'customer', (SELECT name FROM public.mcp_portal_access WHERE id = p.access_id), 'amount_cents', p.amount_cents,
    'method', p.method, 'test', p.mode = 'test', 'applied', p.allocation_id IS NOT NULL, 'booked', p.receipt_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_pay_update(text, text, text, text, text, text, bigint, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_pay_update(text, text, text, text, text, text, bigint, bigint, timestamptz) TO service_role;

DROP FUNCTION IF EXISTS public.mcp_service_record_payment(uuid, uuid, uuid, text, bigint, date, text, text);
DROP FUNCTION IF EXISTS public.mcp_service_bill(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.mcp_work_order_log(uuid, uuid, integer, jsonb);
DROP FUNCTION IF EXISTS public.mcp_work_order_approve_on_site(uuid, uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.mcp_work_order_send(uuid, uuid, integer, date);
DROP FUNCTION IF EXISTS mcp_private.service_fee_credit(uuid, uuid);
DROP FUNCTION IF EXISTS public.mcp_work_order_save(uuid, uuid, integer, jsonb);
DROP FUNCTION IF EXISTS public.mcp_service_fee_request(uuid, date);
DROP FUNCTION IF EXISTS public.mcp_service_call_update(uuid, integer, jsonb);
DROP FUNCTION IF EXISTS public.mcp_service_calls_list(uuid, text);
DROP FUNCTION IF EXISTS public.mcp_service_call_get(uuid);
DROP FUNCTION IF EXISTS public.mcp_service_call_create(uuid, jsonb);
DROP FUNCTION IF EXISTS mcp_private.service_call_json(uuid);
DROP FUNCTION IF EXISTS public.mcp_service_rates_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_service_rates_get(uuid);
DROP FUNCTION IF EXISTS public.mcp_change_order_pricing_list(uuid);
DROP FUNCTION IF EXISTS public.mcp_change_order_pricing_set(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.mcp_job_terms(uuid);
DROP FUNCTION IF EXISTS public.mcp_job_contract_type_set(uuid, text);
DROP FUNCTION IF EXISTS mcp_private.service_recipients(uuid);
DROP FUNCTION IF EXISTS mcp_private.service_invoice_share(public.mcp_jobs, text, text, bigint, bigint, jsonb, date);
DROP FUNCTION IF EXISTS mcp_private.service_work_order_view(public.mcp_work_orders, public.mcp_service_calls, bigint);
DROP FUNCTION IF EXISTS mcp_private.service_terms(text, jsonb, bigint, bigint, bigint, boolean);
DROP FUNCTION IF EXISTS mcp_private.service_price(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS mcp_private.service_rates_json(uuid);
DROP FUNCTION IF EXISTS mcp_private.service_invoice_position(uuid);
DROP FUNCTION IF EXISTS mcp_private.service_invoice_open(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS mcp_private.service_job(uuid);
DROP FUNCTION IF EXISTS mcp_private.service_basis_label(text);
DROP FUNCTION IF EXISTS mcp_private.service_money(numeric);
DROP TABLE IF EXISTS public.mcp_change_order_pricing;
DROP TABLE IF EXISTS public.mcp_work_orders;
DROP TABLE IF EXISTS public.mcp_service_calls;
DROP TABLE IF EXISTS public.mcp_service_rates;
ALTER TABLE public.mcp_jobs DROP CONSTRAINT IF EXISTS mcp_jobs_contract_type_check;
ALTER TABLE public.mcp_jobs DROP CONSTRAINT IF EXISTS mcp_jobs_job_kind_check;
ALTER TABLE public.mcp_jobs DROP COLUMN IF EXISTS contract_type;
ALTER TABLE public.mcp_jobs DROP COLUMN IF EXISTS job_kind;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mcp_portal_items WHERE kind IN ('work_order', 'service_invoice')) THEN
    ALTER TABLE public.mcp_portal_items DROP CONSTRAINT IF EXISTS mcp_portal_items_kind_check;
    ALTER TABLE public.mcp_portal_items ADD CONSTRAINT mcp_portal_items_kind_check CHECK (kind IN ('change_order', 'selection', 'pay_app'));
  END IF;
END $$;
