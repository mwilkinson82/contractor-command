-- Apply through Lovable Cloud only.
-- Progress photos can be removed or replaced by a member with full or super access to the job. Nothing is deleted:
-- the row and its stored file are kept with who removed it, when, why, and the photo that replaced it, so a daily's
-- photo record can be reconstructed in a dispute. Removed photos drop out of the gallery, the daily and chat lists.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mcp_progress_photos
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid,
  ADD COLUMN IF NOT EXISTS removed_reason text,
  ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES public.mcp_progress_photos(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.mcp_progress_photo_remove(_id uuid, _reason text, _replaced_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.mcp_progress_photos; why text := btrim(coalesce(_reason, ''));
BEGIN
  SELECT * INTO p FROM public.mcp_progress_photos WHERE id = _id;
  IF NOT FOUND OR public.mcp_job_scope(p.job_id) IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:That photo wasn''t found on a job you can see. Nothing was changed.';
  END IF;
  PERFORM public.mcp_field_guard(p.job_id);
  IF p.removed_at IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:That photo was already removed. Nothing was changed.'; END IF;
  IF length(why) < 3 OR length(why) > 400 THEN
    RAISE EXCEPTION 'MCP_BAD:Say briefly why the photo is being removed. Nothing was changed.';
  END IF;
  IF _replaced_by IS NOT NULL THEN
    IF _replaced_by = _id OR NOT EXISTS (
      SELECT 1 FROM public.mcp_progress_photos r
      WHERE r.id = _replaced_by AND r.job_id = p.job_id AND r.removed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'MCP_BAD:The replacement photo isn''t saved on this job. Nothing was changed.';
    END IF;
  END IF;
  UPDATE public.mcp_progress_photos
     SET removed_at = now(), removed_by = auth.uid(), removed_reason = why, replaced_by = _replaced_by
   WHERE id = _id;
  PERFORM public.mcp_audit_job(p.job_id, 'progress_photo', CASE WHEN _replaced_by IS NULL THEN 'remove' ELSE 'replace' END, _id::text);
  RETURN jsonb_build_object('id', _id, 'taken_on', p.taken_on, 'area', p.area, 'removed', true, 'replaced_by', _replaced_by);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_progress_photo_remove(uuid, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_progress_photo_remove(uuid, text, uuid) TO authenticated;

-- Same list as before, without removed photos. VOLATILE as set by 0056 (its member gate can write).
CREATE OR REPLACE FUNCTION public.mcp_progress_photos_list(_job uuid, _from date, _to date, _item text, _area text, _client_safe boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; rows jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'taken_on', p.taken_on, 'area', p.area, 'work', p.work, 'sov_item', p.sov_item,
    'activity_id', p.activity_id, 'client_safe', p.client_safe, 'storage_path', p.storage_path, 'mime_type', p.mime_type)
    ORDER BY p.taken_on DESC, p.created_at DESC), '[]'::jsonb) INTO rows
  FROM (
    SELECT * FROM public.mcp_progress_photos p
    WHERE p.job_id = _job
      AND p.removed_at IS NULL
      AND (_from IS NULL OR p.taken_on >= _from)
      AND (_to IS NULL OR p.taken_on <= _to)
      AND (_area IS NULL OR p.area ILIKE '%' || _area || '%')
      AND (_item IS NULL OR p.sov_item = _item OR p.activity_id = _item OR p.work ILIKE '%' || _item || '%')
      AND (_client_safe IS NULL OR p.client_safe = _client_safe)
    ORDER BY p.taken_on DESC, p.created_at DESC
    LIMIT 60
  ) p;
  RETURN rows;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_progress_photos_list(uuid, date, date, text, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_progress_photos_list(uuid, date, date, text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
