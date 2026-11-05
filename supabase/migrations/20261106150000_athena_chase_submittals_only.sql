-- Submittal chases cover approval submittals only. RFIs, RFCs and change orders share the submittals table
-- but are not submittals, so they no longer show under "Submittals to chase" in the morning brief or the
-- submittal chase tool. Additive: one filter in the chase reader. No data changes; nothing is sent.
DO $patch$
DECLARE original text; revised text;
BEGIN
  SELECT pg_get_functiondef('public.mcp_submittal_chase_rows(uuid)'::regprocedure) INTO original;
  IF position('package_purpose=''approval''' IN original) > 0 THEN RETURN; END IF;
  revised := replace(original,
    'FROM public.mcp_submittals WHERE job_id=_job ORDER BY lower(btrim(number)),revision DESC,id DESC)',
    'FROM public.mcp_submittals WHERE job_id=_job AND package_purpose=''approval'' ORDER BY lower(btrim(number)),revision DESC,id DESC)');
  IF revised = original THEN RAISE EXCEPTION 'Chase reader changed; review the submittal-only filter.'; END IF;
  EXECUTE revised;
END $patch$;
