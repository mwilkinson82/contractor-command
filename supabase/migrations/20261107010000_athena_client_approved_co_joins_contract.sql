-- A change order the client approves on their client page joins the contract at once, for every member.
-- Plain SQL for Lovable to apply; nothing in this repo applies it.
-- Rollback: supabase/rollbacks/20261107010000_athena_client_approved_co_joins_contract.rollback.sql.
--
-- Before: the client's signed approval (emailed code, typed name, "I agree") left the change order "approved". It
-- reached the contract only when a member later executed it with a separate confirmed action, so the job board's
-- contract value stayed at the original amount.
-- After:
--   * mcp_private.co_execute_client_approved(submittal): when a change order is approved on the client page with a
--     verified emailed code, it is executed by that approval. The contract's executed change-order total goes up by
--     its amount; when the job has a base SOV, a fee-included SOV line is added in the division that holds most of
--     the base lines; the record moves to "executed", with the execution naming the client's approval, the SOV line
--     and the contract value before and after; the change-order history and the project record gain the step.
--     Anything that stops it (no verified code, a later revision, a credit larger than the contract) leaves the
--     change order approved, exactly as before, and the client's approval itself always stands.
--   * mcp_portal_decide calls it right after both kinds of client approval: a change order sent for approval, and
--     a Good, Better or Best pick that creates an approved change order on a job under contract.
--   * mcp_change_record "execute" (a member executing any other approved change) now adds to the saved executed
--     change-order total instead of recomputing it from SOV change lines only, so a client-approved change already
--     on the contract is never dropped from it.
--   * Every change order already approved on a client page with a verified code is executed now (job 2810's CO-001
--     among them).
-- Grants: the helper is private (no role can call it directly).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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

    -- With a base SOV, the change gets its own fee-included line, as a member's execution adds one.
    SELECT left(f.key, 2) INTO div FROM public.mcp_job_facts f
     WHERE f.job_id = c.job_id AND f.module = 'sov' AND NOT coalesce(f.value ? 'executed_change_order', false) AND f.key ~ '^[0-9]{2}([.]|$)'
     GROUP BY left(f.key, 2) ORDER BY count(*) DESC, left(f.key, 2) LIMIT 1;
    IF div IS NOT NULL THEN
      SELECT div || '.' || lpad(n::text, 3, '0') INTO item FROM generate_series(1, 999) n
       WHERE NOT EXISTS (SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id = c.job_id AND f.module = 'sov' AND f.key = div || '.' || lpad(n::text, 3, '0'))
       ORDER BY n LIMIT 1;
      IF item IS NOT NULL THEN
        INSERT INTO public.mcp_job_facts (job_id, module, key, value, status, source, internal_only)
        VALUES (c.job_id, 'sov', item, jsonb_build_object('description', left((d->>'co_number') || ' · ' || s.title, 300),
          'billable_value', total / 100, 'executed_change_order', s.id, 'fee_included', true, 'cost_codes', '[]'::jsonb,
          'spec_section', s.spec_section), 'known', 'member_answer', true);
      END IF;
    END IF;

    INSERT INTO public.mcp_job_facts (job_id, module, key, value, status, source, internal_only)
    VALUES (c.job_id, 'contract', 'executed_change_orders', to_jsonb((round(coalesce(prior, 0) * 100) + total) / 100), 'known', 'member_answer', true)
    ON CONFLICT (job_id, module, key) DO UPDATE SET value = EXCLUDED.value, status = 'known', updated_at = now();

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

-- The client page executes what the client approves, on both approval paths. Patched in place so every other rule
-- in the decision stays as it is.
DO $patch$
DECLARE routine regprocedure := 'public.mcp_portal_decide(uuid,text,uuid,text,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text; revised text;
BEGIN
  definition := pg_get_functiondef(routine);
  IF position('mcp_private.co_execute_client_approved' IN definition) > 0 THEN RETURN; END IF;
  revised := replace(definition,
    $old$jsonb_build_object('submittal_id', s.id, 'state', d->>'state', 'portal_decision', did), 'user');$old$,
    $new$jsonb_build_object('submittal_id', s.id, 'state', d->>'state', 'portal_decision', did), 'user');
      IF _decision = 'approved' THEN PERFORM mcp_private.co_execute_client_approved(s.id); END IF;$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Client change-order approval changed; review this migration before applying.'; END IF;
  definition := revised;
  revised := replace(definition,
    $old$        pco := s.number; pco_id := s.id; co_no := d->>'co_number';$old$,
    $new$        PERFORM mcp_private.co_execute_client_approved(s.id);
        pco := s.number; pco_id := s.id; co_no := d->>'co_number';$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Package-pick change order changed; review this migration before applying.'; END IF;
  EXECUTE revised;
END $patch$;

-- A member's execution adds to the saved executed total, so a client-approved change already on it stays counted.
DO $patch$
DECLARE routine regprocedure := 'public.mcp_change_record(uuid,text,jsonb)'::regprocedure; definition text; revised text;
BEGIN
  definition := pg_get_functiondef(routine);
  IF position('executed_total_kept' IN definition) > 0 THEN RETURN; END IF;
  revised := replace(definition,
    $old$VALUES(_job,'contract','executed_change_orders',to_jsonb((delta_cents+(d->>'total_cents')::numeric)/100),'known','member_answer',true)$old$,
    $new$VALUES(_job,'contract','executed_change_orders',to_jsonb((coalesce((SELECT round((f.value #>> '{}')::numeric*100) FROM public.mcp_job_facts f WHERE f.job_id=_job AND f.module='contract' AND f.key='executed_change_orders' AND jsonb_typeof(f.value)='number' AND f.status NOT IN('unknown','na')),delta_cents)+(d->>'total_cents')::numeric)/100),'known','member_answer',true) /* executed_total_kept */$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Change-order execution changed; review this migration before applying.'; END IF;
  EXECUTE revised;
END $patch$;

-- Change orders the client already approved on their client page join the contract now.
DO $backfill$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.submittal_id FROM public.mcp_change_orders c
     WHERE c.details->>'state' = 'approved' AND c.details->'decision'->>'channel' = 'customer_page'
       AND c.details->'decision'->>'email_code_verified' = 'true'
     ORDER BY c.updated_at
  LOOP
    IF mcp_private.co_execute_client_approved(r.submittal_id) THEN n := n + 1; END IF;
  END LOOP;
  RAISE NOTICE 'Client-approved change orders added to their contracts: %', n;
END $backfill$;
