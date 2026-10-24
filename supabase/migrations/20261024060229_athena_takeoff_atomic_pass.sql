-- Keep competing reads atomic without changing tables, data, guards or ACLs.
CREATE OR REPLACE FUNCTION public.mcp_takeoff_pass_save(_job uuid,_record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cid uuid; previous public.mcp_takeoff_markups; saved jsonb; proposal jsonb; refs jsonb:='[]'; summary jsonb:=_record->'pass_summary'; cursor integer; pid uuid; current_version integer;
BEGIN
 cid:=public.mcp_estimate_guard(_job);
 IF _record IS NULL OR octet_length(_record::text)>400000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid drawing pass.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_job::text||':takeoff',0));
 pid:=(summary->>'pass_id')::uuid; cursor:=(summary->>'cursor')::integer;
 SELECT version INTO current_version FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
 IF pid IS NULL OR cursor IS NULL OR cursor<0 OR (summary->>'takeoff_version')::integer IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'MCP_BAD:The takeoff changed or the pass reference is invalid.'; END IF;
 SELECT * INTO previous FROM public.mcp_takeoff_markups WHERE job_id=_job AND kind='pass' AND pass_summary->>'pass_id'=pid::text ORDER BY created_at DESC LIMIT 1;
 IF previous.id IS NOT NULL THEN
  IF previous.source_id<>(_record->>'source_id')::uuid OR previous.page<>(_record->>'page')::integer OR previous.pass_summary->>'line_no' IS DISTINCT FROM summary->>'line_no' OR previous.pass_summary->'order' IS DISTINCT FROM summary->'order' THEN RAISE EXCEPTION 'MCP_BAD:Continue the original line and sheet for this pass.'; END IF;
  IF cursor<(previous.pass_summary->>'next_cursor')::integer THEN RETURN to_jsonb(previous); END IF;
  IF cursor<>(previous.pass_summary->>'next_cursor')::integer THEN RAISE EXCEPTION 'MCP_BAD:Reload the latest pass checkpoint.'; END IF;
 ELSIF cursor<>0 THEN RAISE EXCEPTION 'MCP_BAD:Start the drawing read at its first tile.'; END IF;
 IF (summary->>'next_cursor')::integer NOT BETWEEN cursor AND cursor+1 OR (summary->>'next_cursor')::integer>jsonb_array_length(summary->'order') OR (summary->>'complete')::boolean IS DISTINCT FROM ((summary->>'next_cursor')::integer=jsonb_array_length(summary->'order')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid drawing coverage checkpoint.'; END IF;
 -- Re-check under the existing per-job lock after inference, not only in the
 -- request snapshot: two in-flight reads must not add overlapping quantities.
 IF jsonb_array_length(coalesce(_record->'proposals','[]'))>0 AND EXISTS(
  SELECT 1 FROM(
   SELECT DISTINCT ON(g.geometry_id) g.status,g.evidence
   FROM public.mcp_takeoff_geometry g
   JOIN public.mcp_estimate_takeoff_lines l ON l.id=g.line_id
   JOIN public.mcp_estimate_takeoffs t ON t.id=l.takeoff_id
   WHERE g.job_id=_job AND g.source_id=(_record->>'source_id')::uuid
    AND g.page=(_record->>'page')::integer AND t.job_id=_job
    AND t.version=current_version AND l.line_no=(summary->>'line_no')::integer
   ORDER BY g.geometry_id,g.version DESC
  ) heads WHERE heads.status<>'rejected'
   AND heads.evidence->>'pass_id' IS DISTINCT FROM pid::text
 ) THEN RAISE EXCEPTION 'MCP_BAD:This line has geometry from another read. Reload and review it before continuing.'; END IF;
 FOR proposal IN SELECT value FROM jsonb_array_elements(coalesce(_record->'proposals','[]')) LOOP
  IF proposal->>'line_no' IS DISTINCT FROM summary->>'line_no' OR proposal->>'source_id' IS DISTINCT FROM _record->>'source_id' OR proposal->>'page' IS DISTINCT FROM _record->>'page' OR proposal->>'takeoff_version' IS DISTINCT FROM summary->>'takeoff_version' OR proposal->'evidence'->>'pass_id' IS DISTINCT FROM pid::text THEN RAISE EXCEPTION 'MCP_BAD:Proposal does not belong to this pass.'; END IF;
  saved:=public.mcp_takeoff_geometry_save(_job,'propose',proposal,0); refs:=refs||jsonb_build_array(saved->'id');
 END LOOP;
 RETURN public.mcp_takeoff_markup_save(_job,jsonb_build_object('kind','pass','source_id',_record->'source_id','page',_record->'page','geometry_revs',refs,'pass_summary',summary));
END $$;
