# Storage buckets created outside migrations

Lovable's managed migration tool refuses `INSERT/UPDATE on storage.buckets`, so new buckets are created with Lovable's storage-bucket tooling, using the spec file here exactly as written.

- `athena-documents.json`: private bucket for contract and spec uploads (`file_upload`). Create it before applying `20261031120000_athena_file_upload.sql`; the migration's policies and functions refer to it by id.
