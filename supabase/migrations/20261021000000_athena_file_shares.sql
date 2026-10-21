-- Athena 0.8.11: file share links. The host builds the file; Athena stores it in a private bucket under
-- <company_id>/<job_id>/<share_id>/<filename> and returns https://app.meetathena.io/f/<token>.
-- Only a SHA-256 of the token is stored. Additive only: one bucket, one table, storage policies, four functions.
-- NOT APPLIED. Apply only after Marshall's yes.

-- Private bucket (never public). 10 MB per file; PDF, xlsx, docx, csv, png only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('athena-files', 'athena-files', false, 10485760, ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'image/png'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Every share, per job (the share log).
CREATE TABLE IF NOT EXISTS public.mcp_file_shares (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sov', 'schedule', 'report', 'notice', 'other')),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 130),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  signed_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  download_count integer NOT NULL DEFAULT 0,
  last_downloaded_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_file_shares_job_idx ON public.mcp_file_shares (job_id, created_at DESC);

ALTER TABLE public.mcp_file_shares ENABLE ROW LEVEL SECURITY;
-- No direct table access for members or anon (the row carries the signed URL). Everything goes through the functions.
REVOKE ALL ON public.mcp_file_shares FROM anon, authenticated, public;
GRANT ALL ON public.mcp_file_shares TO service_role;

-- Path check for storage policies: <company>/<job>/<id>/<name>, the job belongs to the company, caller's scope.
CREATE OR REPLACE FUNCTION public.mcp_file_path_scope(_name text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE parts text[] := string_to_array(_name, '/'); j uuid; c uuid;
BEGIN
  IF array_length(parts, 1) <> 4 THEN RETURN NULL; END IF;
  BEGIN j := parts[2]::uuid; c := parts[1]::uuid; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_jobs WHERE id = j AND company_id = c) THEN RETURN NULL; END IF;
  RETURN public.mcp_job_scope(j);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_file_path_scope(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_file_path_scope(text) TO authenticated;

-- Storage: members with full or super scope on the job may write/read/delete under that job's folder. No anon policy.
DROP POLICY IF EXISTS "athena files insert job scope" ON storage.objects;
CREATE POLICY "athena files insert job scope" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'athena-files' AND public.mcp_file_path_scope(name) IN ('full', 'super'));
DROP POLICY IF EXISTS "athena files select job scope" ON storage.objects;
CREATE POLICY "athena files select job scope" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'athena-files' AND public.mcp_file_path_scope(name) IN ('full', 'super'));
DROP POLICY IF EXISTS "athena files delete job scope" ON storage.objects;
CREATE POLICY "athena files delete job scope" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'athena-files' AND public.mcp_file_path_scope(name) IN ('full', 'super'));

-- Log a share after the upload. Re-checks scope (supers: schedule only), path, size, mime and expiry.
CREATE OR REPLACE FUNCTION public.mcp_file_share_create(
  _id uuid, _job uuid, _kind text, _filename text, _mime text, _size bigint, _sha256 text,
  _path text, _token_hash text, _signed_url text, _expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; co uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc = 'contract' OR (sc = 'super' AND _kind <> 'schedule') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t share it.'; END IF;
  SELECT company_id INTO co FROM public.mcp_jobs WHERE id = _job;
  IF _path <> co::text || '/' || _job::text || '/' || _id::text || '/' || _filename THEN RAISE EXCEPTION 'MCP_BAD:File path doesn''t match the job.'; END IF;
  IF _mime NOT IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/csv', 'image/png') THEN RAISE EXCEPTION 'MCP_BAD:That file type can''t be shared.'; END IF;
  IF _expires_at <= now() OR _expires_at > now() + interval '90 days 1 hour' THEN RAISE EXCEPTION 'MCP_BAD:Links last 1 to 90 days.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'athena-files' AND name = _path) THEN RAISE EXCEPTION 'MCP_BAD:The file wasn''t stored. Nothing was shared.'; END IF;
  INSERT INTO public.mcp_file_shares (id, company_id, job_id, kind, filename, mime_type, size_bytes, sha256, storage_path, token_hash, signed_url, expires_at)
  VALUES (_id, co, _job, _kind, _filename, _mime, _size, _sha256, _path, _token_hash, _signed_url, _expires_at);
  RETURN jsonb_build_object('id', _id);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_file_share_create(uuid, uuid, text, text, text, bigint, text, text, text, text, timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_file_share_create(uuid, uuid, text, text, text, bigint, text, text, text, text, timestamptz) TO authenticated;

-- Turn a link off: full job scope, or the member who shared it. Returns the storage path so the caller deletes the object.
CREATE OR REPLACE FUNCTION public.mcp_file_share_revoke(_job uuid, _token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_file_shares; sc text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO r FROM public.mcp_file_shares WHERE job_id = _job AND token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF sc <> 'full' AND r.created_by <> auth.uid() THEN RAISE EXCEPTION 'MCP_BAD:Only the person who shared it or someone with full job access can turn it off.'; END IF;
  UPDATE public.mcp_file_shares SET revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid()), signed_url = '' WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'path', r.storage_path, 'filename', r.filename);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_file_share_revoke(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_file_share_revoke(uuid, text) TO authenticated;

-- Public download lookup (anon): hash in, one live row out. Expired, turned-off or unknown links return NULL.
CREATE OR REPLACE FUNCTION public.mcp_file_share_open(_token_hash text, _count boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_file_shares;
BEGIN
  IF _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.mcp_file_shares WHERE token_hash = _token_hash AND revoked_at IS NULL AND expires_at > now() AND signed_url <> '';
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF _count THEN UPDATE public.mcp_file_shares SET download_count = download_count + 1, last_downloaded_at = now() WHERE id = r.id; END IF;
  RETURN jsonb_build_object('filename', r.filename, 'mime_type', r.mime_type, 'size_bytes', r.size_bytes, 'signed_url', r.signed_url);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_file_share_open(text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_file_share_open(text, boolean) TO anon, authenticated;

-- Share log for a job (no tokens, no URLs). Full scope sees all; others see their own.
CREATE OR REPLACE FUNCTION public.mcp_file_share_list(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text := public.mcp_job_scope(_job);
BEGIN
  PERFORM public.mcp_assert_active();
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'filename', filename, 'size_bytes', size_bytes, 'created_at', created_at,
    'expires_at', expires_at, 'revoked_at', revoked_at, 'download_count', download_count, 'last_downloaded_at', last_downloaded_at) ORDER BY created_at DESC)
    FROM public.mcp_file_shares WHERE job_id = _job AND (sc = 'full' OR created_by = auth.uid())), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_file_share_list(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_file_share_list(uuid) TO authenticated;
