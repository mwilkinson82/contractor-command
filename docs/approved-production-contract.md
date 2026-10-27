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
   lines remain unallocated/unknown. A recorded negative SOV credit is allocated
   with the same negative sign and reconciles to that source; this does not create
   or change a credit change order or an invoice credit. Each new version retains
   the previously mapped SOV lines, and never updates allocations referenced by old facts.
3. **Daily revisions:** the existing report remains the current projection. Before
   any destructive replacement, transactionally capture the complete previous
   report and its work/rate facts with original IDs; create a new immutable revision
   with base revision, idempotency key, canonical payload hash, actor, recorded date,
   and correction reason. Require a reason for a changed existing report. An exact
   replay of the same key and payload returns the existing result; a reused key with
   different payload fails. Concurrent stale base revisions fail. Each new work line
   pins an approved allocation and version valid for its report date; never silently
   map existing historical facts. Rates remain the existing production-rate rows,
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
  idempotency key, correction reason and explicit allocation IDs. Existing reports
  must remain readable; migration and compatibility need careful rollout. No caller
  may bypass the mapping checks through the old signature.
- `production_photo_associate(project, photo_id, work_revision_line_id, idempotency_key)`
  records an explicit project-scoped association.
- `weekly_production(project, from, to)` reads current revisions and approved
  references with provenance. Full-scope financial output is separate from field
  quantity/rate output and from actual billing.

All mutation RPCs must be transactional, enforce the job guard themselves, and
use consistent locking and unique constraints rather than relying only on the
TypeScript preview. Test cross-project references and role access at the database
boundary. Reconcile an uncertain result by idempotency key before retrying.

## Required verification before release

Use a new isolated QA project, not Cedar Grove. Exercise 1,000 LF across multiple
days, replay, correction, mapping revision, exact allocation reconciliation,
missing planned basis, explicit photo association, cross-project denial and unchanged
invoice/cash records. Verify the real app path and capture screenshots, then rerun
the focused and aggregate tests, build and exact-head CI after rebasing over the
IOR and billing releases. Unit fixtures alone are not evidence of a live pass.
