# Drawing attachment handoff

The live #220 acceptance test in normal ChatGPT could read the attached 24-page permit set but could not transfer it to Athena. No source or markup was stored. The stored CCW-003 takeoff remained unchanged. This is separate from the Workers renderer fixed by #220.

OpenAI's file-input contract requires a **top-level** file field named in the tool descriptor's `openai/fileParams`. Athena only accepted `drawing.file` and did not advertise file parameters, so the host never supplied a usable download reference. Reference: https://developers.openai.com/plugins/reference#define-file-inputs.

This fix adds an optional top-level `file` input to `drawing_set_import`, `estimate_intake` and `estimate_takeoff_save`. Each file declares required `download_url` and `file_id`, plus optional `mime_type` and `file_name`. The existing nested drawing input, raw-byte import, source links and stored-filename indexing remain supported. The new file reference is normalized into the existing download, size validation, hash-deduplication and immutable storage paths. Ambiguous simultaneous sources are rejected before storage. No model-generated base64, local sandbox paths, public file staging, new auth, migration, permissions or emails are required.

The existing registration bridge advertises file metadata, and the existing transport presentation pass restores it if an SDK drops it. Native and email card resources and all existing openai/outputTemplate values are preserved. No new prototype patch or request handler override is introduced. The committed manifest includes the new optional fields.

Verification: **2,042 tests across 195 files pass**, production build passes, and new helper/test files pass ESLint. TypeScript retains 34 baseline diagnostics with shifted line numbers in changed files only. Tests cover the real SDK tools/list descriptor and exact file schema, metadata repair without template changes, all three handlers, allowed-host downloads, source conflicts, optional file metadata, duplicate recognition and stored-sheet reopening without another source download. Existing original-file protections, size limits and Drive/Dropbox tests also pass in the full suite.

This branch includes the reviewed email-card #227 update and must ship after it. The host may need its supported tool refresh to discover the new optional field. Live attachment import, duplicate recognition, stored S-100 and dated markup acceptance are still required after an approved deployment. Do not call this a live-host pass from local tests.
