-- Additive. Drawing sets live in the existing private athena-files bucket.
-- The object name is <company_id>/<job_id>/drawing-<id>/<filename>.
-- Full scope already reads and writes every object in that bucket.
-- Contract scope can read the takeoff, so it can read and write drawing objects only.
-- Other files stay on the existing full/super policies. No drops, no deletes, no column changes.
-- The storage path itself is a nullable key on each mcp_estimate_setup.documents entry.
-- Entries without that key stay valid.

DROP POLICY IF EXISTS "athena drawing files insert" ON storage.objects;
CREATE POLICY "athena drawing files insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'athena-files'
    AND split_part(name, '/', 3) LIKE 'drawing-%'
    AND public.mcp_file_path_scope(name) IN ('full', 'contract')
  );

DROP POLICY IF EXISTS "athena drawing files select" ON storage.objects;
CREATE POLICY "athena drawing files select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'athena-files'
    AND split_part(name, '/', 3) LIKE 'drawing-%'
    AND public.mcp_file_path_scope(name) IN ('full', 'contract')
  );

DROP POLICY IF EXISTS "athena drawing files delete" ON storage.objects;
CREATE POLICY "athena drawing files delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'athena-files'
    AND split_part(name, '/', 3) LIKE 'drawing-%'
    AND public.mcp_file_path_scope(name) IN ('full', 'contract')
  );
