# Approved SOV/CPM mapping and production: implementation contract

Status: **implementation in review**. The staged migration and MCP tools implement
mapping approval, daily revisions, explicit photo links and quantity/rate reporting.
Local database fixtures exercise these paths; the migration has not been applied and
the real app path has not been verified. Do not release on fixture checks alone.

## Existing sources and boundary

- A project is `mcp_jobs.id` within its `company_id`. An SOV line is an
  `mcp_job_facts.id` with module `sov` and a text item key, not a floating point
  number. Its mutable value needs a captured snapshot and update timestamp.
- A saved CPM is an approved `mcp_living_reports.id`, project and version. The
  activities are inside its `data.activities` JSON; activity `id` is text.
- The confirmed daily already stores `mcp_daily_work_lines` and
  `mcp_production_rates`. It upserts a single report per project/date and deletes
  and recreates lines/rates on save. It also updates `mcp_field_schedule_feed`.
  Existing photos can be linked to a daily by date and have text references;
  neither those references nor the existing rate rows prove an approved mapping.
- Billing owns invoice and receipt facts. Mapping and production must not post or
  modify invoices, billed values, receipts, cash, or the saved CPM.

## Proposed persistent contract

All records carry company and project IDs, server-recorded actor and timestamp.
Reads and writes must enforce the existing membership and job-scope gates. Mapping
money is visible only to full-scope users, while field users receive only the
references and production information their role may see.

1. **Mapping version:** immutable ID, project-scoped version, CPM report ID and
   version, source SOV snapshot (fact ID, item, value in integer cents, source,
   source update time), effective date, recorded date, approval actor/date, and
   revision reason. A proposal is not an approval. Optimistic base-version checks
   and a per-project transaction lock prevent concurrent approvals from both
   becoming the next version. At approval re-read and compare the SOV source and
   CPM report to the preview; reject stale or foreign source records.
2. **Allocation:** immutable ID, mapping version, SOV fact ID and CPM activity ID,
   explicit allocated USD cents and optional sourced planned quantity, unit, and planned
   man-hours. Each SOV/activity pair appears at most once in a version. Allocations
   for each included SOV line must sum exactly to its captured value. Unincluded
   lines remain unallocated/unknown. A negative SOV credit must match an executed
   credit change order and its SOV line and amount; the source is snapshotted and
   rechecked at approval. Its allocation has the same negative sign. This does not create
   or change a credit change order or an invoice credit. Each new version retains
   the previously mapped SOV lines, and never updates allocations referenced by old facts.
3. **Daily revisions:** the existing report remains the current projection. Before
   replacing its current projection, transactionally capture the complete previous
   report and its work/rate facts with original IDs. Retire the current work/rate rows
   without deleting or changing their recorded values, and append an immutable revision
   with request payload, actor, recorded date and correction reason. Updated clients
   provide a reason for a changed report; legacy saves record an unknown reason rather
   than inventing one. An exact
   replay of the same key and payload returns the existing result; a reused key with
   different payload fails. Concurrent stale base revisions fail. Each new work line
   either pins an approved allocation and version valid for its report date, or is
   explicitly unlinked; never silently map existing historical facts. Rates remain the existing production-rate rows,
   tied to the work revision; do not create a parallel rate ledger. A correction
   supersedes only its prior revision and keeps both available for audit.
4. **Photo association:** associate an existing `mcp_progress_photos.id` with an
   explicit work-revision line and its mapping allocation, validating project and
   date. Preserve the original association after correction; re-association is an
   explicit audited event. Date and text tags alone are not proof of association.
5. **Weekly view:** report the selected period and cumulative current production by
   approved allocation and unit. Calculate actual rate from total quantity divided
   by total man-hours, not the average of daily rates. Show a planned rate only with
   positive planned quantity and man-hours, matching unit and source. No records
   means unknown, not zero. Do not conflate progress/earned value with actual
   invoicing. A quantity-based earned-value formula needs an explicit business
   decision and approved quantity basis before implementation; until then earned
   value stays unknown. Do not silently revalue historical facts when mappings change.

## Intended API shape

- `production_mapping_sources` supplies the saved source records; `production_mapping_preview` returns the
  source snapshot, validation errors, and exact reconciliation for human review;
  it writes nothing.
- `production_mapping_approve(project, expected_mapping_version, preview_source_token,
  effective_date, allocations, reason, idempotency_key)` atomically rechecks the
  sources and authority, records the approver, and returns the immutable version.
- Extend the existing confirmed `daily_report_save` with expected revision,
  idempotency key, correction reason and explicit allocation IDs for approved work.
  Existing callers can save unlinked work through the original signature; they cannot
  replace approved or voided work. Unlinked work is excluded from approved totals.
- `daily_work_void` requires a reviewed revision, reason and confirmation. It voids
  all work on the daily while retaining the report's other sections, history and photo
  links. A later restore needs an explicit new revision and reason. Voiding the entire
  report, including its other sections and reminder implications, is not implemented.
- `production_photo_associate(project, photo_id, work_revision_line_id, idempotency_key)`
  records an explicit project-scoped association.
- `weekly_production(project, from, to)` reads current revisions and approved
  references with provenance. Full-scope financial output is separate from field
  quantity/rate output and from actual billing.

All mutation RPCs must be transactional, enforce the job guard themselves, and
use consistent locking and unique constraints rather than relying only on the
TypeScript preview. Test cross-project references and role access at the database
boundary. Reconcile an uncertain result by idempotency key before retrying.

## Compatibility and rollout

1. After billing is accepted, reconcile the release branch and managed migration
   history, confirm that `20261101120002` follows the accepted billing migration,
   account for the applied managed billing migration `0033` as well as the existing
   timestamped migration files, and rerun the checks against that exact combined head.
   Do not rewrite migration history or assume the next managed number. Keep the PR in draft until
   this succeeds and the parent coordinates the release. Verify the table-alter and
   index-build lock duration under representative daily-save traffic in an isolated
   supported environment. The migration has a five-second lock timeout, but that
   alone does not prove uninterrupted service; hold deployment if the test shows a
   disruptive lock or if the supported flow cannot establish that evidence.
2. Apply the reviewed migration through the supported managed flow before the updated
   MCP service. The original daily-save RPC remains available during that interval:
   confirmed old-client saves are recorded as unlinked and history is retained. Existing
   saved dailies and rates are not backfilled or changed by the migration. The updated
   service explicitly explains unlinked work and offers approved references when they exist.
3. Old clients may continue to save an unlinked daily, even on a project with an
   approved mapping. They receive a clear refusal if they try to replace a daily that
   already has approved references or to restore voided work; the updated workflow is
   required for those intentional actions. Old callers do not supply an idempotency key
   or correction reason: the compatibility path serializes saves, deduplicates identical
   payloads, rejects a known older payload after a newer revision, and records its origin.
   It cannot supply a reason or detect every stale old-client overwrite of an unlinked
   daily. Updated callers use version checks and keys.
4. Verify the existing Cedar Grove reports and 3.75/4 LF per person-hour rates by
   read only, before and after rollout; never save or modify those fixtures. Use a
   separate QA project for writes. Before creating it, independently verify the intended
   test company and explicitly pass its company ID; after creation, re-read the job and
   confirm its company before any other writes. Stop if the company does not match.
   Do not use the empty `BILL-QA-20261027-A` job created in ALP. Test an old-client unlinked save, an unmapped job,
   an approved mapped correction, void/replay and existing field-board views, as well as
   actual billing/cash non-mutation. Capture real app screenshots.
5. If service rollback is necessary after mapped or voided work exists, retain the
   migration and history. An older service cannot safely edit mapped or voided work
   and may not label a void on its daily page; prefer a forward-compatible service fix.
   Do not roll back or delete recorded history to restore the old write path.

## Required verification before release

Use a new isolated QA project, not Cedar Grove. Exercise 1,000 LF across multiple
days, replay, correction, mapping revision, exact allocation reconciliation,
missing planned basis, explicit photo association, cross-project denial and unchanged
invoice/cash records. Verify the real app path and capture screenshots, then rerun
the focused and aggregate tests, build and exact-head CI after rebasing over the
IOR and billing releases. Unit fixtures alone are not evidence of a live pass.
