# Storage bucket capability findings (read-only, nothing executed)

## Create action: `supabase--storage_create_bucket`
Schema (exact):
```text
{ name: string (required), public: boolean (required),
  file_size_limit?: string  // "Largest single file the bucket accepts, as a size
                            //  with a unit ("500KB", "50MB", "2GB"). Omit to
                            //  inherit the project-wide limit." }
additionalProperties: false
```
Doc quote: "public: false (default) = private, RLS-gated." / "file_size_limit: largest single file the bucket accepts, written with a unit ... A value above the project-wide limit is rejected."

## Update action: `supabase--storage_update_bucket`
Schema: `name` (required), `public?`, `file_size_limit?` (string with unit), `remove_file_size_limit?` (boolean). additionalProperties: false.

## Field support for your request
- Private bucket: supported (`public: false`).
- Per-bucket limit of exactly 104857600 bytes: likely expressible as `"100MB"`, but the docs do not state whether MB means 10^6 or 2^20 bytes, and no raw byte form is documented. Exact 104857600 is NOT verifiable from documentation. It must also not exceed the project-wide limit (current value not checked).
- MIME allowlist (pdf, docx, text/plain, jpeg, png): NOT supported. Neither schema has an allowed-MIME-types field, and additionalProperties is false.

## Approval at action time
The tool descriptions mention no approval step. The approvals tool lists only `tool.connector.call`, `tool.mcp.call`, `tool.workspace_settings.update` as approvable, so no human approval card is documented for these actions. Whether a workspace policy (e.g. public-bucket blocking) applies is noted only for public buckets.

## Conclusion
No supported action is verifiable that creates this bucket with all requested fields. The MIME allowlist cannot be set, and the exact byte limit is unconfirmed.
