-- Raise submittal package size check to 100 MB (104857600 bytes) to match file_upload.
-- 20261028120000 is already live; this does not edit it.
-- The athena-submittals bucket limit (storage.buckets.file_size_limit 52428800 -> 104857600)
-- is NOT changed here: Lovable's migration tool refuses writes to storage.buckets.
-- Update it with Lovable Cloud storage tooling per supabase/storage/athena-submittals.json.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.mcp_submittal_packages DROP CONSTRAINT mcp_submittal_packages_size_bytes_check;
ALTER TABLE public.mcp_submittal_packages
  ADD CONSTRAINT mcp_submittal_packages_size_bytes_check CHECK (size_bytes BETWEEN 1 AND 104857600);
COMMIT;
