-- LOCAL PROPOSAL ONLY. No live bucket or policy is changed by the application.
-- Provision this dedicated private bucket through Lovable's supported Storage UI
-- after specific access review. Do not reuse athena-files: its existing full/super
-- read policy would expose monetary bids to users denied by estimating's guard.
-- This proposal grants no new RPC EXECUTE permission and changes no existing
-- bucket policy. The existing guarded scope functions are reused.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id='athena-estimate-exports'
      AND public=false AND file_size_limit=10485760
      AND allowed_mime_types=ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'Provision and review the private estimating export bucket first.';
  END IF;
END $$;

CREATE POLICY "estimating bid export insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='athena-estimate-exports'
    AND public.mcp_gate()
    AND public.mcp_file_path_scope(name) IN ('full','contract')
  );
CREATE POLICY "estimating bid export select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id='athena-estimate-exports'
    AND public.mcp_gate()
    AND public.mcp_file_path_scope(name) IN ('full','contract')
  );
-- No authenticated UPDATE/DELETE policy: emitted bytes cannot be replaced.
