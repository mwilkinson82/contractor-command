-- Data only. Run after migration 20261107020000 (the helper that names who saved the contract facts), as its own step.
-- Every change order a client approved on their client page with a verified emailed code, and that is still
-- approved, joins its contract now. Safe to run again: an executed change order is skipped.
-- Its notice says how many joined and lists, by job and number, any that stay approved.
DO $cleanup$
DECLARE r record; n int := 0; stayed text[] := '{}';
BEGIN
  FOR r IN
    SELECT c.submittal_id, j.job_number, s.number
      FROM public.mcp_change_orders c
      JOIN public.mcp_submittals s ON s.id = c.submittal_id
      JOIN public.mcp_jobs j ON j.id = c.job_id
     WHERE c.details->>'state' = 'approved' AND c.details->'decision'->>'channel' = 'customer_page'
       AND c.details->'decision'->>'email_code_verified' = 'true'
     ORDER BY c.updated_at
  LOOP
    IF mcp_private.co_execute_client_approved(r.submittal_id) THEN n := n + 1;
    ELSE stayed := stayed || (r.job_number || ' ' || r.number); END IF;
  END LOOP;
  RAISE NOTICE 'Client-approved change orders added to their contracts: %. Still approved: %', n,
    CASE WHEN cardinality(stayed) = 0 THEN 'none' ELSE array_to_string(stayed, ', ') END;
END $cleanup$;
