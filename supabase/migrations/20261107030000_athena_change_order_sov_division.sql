-- A change order is filed under the job's own trade division, and a member can execute one on any base SOV.
-- Plain SQL for Lovable to apply; nothing in this repo applies it.
-- Rollback: supabase/rollbacks/20261107030000_athena_change_order_sov_division.rollback.sql.
--
-- Before:
--   * The SOV line a client-approved change order got took its division from the first two digits of the base SOV
--     line numbers. A job whose SOV lines are numbered 01, 02, 03 (with the trade in their cost codes, 26.01, 26.04)
--     has no division there, so job 2810's electrical CO-001 was filed as 01.001, under line 01 "Mobilization".
--   * A member executing any other approved change had to name a two-digit division, and execution refused any base
--     SOV whose lines are not numbered division.line (26.01): "Complete and verify every base SOV line before
--     executing a change." Athena in ChatGPT read that refusal as missing division classifications.
-- After:
--   * mcp_private.co_sov_division(job, spec section) picks the division once, for both paths: the division most
--     base lines sit in when they are numbered by division (26.01); otherwise the division most of their cost codes
--     name (26.04 is 26); otherwise the change's own spec section (26 05 19 is 26); otherwise the base line numbers'
--     first two digits, as before.
--   * The client-approved helper files its line there (job 2810: 26.001).
--   * mcp_change_record "execute" takes the member's division when they name one and that pick otherwise, and
--     accepts base SOV lines numbered 1, 01, 1.1 or 26.01, as long as each is known with a whole-cent, non-negative
--     value. The contract-value tie check and every other check stay as they are.
-- The data step (supabase/scripts/20261107030000_change_order_sov_line_refile.sql) moves a client-approved change
-- order's SOV line that was filed under the wrong division, when no pay application or billing document has been
-- recorded on the job since; run it after this file, as its own step.
-- Grants: both helpers are private (no role can call them directly).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION mcp_private.co_sov_division(_job uuid, _spec text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE div text;
BEGIN
  -- Base lines numbered by division (26.01, 26.02): the division most of them sit in.
  IF EXISTS (SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id = _job AND f.module = 'sov'
              AND NOT coalesce(f.value ? 'executed_change_order', false))
     AND NOT EXISTS (SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id = _job AND f.module = 'sov'
              AND NOT coalesce(f.value ? 'executed_change_order', false) AND f.key !~ '^[0-9]{2}[.][0-9]{2,3}$') THEN
    SELECT left(f.key, 2) INTO div FROM public.mcp_job_facts f
     WHERE f.job_id = _job AND f.module = 'sov' AND NOT coalesce(f.value ? 'executed_change_order', false)
     GROUP BY left(f.key, 2) ORDER BY count(*) DESC, left(f.key, 2) LIMIT 1;
    RETURN div;
  END IF;
  -- Base lines numbered 01, 02, 03: the division most of their cost codes name.
  SELECT left(code, 2) INTO div
    FROM public.mcp_job_facts f
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(f.value->'cost_codes') = 'array'
      THEN f.value->'cost_codes' ELSE '[]'::jsonb END) code
   WHERE f.job_id = _job AND f.module = 'sov' AND NOT coalesce(f.value ? 'executed_change_order', false)
     AND code ~ '^[0-9]{2}([^0-9]|$)'
   GROUP BY left(code, 2) ORDER BY count(*) DESC, left(code, 2) LIMIT 1;
  IF div IS NOT NULL THEN RETURN div; END IF;
  -- No cost codes: the change's own spec section.
  IF coalesce(_spec, '') ~ '^[0-9]{2}([^0-9]|$)' THEN RETURN left(_spec, 2); END IF;
  -- Otherwise the base line numbers' first two digits, as before.
  SELECT left(f.key, 2) INTO div FROM public.mcp_job_facts f
   WHERE f.job_id = _job AND f.module = 'sov' AND NOT coalesce(f.value ? 'executed_change_order', false) AND f.key ~ '^[0-9]{2}([.]|$)'
   GROUP BY left(f.key, 2) ORDER BY count(*) DESC, left(f.key, 2) LIMIT 1;
  RETURN div;
END $$;
REVOKE ALL ON FUNCTION mcp_private.co_sov_division(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.co_execute_client_approved(_submittal uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_change_orders; s public.mcp_submittals; d jsonb; dec jsonb; total numeric; actor uuid; did uuid;
  div text; item text; prior numeric; setup numeric; before_cents numeric; after_cents numeric; ev jsonb; v int;
BEGIN
  -- Its own savepoint: whatever goes wrong here leaves the change order approved and the client's decision saved.
  BEGIN
    SELECT * INTO c FROM public.mcp_change_orders WHERE submittal_id = _submittal FOR UPDATE;
    d := c.details;
    dec := d->'decision';
    IF c.submittal_id IS NULL OR d->>'state' IS DISTINCT FROM 'approved' OR dec->>'channel' IS DISTINCT FROM 'customer_page'
       OR dec->>'email_code_verified' IS DISTINCT FROM 'true' OR jsonb_typeof(d->'total_cents') IS DISTINCT FROM 'number'
       OR (d->>'total_cents')::numeric <> trunc((d->>'total_cents')::numeric) THEN
      RETURN false;
    END IF;
    SELECT * INTO s FROM public.mcp_submittals WHERE id = _submittal;
    IF s.id IS NULL OR EXISTS (SELECT 1 FROM public.mcp_submittals x WHERE x.job_id = s.job_id AND x.number = s.number AND x.revision > s.revision) THEN
      RETURN false;
    END IF;
    total := (d->>'total_cents')::numeric;

    -- The member who invited the client, as every client-page step on this record is stored.
    IF coalesce(dec->>'reference', '') ~ '[0-9a-fA-F-]{36}$' THEN
      did := substring(dec->>'reference' FROM '([0-9a-fA-F-]{36})$')::uuid;
      SELECT pa.created_by INTO actor FROM public.mcp_portal_decisions pd JOIN public.mcp_portal_access pa ON pa.id = pd.access_id
       WHERE pd.id = did;
    END IF;
    IF actor IS NULL THEN
      SELECT h.actor_id INTO actor FROM public.mcp_change_history h WHERE h.submittal_id = _submittal ORDER BY h.record_version DESC LIMIT 1;
    END IF;
    IF actor IS NULL THEN RETURN false; END IF;

    -- Contract value before and after, from the saved original contract, as the job board reads it.
    SELECT CASE WHEN jsonb_typeof(f.value) = 'number' THEN (f.value #>> '{}')::numeric END INTO prior
      FROM public.mcp_job_facts f WHERE f.job_id = c.job_id AND f.module = 'contract' AND f.key = 'executed_change_orders'
       AND f.status NOT IN ('unknown', 'na');
    SELECT round(regexp_replace(f.value #>> '{}', '[$,[:space:]]', '', 'g')::numeric * 100) INTO setup
      FROM public.mcp_job_facts f
     WHERE f.job_id = c.job_id AND f.module IN ('contract', 'budget', 'job', 'setup')
       AND f.key IN ('contract_value', 'contract_amount', 'original_contract', 'contract_sum', 'contract')
       AND f.status NOT IN ('unknown', 'na') AND jsonb_typeof(f.value) IN ('number', 'string')
       AND regexp_replace(f.value #>> '{}', '[$,[:space:]]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$'
     ORDER BY (f.module = 'contract') DESC, (f.key = 'contract_value') DESC LIMIT 1;
    before_cents := setup + round(coalesce(prior, 0) * 100);
    after_cents := before_cents + total;
    IF after_cents < 0 THEN RETURN false; END IF;

    -- With a base SOV, the change gets its own fee-included line in the job's own division, as a member's execution adds one.
    div := mcp_private.co_sov_division(c.job_id, s.spec_section);
    IF div IS NOT NULL THEN
      SELECT div || '.' || lpad(n::text, 3, '0') INTO item FROM generate_series(1, 999) n
       WHERE NOT EXISTS (SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id = c.job_id AND f.module = 'sov' AND f.key = div || '.' || lpad(n::text, 3, '0'))
       ORDER BY n LIMIT 1;
      IF item IS NOT NULL THEN
        INSERT INTO public.mcp_job_facts (job_id, module, key, value, status, source, internal_only, updated_by)
        VALUES (c.job_id, 'sov', item, jsonb_build_object('description', left((d->>'co_number') || ' · ' || s.title, 300),
          'billable_value', total / 100, 'executed_change_order', s.id, 'fee_included', true, 'cost_codes', '[]'::jsonb,
          'spec_section', s.spec_section), 'known', 'member_answer', true, actor);
      END IF;
    END IF;

    INSERT INTO public.mcp_job_facts (job_id, module, key, value, status, source, internal_only, updated_by)
    VALUES (c.job_id, 'contract', 'executed_change_orders', to_jsonb((round(coalesce(prior, 0) * 100) + total) / 100), 'known', 'member_answer', true, actor)
    ON CONFLICT (job_id, module, key) DO UPDATE SET value = EXCLUDED.value, status = 'known', updated_by = EXCLUDED.updated_by, updated_at = now();

    v := (d->>'record_version')::int + 1;
    ev := jsonb_build_object('by', dec->>'by', 'at', dec->>'at', 'reference', dec->>'reference', 'channel', 'customer_page',
      'authority', 'client_signed_approval', 'fingerprint', dec->'fingerprint', 'email_code_verified', true,
      'sov_item', to_jsonb(item), 'contract_before_cents', to_jsonb(before_cents), 'contract_after_cents', to_jsonb(after_cents));
    d := d || jsonb_build_object('state', 'executed', 'execution', ev, 'record_version', v);
    UPDATE public.mcp_change_orders SET details = d, updated_at = now() WHERE submittal_id = _submittal;
    INSERT INTO public.mcp_change_history (submittal_id, job_id, record_version, action, snapshot, actor_id)
    VALUES (_submittal, c.job_id, v, 'execute', d, actor);
    -- Written straight to the record so it reads as the client's step and lands after the approval in the timeline.
    INSERT INTO public.mcp_project_record_events (company_id, job_id, actor, actor_id, kind, title, summary, ref_table, ref_id, payload, occurred_at)
    VALUES (s.company_id, c.job_id, 'user', NULL, 'change_order_execute', left(s.number || ' · ' || s.title, 300),
      'Added to the contract by the client''s signed approval on the client page; commercial details require full job access.',
      'mcp_submittals', _submittal,
      jsonb_build_object('submittal_id', _submittal, 'state', 'executed') || CASE WHEN did IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('portal_decision', did) END,
      clock_timestamp());
    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Client-approved change order % stays approved: %', _submittal, SQLERRM;
    RETURN false;
  END;
END $$;
REVOKE ALL ON FUNCTION mcp_private.co_execute_client_approved(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A member's execution: the member's division when they name one, the job's own otherwise; any numbered base SOV.
DO $patch$
DECLARE routine regprocedure := 'public.mcp_change_record(uuid,text,jsonb)'::regprocedure; definition text; revised text;
BEGIN
  definition := pg_get_functiondef(routine);
  IF position('mcp_private.co_sov_division' IN definition) > 0 THEN RETURN; END IF;
  revised := replace(definition,
    $old$ev:=_p->'evidence';div:=_p->>'sov_division';$old$,
    $new$ev:=_p->'evidence';div:=coalesce(nullif(_p->>'sov_division',''),mcp_private.co_sov_division(_job,s.spec_section));$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Change-order execution division changed; review this migration before applying.'; END IF;
  definition := revised;
  revised := replace(definition,
    $old$f.key !~ '^[0-9]{2}\.[0-9]{2,3}$'$old$,
    $new$f.key !~ '^[0-9]{1,3}([.][0-9]{1,4})*$'$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Base SOV check changed; review this migration before applying.'; END IF;
  EXECUTE revised;
END $patch$;
