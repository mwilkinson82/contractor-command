-- A change order the client already approved on their client page joins the contract even when nobody is signed in.
-- Plain SQL for Lovable to apply; nothing in this repo applies it.
-- Rollback: supabase/rollbacks/20261107020000_athena_client_approved_co_saved_by_inviter.rollback.sql.
--
-- Before: mcp_private.co_execute_client_approved (20261107010000) wrote the job's contract facts without naming who
-- saved them, so the row took the signed-in member from auth.uid(). On the client page that is the inviting member,
-- so a new approval worked. The one-time cleanup of change orders approved before it runs with nobody signed in:
-- mcp_job_facts.updated_by came out null, the insert failed, the helper's own savepoint kept the change order
-- approved, and the cleanup reported nothing (job 2810's CO-001 stayed approved at $480,000.00).
-- After: both contract facts the helper writes (the executed change-order total and the change's SOV line) are saved
-- by the member who invited the client, the same person the change-order history names. Nothing else changes.
-- The cleanup below is data only: run it after the function, as its own step. It executes every change order that
-- was approved on a client page with a verified emailed code and is still approved, and lists any that stay approved.
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
