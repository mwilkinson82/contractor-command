# Storage buckets created outside migrations

Lovable's managed migration tool refuses `INSERT/UPDATE on storage.buckets`, so new buckets are created with Lovable's storage-bucket tooling, using the spec file here exactly as written.

- `athena-documents.json`: private bucket for contract and spec uploads (`file_upload`), 100 MB per file (104857600 bytes), no bucket MIME list. The app itself only accepts PDF, DOCX and TXT (extension and magic-byte checks in `src/lib/mcp/file-upload.ts`). Create it before applying `20261031120000_athena_file_upload.sql`; the migration's policies and functions refer to it by id.
- `athena-submittals.json`: existing private bucket (created by `20261028120000`). Update its `file_size_limit` to 104857600 (100 MB) with Lovable storage tooling; MIME list unchanged.
