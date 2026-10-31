-- Reviewed source proposal for Lovable Cloud application only. Not applied by this patch.
-- No table grants or policy changes. Recovery returns only the caller's uploads
-- on a currently accessible job, without tokens, storage paths, or file content.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE FUNCTION public.mcp_file_upload_recovery(
  _job uuid, _upload uuid DEFAULT NULL, _before uuid DEFAULT NULL, _limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_catalog AS $$
DECLARE sc text; n integer := greatest(1,least(coalesce(_limit,25),25));
  cursor_time timestamptz; cursor_id uuid; result jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL OR sc NOT IN ('full','contract') THEN
    RAISE EXCEPTION 'MCP_BAD:Your role cannot recover uploads on this job.';
  END IF;
  IF _before IS NOT NULL THEN
    SELECT created_at,id INTO cursor_time,cursor_id FROM public.mcp_file_uploads
      WHERE id=_before AND job_id=_job AND created_by=auth.uid()
        AND (purpose<>'submittal_piece' OR sc='full');
    IF cursor_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That upload is not available on this job.'; END IF;
  END IF;
  WITH candidates AS (
    SELECT u.id AS upload_id,u.company_id,u.job_id,u.purpose,u.filename,u.mime_type,
      u.expires_at,u.status,u.created_at,
      (u.expires_at<=now() AND u.status<>'finished') AS expired,
      EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=u.bucket AND o.name=u.storage_path) AS bytes_received
    FROM public.mcp_file_uploads u
    WHERE u.job_id=_job AND u.created_by=auth.uid()
      AND (u.purpose<>'submittal_piece' OR sc='full')
      AND ((_upload IS NOT NULL AND u.id=_upload) OR (_upload IS NULL AND u.status='open'))
      AND (_before IS NULL OR (u.created_at,u.id)<(cursor_time,cursor_id))
    ORDER BY u.created_at DESC,u.id DESC LIMIT n+1
  ), page AS (
    SELECT * FROM candidates ORDER BY created_at DESC,upload_id DESC LIMIT n
  )
  SELECT jsonb_build_object(
    'uploads',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.upload_id DESC) FROM page p),'[]'::jsonb),
    'next_before',CASE WHEN (SELECT count(*) FROM candidates)>n
      THEN (SELECT upload_id FROM page ORDER BY created_at,upload_id LIMIT 1) ELSE NULL END
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_file_upload_recovery(uuid,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_file_upload_recovery(uuid,uuid,uuid,integer) TO authenticated;
COMMIT;
