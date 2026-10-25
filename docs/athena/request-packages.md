# RFI and RFC packages on the shared submittal engine

This implementation adds numbered RFI and bid-stage RFC records. Installation approval submittals continue to use the existing engine. This release does not implement change-order pricing or execution; that work follows separately on the same package foundation.

## Member workflow

1. `rfi_record` or `rfc_record`, action `create`, saves the actual condition, question and drawing/detail, spec, contract or condition citation. Missing information produces a styled request for that information without allocating a number. A specification is not invented when the question instead cites a drawing or condition.
2. Read the distinct `rfi_log` / `rfc_log`, optionally by number, state or overdue member target. These are actual registered MCP tools, not lookahead substitutions. Every row opens the existing persistent record page. Each log has its own link at `/r/job/<job-id>/rfis` or `/rfcs`.
3. Use the existing `submittal_package` tool to log, collect or upload supporting pieces and build the company's letterhead cover/transmittal with the question and references, followed by the stored attachments. A question can form a complete package without an attachment; any attachment marked required must be collected before building.
4. Existing exact-draft approval and successful provider-receipt rules still govern delivery. Creating or building never sends. The request remains Draft, not sent until that receipt exists.
5. Capture the response with its exact text, respondent and received time. An answer is not automatic closure. Closing requires explicit confirmation; reopening creates a new draft revision and transmittal, preserving earlier questions, PDFs and receipts.

Every mutation has a caller-generated UUID `request_id` for retry safety. Updates also require the record version last read. A successful write followed by a failed log reload is acknowledged as saved, not incorrectly reported as an unsaved request.

Stored drawing IDs are checked against the job/company and bound to their actual source hash, version and filename. Plain citations remain citations: the presence of text does not prove a document was uploaded, read or verified. The host model supplies the construction reasoning; no Athena model call is introduced.

## Preserved package behavior

The migration defaults existing records to installation approval and preserves existing build fingerprints and pending exact chase approvals. It reuses storage, source originals, transmittal allocation, piece IDs, duplicate warnings, immutable builds, superseded history, job/company/member time-zone formatting, durable PDF links, record-page upload and receipt audit. Existing record and log link navigation and ChatGPT's widget/outputTemplate remain unchanged.

The record return-address whitelist recognizes the two new log routes and preserves their link token. Credentials, sign-in method, eight-digit codes, connector URL, OAuth and Hub logic are unchanged.

## Access and dates

Existing full-job package permissions govern writes. Superintendents retain the existing read-only view. Contract-only roles are not granted new package/file access by this release. RFC writes additionally require Office, Circle or Hardcore. Existing jobs, members and seats are not edited.

A request's date is explicitly a **member target**, or absent. This phase does not compute a contractual RFI response deadline or infer a contract clock. It does not implement automatic inbound response matching. The capture action records the response the member supplies.

## Cloud migration

Apply `20261025140000_athena_request_package_records.sql` only through the existing Lovable Cloud managed migration flow, after the already-live submittal log/chase, package, record-page and package-build-identity migrations. Source timestamps are not an instruction to replay historical migrations. The integration patches fail if expected shared function anchors changed; stop and review instead of improvising a database repair. No production data cleanup is part of this migration.

## Verification and live acceptance

Local tests run actual Postgres functions, the installed Supabase PromiseLike client, actual MCP handlers and actual PDF generation. They cover retry identity, stale edits, missing content, source binding, role denial, revoked/wrong-job tokens, caller-claim restoration, filtered-row/count agreement, source-reference preservation, existing approval fingerprints and pending approvals, and the complete RFI create/build/attach/rebuild/draft/receipt/answer/close/reopen path. Mail receipts in these tests are local fixtures; no email is sent.

Grok Bot/Tess run the live acceptance in ChatGPT, Claude and Grok Bot after publication. Use fictional example.com people only. Read existing submittals first to preserve #283/#284 behavior; create explicitly labeled QA RFI/RFC records on 2701, attach an approved test drawing, build once, check the real PDF, verify get does not build, reopen links, compare filtered and full logs, and verify numbering/history. Do not send any email for acceptance. Receipt-dependent answer/closure is proven locally; a live send is outside this retest.

Local browser and PDF screenshots are fixture evidence, not proof of host acceptance or live production access. Existing legacy TypeScript diagnostics are reported separately from the passing production build.
