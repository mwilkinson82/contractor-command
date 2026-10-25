-- A CPM view is stored beside the official schedule. Saving it again updates that
-- same draft. The official cpm rows are not written here.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mcp_living_reports DROP CONSTRAINT mcp_living_reports_report_type_check;
ALTER TABLE public.mcp_living_reports ADD CONSTRAINT mcp_living_reports_report_type_check
  CHECK (report_type IN ('cpm', 'billing_forecast', 'ior', 'dashboard', 'cpm_draft'));

CREATE FUNCTION public.mcp_cpm_draft_save(_job uuid, _data jsonb, _data_date date, _what text, _who text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE existing public.mcp_living_reports; payload jsonb; nid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF coalesce(btrim(_what), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:Say what changed in this version.'; END IF;
  payload := coalesce(_data, '{}'::jsonb) || jsonb_build_object('standing', 'draft', 'label', 'Draft, not official');
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':cpm_draft'));
  SELECT * INTO existing FROM public.mcp_living_reports WHERE job_id = _job AND report_type = 'cpm_draft' ORDER BY version DESC LIMIT 1;
  IF existing.id IS NOT NULL THEN
    UPDATE public.mcp_living_reports SET data = payload, data_date = _data_date, change_what = btrim(_what), updated_by_name = _who, activity_count = jsonb_array_length(coalesce(payload->'activities', '[]'::jsonb))
      WHERE id = existing.id;
    RETURN jsonb_build_object('id', existing.id, 'version', existing.version, 'reused', true, 'label', 'Draft, not official');
  END IF;
  INSERT INTO public.mcp_living_reports (job_id, report_type, version, data_date, data, activity_count, change_what, updated_by_name)
  VALUES (_job, 'cpm_draft', 1, _data_date, payload, jsonb_array_length(coalesce(payload->'activities', '[]'::jsonb)), btrim(_what), _who)
  RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'version', 1, 'reused', false, 'label', 'Draft, not official');
END $$;
REVOKE ALL ON FUNCTION public.mcp_cpm_draft_save(uuid, jsonb, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_cpm_draft_save(uuid, jsonb, date, text, text) TO authenticated;

COMMIT;
