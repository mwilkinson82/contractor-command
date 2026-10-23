-- Add one application table, guarded functions and a private originals bucket.
-- Existing tables, buckets, policies and auth are untouched. No production apply in this PR.
CREATE TABLE public.mcp_drawing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  kind text NOT NULL CHECK (kind IN ('source', 'markup')),
  parent_id uuid REFERENCES public.mcp_drawing_versions(id),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 512),
  source_url text CHECK (length(source_url) <= 4096),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  path text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'athena-files' CHECK (storage_bucket IN ('athena-files', 'athena-drawings')),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  sheets jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sheets) = 'array' AND jsonb_array_length(sheets) <= 400),
  sheet text,
  page integer CHECK (page > 0),
  version integer NOT NULL CHECK (version > 0),
  annotations jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(annotations) = 'array' AND jsonb_array_length(annotations) <= 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  CHECK ((kind = 'source' AND parent_id IS NULL AND sheet IS NULL AND page IS NULL)
      OR (kind = 'markup' AND parent_id IS NOT NULL AND sheet IS NOT NULL AND page IS NOT NULL))
);
CREATE UNIQUE INDEX mcp_drawing_source_identity ON public.mcp_drawing_versions(job_id, source_key, version) WHERE kind = 'source';
CREATE INDEX mcp_drawing_source_hash ON public.mcp_drawing_versions(job_id, content_hash) WHERE kind = 'source';
CREATE INDEX mcp_drawing_job_date ON public.mcp_drawing_versions(job_id, created_at DESC);
CREATE UNIQUE INDEX mcp_drawing_markup_number ON public.mcp_drawing_versions(parent_id, sheet, version) WHERE kind = 'markup';
ALTER TABLE public.mcp_drawing_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_drawing_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_drawing_versions TO service_role;

-- No direct member reads/writes: every operation rechecks membership and job scope in the existing guard.
CREATE FUNCTION public.mcp_drawing_records(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC, v.id)
    FROM public.mcp_drawing_versions v WHERE v.job_id = _job AND v.kind = 'source'), '[]');
END $$;

CREATE FUNCTION public.mcp_drawing_source_save(_job uuid, _record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cid uuid; found public.mcp_drawing_versions; seq integer;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF _record->>'path' NOT LIKE cid::text || '/' || _job::text || '/drawing-%/%'
    OR _record->>'path' ~ '(\.\.|\\)' THEN RAISE EXCEPTION 'MCP_BAD:Invalid drawing path.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_job::text || ':drawings', 0));
  SELECT * INTO found FROM public.mcp_drawing_versions WHERE job_id = _job AND kind = 'source'
    AND source_key = _record->>'source_key' ORDER BY version DESC LIMIT 1;
  IF found.id IS NOT NULL AND found.content_hash = _record->>'content_hash'
    AND found.sheets = coalesce(_record->'sheets', '[]') THEN RETURN to_jsonb(found); END IF;
  SELECT coalesce(max(version), 0) + 1 INTO seq FROM public.mcp_drawing_versions
    WHERE job_id = _job AND kind = 'source' AND source_key = _record->>'source_key';
  INSERT INTO public.mcp_drawing_versions(job_id, company_id, kind, source_key, source_url, content_hash, path, storage_bucket, filename, sheets, version, created_by)
    VALUES (_job, cid, 'source', _record->>'source_key', _record->>'source_url', _record->>'content_hash',
      _record->>'path', coalesce(_record->>'storage_bucket', 'athena-files'), _record->>'filename', coalesce(_record->'sheets', '[]'), seq, auth.uid()) RETURNING * INTO found;
  RETURN to_jsonb(found);
END $$;

CREATE FUNCTION public.mcp_drawing_markup_save(_job uuid, _source uuid, _record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cid uuid; src public.mcp_drawing_versions; saved public.mcp_drawing_versions; seq integer;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  SELECT * INTO src FROM public.mcp_drawing_versions WHERE id = _source AND job_id = _job AND kind = 'source';
  IF src.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Stored source drawing not found on this job.'; END IF;
  IF _record->>'path' NOT LIKE cid::text || '/' || _job::text || '/drawing-markup-%/%'
    OR _record->>'path' ~ '(\.\.|\\)' OR _record->>'path' = src.path THEN RAISE EXCEPTION 'MCP_BAD:Invalid markup path.'; END IF;
  IF NOT src.sheets ? (_record->>'sheet') OR (_record->>'page')::integer <> (
    SELECT ordinality::integer FROM jsonb_array_elements_text(src.sheets) WITH ORDINALITY WHERE value = _record->>'sheet' LIMIT 1
  ) THEN RAISE EXCEPTION 'MCP_BAD:Sheet does not match the stored drawing.'; END IF;
  IF octet_length(_record::text) > 200000 THEN RAISE EXCEPTION 'MCP_BAD:Too many markup details.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_source::text || ':' || (_record->>'sheet'), 0));
  SELECT coalesce(max(version), 0) + 1 INTO seq FROM public.mcp_drawing_versions
    WHERE parent_id = _source AND sheet = _record->>'sheet' AND kind = 'markup';
  INSERT INTO public.mcp_drawing_versions(job_id, company_id, kind, parent_id, source_key, source_url, content_hash,
    path, filename, sheet, page, version, annotations, created_by)
    VALUES (_job, cid, 'markup', _source, src.source_key, src.source_url, _record->>'content_hash', _record->>'path',
      _record->>'filename', _record->>'sheet', (_record->>'page')::integer, seq, coalesce(_record->'annotations', '[]'), auth.uid()) RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_drawing_records(uuid), public.mcp_drawing_source_save(uuid,jsonb), public.mcp_drawing_markup_save(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_drawing_records(uuid), public.mcp_drawing_source_save(uuid,jsonb), public.mcp_drawing_markup_save(uuid,uuid,jsonb) TO authenticated;

-- Drawing originals can exceed file_share's unchanged 10 MiB limit. Keep its
-- bucket and all #190 paths intact. athena-files stays at 10485760 bytes.
-- This migration does not update that limit. It only adds a separate PDF-only bucket.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('athena-drawings', 'athena-drawings', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='athena-drawings' AND
    (public IS DISTINCT FROM false OR file_size_limit IS DISTINCT FROM 52428800 OR
     allowed_mime_types IS DISTINCT FROM ARRAY['application/pdf']::text[])) THEN
    RAISE EXCEPTION 'Unexpected drawing bucket configuration; review before applying.';
  END IF;
END $$;

CREATE FUNCTION public.mcp_drawing_path_allowed(_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parts text[]; cid uuid;
BEGIN
  parts := string_to_array(_path, '/');
  IF cardinality(parts) <> 4 OR parts[3] NOT LIKE 'drawing-%' OR parts[4] = ''
    OR _path ~ '(\.\.|\\)' THEN RETURN false; END IF;
  cid := public.mcp_estimate_guard(parts[2]::uuid);
  RETURN cid::text = parts[1];
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_drawing_path_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_drawing_path_allowed(text) TO authenticated;

CREATE POLICY "athena drawing originals insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='athena-drawings' AND public.mcp_drawing_path_allowed(name));
CREATE POLICY "athena drawing originals select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='athena-drawings' AND public.mcp_drawing_path_allowed(name));
-- No member UPDATE or DELETE policy: original objects cannot be overwritten or removed.
