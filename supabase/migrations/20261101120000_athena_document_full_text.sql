-- Store the full readable text of a contract or spec. The old 400,000-character cap dropped
-- everything after about page 252. Text now arrives in parts of at most 1,000,000 characters:
-- mcp_contract_document_save takes the first part, mcp_contract_document_append adds the rest.
BEGIN;

CREATE OR REPLACE FUNCTION public.mcp_contract_document_save(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; doc_kind text; doc_body text; doc_id uuid; chars int;
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
  IF coalesce((_p->>'size_bytes')::int, 0) < 1 OR (_p->>'size_bytes')::int > 104857600 THEN RAISE EXCEPTION 'MCP_BAD:That file is over 100 MB. Nothing was stored.'; END IF;
  doc_body := coalesce(_p->>'body', '');
  IF length(doc_body) > 1000000 THEN RAISE EXCEPTION 'MCP_BAD:Send the readable text in parts of at most 1,000,000 characters.'; END IF;
  chars := length(doc_body);
  IF doc_kind = 'contract' THEN
    INSERT INTO public.mcp_contract_documents (
      job_id, company_id, name, body, body_sha256, kind, storage_bucket, storage_path, mime_type, size_bytes, file_sha256, upload_id
    ) VALUES (
      _job, j.company_id, left(_p->>'name', 300), doc_body, encode(sha256(convert_to(doc_body, 'UTF8')), 'hex'), 'contract',
      'athena-documents', _p->>'path', _p->>'mime_type', (_p->>'size_bytes')::int, _p->>'file_sha256', nullif(_p->>'upload_id', '')::uuid
    )
    ON CONFLICT (job_id) DO UPDATE SET
      name = EXCLUDED.name, body = EXCLUDED.body, body_sha256 = EXCLUDED.body_sha256, kind = EXCLUDED.kind,
      storage_bucket = EXCLUDED.storage_bucket, storage_path = EXCLUDED.storage_path, mime_type = EXCLUDED.mime_type,
      size_bytes = EXCLUDED.size_bytes, file_sha256 = EXCLUDED.file_sha256, upload_id = EXCLUDED.upload_id,
      updated_at = now(), created_by = auth.uid()
    RETURNING id INTO doc_id;
  ELSE
    INSERT INTO public.mcp_spec_documents (
      job_id, company_id, name, body, body_sha256, storage_bucket, storage_path, mime_type, size_bytes, file_sha256, upload_id
    ) VALUES (
      _job, j.company_id, left(_p->>'name', 300), doc_body, encode(sha256(convert_to(doc_body, 'UTF8')), 'hex'),
      'athena-documents', _p->>'path', _p->>'mime_type', (_p->>'size_bytes')::int, _p->>'file_sha256', nullif(_p->>'upload_id', '')::uuid
    )
    ON CONFLICT (upload_id) DO UPDATE SET
      name = EXCLUDED.name, body = EXCLUDED.body, body_sha256 = EXCLUDED.body_sha256,
      storage_path = EXCLUDED.storage_path, size_bytes = EXCLUDED.size_bytes, file_sha256 = EXCLUDED.file_sha256,
      updated_at = now()
    RETURNING id INTO doc_id;
  END IF;
  PERFORM public.mcp_audit_job(_job, 'file_upload', 'store_' || doc_kind, doc_id::text);
  RETURN jsonb_build_object('id', doc_id, 'kind', doc_kind, 'name', left(_p->>'name', 300), 'body_chars', chars, 'truncated', coalesce((_p->>'truncated')::boolean, false), 'storage_path', _p->>'path', 'size_bytes', (_p->>'size_bytes')::int);
END $$;
REVOKE ALL ON FUNCTION public.mcp_contract_document_save(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_contract_document_save(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_contract_document_append(_job uuid, _kind text, _id uuid, _part text, _last boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; chars int;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t store a file on this job.'; END IF;
  IF _kind NOT IN ('contract', 'spec') THEN RAISE EXCEPTION 'MCP_BAD:Choose a contract or a spec.'; END IF;
  IF coalesce(length(_part), 0) > 1000000 THEN RAISE EXCEPTION 'MCP_BAD:Send the readable text in parts of at most 1,000,000 characters.'; END IF;
  IF _kind = 'contract' THEN
    UPDATE public.mcp_contract_documents SET body = body || coalesce(_part, ''), updated_at = now()
      WHERE id = _id AND job_id = _job RETURNING length(body) INTO chars;
    IF chars IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That document is not on this job.'; END IF;
    IF _last THEN
      UPDATE public.mcp_contract_documents SET body_sha256 = encode(sha256(convert_to(body, 'UTF8')), 'hex') WHERE id = _id;
    END IF;
  ELSE
    UPDATE public.mcp_spec_documents SET body = body || coalesce(_part, ''), updated_at = now()
      WHERE id = _id AND job_id = _job RETURNING length(body) INTO chars;
    IF chars IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That document is not on this job.'; END IF;
    IF _last THEN
      UPDATE public.mcp_spec_documents SET body_sha256 = encode(sha256(convert_to(body, 'UTF8')), 'hex') WHERE id = _id;
    END IF;
  END IF;
  RETURN jsonb_build_object('id', _id, 'body_chars', chars);
END $$;
REVOKE ALL ON FUNCTION public.mcp_contract_document_append(uuid, text, uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_contract_document_append(uuid, text, uuid, text, boolean) TO authenticated;

COMMIT;
