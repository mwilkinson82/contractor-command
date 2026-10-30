-- PROPOSAL ONLY — not registered in either migration journal, never applied remotely.
-- Requires the existing superintendent schema, mcp_field_guard and mcp_daily_report_save.
-- Adds a create-only entry point for the new capture form. Existing assistant save stays unchanged.
BEGIN;

CREATE TABLE public.mcp_daily_capture_requests (
  requested_by uuid NOT NULL,
  request_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  report_date date NOT NULL,
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (requested_by, request_id)
);
ALTER TABLE public.mcp_daily_capture_requests ENABLE ROW LEVEL SECURITY;
-- No member read/write policy. Receipt/payload are accessible only inside the guarded function.
REVOKE ALL ON TABLE public.mcp_daily_capture_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.mcp_daily_report_create(
  _job uuid, _date date, _confirmed boolean, _request uuid, _reviewed_at timestamptz,
  _weather text, _manpower text, _subs text, _deliveries text, _issues text, _delays text, _safety text,
  _lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  cid uuid;
  uid uuid;
  payload jsonb;
  prior public.mcp_daily_capture_requests;
  reserved integer;
  created_id uuid;
  saved jsonb;
BEGIN
  -- Access is checked before receipt lookup, including idempotent replays after access loss.
  cid := public.mcp_field_guard(_job);
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MCP_DAILY_ACCESS:Sign in with current access to this project.'; END IF;
  IF _confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_CONFIRM:Review and confirm this daily before saving.'; END IF;
  IF _request IS NULL OR _date IS NULL OR _reviewed_at IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_REVIEW:Review the date and draft again before saving.'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_INPUT:A daily needs between one and 80 work lines.';
  END IF;
  -- Exact jsonb equality binds an actor/request ID to one reviewed payload, not a lossy hash.
  payload := jsonb_build_object('job', _job, 'date', _date, 'reviewed_at_utc', _reviewed_at AT TIME ZONE 'UTC',
    'weather', _weather, 'manpower', _manpower, 'subs', _subs, 'deliveries', _deliveries,
    'issues', _issues, 'delays', _delays, 'safety', _safety, 'lines', _lines);
  IF pg_column_size(payload) > 262144 THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_INPUT:The reviewed daily is too large.'; END IF;

  -- Same actor/key contenders serialize on this unique row. Failed transactions leave no reservation.
  INSERT INTO public.mcp_daily_capture_requests(requested_by, request_id, job_id, company_id, report_date, request_payload)
  VALUES(uid, _request, _job, cid, _date, payload)
  ON CONFLICT (requested_by, request_id) DO NOTHING;
  GET DIAGNOSTICS reserved = ROW_COUNT;
  IF reserved = 0 THEN
    SELECT * INTO prior FROM public.mcp_daily_capture_requests WHERE requested_by = uid AND request_id = _request FOR UPDATE;
    IF NOT FOUND OR prior.job_id <> _job OR prior.company_id <> cid OR prior.report_date <> _date OR prior.request_payload <> payload THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_KEY:This request ID belongs to a different reviewed draft. Review again.';
    END IF;
    IF prior.result IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_RETRY:The prior request is not complete. Check the saved date before retrying.'; END IF;
    -- Recheck after a possible unique-row/row-lock wait, before returning private receipt data.
    PERFORM public.mcp_field_guard(_job);
    -- Receipt proves creation by this request, not the current contents after an intentional later correction.
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  -- Fresh requests must carry recent confirmation. Committed exact retries remain resolvable after expiry.
  IF _reviewed_at < clock_timestamp() - interval '15 minutes' OR _reviewed_at > clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_STALE:The daily review expired. Review the current date and draft again.';
  END IF;

  -- This is the atomic expected-absence check. It uses the existing unique(job_id,report_date)
  -- index: another capture/legacy insert must finish before this can win or fail. No pre-read race.
  INSERT INTO public.mcp_daily_reports(job_id, company_id, report_date, weather, manpower, subs_on_site, deliveries, issues, delays, safety)
  VALUES(_job, cid, _date, _weather, _manpower, _subs, _deliveries, _issues, _delays, _safety)
  ON CONFLICT (job_id, report_date) DO NOTHING
  RETURNING id INTO created_id;
  IF created_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_EXISTS:A daily already exists for this date. Nothing was replaced; review the saved daily.';
  END IF;

  -- The unique-row wait can outlast the review window. Abort the entire claim if it did.
  IF _reviewed_at < clock_timestamp() - interval '15 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_STALE:The daily review expired while waiting. Review again.';
  END IF;

  -- Only the row just inserted in this same transaction reaches the canonical workflow.
  -- It retains canonical validation, work/rate/feed behavior, field guard and atomic rollback.
  saved := public.mcp_daily_report_save(_job, _date, true, _weather, _manpower, _subs, _deliveries,
    _issues, _delays, _safety, NULL, _lines);
  IF saved->>'id' IS DISTINCT FROM created_id::text OR saved->>'saved' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MCP_DAILY_RETRY:The canonical creation receipt is unavailable.';
  END IF;
  saved := saved || jsonb_build_object('request_id', _request, 'replayed', false, 'creation_only', true);
  UPDATE public.mcp_daily_capture_requests SET result = saved WHERE requested_by = uid AND request_id = _request;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.mcp_daily_report_create(uuid,date,boolean,uuid,timestamptz,text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_daily_report_create(uuid,date,boolean,uuid,timestamptz,text,text,text,text,text,text,text,jsonb) TO authenticated;

COMMIT;
