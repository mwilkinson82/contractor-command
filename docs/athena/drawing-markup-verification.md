# Stored drawing markup — review and acceptance

## Scope

Adds two actual MCP tools: `drawing_set_import` and `drawing_markup`. Both appear in the generated manifest and real `tools/list`; card widget metadata remains on results only. Both pass the existing membership/job guard. No sign-in, Hub, Site URL, email-code or connector endpoint changes.

A SHA-256 fingerprint of the PDF controls file identity within a company/job. New PDFs use a deterministic private `drawing-<hash>/source.pdf` path with `upsert:false`; concurrent identical uploads converge on one object. Existing #190 files are matched by their bytes and indexed in place. Re-sharing an identical file reuses its existing object. Files in another job or company are never reused.

One additive table, `mcp_drawing_versions`, records source revisions and markup copies, their hashes, sheet indexes, timestamps and creators. It is not directly readable or writable by members. New SECURITY DEFINER functions use the existing `mcp_estimate_guard` (membership and full/contract job scope). Supers and unauthorized users are denied. Existing tables, functions, policies and auth configuration are not altered. The migration is staged in `20261027120000_athena_drawing_versions.sql`; it was exercised only in isolated test databases.

## Using the tools

- Import an upload through `drawing_set_import` with `drawing.filename`, `drawing.content_base64`, and `drawing.sheets` in PDF page order.
- Import a provider link with `drawing.source_url` (Google Drive or Dropbox), plus the filename and page-order sheet index when known. Athena downloads the PDF by GET and retains the source link. Changed bytes at the same source are a new revision; previous files and records remain. A source that changes back to older bytes also gets a new revision while reusing the existing file object.
- If a set is already stored but lacks its page-order index, use `stored_filename` and `sheets` on `drawing_set_import`. No new upload or provider access is required. Corrected index metadata is retained as a new revision; file bytes are reused.
- `drawing_markup` with `job_number` and `sheet` defaults to saving a new dated copy from saved takeoff references. It returns the actual stored sheet, rendered markup preview, styled card and a 15-minute PDF download link. Repeating save creates another numbered, dated version.
- To create new findings, call `drawing_markup` with `operation: prepare`, inspect the returned stored page, then call save with `annotations`. Pins, lines and area outlines use normalized coordinates from 0 to 1, measured from the top-left of the returned image.
- No locations or quantities are guessed. Findings without coordinates appear in a numbered key only. Saved takeoff references still need review against the source revision. If no findings exist or are supplied, the output explicitly says it is a review copy and claims no review or measurements.

## Provider boundaries

Downloads use HTTPS, provider-specific allowlists, a timeout, capped redirects and a capped streamed body. Each redirect is validated before fetching. Credentials are never forwarded. Sign-in pages and other non-PDF responses are rejected without recording them as drawings. Every source request is GET; no provider file, permission or sharing setting is modified.

Private files require an authorized downloadable link or PDF bytes supplied by the member's connected AI. `drawing.source_url` can accompany those bytes to preserve provenance. This does not add Drive/Dropbox OAuth or change sharing permissions. The existing drawing/file limit remains 10 MB per PDF.

## Appearance

The server draws onto an image of the actual stored sheet and exports a landscape PDF with a numbered callout key. Source PDFs remain intact, including their native vector content; markup PDFs contain a raster sheet preview with server-drawn annotations. The source preview uses #190's 1,600-pixel long-edge limit. Downloads retain the complete key even when it spans pages.

Annotation colors are navy, #1E5FED blue and gray; explicit risk and delay annotations alone use #DC2626. Colors already present in the original drawing are preserved. Geometry is never fabricated from textual locations. The card includes the source revision, markup version, date and download; the MCP response also includes a rendered PNG for hosts that display images.

## Verification and release gate

Automated coverage includes legacy stored-sheet pull, no-upload indexing, re-shared and concurrent duplicates, source revision history, second markup copies, source/earlier-copy preservation, supplied geometry, private-source bytes, Drive/Dropbox imports, unsafe redirects, oversized bodies, real `tools/list`, result-only widget metadata, and real Postgres job/membership/direct-access denials.

Verification on the final implementation: 169 test files / 1,754 tests passed and the production build passed. In a separate local checkout, the #196 patch applies cleanly with three-way application; the combined tree passes 170 files / 1,758 tests and its production build. TypeScript remains baseline-failing with the same 34 diagnostic signatures and none added. Semantic ESLint passes the changed drawing/tool/test files with the existing formatting rule disabled. A local fictional-sheet PDF/PNG review accompanies the logs outside the repository. Real host tests and provider-account permission flows have not been run by Codex.

This PR ships only after #196 and #197 and Marshall's explicit approval. #197 was already in the base at implementation time. #196 is a dependency; once merged, update this branch onto its tip and rerun the regression suite/build before shipping.

Tess must run Marshall's seven acceptance tests on job 2701 in ChatGPT, Claude and Grok Bot, plus the locked do-not-break checks: hidden-line suppression, CPM panning, correct lookahead data, repeated full brief with inbox/calendar, red delay/fragnet banner, and #190 stored-page retrieval. Confirm the fixture actually has S-100 stored with a correct page index; do not manufacture job data or drawing locations. Never send real emails or open checkout.
