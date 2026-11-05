-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Stage only. Plain SQL for Lovable to apply; nothing in this repo applies it.
--
-- Good, Better, Best: time and added cost on each upgrade, and a client pick on a contracted job that approves the
-- change order. Needs 20261105120000_athena_portal_pay_apps.sql (the customer page as it stands) first.
--
-- Before: a Better or Best pick on a job under contract drafted a change order with no lines, no total and the
-- schedule "not determined", and told the contractor to price it and send it to the customer again. Time was blank.
-- After:
--   * The board's proposal may carry change_terms: per upgrade tier, schedule_days (0 to 3650), added_cents (cost
--     beyond the package difference) and added_note, plus reviewed_on. All 0 by default; the base tier never adds any.
--   * The customer view's packages carry schedule_days, added_cents and added_note, and the package difference
--     includes the added cost.
--   * Under contract, a pick that changes the price or adds time creates an approved change order: the signed
--     difference as its total, one material line per selection that changes plus an added-cost line, the stated
--     days, the customer's signed decision and a CO number. The customer saw the time sentence before confirming.
--   * Grants are unchanged: the board functions stay private and mcp_portal_decide stays service_role only.

CREATE OR REPLACE FUNCTION mcp_private.validate_residential_selection_board(_body jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE item jsonb; opt jsonb; p jsonb; tier text; bullet jsonb; ids text[] := '{}'; id text; q numeric; ct jsonb; t jsonb;
BEGIN
  IF jsonb_typeof(_body) IS DISTINCT FROM 'object'
     OR _body - ARRAY['currency','proposal','selections','accepted'] <> '{}'::jsonb
     OR NOT _body ?& ARRAY['currency','proposal','selections','accepted']
     OR (_body->'currency' <> 'null'::jsonb AND (jsonb_typeof(_body->'currency') <> 'string' OR _body->>'currency' !~ '^[A-Z]{3}$'))
     OR jsonb_typeof(_body->'selections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(_body->'selections') > 100
     OR (_body->'accepted' <> 'null'::jsonb AND jsonb_typeof(_body->'accepted') <> 'object')
     OR octet_length(_body::text) > 1000000 THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid selections board.';
  END IF;

  p := _body->'proposal';
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - ARRAY['title','intro','base_price_cents','base_tier','base_reviewed_on','base_basis','valid_until','terms','change_terms'] <> '{}'::jsonb
     OR NOT p ?& ARRAY['title','intro','base_price_cents','base_tier','base_reviewed_on','base_basis','valid_until','terms']
     OR NOT mcp_private.gbb_is_text(p->'title', 160) OR NOT mcp_private.gbb_is_text(p->'intro', 1200)
     OR NOT mcp_private.gbb_is_text(p->'base_basis', 300) OR NOT mcp_private.gbb_is_text(p->'terms', 2000)
     OR jsonb_typeof(p->'base_tier') IS DISTINCT FROM 'string' OR p->>'base_tier' NOT IN ('good','better','best') THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid proposal details.';
  END IF;
  IF NOT mcp_private.gbb_is_cents(p->'base_price_cents', 999999999999) THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid base price.';
  END IF;
  IF NOT mcp_private.gbb_is_date(p->'base_reviewed_on') OR NOT mcp_private.gbb_is_date(p->'valid_until') THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid proposal date.';
  END IF;
  IF p->'base_reviewed_on' <> 'null'::jsonb AND p->'base_price_cents' = 'null'::jsonb THEN
    RAISE EXCEPTION 'MCP_BAD:A base price must be set before it can be marked reviewed.';
  END IF;
  -- Optional: each package's extra schedule days and added cost (whole cents) beyond its products.
  IF p ? 'change_terms' THEN
    ct := p->'change_terms';
    IF jsonb_typeof(ct) IS DISTINCT FROM 'object'
       OR ct - ARRAY['good','better','best','reviewed_on'] <> '{}'::jsonb
       OR NOT ct ?& ARRAY['good','better','best','reviewed_on']
       OR NOT mcp_private.gbb_is_date(ct->'reviewed_on') THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid time and added cost.';
    END IF;
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      t := ct->tier;
      IF jsonb_typeof(t) IS DISTINCT FROM 'object'
         OR t - ARRAY['schedule_days','added_cents','added_note'] <> '{}'::jsonb
         OR NOT t ?& ARRAY['schedule_days','added_cents','added_note']
         OR jsonb_typeof(t->'schedule_days') IS DISTINCT FROM 'number' OR (t->>'schedule_days') !~ '^(0|[1-9][0-9]{0,3})$'
         OR jsonb_typeof(t->'added_cents') IS DISTINCT FROM 'number' OR NOT mcp_private.gbb_is_cents(t->'added_cents', 999999999999)
         OR NOT mcp_private.gbb_is_text(t->'added_note', 300) THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid time and added cost.';
      END IF;
      IF (t->>'schedule_days')::int > 3650 THEN RAISE EXCEPTION 'MCP_BAD:Invalid time and added cost.'; END IF;
    END LOOP;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR item - ARRAY['id','title','decision_due','allowance_cents','quantity','unit','estimate_line_ref','options','selected','notes'] <> '{}'::jsonb
       OR NOT item ?& ARRAY['id','title','decision_due','allowance_cents','quantity','unit','estimate_line_ref','options','selected','notes']
       OR jsonb_typeof(item->'id') <> 'string'
       OR (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT mcp_private.gbb_is_text(item->'title', 160) OR length(btrim(item->>'title')) = 0
       OR NOT mcp_private.gbb_is_text(item->'notes', 2000)
       OR NOT mcp_private.gbb_is_text(item->'unit', 20) OR length(btrim(item->>'unit')) = 0
       OR (item->'estimate_line_ref' <> 'null'::jsonb AND (jsonb_typeof(item->'estimate_line_ref') <> 'string' OR item->>'estimate_line_ref' !~ '^T-[1-9][0-9]{0,5}$'))
       OR jsonb_typeof(item->'options') IS DISTINCT FROM 'object'
       OR (item->'options') - ARRAY['good','better','best'] <> '{}'::jsonb
       OR NOT (item->'options') ?& ARRAY['good','better','best'] THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid selection.';
    END IF;
    id := lower(item->>'id');
    IF id = ANY(ids) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate selection ID.'; END IF;
    ids := array_append(ids, id);
    IF jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Invalid quantity.'; END IF;
    q := (item->>'quantity')::numeric;
    IF q <= 0 OR q > 1000000 OR q <> round(q, 3) THEN RAISE EXCEPTION 'MCP_BAD:Invalid quantity.'; END IF;
    IF NOT mcp_private.gbb_is_date(item->'decision_due') THEN RAISE EXCEPTION 'MCP_BAD:Invalid decision date.'; END IF;
    IF NOT mcp_private.gbb_is_cents(item->'allowance_cents', 999999999999) THEN RAISE EXCEPTION 'MCP_BAD:Invalid allowance.'; END IF;
    IF item->'selected' <> 'null'::jsonb AND (jsonb_typeof(item->'selected') <> 'string' OR item->>'selected' NOT IN ('good','better','best')) THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid selected option.';
    END IF;
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      opt := item->'options'->tier;
      IF jsonb_typeof(opt) IS DISTINCT FROM 'object'
         OR opt - ARRAY['description','manufacturer','model','specifications','included','product_url','source_url','photo_url','found_price_cents','found_at','found_on','cost_cents','price_cents','price_reviewed_on','assumptions'] <> '{}'::jsonb
         OR NOT opt ?& ARRAY['description','manufacturer','model','specifications','included','product_url','source_url','photo_url','found_price_cents','found_at','found_on','cost_cents','price_cents','price_reviewed_on','assumptions']
         OR NOT mcp_private.gbb_is_text(opt->'description', 500) OR NOT mcp_private.gbb_is_text(opt->'manufacturer', 120)
         OR NOT mcp_private.gbb_is_text(opt->'model', 120) OR NOT mcp_private.gbb_is_text(opt->'specifications', 2000)
         OR NOT mcp_private.gbb_is_text(opt->'assumptions', 1000) OR NOT mcp_private.gbb_is_text(opt->'found_at', 160)
         OR jsonb_typeof(opt->'included') IS DISTINCT FROM 'array' OR jsonb_array_length(opt->'included') > 12 THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid selection option.';
      END IF;
      FOR bullet IN SELECT value FROM jsonb_array_elements(opt->'included') LOOP
        IF NOT mcp_private.gbb_is_text(bullet, 160) OR length(btrim(bullet #>> '{}')) = 0 THEN
          RAISE EXCEPTION 'MCP_BAD:Invalid included item.';
        END IF;
      END LOOP;
      IF NOT mcp_private.gbb_is_cents(opt->'cost_cents', 100000000000) OR NOT mcp_private.gbb_is_cents(opt->'price_cents', 100000000000)
         OR NOT mcp_private.gbb_is_cents(opt->'found_price_cents', 100000000000) THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid option amount.';
      END IF;
      IF NOT mcp_private.gbb_is_url(opt->'product_url') OR NOT mcp_private.gbb_is_url(opt->'source_url')
         OR NOT mcp_private.gbb_is_url(opt->'photo_url') THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid product, source or photo link.';
      END IF;
      IF NOT mcp_private.gbb_is_date(opt->'price_reviewed_on') OR NOT mcp_private.gbb_is_date(opt->'found_on') THEN RAISE EXCEPTION 'MCP_BAD:Invalid review date.'; END IF;
      IF opt->'price_reviewed_on' <> 'null'::jsonb AND opt->'price_cents' = 'null'::jsonb THEN
        RAISE EXCEPTION 'MCP_BAD:A price must be set before it can be marked reviewed.';
      END IF;
      IF item->>'selected' = tier AND length(btrim(opt->>'description')) = 0 THEN
        RAISE EXCEPTION 'MCP_BAD:The selected option needs a description.';
      END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION mcp_private.validate_residential_selection_board(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.gbb_customer_proposal(_body jsonb, _version bigint) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE p jsonb := _body->'proposal'; item jsonb; opt jsonb; tier text; base_tier text; delta numeric; terms jsonb;
  total numeric; packages jsonb := '[]'::jsonb; selections jsonb := '[]'::jsonb; options jsonb; missing text[] := '{}';
BEGIN
  PERFORM mcp_private.validate_residential_selection_board(_body);
  base_tier := p->>'base_tier';
  IF _body->'currency' = 'null'::jsonb THEN missing := array_append(missing, 'currency'); END IF;
  IF length(btrim(p->>'title')) = 0 THEN missing := array_append(missing, 'title'); END IF;
  IF p->'base_price_cents' = 'null'::jsonb OR p->'base_reviewed_on' = 'null'::jsonb THEN missing := array_append(missing, 'reviewed base price'); END IF;
  IF jsonb_array_length(_body->'selections') = 0 THEN missing := array_append(missing, 'selections'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      opt := item->'options'->tier;
      IF length(btrim(opt->>'description')) = 0 OR opt->'price_cents' = 'null'::jsonb OR opt->'price_reviewed_on' = 'null'::jsonb
         OR coalesce(opt->>'photo_url', '') !~ '^https://' THEN
        missing := array_append(missing, (item->>'title') || ' (' || tier || ')');
      END IF;
    END LOOP;
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'MCP_BAD:Proposal is not ready. Missing, unreviewed or without a product photo: %', array_to_string(missing[1:10], ', ');
  END IF;

  FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
    delta := 0;
    -- The base package is the contract scope: it never adds time or cost. Older boards have no terms.
    terms := CASE WHEN tier <> base_tier AND jsonb_typeof(p->'change_terms') = 'object' THEN p->'change_terms'->tier
      ELSE jsonb_build_object('schedule_days', 0, 'added_cents', 0, 'added_note', '') END;
    delta := delta + (terms->>'added_cents')::numeric;
    FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
      delta := delta + mcp_private.gbb_extended(item->'quantity', item->'options'->tier->'price_cents')
                     - mcp_private.gbb_extended(item->'quantity', item->'options'->base_tier->'price_cents');
    END LOOP;
    total := (p->>'base_price_cents')::numeric + delta;
    IF total < 0 OR total > 999999999999 OR abs(delta) > 999999999999 THEN
      RAISE EXCEPTION 'MCP_BAD:A package total is out of range.';
    END IF;
    packages := packages || jsonb_build_array(jsonb_build_object('tier', tier, 'total_cents', total, 'difference_cents', delta,
      'schedule_days', (terms->>'schedule_days')::int, 'added_cents', (terms->>'added_cents')::numeric, 'added_note', btrim(terms->>'added_note')));
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
    options := '{}'::jsonb;
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      opt := item->'options'->tier;
      options := options || jsonb_build_object(tier, jsonb_build_object(
        'description', opt->'description', 'manufacturer', opt->'manufacturer', 'model', opt->'model',
        'specifications', opt->'specifications', 'included', opt->'included',
        'photo_url', opt->'photo_url',
        'difference_cents', round(mcp_private.gbb_extended(item->'quantity', opt->'price_cents')
                                - mcp_private.gbb_extended(item->'quantity', item->'options'->base_tier->'price_cents'))));
    END LOOP;
    selections := selections || jsonb_build_array(jsonb_build_object('id', item->'id', 'title', item->'title',
      'quantity', item->'quantity', 'unit', item->'unit', 'options', options));
  END LOOP;

  RETURN jsonb_build_object(
    'currency', _body->'currency', 'title', p->'title', 'intro', p->'intro', 'terms', p->'terms',
    'valid_until', p->'valid_until', 'base_tier', p->'base_tier', 'packages', packages, 'selections', selections,
    'accepted', CASE WHEN jsonb_typeof(_body->'accepted') = 'object' AND (_body->'accepted'->>'board_version')::bigint = _version
      THEN jsonb_build_object('tier', _body->'accepted'->'tier', 'recorded_on', _body->'accepted'->'recorded_on') END);
END $$;
REVOKE ALL ON FUNCTION mcp_private.gbb_customer_proposal(jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;

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
