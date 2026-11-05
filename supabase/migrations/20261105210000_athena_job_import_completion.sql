-- Job import: the source's contract completion goes on the job's CPM header.
-- After an import is saved, Athena fills mcp_jobs.contract_completion_date from
-- the package's job.contract_completion (Overwatch's baseline completion), only
-- when the job has no contract completion yet. A date already on the job is
-- never changed here. Safe to run again.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.mcp_job_import_completion(_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.mcp_import_batches; jid uuid; raw text; d date; cur date; filled boolean := false;
BEGIN
  PERFORM public.mcp_assert_active();
  SELECT * INTO b FROM public.mcp_import_batches WHERE id = _batch;
  IF b.id IS NULL OR b.actor_id IS DISTINCT FROM auth.uid() OR b.status IS DISTINCT FROM 'applied' THEN
    RETURN jsonb_build_object('filled', false);
  END IF;
  SELECT id, contract_completion_date INTO jid, cur FROM public.mcp_jobs
    WHERE company_id = b.company_id AND job_number = b.job_number;
  IF jid IS NULL OR public.mcp_job_scope(jid) IS DISTINCT FROM 'full' THEN
    RETURN jsonb_build_object('filled', false);
  END IF;
  raw := btrim(coalesce(b.package -> 'job' ->> 'contract_completion', ''));
  IF raw ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN d := raw::date; EXCEPTION WHEN others THEN d := NULL; END;
  END IF;
  IF d IS NOT NULL AND cur IS NULL THEN
    UPDATE public.mcp_jobs SET contract_completion_date = d WHERE id = jid AND contract_completion_date IS NULL;
    filled := FOUND;
  END IF;
  RETURN jsonb_build_object('filled', filled, 'contract_completion_date', coalesce(cur, CASE WHEN filled THEN d END));
END $$;

REVOKE ALL ON FUNCTION public.mcp_job_import_completion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_import_completion(uuid) TO authenticated;
