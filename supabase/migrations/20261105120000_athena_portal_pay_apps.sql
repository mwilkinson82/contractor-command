-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Stage only. Plain SQL for Lovable to apply; nothing in this repo applies it.
--
-- Customer page: payment applications. Needs 20261104200100_athena_portal_choice_stage.sql (the customer page as it
-- stands) and the payment application chain (drizzle 0057_sov_payment_applications, 0058 and 0059) first.
--
-- Before: the customer page shared change orders and Good/Better/Best selections.
-- After:
--   * mcp_portal_items also takes kind 'pay_app'.
--   * mcp_portal_share_pay_app (members with full job access, from chat) shares the current version of a ready or
--     submitted, complete payment application, with an optional approve-by date. The customer view is frozen when
--     shared, with the same SHA-256 fingerprint as a change order. It is a strict whitelist built field by field:
--     number, period, original contract, approved change orders, contract total, each SOV line's scheduled, previous,
--     this period, stored, completed to date and percent, and the totals (completed and stored, retainage percent and
--     amount, previously certified, due now). Nothing else from the application body, its calculation or its
--     provenance (fee basis, SOV facts, change order references, reasons, sources, evidence, working intent,
--     recorded_by) reaches the page.
--   * mcp_portal_view shows an undecided pay application only while that exact version is still the application's
--     current, ready or submitted version. A revision hides it until it is shared again.
--   * mcp_portal_decide takes 'approved' (fresh emailed code) or 'declined' on a pay application, with the typed name
--     and statement, exactly as for a change order. The decision is recorded with who, when, IP, browser and the
--     fingerprint, and a project record entry is added. It does not certify the application, post billing or record
--     a payment.
--   * mcp_portal_list labels pay applications.
-- Grants follow 0077: the member function is for authenticated only, customer functions stay service_role only, and
-- the private helpers are callable by nobody.
-- Rollback: supabase/rollbacks/20261105120000_athena_portal_pay_apps.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------- kinds ----------

DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.mcp_portal_items'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%change_order%' LOOP
    EXECUTE format('ALTER TABLE public.mcp_portal_items DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.mcp_portal_items ADD CONSTRAINT mcp_portal_items_kind_check
  CHECK (kind IN ('change_order', 'selection', 'pay_app'));

-- ---------- helpers (private) ----------

-- "Pay application 3"; a number that already says so ("Application 3", "Pay app 3") is kept as it is.
CREATE OR REPLACE FUNCTION mcp_private.portal_pay_app_label(_number text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN btrim(coalesce(_number, '')) ~* '^(pay[[:space:]]+)?app(lication)?\M' THEN btrim(_number)
    ELSE 'Pay application ' || ltrim(btrim(coalesce(_number, '')), '#') END
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_pay_app_label(text) FROM PUBLIC, anon, authenticated, service_role;

-- True while this version is still the application's current, finished, ready or submitted version on this job.
CREATE OR REPLACE FUNCTION mcp_private.portal_pay_app_open(_job uuid, _app uuid, _version bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_payment_application_versions v
      JOIN public.mcp_payment_applications h ON h.id = v.application_id AND h.job_id = _job
     WHERE v.application_id = _app AND v.version = _version AND v.job_id = _job
       AND v.working_state IS NULL AND v.body->>'state' IN ('ready', 'submitted')
       AND v.calculation->>'complete' = 'true'
       AND v.version = (SELECT max(x.version) FROM public.mcp_payment_application_versions x WHERE x.application_id = _app))
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_pay_app_open(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- The owner's view of a saved application version. Built field by field from the frozen body and calculation, so a
-- field added to either later can never reach the customer.
CREATE OR REPLACE FUNCTION mcp_private.portal_pay_app_view(_body jsonb, _calc jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE r jsonb; lines jsonb := '[]'::jsonb; c numeric; pw numeric; w numeric; st numeric; g numeric;
  contract numeric; orig numeric; raw jsonb; gross numeric; held numeric; prior numeric; due numeric;
  rates numeric[]; released numeric; pct numeric;
BEGIN
  IF jsonb_typeof(_calc->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(_calc->'rows') NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'MCP_BAD:This pay application has no work lines to show.';
  END IF;
  contract := nullif(_calc->>'contract_cents', '')::numeric;
  gross := nullif(_calc->>'gross_cents', '')::numeric;
  held := nullif(_calc->>'retained_cents', '')::numeric;
  prior := nullif(_calc->>'prior_certified_net_cents', '')::numeric;
  due := nullif(_calc->>'payment_due_cents', '')::numeric;
  IF contract IS NULL OR gross IS NULL OR held IS NULL OR prior IS NULL OR due IS NULL
     OR length(btrim(coalesce(_body->>'number', ''))) NOT BETWEEN 1 AND 120
     OR coalesce(_body->>'period_start', '') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(_body->>'period_end', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'MCP_BAD:Complete the pay application before sharing it.';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(_calc->'rows') LOOP
    c := nullif(r->>'scheduled_cents', '')::numeric; pw := nullif(r->>'prior_work_cents', '')::numeric;
    w := nullif(r->>'work_cents', '')::numeric; st := nullif(r->>'stored_cents', '')::numeric;
    IF c IS NULL OR pw IS NULL OR w IS NULL OR st IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Complete the pay application before sharing it.'; END IF;
    g := w + st;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'item', left(coalesce(r->>'item', ''), 40), 'description', left(coalesce(r->>'description', ''), 500),
      'scheduled_cents', c::bigint, 'previous_cents', pw::bigint, 'this_period_cents', (w - pw)::bigint,
      'stored_cents', st::bigint, 'completed_to_date_cents', g::bigint,
      'percent_complete', CASE WHEN c = 0 THEN NULL ELSE trim_scale(round(g * 100 / c, 1)) END));
  END LOOP;
  -- One rate when every line holds back the same rate and nothing is released; otherwise what is actually held.
  SELECT array_agg(DISTINCT b) INTO rates FROM (
    SELECT nullif(x->>'work_retainage_bps', '')::numeric AS b FROM jsonb_array_elements(_calc->'rows') x
    UNION ALL
    SELECT nullif(x->>'stored_retainage_bps', '')::numeric FROM jsonb_array_elements(_calc->'rows') x
     WHERE coalesce(nullif(x->>'stored_cents', '')::numeric, 0) <> 0 OR coalesce(nullif(x->>'prior_stored_cents', '')::numeric, 0) <> 0) q;
  SELECT coalesce(sum(nullif(x->>'release_cents', '')::numeric), 0) INTO released FROM jsonb_array_elements(_calc->'rows') x;
  pct := CASE WHEN cardinality(rates) = 1 AND rates[1] IS NOT NULL AND released = 0 THEN trim_scale(round(rates[1] / 100, 2))
              WHEN gross > 0 THEN trim_scale(round(held * 100 / gross, 1)) END;
  raw := _body->'snapshot'->'provenance'->'contract_fact'->'value';
  IF jsonb_typeof(raw) = 'number' AND (raw::text)::numeric >= 0 AND (raw::text)::numeric * 100 = trunc((raw::text)::numeric * 100)
     AND (raw::text)::numeric * 100 <= contract THEN
    orig := (raw::text)::numeric * 100;
  END IF;
  RETURN jsonb_build_object(
    'number', btrim(_body->>'number'), 'period_start', _body->>'period_start', 'period_end', _body->>'period_end',
    'original_contract_cents', orig::bigint, 'approved_changes_cents', (contract - orig)::bigint, 'contract_total_cents', contract::bigint,
    'lines', lines,
    'totals', jsonb_build_object('completed_and_stored_cents', gross::bigint, 'retainage_percent', pct, 'retainage_cents', held::bigint,
      'previous_certified_cents', prior::bigint, 'current_due_cents', due::bigint));
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_pay_app_view(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Refuses any pay application view that is not exactly the whitelist above.
CREATE OR REPLACE FUNCTION mcp_private.portal_pay_app_view_check(_v jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE top text[] := ARRAY['number', 'period_start', 'period_end', 'original_contract_cents', 'approved_changes_cents',
    'contract_total_cents', 'lines', 'totals'];
  line_keys text[] := ARRAY['item', 'description', 'scheduled_cents', 'previous_cents', 'this_period_cents', 'stored_cents',
    'completed_to_date_cents', 'percent_complete'];
  total_keys text[] := ARRAY['completed_and_stored_cents', 'retainage_percent', 'retainage_cents', 'previous_certified_cents',
    'current_due_cents'];
  l jsonb;
BEGIN
  IF jsonb_typeof(_v) IS DISTINCT FROM 'object' OR jsonb_typeof(_v->'lines') IS DISTINCT FROM 'array'
     OR jsonb_typeof(_v->'totals') IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k) FROM jsonb_object_keys(_v) k) IS NULL
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(_v) k WHERE k <> ALL (top))
     OR (SELECT count(*) FROM jsonb_object_keys(_v)) <> cardinality(top)
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(_v->'totals') k WHERE k <> ALL (total_keys))
     OR (SELECT count(*) FROM jsonb_object_keys(_v->'totals')) <> cardinality(total_keys) THEN
    RAISE EXCEPTION 'MCP_BAD:The pay application view is not the customer whitelist.';
  END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(_v->'lines') LOOP
    IF jsonb_typeof(l) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(l) k WHERE k <> ALL (line_keys))
       OR (SELECT count(*) FROM jsonb_object_keys(l)) <> cardinality(line_keys) THEN
      RAISE EXCEPTION 'MCP_BAD:The pay application view is not the customer whitelist.';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_pay_app_view_check(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- member function (the contractor, from chat) ----------

-- Shares the current version of a payment application, found by id or by its number on the job.
CREATE OR REPLACE FUNCTION public.mcp_portal_share_pay_app(_job uuid, _application uuid, _number text, _expected_version integer, _due_on date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; h public.mcp_payment_applications; v public.mcp_payment_application_versions; latest integer;
  v_view jsonb; it public.mcp_portal_items; today date;
BEGIN
  j := mcp_private.portal_full_job(_job);
  IF _application IS NOT NULL THEN
    SELECT * INTO h FROM public.mcp_payment_applications WHERE id = _application AND job_id = _job AND company_id = j.company_id;
  ELSIF length(btrim(coalesce(_number, ''))) BETWEEN 1 AND 120 THEN
    SELECT * INTO h FROM public.mcp_payment_applications
     WHERE job_id = _job AND company_id = j.company_id AND lower(btrim(number)) = lower(btrim(_number));
  END IF;
  IF h.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That pay application is not on this job.'; END IF;
  SELECT max(version) INTO latest FROM public.mcp_payment_application_versions WHERE application_id = h.id;
  IF _expected_version IS NOT NULL AND _expected_version IS DISTINCT FROM latest THEN
    RAISE EXCEPTION 'MCP_BAD:The pay application changed; read it again before sharing.';
  END IF;
  SELECT * INTO v FROM public.mcp_payment_application_versions WHERE application_id = h.id AND version = latest AND job_id = _job;
  IF v.application_id IS NULL OR v.working_state IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_BAD:This pay application is still a working draft. Review it and mark it ready or submitted before sharing.';
  END IF;
  IF v.body->>'state' IS DISTINCT FROM 'ready' AND v.body->>'state' IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'MCP_BAD:Only a ready or submitted pay application can go to the customer. A draft is not finished, and a certified one is already settled.';
  END IF;
  IF v.calculation->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'MCP_BAD:Complete the pay application before sharing it.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_portal_items i JOIN public.mcp_portal_decisions x ON x.item_id = i.id
              WHERE i.kind = 'pay_app' AND i.ref_id = h.id AND i.ref_version = latest) THEN
    RAISE EXCEPTION 'MCP_BAD:The customer already decided on this version of the pay application.';
  END IF;
  today := (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date;
  IF _due_on IS NOT NULL AND (_due_on < today OR _due_on > today + 366) THEN
    RAISE EXCEPTION 'MCP_BAD:Use an approve-by date from today to a year out.';
  END IF;
  v_view := mcp_private.portal_pay_app_view(v.body, v.calculation);
  PERFORM mcp_private.portal_pay_app_view_check(v_view);
  UPDATE public.mcp_portal_items i SET withdrawn_at = now(), withdrawn_by = auth.uid()
   WHERE i.kind = 'pay_app' AND i.job_id = _job AND i.ref_id = h.id AND i.ref_version <> latest AND i.withdrawn_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id);
  INSERT INTO public.mcp_portal_items (company_id, job_id, kind, ref_id, ref_version, view, fingerprint, due_on, shared_by)
  VALUES (j.company_id, _job, 'pay_app', h.id, latest, v_view, mcp_private.portal_fingerprint(v_view), _due_on, auth.uid())
  ON CONFLICT (kind, ref_id, ref_version) DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL, due_on = EXCLUDED.due_on
  RETURNING * INTO it;
  RETURN jsonb_build_object('item_id', it.id, 'kind', 'pay_app', 'application_id', h.id, 'version', latest,
    'number', v_view->>'number', 'label', mcp_private.portal_pay_app_label(v_view->>'number'), 'due_on', it.due_on,
    'view', v_view, 'fingerprint', it.fingerprint,
    'recipients', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', id, 'email', email, 'name', name)) FROM public.mcp_portal_access WHERE job_id = _job AND revoked_at IS NULL), '[]'::jsonb),
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id), 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_share_pay_app(uuid, uuid, text, integer, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_share_pay_app(uuid, uuid, text, integer, date) TO authenticated;

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

-- ---------- customer functions (the app server only) ----------

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

-- As in 20261104200100, plus approve (fresh code) or decline on a pay application.
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
    'label', CASE WHEN it.kind = 'change_order' THEN (it.view->>'number') || ' · ' || (it.view->>'title')
      WHEN it.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(it.view->>'number') ELSE it.view->'proposal'->>'title' END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) TO service_role;
