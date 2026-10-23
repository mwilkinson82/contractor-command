# Stored drawing markup — review and acceptance

## Scope

Adds two actual MCP tools: `drawing_set_import` and `drawing_markup`. Both appear in the generated manifest and real `tools/list`; card widget metadata remains on results only. Both pass the existing membership/job guard. No sign-in, Hub, Site URL, email-code or connector endpoint changes.

A SHA-256 fingerprint of the PDF controls file identity within a company/job. New PDFs use a deterministic private `drawing-<hash>/source.pdf` path with `upsert:false`; concurrent identical uploads converge on one object. Existing #190 files are matched by their bytes and indexed in place. Re-sharing an identical file reuses its existing object. Files in another job or company are never reused.

One additive table, `mcp_drawing_versions`, records source revisions and markup copies, their hashes, sheet indexes, timestamps, storage buckets and creators. It is not directly readable or writable by members. New SECURITY DEFINER functions use the existing `mcp_estimate_guard` (membership and full/contract job scope). Supers and unauthorized users are denied. A new private PDF-only `athena-drawings` bucket holds new originals; new policies recheck membership and job/company scope and permit insert/select only. Existing buckets, tables, functions, policies and auth configuration are not altered. Legacy sources and markup copies retain their existing `athena-files` paths. The migration is staged in `20261027130000_athena_drawing_versions.sql`; it was exercised only in isolated test databases.

## Using the tools

- Import an upload through `drawing_set_import` with `drawing.filename`, `drawing.content_base64`, and `drawing.sheets` in PDF page order.
- Import a provider link with `drawing.source_url` (Google Drive or Dropbox), plus the filename and page-order sheet index when known. Athena downloads the PDF by GET and retains the source link. Changed bytes at the same source are a new revision; previous files and records remain. A source that changes back to older bytes also gets a new revision while reusing the existing file object.
- If a set is already stored but lacks its page-order index, use `stored_filename` and `sheets` on `drawing_set_import`. No new upload or provider access is required. Corrected index metadata is retained as a new revision; file bytes are reused.
- `drawing_markup` with `job_number` and `sheet` defaults to saving a new dated copy from saved takeoff references. It returns the actual stored sheet, rendered markup preview, styled card and a 15-minute PDF download link. Repeating save creates another numbered, dated version.
- To create new findings, call `drawing_markup` with `operation: prepare`, inspect the returned stored page, then call save with `annotations`. Pins, lines and area outlines use normalized coordinates from 0 to 1, measured from the top-left of the returned image.
- No locations or quantities are guessed. Findings without coordinates appear in a numbered key only. Saved takeoff references still need review against the source revision. If no findings exist or are supplied, the output explicitly says it is a review copy and claims no review or measurements.

## Provider boundaries

Downloads use HTTPS, provider-specific allowlists, a timeout, capped redirects and a capped streamed body. Each redirect is validated before fetching. Credentials are never forwarded. Sign-in pages and other non-PDF responses are rejected without recording them as drawings. Every source request is GET; no provider file, permission or sharing setting is modified.

Private files require an authorized downloadable link or PDF bytes supplied by the member's connected AI. `drawing.source_url` can accompany those bytes to preserve provenance. This does not add Drive/Dropbox OAuth or change sharing permissions. Drawing originals have a separate **50 MiB** limit. Ordinary file sharing and generated markup PDFs keep their existing **10 MiB** limits. New original objects cannot be updated or deleted through the new member storage policies. Oversize downloads are canceled before an object/record is created.

The hosting project's global storage limit must permit the new bucket's 50 MiB limit. No production setting was changed here; the release team must verify it in the approved environment. Source downloads are bounded and uploads use the existing standard Storage API. A hosted transfer test remains required; a local test cannot establish provider/network reliability.

## Appearance

The server draws onto an image of the actual stored sheet and exports a landscape PDF with a numbered callout key. Source PDFs remain intact, including their native vector content; markup PDFs contain a raster sheet preview with server-drawn annotations. The source preview uses #190's 1,600-pixel long-edge limit. Downloads retain the complete key even when it spans pages.

Annotation colors are navy, #1E5FED blue and gray; explicit risk and delay annotations alone use #DC2626. Colors already present in the original drawing are preserved. Geometry is never fabricated from textual locations. The card includes the source revision, markup version, date and download; the MCP response also includes a rendered PNG for hosts that display images.

## Verification and release gate

Updated onto `55fe621b` (#206), including the full-reply fix after the #203 rollback. Conflict resolution retains `lookahead_get` and both drawing tools in the real registry, card lists and manifest. The registry guard covers 71 tools. The migration remains `20261027130000_athena_drawing_versions.sql`, avoiding the #201 version collision. The later storage follow-up adds the drawing-only bucket/limit and reads each source from its recorded bucket, with legacy fallback. Rendering remains unchanged.

- Default Vitest: **173 files / 1,818 tests PASS**.
- Production build: **PASS**.
- Typecheck: **34 baseline errors**, with no new diagnostic location/code. The existing tool-union diagnostic includes the two added drawing tools; this remains baseline-failing.
- The separate role suite is excluded by the repository's default test command. It was run explicitly on both this branch and a clean archive of current base `e8f66d3c`: **114 passed / 56 failed on each**, with identical failing test names. These are open baseline failures, not a role-suite pass; their disposition remains a release-readiness item. The drawing-specific real-Postgres membership/job-scope/direct-write tests pass within the default suite.
- Coverage includes legacy stored-sheet pull, no-upload indexing, re-shared and concurrent duplicates, source revisions, second dated markups, preservation of original/earlier copies, supplied geometry, private-source bytes, Drive/Dropbox imports, unsafe redirects/body limits, real tools/list, result-only widget metadata and migration-version uniqueness. New cases cover a fictional 17 MiB PDF, unchanged file_share cap, oversize cancellation, bucket validation and real Storage RLS for roles, active membership, company scope and immutable originals.
- A private local run also used the actual 17,612,902-byte, 24-page CCW permit PDF obtained from Marshall's authorized source email. The working server code stored it once in in-memory storage, recognized the identical second share, pulled S-100 from page 15 without re-upload, generated two separately dated markups, and preserved both the source object hash and local original hash. Server-rendered source and markup/key previews were visually inspected. The source, quantities and outputs remain private and are not committed. This is actual-file parser/rendering evidence with fake storage/RPC; it is not a production import or host acceptance pass.
- The earlier fictional-sheet PDF/PNG visual review remains applicable because the renderer is unchanged. No live Drive/Dropbox transfer, host or production migration test is claimed.

The candidate is now updated onto `e8f66d3c` (#207), retaining the team's Grokbot phone-list fallback. The full suite, build, type baseline and separate role comparison were rerun after that update. The initial test attempt hit a transient filesystem scan error in generated build output before any test ran; the repeated run after build completion passed. No test configuration was weakened.

Tess must run Marshall's seven drawing acceptance tests on job 2701 in ChatGPT, Claude and Grok Bot, plus the locked do-not-break checks: hidden-line suppression, CPM panning, correct lookahead data, repeated full brief with inbox/calendar, red delay/fragnet banner and #190 stored-page retrieval. Confirm S-100 is actually stored with the correct page index; do not manufacture job data or drawing locations. Never send real emails or open checkout.

No merge, deployment, production migration or change to sign-in/Hub/Site URL/email codes/connector address was performed. Release requires Gage's review, Tess's live proof, resolution of the open readiness findings and Marshall's explicit approval.
