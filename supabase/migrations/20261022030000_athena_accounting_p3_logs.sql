-- Athena accounting Phase 3: living logs. Additive only. STAGED, NOT APPLIED.
-- Uses mcp_number_sequences (per job numbering) and mcp_record_versions (version + change log per log) from Phase 1.
CREATE TABLE IF NOT EXISTS public.mcp_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  log_type text NOT NULL CHECK (log_type IN ('rfi','submittal','change_order','transmittal','pay_app','notice')),
  number text NOT NULL,
  title text NOT NULL,
  opened date NOT NULL,
  due date,
  closed date,
  status text NOT NULL DEFAULT 'open',
  ball_in_court jsonb,
  condition_precedent boolean NOT NULL DEFAULT false,
  sent date,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, log_type, number),
  CHECK (closed IS NULL OR closed >= opened)
);
CREATE TABLE IF NOT EXISTS public.mcp_log_events (
  id bigserial PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.mcp_log_entries(id) ON DELETE CASCADE,
  what text NOT NULL,
  who text,
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_log_events ENABLE ROW LEVEL SECURITY;
-- Logs carry no dollars, so supers can read them; contract-only scope cannot.
CREATE POLICY mcp_log_entries_read ON public.mcp_log_entries FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full','super'), false));
CREATE POLICY mcp_log_events_read ON public.mcp_log_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_log_entries e WHERE e.id = entry_id AND coalesce(public.mcp_job_scope(e.job_id) IN ('full','super'), false)));

CREATE OR REPLACE FUNCTION public.mcp_log_list(_job uuid, _log_type text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) IN ('full','super'), false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs job access.'; END IF;
  RETURN jsonb_build_object(
    'entries', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.opened DESC, e.number DESC) FROM public.mcp_log_entries e
                         WHERE e.job_id = _job AND (_log_type IS NULL OR e.log_type = _log_type)), '[]'::jsonb),
    'versions', coalesce((SELECT jsonb_object_agg(v.record_type, jsonb_build_object('version', v.version, 'at', v.created_at, 'by', v.saved_by_name, 'what', v.change_what))
                         FROM (SELECT DISTINCT ON (record_type) * FROM public.mcp_record_versions WHERE job_id = _job AND record_type LIKE 'log:%' ORDER BY record_type, version DESC) v), '{}'::jsonb));
END $$;

-- _entry: {id?, log_type, title, opened, due, closed, status, ball_in_court, condition_precedent, sent, fields, number_hint}
-- New entries get the next per-job number for their log; the number string is built by the host-side label rule.
CREATE OR REPLACE FUNCTION public.mcp_log_save(_job uuid, _base_version integer, _entry jsonb, _number text, _what text, _who text, _tz text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t text := _entry->>'log_type'; eid uuid := nullif(_entry->>'id','')::uuid; v jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mcp_log:' || _job::text || ':' || t));
  v := public.mcp_record_version_bump(_job, 'log:' || t, _base_version, current_date, _tz, _what, NULL, _who);
  IF eid IS NULL THEN
    INSERT INTO public.mcp_log_entries (job_id, log_type, number, title, opened, due, closed, status, ball_in_court, condition_precedent, sent, fields)
    VALUES (_job, t, _number, _entry->>'title', (_entry->>'opened')::date, nullif(_entry->>'due','')::date, nullif(_entry->>'closed','')::date,
            coalesce(_entry->>'status','open'), _entry->'ball_in_court', coalesce((_entry->>'condition_precedent')::boolean, false),
            nullif(_entry->>'sent','')::date, coalesce(_entry->'fields','{}'::jsonb))
    RETURNING id INTO eid;
  ELSE
    UPDATE public.mcp_log_entries SET title = coalesce(_entry->>'title', title), due = CASE WHEN _entry ? 'due' THEN nullif(_entry->>'due','')::date ELSE due END,
      closed = CASE WHEN _entry ? 'closed' THEN nullif(_entry->>'closed','')::date ELSE closed END, status = coalesce(_entry->>'status', status),
      ball_in_court = coalesce(_entry->'ball_in_court', ball_in_court), sent = CASE WHEN _entry ? 'sent' THEN nullif(_entry->>'sent','')::date ELSE sent END,
      fields = fields || coalesce(_entry->'fields','{}'::jsonb), updated_at = now()
    WHERE id = eid AND job_id = _job AND log_type = t;
    IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:That log entry is not on this job.'; END IF;
  END IF;
  INSERT INTO public.mcp_log_events (entry_id, what, who) VALUES (eid, _what, _who);
  RETURN jsonb_build_object('id', eid, 'version', (v->>'version')::integer, 'at', v->'at');
END $$;

REVOKE EXECUTE ON FUNCTION public.mcp_log_list(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_log_save(uuid, integer, jsonb, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_log_list(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_log_save(uuid, integer, jsonb, text, text, text, text) TO authenticated;
