-- Remember a drawing PDF's page count next to its content hash.
-- Indexing a stored set then checks the saved count and does not download the file.
-- Null means the count was not known at upload (legacy rows, or a trailer that
-- could not be read cheaply). Members can still name the sheets.
ALTER TABLE public.mcp_drawing_versions
  ADD COLUMN IF NOT EXISTS page_count integer;

DO $$ BEGIN
  ALTER TABLE public.mcp_drawing_versions
    ADD CONSTRAINT mcp_drawing_versions_page_count_check
    CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_drawing_source_save(_job uuid, _record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cid uuid; found public.mcp_drawing_versions; seq integer; pages integer;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF _record->>'path' NOT LIKE cid::text || '/' || _job::text || '/drawing-%/%'
    OR _record->>'path' ~ '(\.\.|\\)' THEN RAISE EXCEPTION 'MCP_BAD:Invalid drawing path.'; END IF;
  IF nullif(_record->>'page_count', '') IS NOT NULL THEN
    IF _record->>'page_count' !~ '^[0-9]{1,5}$'
      OR (_record->>'page_count')::integer < 1
      OR (_record->>'page_count')::integer > 10000 THEN
      RAISE EXCEPTION 'MCP_BAD:The drawing page count is not valid.';
    END IF;
    pages := (_record->>'page_count')::integer;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_job::text || ':drawings', 0));
  SELECT * INTO found FROM public.mcp_drawing_versions WHERE job_id = _job AND kind = 'source'
    AND source_key = _record->>'source_key' ORDER BY version DESC LIMIT 1;
  IF found.id IS NOT NULL AND found.content_hash = _record->>'content_hash'
    AND found.sheets = coalesce(_record->'sheets', '[]') THEN
    IF found.page_count IS NULL AND pages IS NOT NULL THEN
      UPDATE public.mcp_drawing_versions SET page_count = pages
        WHERE id = found.id AND page_count IS NULL RETURNING * INTO found;
    END IF;
    RETURN to_jsonb(found);
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO seq FROM public.mcp_drawing_versions
    WHERE job_id = _job AND kind = 'source' AND source_key = _record->>'source_key';
  INSERT INTO public.mcp_drawing_versions(
    job_id, company_id, kind, source_key, source_url, content_hash, path, storage_bucket,
    filename, sheets, version, created_by, page_count)
    VALUES (_job, cid, 'source', _record->>'source_key', _record->>'source_url', _record->>'content_hash',
      _record->>'path', coalesce(_record->>'storage_bucket', 'athena-files'), _record->>'filename',
      coalesce(_record->'sheets', '[]'), seq, auth.uid(),
      coalesce(pages, CASE WHEN found.id IS NULL THEN NULL ELSE found.page_count END))
    RETURNING * INTO found;
  RETURN to_jsonb(found);
END $$;

REVOKE EXECUTE ON FUNCTION public.mcp_drawing_source_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_drawing_source_save(uuid, jsonb) TO authenticated;
