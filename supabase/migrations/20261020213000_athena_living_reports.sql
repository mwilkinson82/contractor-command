-- Athena 0.8.9: living reports (master copy per job) and one saved contract completion date per job.
-- Additive only: one new column, one new append-only table, two functions. No drops, no deletes, no data changes.
-- NOT APPLIED. Apply only after Marshall's yes.

-- ONE saved contract completion date per job (set through mcp_living_report_save; a change needs replace_completion).
ALTER TABLE public.mcp_jobs ADD COLUMN IF NOT EXISTS contract_completion_date date;

-- Every saved version of every living report, append-only. The latest approved version is the master copy.
CREATE TABLE IF NOT EXISTS public.mcp_living_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('cpm', 'billing_forecast', 'ior', 'dashboard')),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved')),
  data_date date,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  activity_count integer,
  contract_total numeric(14,2),
  forecast_total numeric(14,2),
  change_what text NOT NULL,
  change_why text,
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, report_type, version)
);
CREATE INDEX IF NOT EXISTS mcp_living_reports_job_idx ON public.mcp_living_reports (job_id, report_type, version DESC);

ALTER TABLE public.mcp_living_reports ENABLE ROW LEVEL SECURITY;
-- Direct reads: full job scope only (dollars). Supers read the schedule through mcp_living_report_get, which strips $.
-- No INSERT/UPDATE/DELETE policy: writes go only through mcp_living_report_save.
DROP POLICY IF EXISTS "living report read full scope" ON public.mcp_living_reports;
CREATE POLICY "living report read full scope" ON public.mcp_living_reports FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
GRANT SELECT ON public.mcp_living_reports TO authenticated;
GRANT ALL ON public.mcp_living_reports TO service_role;

-- Strip dollars from a stored report for the Super view (schedule only).
CREATE OR REPLACE FUNCTION public.mcp_living_strip_money(_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT (_data - 'billing' - 'ior' - 'kpis' - 'contract_total')
    || jsonb_build_object('activities', coalesce((
      SELECT jsonb_agg(a - 'value' - 'billable_value') FROM jsonb_array_elements(coalesce(_data->'activities', '[]'::jsonb)) a), '[]'::jsonb))
$$;

-- Latest (or a named) version. Supers: cpm only, no dollars.
CREATE OR REPLACE FUNCTION public.mcp_living_report_get(_job uuid, _type text, _version integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text := public.mcp_job_scope(_job); r public.mcp_living_reports; log jsonb; cd date;
BEGIN
  PERFORM public.mcp_assert_active();
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc = 'contract' OR (sc = 'super' AND _type <> 'cpm') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO r FROM public.mcp_living_reports WHERE job_id = _job AND report_type = _type
    AND (_version IS NULL OR version = _version) ORDER BY version DESC LIMIT 1;
  SELECT contract_completion_date INTO cd FROM public.mcp_jobs WHERE id = _job;
  IF r.id IS NULL THEN RETURN jsonb_build_object('found', false, 'contract_completion_date', cd); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('version', version, 'at', created_at, 'who', updated_by_name, 'what', change_what, 'why', change_why) ORDER BY version DESC), '[]'::jsonb)
    INTO log FROM public.mcp_living_reports WHERE job_id = _job AND report_type = _type AND version <= r.version;
  RETURN jsonb_build_object('found', true, 'version', r.version, 'status', r.status, 'data_date', r.data_date,
    'updated_at', r.created_at, 'updated_by_name', r.updated_by_name, 'activity_count', r.activity_count,
    'contract_total', CASE WHEN sc = 'full' THEN r.contract_total END, 'forecast_total', CASE WHEN sc = 'full' THEN r.forecast_total END,
    'data', CASE WHEN sc = 'full' THEN r.data ELSE public.mcp_living_strip_money(r.data) END,
    'change_log', log, 'contract_completion_date', cd, 'scope', sc);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_living_report_get(uuid, text, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_living_report_get(uuid, text, integer) TO authenticated;

-- Save a new version after the PM approves. Full job scope only. Re-checks what the server checked:
-- no dropped activities, version is the next one, and the forecast ties to the contract to the cent.
CREATE OR REPLACE FUNCTION public.mcp_living_report_save(
  _job uuid, _type text, _base_version integer, _data jsonb, _data_date date,
  _activity_count integer, _contract_total numeric, _forecast_total numeric,
  _what text, _why text, _who text, _completion date DEFAULT NULL, _replace_completion boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur integer; prev public.mcp_living_reports; dropped text[]; cd date; nid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF _type NOT IN ('cpm', 'billing_forecast', 'ior', 'dashboard') THEN RAISE EXCEPTION 'MCP_BAD:Unknown report type.'; END IF;
  IF coalesce(btrim(_what), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:Say what changed in this version.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':' || _type));
  SELECT coalesce(max(version), 0) INTO cur FROM public.mcp_living_reports WHERE job_id = _job AND report_type = _type;
  IF coalesce(_base_version, 0) <> cur THEN RAISE EXCEPTION 'MCP_BAD:This report changed since you loaded it (now v%). Load the latest version and update that one.', cur; END IF;
  IF cur > 0 THEN
    SELECT * INTO prev FROM public.mcp_living_reports WHERE job_id = _job AND report_type = _type AND version = cur;
    SELECT array_agg(p->>'id') INTO dropped FROM jsonb_array_elements(coalesce(prev.data->'activities', '[]'::jsonb)) p
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_data->'activities', '[]'::jsonb)) n WHERE n->>'id' = p->>'id');
    IF dropped IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Not saved: this update drops activities %. Keep every activity.', array_to_string(dropped, ', '); END IF;
  END IF;
  IF _type IN ('cpm', 'billing_forecast') AND (_contract_total IS NULL OR _forecast_total IS NULL OR round(_contract_total, 2) <> round(_forecast_total, 2)) THEN
    RAISE EXCEPTION 'MCP_BAD:Not saved: the forecast doesn''t tie to the contract.';
  END IF;
  IF _completion IS NOT NULL THEN
    SELECT contract_completion_date INTO cd FROM public.mcp_jobs WHERE id = _job;
    IF cd IS NOT NULL AND cd <> _completion AND NOT _replace_completion THEN
      RAISE EXCEPTION 'MCP_BAD:A different contract completion date (%) is already saved. Confirm the change first.', cd;
    END IF;
    UPDATE public.mcp_jobs SET contract_completion_date = _completion WHERE id = _job;
  END IF;
  INSERT INTO public.mcp_living_reports (job_id, report_type, version, data_date, data, activity_count, contract_total, forecast_total, change_what, change_why, updated_by_name)
  VALUES (_job, _type, cur + 1, _data_date, _data, _activity_count, _contract_total, _forecast_total, btrim(_what), nullif(btrim(coalesce(_why, '')), ''), _who)
  RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'version', cur + 1);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_living_report_save(uuid, text, integer, jsonb, date, integer, numeric, numeric, text, text, text, date, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_living_report_save(uuid, text, integer, jsonb, date, integer, numeric, numeric, text, text, text, date, boolean) TO authenticated;
