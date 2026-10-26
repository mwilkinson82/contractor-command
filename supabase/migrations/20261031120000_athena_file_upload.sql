-- Stage only. Apply through the approved Cloud release, never directly from a workstation.
-- Contract and spec files: one stored object plus extracted text on mcp_contract_documents.
-- Upload sessions let a connector finish a file that could not fit in one tool call.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mcp_contract_documents
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'contract',
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS size_bytes integer,
  ADD COLUMN IF NOT EXISTS file_sha256 text,
  ADD COLUMN IF NOT EXISTS upload_id uuid;

ALTER TABLE public.mcp_contract_documents DROP CONSTRAINT IF EXISTS mcp_contract_documents_pkey;
ALTER TABLE public.mcp_contract_documents ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_contract_documents_one_contract
  ON public.mcp_contract_documents (job_id) WHERE kind = 'contract';
CREATE UNIQUE INDEX IF NOT EXISTS mcp_contract_documents_upload
  ON public.mcp_contract_documents (upload_id) WHERE upload_id IS NOT NULL;
ALTER TABLE public.mcp_contract_documents DROP CONSTRAINT IF EXISTS mcp_contract_documents_kind_check;
ALTER TABLE public.mcp_contract_documents
  ADD CONSTRAINT mcp_contract_documents_kind_check CHECK (kind IN ('contract', 'spec'));
ALTER TABLE public.mcp_contract_documents DROP CONSTRAINT IF EXISTS mcp_contract_documents_sha_check;
ALTER TABLE public.mcp_contract_documents
  ADD CONSTRAINT mcp_contract_documents_sha_check CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.mcp_contract_documents DROP CONSTRAINT IF EXISTS mcp_contract_documents_size_check;
ALTER TABLE public.mcp_contract_documents
  ADD CONSTRAINT mcp_contract_documents_size_check CHECK (size_bytes IS NULL OR size_bytes > 0);

CREATE OR REPLACE FUNCTION public.mcp_clauses_save(_job uuid, _doc jsonb, _clauses jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; body text; c jsonb; txt text; src text; out jsonb := '[]'::jsonb; sec text;
BEGIN
  sc := public.mcp_assert_job_scope(_job);
  IF sc NOT IN ('full','contract') THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF _doc IS NOT NULL AND nullif(btrim(_doc->>'body'), '') IS NOT NULL THEN
    INSERT INTO public.mcp_contract_documents (job_id, company_id, name, body, body_sha256, kind)
    VALUES (_job, j.company_id, left(coalesce(nullif(btrim(_doc->>'name'), ''), 'contract'), 300), _doc->>'body', encode(sha256(convert_to(_doc->>'body', 'UTF8')), 'hex'), 'contract')
    ON CONFLICT (job_id) WHERE kind = 'contract' DO UPDATE SET name = EXCLUDED.name, body = EXCLUDED.body, body_sha256 = EXCLUDED.body_sha256, updated_at = now(), created_by = auth.uid();
  END IF;
  SELECT d.body INTO body FROM public.mcp_contract_documents d WHERE d.job_id = _job AND d.kind = 'contract';
  FOR c IN SELECT value FROM jsonb_array_elements(coalesce(_clauses, '[]'::jsonb)) LOOP
    txt := btrim(c->>'text');
    sec := btrim(c->>'section');
    IF txt IS NULL OR txt = '' OR sec IS NULL OR sec = '' THEN RAISE EXCEPTION 'MCP_BAD:each clause needs section and text'; END IF;
    src := CASE WHEN body IS NOT NULL AND length(public.mcp_clause_norm(txt)) > 0
                 AND position(public.mcp_clause_norm(txt) IN public.mcp_clause_norm(body)) > 0 THEN 'document' ELSE 'unverified' END;
    INSERT INTO public.mcp_contract_clauses (job_id, company_id, section, heading, category, verbatim_text, n_days, day_type, trigger_desc, parse_source, source)
    VALUES (_job, j.company_id, sec, nullif(btrim(c->>'heading'), ''), coalesce(nullif(c->>'category', ''), 'other'), txt,
      nullif(c->>'n_days', '')::int, nullif(c->>'day_type', ''), nullif(c->>'trigger_desc', ''),
      CASE WHEN nullif(c->>'n_days', '') IS NULL AND nullif(c->>'trigger_desc', '') IS NULL THEN 'none' ELSE 'clause_text' END, src)
    ON CONFLICT (job_id, section) DO UPDATE SET heading = EXCLUDED.heading, category = EXCLUDED.category, verbatim_text = EXCLUDED.verbatim_text,
      n_days = EXCLUDED.n_days, day_type = EXCLUDED.day_type, trigger_desc = EXCLUDED.trigger_desc, parse_source = EXCLUDED.parse_source,
      source = EXCLUDED.source, updated_at = now(), created_by = auth.uid();
    out := out || jsonb_build_object('section', sec, 'source', src);
  END LOOP;
  PERFORM public.mcp_audit_job(_job, 'intake', 'contract_clauses_save', NULL);
  RETURN jsonb_build_object('clauses', out, 'has_document', body IS NOT NULL);
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('athena-documents', 'athena-documents', false, 10485760, ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT m) FROM unnest(coalesce(allowed_mime_types, '{}') || ARRAY['text/plain']::text[]) m
)
WHERE id = 'athena-submittals';

CREATE OR REPLACE FUNCTION public.mcp_document_path_scope(_name text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE parts text[] := string_to_array(_name, '/'); j uuid; c uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  IF array_length(parts, 1) <> 4 THEN RETURN NULL; END IF;
  BEGIN
    j := parts[2]::uuid; c := parts[1]::uuid;
    PERFORM parts[3]::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_jobs WHERE id = j AND company_id = c) THEN RETURN NULL; END IF;
  RETURN public.mcp_job_scope(j);
END $$;
REVOKE ALL ON FUNCTION public.mcp_document_path_scope(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_document_path_scope(text) TO authenticated;

DROP POLICY IF EXISTS "athena document files insert" ON storage.objects;
CREATE POLICY "athena document files insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'athena-documents' AND public.mcp_document_path_scope(name) IN ('full', 'contract'));
DROP POLICY IF EXISTS "athena document files select" ON storage.objects;
CREATE POLICY "athena document files select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'athena-documents' AND public.mcp_document_path_scope(name) IN ('full', 'contract'));
DROP POLICY IF EXISTS "athena document files delete" ON storage.objects;
CREATE POLICY "athena document files delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'athena-documents' AND public.mcp_document_path_scope(name) IN ('full', 'contract'));

CREATE TABLE IF NOT EXISTS public.mcp_file_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('contract', 'spec', 'submittal_piece')),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 130),
  mime_type text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('athena-documents', 'athena-submittals')),
  storage_path text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finished')),
  chunks integer[] NOT NULL DEFAULT '{}',
  submittal_id uuid,
  piece_id uuid,
  new_piece jsonb,
  result jsonb,
  expires_at timestamptz NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_file_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_file_uploads FROM public, anon, authenticated;
GRANT ALL ON public.mcp_file_uploads TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_file_upload_begin(
  _job uuid, _purpose text, _filename text, _mime text, _token_hash text,
  _submittal uuid, _piece uuid, _new_piece jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; rid uuid := gen_random_uuid(); bucket text; path text; exp timestamptz := now() + interval '2 hours';
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF _purpose = 'submittal_piece' AND sc <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full job access is required to store a submittal piece.'; END IF;
  IF _purpose IN ('contract', 'spec') AND sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t store a file on this job.'; END IF;
  IF _purpose NOT IN ('contract', 'spec', 'submittal_piece') THEN RAISE EXCEPTION 'MCP_BAD:Choose a contract, a spec, or a submittal piece.'; END IF;
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:That upload could not be started.'; END IF;
  IF _filename IS NULL OR length(_filename) < 1 OR length(_filename) > 130 OR _filename LIKE '%/%' THEN RAISE EXCEPTION 'MCP_BAD:Use a PDF, Word, or text filename.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF _submittal IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.mcp_submittals WHERE id = _submittal AND job_id = _job) THEN
      RAISE EXCEPTION 'MCP_BAD:That submittal is not on this job.';
    END IF;
  END IF;
  IF _purpose = 'submittal_piece' THEN
    bucket := 'athena-submittals';
    path := j.company_id::text || '/' || _job::text || '/pieces/' || rid::text || '/' || _filename;
  ELSE
    bucket := 'athena-documents';
    path := j.company_id::text || '/' || _job::text || '/' || rid::text || '/' || _filename;
  END IF;
  INSERT INTO public.mcp_file_uploads (
    id, company_id, job_id, purpose, filename, mime_type, bucket, storage_path, token_hash,
    submittal_id, piece_id, new_piece, expires_at
  ) VALUES (
    rid, j.company_id, _job, _purpose, _filename, _mime, bucket, path, _token_hash,
    _submittal, _piece, _new_piece, exp
  );
  RETURN jsonb_build_object(
    'id', rid, 'bucket', bucket, 'storage_path', path, 'expires_at', exp,
    'purpose', _purpose, 'filename', _filename, 'mime_type', _mime, 'status', 'open', 'chunks', '[]'::jsonb
  );
END $$;
REVOKE ALL ON FUNCTION public.mcp_file_upload_begin(uuid, text, text, text, text, uuid, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_file_upload_begin(uuid, text, text, text, text, uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_file_upload_get(_id uuid, _job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_file_uploads; sc text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO r FROM public.mcp_file_uploads WHERE id = _id AND job_id = _job;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', r.id, 'bucket', r.bucket, 'storage_path', r.storage_path, 'expires_at', r.expires_at,
    'purpose', r.purpose, 'filename', r.filename, 'mime_type', r.mime_type, 'status', r.status,
    'chunks', to_jsonb(r.chunks), 'submittal_id', r.submittal_id, 'piece_id', r.piece_id,
    'new_piece', r.new_piece, 'result', r.result, 'company_id', r.company_id
  );
END $$;
REVOKE ALL ON FUNCTION public.mcp_file_upload_get(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_file_upload_get(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_file_upload_chunk(_id uuid, _job uuid, _index int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_file_uploads;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO r FROM public.mcp_file_uploads WHERE id = _id AND job_id = _job FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That upload is not on this job.'; END IF;
  IF r.status <> 'open' OR r.expires_at <= now() THEN RAISE EXCEPTION 'MCP_BAD:That upload link has expired. Start again. Nothing was stored.'; END IF;
  IF _index < 0 OR _index > 6000 THEN RAISE EXCEPTION 'MCP_BAD:That chunk is out of range. Nothing was stored.'; END IF;
  UPDATE public.mcp_file_uploads
  SET chunks = (SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') FROM unnest(r.chunks || _index) x)
  WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'chunk_index', _index);
END $$;
REVOKE ALL ON FUNCTION public.mcp_file_upload_chunk(uuid, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_file_upload_chunk(uuid, uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_file_upload_complete(_id uuid, _job uuid, _result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_file_uploads;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO r FROM public.mcp_file_uploads WHERE id = _id AND job_id = _job FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That upload is not on this job.'; END IF;
  IF r.status = 'finished' THEN RETURN r.result; END IF;
  IF r.expires_at <= now() THEN RAISE EXCEPTION 'MCP_BAD:That upload link has expired. Start again. Nothing was stored.'; END IF;
  UPDATE public.mcp_file_uploads SET status = 'finished', result = _result WHERE id = r.id;
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_file_upload_complete(uuid, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_file_upload_complete(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_contract_document_save(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; doc_kind text; doc_body text; doc uuid; chars int;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t store a file on this job.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  doc_kind := _p->>'kind';
  IF doc_kind NOT IN ('contract', 'spec') THEN RAISE EXCEPTION 'MCP_BAD:Choose a contract or a spec.'; END IF;
  IF coalesce(_p->>'bucket', '') <> 'athena-documents' THEN RAISE EXCEPTION 'MCP_BAD:That file is not a contract or spec.'; END IF;
  IF coalesce(_p->>'path', '') NOT LIKE j.company_id::text || '/' || _job::text || '/%'
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'athena-documents' AND name = _p->>'path') THEN
    RAISE EXCEPTION 'MCP_BAD:The file is not stored on this job yet.';
  END IF;
  IF coalesce(_p->>'file_sha256', '') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:The stored file could not be checked.'; END IF;
  IF coalesce((_p->>'size_bytes')::int, 0) < 1 OR (_p->>'size_bytes')::int > 10485760 THEN RAISE EXCEPTION 'MCP_BAD:That file is over 10 MB. Nothing was stored.'; END IF;
  doc_body := coalesce(_p->>'body', '');
  IF length(doc_body) > 400000 THEN RAISE EXCEPTION 'MCP_BAD:The readable text is too long to store.'; END IF;
  chars := length(doc_body);
  IF doc_kind = 'contract' THEN
    INSERT INTO public.mcp_contract_documents (
      job_id, company_id, name, body, body_sha256, kind, storage_bucket, storage_path, mime_type, size_bytes, file_sha256, upload_id
    ) VALUES (
      _job, j.company_id, left(_p->>'name', 300), doc_body, encode(sha256(convert_to(doc_body, 'UTF8')), 'hex'), 'contract',
      'athena-documents', _p->>'path', _p->>'mime_type', (_p->>'size_bytes')::int, _p->>'file_sha256', nullif(_p->>'upload_id', '')::uuid
    )
    ON CONFLICT (job_id) WHERE kind = 'contract' DO UPDATE SET
      name = EXCLUDED.name, body = EXCLUDED.body, body_sha256 = EXCLUDED.body_sha256,
      storage_bucket = EXCLUDED.storage_bucket, storage_path = EXCLUDED.storage_path, mime_type = EXCLUDED.mime_type,
      size_bytes = EXCLUDED.size_bytes, file_sha256 = EXCLUDED.file_sha256, upload_id = EXCLUDED.upload_id,
      updated_at = now(), created_by = auth.uid()
    RETURNING id INTO doc;
  ELSE
    INSERT INTO public.mcp_contract_documents (
      job_id, company_id, name, body, body_sha256, kind, storage_bucket, storage_path, mime_type, size_bytes, file_sha256, upload_id
    ) VALUES (
      _job, j.company_id, left(_p->>'name', 300), doc_body, encode(sha256(convert_to(doc_body, 'UTF8')), 'hex'), 'spec',
      'athena-documents', _p->>'path', _p->>'mime_type', (_p->>'size_bytes')::int, _p->>'file_sha256', nullif(_p->>'upload_id', '')::uuid
    )
    ON CONFLICT (upload_id) WHERE upload_id IS NOT NULL DO UPDATE SET
      name = EXCLUDED.name, body = EXCLUDED.body, body_sha256 = EXCLUDED.body_sha256,
      storage_path = EXCLUDED.storage_path, size_bytes = EXCLUDED.size_bytes, file_sha256 = EXCLUDED.file_sha256,
      updated_at = now()
    RETURNING id INTO doc;
  END IF;
  PERFORM public.mcp_audit_job(_job, 'file_upload', 'store_' || doc_kind, doc::text);
  RETURN jsonb_build_object('id', doc, 'kind', doc_kind, 'name', left(_p->>'name', 300), 'body_chars', chars, 'truncated', coalesce((_p->>'truncated')::boolean, false), 'storage_path', _p->>'path', 'size_bytes', (_p->>'size_bytes')::int);
END $$;
REVOKE ALL ON FUNCTION public.mcp_contract_document_save(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_contract_document_save(uuid, jsonb) TO authenticated;

COMMIT;
