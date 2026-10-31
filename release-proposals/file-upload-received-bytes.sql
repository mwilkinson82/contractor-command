-- Unapplied proposal for the Lovable Cloud native migration runner (transaction supplied by runner).
-- Preserve all signatures, ACLs, creator/job/purpose checks and two-hour transport expiry.
-- Only already-received, unmodified in-time objects or contiguous registered chunks qualify.
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
      (receipt.object_received OR receipt.chunks_received) AS bytes_received,
      CASE WHEN receipt.object_received THEN 'object' WHEN receipt.chunks_received THEN 'chunks' ELSE NULL END AS received_via,
      coalesce(cardinality(u.chunks),0) AS received_chunks
    FROM public.mcp_file_uploads u
    CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM storage.objects o
        WHERE o.bucket_id=u.bucket AND o.name=u.storage_path
          AND greatest(o.created_at,o.updated_at)<=u.expires_at) AS object_received,
      (coalesce(cardinality(u.chunks),0)>0
        AND (SELECT min(i)=0 AND count(DISTINCT i)=max(i)+1 FROM unnest(u.chunks) i)
        AND NOT EXISTS(SELECT 1 FROM unnest(u.chunks) i WHERE NOT EXISTS(
          SELECT 1 FROM storage.objects o WHERE o.bucket_id=u.bucket
            AND o.name=u.storage_path||'.part.'||i::text
            AND greatest(o.created_at,o.updated_at)<=u.expires_at))) AS chunks_received) receipt
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

CREATE OR REPLACE FUNCTION public.mcp_file_upload_complete(_id uuid, _job uuid, _result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.mcp_file_uploads; sc text; received boolean;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL OR sc NOT IN ('full','contract') THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO r FROM public.mcp_file_uploads WHERE id = _id AND job_id = _job AND created_by = auth.uid()
    AND (purpose <> 'submittal_piece' OR sc = 'full') FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That upload is not available on this job.'; END IF;
  IF r.status = 'finished' THEN RETURN r.result; END IF;
  SELECT (EXISTS(SELECT 1 FROM storage.objects o
        WHERE o.bucket_id=u.bucket AND o.name=u.storage_path
          AND greatest(o.created_at,o.updated_at)<=u.expires_at) OR (coalesce(cardinality(u.chunks),0)>0
        AND (SELECT min(i)=0 AND count(DISTINCT i)=max(i)+1 FROM unnest(u.chunks) i)
        AND NOT EXISTS(SELECT 1 FROM unnest(u.chunks) i WHERE NOT EXISTS(
          SELECT 1 FROM storage.objects o WHERE o.bucket_id=u.bucket
            AND o.name=u.storage_path||'.part.'||i::text
            AND greatest(o.created_at,o.updated_at)<=u.expires_at)))) INTO received
    FROM public.mcp_file_uploads u WHERE u.id=r.id;
  IF r.expires_at <= now() AND NOT coalesce(received,false) THEN
    RAISE EXCEPTION 'MCP_BAD:The upload link expired before eligible bytes were received. Start a new upload.';
  END IF;
  UPDATE public.mcp_file_uploads SET status = 'finished', result = _result WHERE id = r.id;
  RETURN _result;
END $$;

