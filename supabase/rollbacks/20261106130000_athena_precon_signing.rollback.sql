-- Rollback for 20261106130000_athena_precon_signing.sql.
-- 1. Puts the pre-con and client page functions back exactly as 20261106120000 (precon_json,
--    mcp_precon_invoice_share) and 20261106110000 (portal_item_label, mcp_portal_view) defined them. Pre-con
--    agreements then drop off the client page, and billing goes back to full or split.
-- 2. Drops the signing, terms, check and pickup functions and the trigger that withdraws a changed agreement.
-- 3. Kept, because they are the job's and the owner's record: the new agreement columns (payments, own terms,
--    construction line, client page item, signature), every client page item and decision with its consent
--    words, and every check request and pickup. The kind and decision checks are narrowed back only when no
--    pre-con items or signed decisions exist.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TRIGGER IF EXISTS mcp_precon_portal_guard ON public.mcp_precon_agreements;
DROP FUNCTION IF EXISTS mcp_private.precon_portal_guard();
DROP FUNCTION IF EXISTS public.mcp_precon_check_pickup(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_portal_check_request(uuid, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.mcp_portal_precon_sign(uuid, text, uuid, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.mcp_precon_portal_send(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_precon_terms_save(uuid, jsonb);

-- As in 20261106120000.
CREATE OR REPLACE FUNCTION mcp_private.precon_json(a public.mcp_precon_agreements) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parts jsonb; invs jsonb; first_cents bigint;
BEGIN
  parts := mcp_private.precon_parts(a.design_fee_cents, a.design_markup_bps, a.hourly_rate_cents, a.time_lines);
  first_cents := CASE WHEN a.billing = 'full' THEN a.price_cents ELSE (a.price_cents + 1) / 2 END;
  SELECT coalesce(jsonb_agg(mcp_private.precon_invoice_json(a.job_id, x) ORDER BY o), '[]'::jsonb) INTO invs
    FROM unnest(a.invoice_ids) WITH ORDINALITY u(x, o) WHERE mcp_private.precon_invoice_json(a.job_id, x) IS NOT NULL;
  RETURN jsonb_build_object(
    'id', a.id, 'job_id', a.job_id, 'version', a.version, 'status', a.status, 'phase', mcp_private.precon_phase(a),
    'design_partner', a.design_partner, 'design_role', a.design_role, 'design_fee_cents', a.design_fee_cents,
    'design_days', a.design_days, 'design_markup_bps', a.design_markup_bps, 'hourly_rate_cents', a.hourly_rate_cents,
    'time_lines', a.time_lines, 'includes', a.includes, 'billing', a.billing, 'owner_owns_drawings', a.owner_owns_drawings,
    'credit', a.credit, 'credit_days', a.credit_days,
    'credit_until', CASE WHEN a.credit AND a.drawings_approved_on IS NOT NULL THEN a.drawings_approved_on + a.credit_days END,
    'price_cents', a.price_cents, 'parts', parts,
    'installments', CASE WHEN a.billing = 'full'
      THEN jsonb_build_array(jsonb_build_object('when', 'signing', 'amount_cents', a.price_cents))
      ELSE jsonb_build_array(jsonb_build_object('when', 'signing', 'amount_cents', first_cents),
        jsonb_build_object('when', 'final_drawings', 'amount_cents', a.price_cents - first_cents)) END,
    'hours_used', a.hours_used, 'sent_on', a.sent_on, 'signed_on', a.signed_on, 'signed_name', a.signed_name,
    'signed_via', a.signed_via, 'drawings_approved_on', a.drawings_approved_on, 'outcome', a.outcome, 'closed_on', a.closed_on,
    'invoices', invs,
    'credit_change', CASE WHEN a.credit_change_id IS NULL THEN NULL ELSE mcp_private.precon_change_json(a.job_id, a.credit_change_id) END,
    'contract_sov', mcp_private.precon_has_sov(a.job_id),
    'note', a.note, 'updated_at', a.updated_at);
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_json(public.mcp_precon_agreements) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_precon_invoice_share(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; a public.mcp_precon_agreements; issued integer; total integer; idx integer; amt bigint; first_cents bigint;
  due date; num text; v jsonb; it public.mcp_portal_items; inc text; money text; parts_text text;
BEGIN
  j := mcp_private.precon_job(_job);
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('expected_version', 'due_on')) THEN
    RAISE EXCEPTION 'MCP_BAD:That invoice has details Athena doesn''t use.';
  END IF;
  IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Send the version you loaded.'; END IF;
  BEGIN
    due := nullif(_p->>'due_on', '')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'MCP_BAD:Write the due date as YYYY-MM-DD.';
  END;
  PERFORM pg_advisory_xact_lock(hashtext(j.id::text || ':precon'));
  SELECT * INTO a FROM public.mcp_precon_agreements WHERE job_id = j.id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This job has no pre-construction agreement.'; END IF;
  IF (_p->>'expected_version')::integer <> a.version THEN
    RAISE EXCEPTION 'MCP_BAD:The agreement changed since you loaded it (now version %). Load it again.', a.version;
  END IF;
  IF a.status NOT IN ('signed', 'closed') THEN RAISE EXCEPTION 'MCP_BAD:The owner hasn''t signed the agreement yet. Nothing was billed.'; END IF;
  IF a.price_cents <= 0 THEN RAISE EXCEPTION 'MCP_BAD:Price the agreement first. Nothing was billed.'; END IF;
  SELECT count(*) INTO issued FROM unnest(a.invoice_ids) x
    WHERE (SELECT v2.status FROM public.mcp_billing_invoice_versions v2 WHERE v2.invoice_id = x ORDER BY v2.version DESC LIMIT 1) IS DISTINCT FROM 'void';
  total := CASE WHEN a.billing = 'full' THEN 1 ELSE 2 END;
  IF issued >= total THEN RAISE EXCEPTION 'MCP_BAD:Every installment is already billed. Nothing was billed.'; END IF;
  idx := issued + 1;
  first_cents := CASE WHEN a.billing = 'full' THEN a.price_cents ELSE (a.price_cents + 1) / 2 END;
  amt := CASE WHEN idx = 1 THEN first_cents ELSE a.price_cents - first_cents END;
  IF idx = 2 AND a.drawings_approved_on IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:The second payment is due at final drawings, and they aren''t approved yet. Nothing was billed.';
  END IF;
  num := 'PC-' || j.job_number || '-' || idx;
  -- Another invoice may already hold that number (voided and redone): count up until one is free.
  WHILE EXISTS (SELECT 1 FROM public.mcp_billing_invoices WHERE job_id = j.id AND lower(document_number) = lower(num)) LOOP
    num := num || 'R';
    IF length(num) > 60 THEN RAISE EXCEPTION 'MCP_BAD:Too many invoices with that number on this job.'; END IF;
  END LOOP;
  money := regexp_replace(to_char(a.price_cents / 100.0, 'FM$999,999,999,990.00'), '\.00$', '');
  SELECT nullif(string_agg(x, ' · ' ORDER BY o), '') INTO inc FROM jsonb_array_elements_text(a.includes) WITH ORDINALITY e(x, o);
  parts_text := CASE WHEN total = 1 THEN 'Pre-construction agreement'
    WHEN idx = 1 THEN 'Pre-construction agreement, payment 1 of 2 (at signing)'
    ELSE 'Pre-construction agreement, payment 2 of 2 (at final drawings)' END;
  v := jsonb_build_object('number', num, 'stage', 'bill',
    'title', CASE WHEN total = 1 THEN 'Pre-construction · ' || j.name ELSE 'Pre-construction payment ' || idx || ' of 2 · ' || j.name END,
    'work_order', 'Pre-construction agreement',
    'site_address', NULL,
    'issue', left('Design and pre-construction for ' || j.name
      || CASE WHEN a.design_days IS NOT NULL THEN ', with about ' || a.design_days || ' days of design' ELSE '' END
      || '. The agreement totals ' || money
      || CASE WHEN total = 2 THEN ', paid half at signing and half when you approve the final drawings.' ELSE ', paid at signing.' END, 2000),
    'lines', jsonb_build_array(jsonb_build_object('description', parts_text, 'detail', inc, 'amount_cents', amt)),
    'signoff', NULL,
    'totals', jsonb_build_object('subtotal_cents', amt, 'credit_cents', 0, 'current_due_cents', amt),
    'note', CASE WHEN a.owner_owns_drawings THEN 'You own the drawings.' ELSE '' END
      || CASE WHEN a.credit THEN CASE WHEN a.owner_owns_drawings THEN ' ' ELSE '' END || 'If you hire us to build within '
        || a.credit_days || ' days of the final drawings, the full ' || money || ' is credited to the construction contract.' ELSE '' END);
  IF v->>'note' = '' THEN v := jsonb_set(v, '{note}', 'null'::jsonb); END IF;
  it := mcp_private.service_invoice_share(j, num, 'Pre-construction agreement, installment ' || idx || ' of ' || total, amt, amt, v, due);
  UPDATE public.mcp_precon_agreements SET invoice_ids = invoice_ids || it.ref_id, version = version + 1, updated_by = auth.uid(),
    updated_at = now() WHERE id = a.id RETURNING * INTO a;
  PERFORM public.mcp_project_record_add(j.id, 'precon_invoice_share', 'Pre-construction invoice ' || num,
    'Invoice ' || num || ' for ' || to_char(amt / 100.0, 'FM$999,999,999,990.00') || ' sent to the client page.',
    NULL, NULL, 'mcp_billing_invoices', it.ref_id, jsonb_build_object('amount_cents', amt, 'portal_item', it.id), 'user', NULL, NULL);
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'item_id', it.id, 'invoice_id', it.ref_id, 'number', num, 'label', v->>'title', 'amount_cents', amt, 'due_on', it.due_on,
    'recipients', mcp_private.service_recipients(j.id), 'agreement', mcp_private.precon_json(a));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_invoice_share(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_invoice_share(uuid, jsonb) TO authenticated;

-- As in 20261106110000.
CREATE OR REPLACE FUNCTION mcp_private.portal_item_label(_item uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN i.kind = 'change_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(i.view->>'number')
    WHEN i.kind = 'work_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind = 'service_invoice' THEN i.view->>'title' ELSE i.view->'proposal'->>'title' END
    FROM public.mcp_portal_items i WHERE i.id = _item
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_item_label(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
      'under_contract', mcp_private.gbb_job_under_contract(j.id), 'kind', j.job_kind,
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
          OR (i.kind = 'pay_app' AND mcp_private.portal_pay_app_open(i.job_id, i.ref_id, i.ref_version))
          OR (i.kind = 'work_order' AND EXISTS (SELECT 1 FROM public.mcp_work_orders w WHERE w.id = i.ref_id AND w.job_id = i.job_id
                AND w.version = i.ref_version AND w.state = 'sent'))
          OR (i.kind = 'service_invoice' AND mcp_private.service_invoice_open(i.job_id, i.ref_id, i.ref_version)))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_view(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_view(uuid, text, text, text) TO service_role;

DROP FUNCTION IF EXISTS mcp_private.portal_check_ok(public.mcp_portal_items);
DROP FUNCTION IF EXISTS mcp_private.precon_bill_next(public.mcp_precon_agreements, public.mcp_jobs, date);
DROP FUNCTION IF EXISTS mcp_private.precon_portal_view(public.mcp_precon_agreements, public.mcp_jobs);
DROP FUNCTION IF EXISTS mcp_private.precon_due_words(jsonb);
DROP FUNCTION IF EXISTS mcp_private.precon_schedule(public.mcp_precon_agreements);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mcp_portal_items WHERE kind = 'precon_agreement') THEN
    ALTER TABLE public.mcp_portal_items DROP CONSTRAINT IF EXISTS mcp_portal_items_kind_check;
    ALTER TABLE public.mcp_portal_items ADD CONSTRAINT mcp_portal_items_kind_check
      CHECK (kind IN ('change_order', 'selection', 'pay_app', 'work_order', 'service_invoice'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions WHERE decision = 'signed') THEN
    ALTER TABLE public.mcp_portal_decisions DROP CONSTRAINT IF EXISTS mcp_portal_decisions_decision_check;
    ALTER TABLE public.mcp_portal_decisions ADD CONSTRAINT mcp_portal_decisions_decision_check
      CHECK (decision IN ('approved', 'declined', 'chosen'));
  END IF;
END $$;
-- ALTER TABLE public.mcp_precon_agreements DROP COLUMN IF EXISTS payments, DROP COLUMN IF EXISTS own_terms,
--   DROP COLUMN IF EXISTS construction_line, DROP COLUMN IF EXISTS portal_item_id, DROP COLUMN IF EXISTS signed_decision_id;
-- DROP TABLE IF EXISTS public.mcp_portal_check_requests;
