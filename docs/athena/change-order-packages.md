# Change-order packages and execution

Change orders use the same company cover/transmittal, supporting-piece upload, immutable PDF, revision/history and exact-approved-delivery workflow as installation submittals and RFI/RFC packages. This extends the RFI/RFC foundation in #286.

## Member flow

- `change_order_record create` saves a numbered PCO with the actual condition, requested scope, source references, owner/contractor origin, recipient and optional owner's number. The persistent record remains at its PCO address; an issued CO number is an additional identifier, not a replacement URL.
- `price` requires sourced labor/material/equipment/subcontract/other cost lines. Athena multiplies quantity by integer-cent rates, rounds each line once, and applies explicitly supplied markup basis points to direct costs. Credits use negative rates. Rates, quantities and contract bases are never invented. Price, scope, date and recipient edits invalidate prior draft pricing/build context as appropriate.
- `change_order_log` is a real read-only registered tool, with a persistent `/r/job/<id>/cos` board, state/overdue filters and linked rows. Reads allocate no numbers and build nothing.
- `submittal_package` collects supporting pieces and builds the real sourced proposal PDF. Required missing attachments block the build. Ordinary submittal upload, duplicate warning, source preservation, transmittal allocation, durable links and history are reused.
- Submission requires the existing exact draft approval and successful provider receipt. A status label or building a PDF is not a send. Approval/rejection needs explicit confirmation, the decision-maker, date and supporting reference. Approval allocates an internal CO number; the owner's number remains separate. A member-supplied approval reference is recorded evidence, not a claim that Athena independently authenticated a signature.
- Execution first refuses incomplete base SOV lines and any mismatch with a recorded original contract value. It is a separate confirmed action with its own authority/date/reference and SOV division. It appends one fee-inclusive SOV line and updates the executed-change aggregate; it does not replace or edit existing SOV lines. Idempotent retries cannot execute twice. An executed line is immutable; a correction requires another approved compensating change.
- A submitted/approved/rejected unexecuted proposal can reopen as a new draft revision with a new transmittal; earlier revisions/files/receipts remain. Executed changes cannot be reopened and repriced in place.

## Billing checks

The base SOV fee stays on the base work. Fully priced executed changes are added at face value, avoiding a second base fee. Separate lines preserve previous base billing and its original fee allocation; negative credits can produce a negative current-period certificate. Original contract facts remain intact while the reported contract value includes executed changes. Execution does not claim a new CPM completion date: schedule days are stored as the requested impact and need the existing schedule/TIA workflow for a justified update.

## Access, provenance and history

Commercial data and every saved commercial snapshot live in new full-job-only tables, not in broadly readable parent submittal JSON or job event payloads. Existing superintendent/contract-only roles gain no commercial access. Shared package readers, record readers, package RLS and storage path authorization exclude commercial content for a superintendent. Full-job board capabilities retain the existing bearer-link model; their readers restore caller identity and do not grant writes. Drawing IDs bind to the job/company and actual source hash/version. Exact citation text alone is not proof a document was stored or read.

Dates remain explicitly member targets; no contractual notice/response period is inferred here. Capture of an RFI/RFC answer is explicit; automatic inbox matching is not introduced. No server-side AI is added, no emails are sent by this change or its tests, and no live job/member data is repaired or cleaned up. Credentials, Hub and connector stay unchanged; the existing sign-in return whitelist additionally recognizes `/cos` with its link token.

## Release and verification

Apply `20261025150000_athena_change_order_packages.sql` only through existing Lovable Cloud after #286's request-package migration. Preserve source bytes; omit only the two outer transaction lines when the managed tool supplies the transaction. Do not replay historical staged migrations. Shared-function integration fails on incompatible source anchors instead of silently substituting a different implementation.

Local tests cover real handlers, real Postgres/RLS/storage authorization, real package PDFs and the complete create → price → build → receipt → approve → execute → rebuild flow. They verify no SOV write on approval, one execution on retry, prior-certificate stability, fee-inclusive addition, signed credits, source-reference text, read-only logs, denied/revoked links, identity restoration, commercial denial for a superintendent, and preserved original files. Receipts are local fixtures only. Local phone/desktop/PDF screenshots are not a live-host pass.

After publication Grok Bot/Tess run the live acceptance in ChatGPT, Claude and Grok Bot, using fictional example.com people and explicitly named test records. Confirm installation submittals, RFI/RFC and CO records/logs/packages; matching counts; stable record/log/upload/PDF links; one-build semantics; source references; full superseded history; job time zones; and no emails or unexpected financial writes. Live financial execution requires a dedicated authorized test job, never a real billing adjustment on 2701 merely to make QA pass. P9 and existing #283 test items remain untouched.

The pre-execution base-SOV and original-value guard is staged in `20261025153000_athena_change_execution_tie.sql` and must be applied through Lovable Cloud after the commercial package migration, before publishing the CO release. Missing or inconsistent original values are not repaired automatically.

The execution-guard migration also retains an already-named request recipient when a successful send receipt omits the optional display name, only when the recipient email still matches. It never guesses a name for a different address, and installation-approval delivery behavior is unchanged.
