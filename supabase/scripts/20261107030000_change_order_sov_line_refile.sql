-- Data only. Run after migration 20261107030000 (the job's own division for change-order SOV lines), as its own step.
-- A change order the client approved on their client page got its SOV line from the base line numbers' first two
-- digits. Where the job's own division is another one (job 2810's electrical CO-001 sat at 01.001, under line 01
-- "Mobilization"), the line moves to the next free line in that division (26.001), and the change order's execution
-- record names the new line. Only the line's number changes: its amount, its description and the contract value
-- stay exactly as they are. A line is left where it is once any pay application or billing document has been
-- recorded on the job since the line was added, because that document already shows it under its number.
-- Safe to run again: a line already in the job's division is skipped.
DO $refile$
DECLARE r record; todo jsonb; want text; item text; billed boolean; moved text[] := '{}'; kept text[] := '{}';
BEGIN
  -- Read the lines first, so no read of the facts is open while their lock is lifted below.
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.at), '[]'::jsonb) INTO todo FROM (
    SELECT c.submittal_id, c.job_id, s.spec_section, s.number, j.job_number, f.id AS fact_id, f.key, f.updated_at, c.updated_at AS at
      FROM public.mcp_change_orders c
      JOIN public.mcp_submittals s ON s.id = c.submittal_id
      JOIN public.mcp_jobs j ON j.id = c.job_id
      JOIN public.mcp_job_facts f ON f.job_id = c.job_id AND f.module = 'sov' AND f.key = c.details->'execution'->>'sov_item'
       AND f.value->>'executed_change_order' = c.submittal_id::text
     WHERE c.details->>'state' = 'executed' AND c.details->'execution'->>'channel' = 'customer_page') x;
  FOR r IN
    SELECT * FROM jsonb_to_recordset(todo) AS t(submittal_id uuid, job_id uuid, spec_section text, number text,
      job_number text, fact_id uuid, key text, updated_at timestamptz)
  LOOP
    want := mcp_private.co_sov_division(r.job_id, r.spec_section);
    CONTINUE WHEN want IS NULL OR left(r.key, 2) = want;
    billed := EXISTS (SELECT 1 FROM public.mcp_billing_invoice_versions v WHERE v.job_id = r.job_id AND v.recorded_at >= r.updated_at);
    IF NOT billed AND to_regclass('public.mcp_payment_application_versions') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.mcp_payment_application_versions v WHERE v.job_id = $1 AND v.recorded_at >= $2)'
        INTO billed USING r.job_id, r.updated_at;
    END IF;
    IF billed THEN kept := kept || (r.job_number || ' ' || r.number || ' at ' || r.key); CONTINUE; END IF;
    SELECT want || '.' || lpad(n::text, 3, '0') INTO item FROM generate_series(1, 999) n
     WHERE NOT EXISTS (SELECT 1 FROM public.mcp_job_facts x WHERE x.job_id = r.job_id AND x.module = 'sov' AND x.key = want || '.' || lpad(n::text, 3, '0'))
     ORDER BY n LIMIT 1;
    CONTINUE WHEN item IS NULL;
    -- An executed change's SOV line is locked; it opens only for this renumbering and locks again at once.
    ALTER TABLE public.mcp_job_facts DISABLE TRIGGER mcp_executed_change_immutable;
    UPDATE public.mcp_job_facts SET key = item WHERE id = r.fact_id;
    ALTER TABLE public.mcp_job_facts ENABLE TRIGGER mcp_executed_change_immutable;
    UPDATE public.mcp_change_orders SET details = jsonb_set(details, '{execution,sov_item}', to_jsonb(item))
     WHERE submittal_id = r.submittal_id;
    UPDATE public.mcp_change_history SET snapshot = jsonb_set(snapshot, '{execution,sov_item}', to_jsonb(item))
     WHERE submittal_id = r.submittal_id AND action = 'execute' AND snapshot->'execution'->>'sov_item' = r.key;
    moved := moved || (r.job_number || ' ' || r.number || ' ' || r.key || ' to ' || item);
  END LOOP;
  RAISE NOTICE 'Change-order SOV lines moved to the job''s division: %. Left in place (already billed): %',
    CASE WHEN cardinality(moved) = 0 THEN 'none' ELSE array_to_string(moved, ', ') END,
    CASE WHEN cardinality(kept) = 0 THEN 'none' ELSE array_to_string(kept, ', ') END;
END $refile$;
