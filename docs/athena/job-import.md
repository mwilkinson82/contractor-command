# Job import

Bring a whole job into Athena from another system in one reviewed batch.
Overwatch first; Procore, Buildertrend and plain spreadsheets use the same path.

## How a client runs it

1. Export the job from the old system (the Overwatch export format is below; for
   Procore or Buildertrend, the SOV, change order and submittal log CSVs).
2. In Claude or ChatGPT: "Hey Athena, import job 3101 from Overwatch" and attach
   the export.
3. Athena calls `job_import` with `step: "review"`. Nothing is saved. It shows one
   card: what will be saved, what is kept as it already is in Athena, what stays
   in the old system for now, and anything to check first.
4. The member says yes. Athena calls `step: "save"` with the `batch_id` and
   `import_key` from that card. Everything is written in one database
   transaction; if any part is refused, nothing is saved.
5. Running the same export again brings in nothing twice.

The review lasts 15 minutes and belongs to the member who ran it. A newer review
of the same job replaces the older one.

## What comes in

| Old system                                                                                                                                                                                                    | Athena                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job number, name, PM                                                                                                                                                                                          | New job (or the existing job, full access only)                                                                                                                      |
| Original contract, approved change orders, retainage, customer                                                                                                                                                | Contract facts `contract_value`, `executed_change_orders`, `retainage`, `customer`, `contract_value_basis`                                                           |
| SOV lines (Overwatch cost buckets plus approved CO allocations)                                                                                                                                               | Official SOV, fee 0% with basis "Imported from …"                                                                                                                    |
| Billing to date from the latest sent pay app                                                                                                                                                                  | `mcp_import_opening_balances` per SOV line (work, stored, retainage). Pay app preparation does not read it yet.                                                      |
| Original budget per cost code                                                                                                                                                                                 | Budget facts                                                                                                                                                         |
| Pending change orders                                                                                                                                                                                         | Priced PCO drafts (`mcp_change_record` create + price). Not sent.                                                                                                    |
| Submittal log                                                                                                                                                                                                 | `mcp_submittal_log` import rows, source `imported`                                                                                                                   |
| Dailies with work quantities, last 28 days                                                                                                                                                                    | `mcp_daily_report_save`, only on dates with no Athena daily                                                                                                          |
| IOR (format 2): project contract, cost budget, phase, % complete, completion dates; cost codes' actual and forecast to complete; approved and pending change orders with cost and probability; open exposures | Version 1 of the job's IOR living report (`data.ior_model`, via `mcp_living_report_save`), only when the job has no IOR                                              |
| Schedule activities, WBS sections and milestones                                                                                                                                                              | Version 1 of the job's CPM (`mcp_living_report_save`, type `cpm`), organized with `schedule_workflow`'s organize path, not cost loaded, only when the job has no CPM |
| RFIs (submittal log rows of kind `rfi`)                                                                                                                                                                       | Athena's RFI log, recorded as handled outside Athena (`mcp_request_record_outside`); never sent from Athena                                                          |
| Owner decisions, claims with their events, inspections (format 2)                                                                                                                                             | The owner decision log, claims register and inspection log (`mcp_job_log_record`)                                                                                    |
| Every row in the file, every table (format 1 or 2)                                                                                                                                                            | `mcp_import_archive`: read-only, one row per source table and row id, as the source stored it                                                                        |

Athena never overwrites: a known contract fact, an existing SOV, a budget cost
code, a submittal number and revision, a daily already on the job, or an IOR the
job already has are kept and listed on the card. A row already in the archive
keeps its first copy.

### Change-order cost

Overwatch keeps our cost of each change order (`cost_amount`, dollars) and the
chance a pending one is approved (`probability`, 0 to 100). Athena's change
writer prices a PCO with the price to the owner only, so the cost never goes on
the PCO. It goes into the IOR (`ior_model.change_orders[].cost_amount`) and shows
on the review card beside each open change order.

### IOR mapping (Overwatch to `ior_model`)

Money in `ior_model` is dollars. Category (`exposure_category`) and response
(`response_path`) are the same words in both systems and map one to one; an
unknown category becomes `other`.

| Overwatch `hold_class` | Athena `hold`                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E-Hold`               | `E`                                                                                                                                                                                                                   |
| `C-Hold`               | `C`                                                                                                                                                                                                                   |
| `Both`                 | Two risks, one `E` and one `C`, titled "(E-hold side)" and "(C-hold side)". Overwatch's IOR rollup counts a Both exposure in E-holds and C-holds, so this keeps Athena's indicated gross profit equal to Overwatch's. |
| `None`                 | Left off the IOR (Overwatch holds nothing for it); kept in the archive and counted on the card.                                                                                                                       |

- Closed exposures (`recovered`, `eliminated`, `released`) drop off, as on
  Overwatch's IOR. `accepted` still carries.
- `dollar_risk` is `dollar_exposure`, reduced by any partial release so that
  `dollar_risk × probability` equals Overwatch's remaining hold.
- `next_move` is "Release when: " plus the release condition; `opened` and
  `next_review` come from `opened_at` and `next_review_at`.
- `actual_cost_to_date` is the sum of the live cost buckets' `actual_to_date`.
- `cost_growth` is actual to date plus forecast to complete (`ftc`, 0 on a
  finished code) across the live cost buckets, less the original cost budget,
  when every bucket carries its forecast; otherwise 0. Overwatch's subcontract
  buyout layer is not included; the note on the IOR says so.
- Denied and entered-in-error change orders stay off. A file with no project
  phase or no change-order cost (every format 1 file) brings no IOR; the card
  says why.

### Archive

`mcp_import_archive (job_id, company_id, source_system, source_table,
source_id, row, batch_id, created_at)`, primary key (job_id, source_system,
source_table, source_id). The row id is the source row's `id`; tables keyed
otherwise use Overwatch's export keys (`billing_forecast_settings` by
`project_id`, `billing_line_change_order_allocations` by its two ids,
`schedule_activity_progress_controls` by `schedule_activity_id`); a row with no
key gets a stable hash (`row:` plus 16 hex digits). The project header is table
`projects`. Members with full job access can read it (rows carry dollars, as
the IOR does); nobody writes it except the save.

Limits: the stage refuses a package over 6,000,000 bytes and the tool takes an
export of up to 2,000,000 characters, so an export that fits the tool fits the
batch. The archive is capped at 50,000 rows; if the package would pass 5.5 MB the
archive is left out with a line on the card and everything else still saves.

### Schedule

The schedule becomes version 1 of the job's CPM, only when the job has no CPM
(otherwise the card says "kept Athena's"). It goes through the same organize
path as `schedule_workflow` (`initial_activities`), so Athena checks IDs,
logic and dates the way it checks a CPM a member builds.

- Each activity keeps its ID, name, duration, start and finish, percent
  complete, actual start and finish and remaining duration. An actual finish
  makes it 100% complete; an actual finish with no actual start is left off and
  listed.
- Predecessors come in as finish-to-start with lag 0 (Overwatch keeps no link
  type or lag). A link to an activity not in the export is left off and listed.
- WBS sections become Athena WBS groups. Milestones become milestone
  activities `MS-01`, `MS-02` … with duration 0 on their forecast date (or
  baseline date when there is no forecast).
- No dollars. The CPM is not cost loaded and nothing spreads the contract onto
  it. Schedule updates, activity history and delay fragments stay in the
  archive.
- If Athena can't organize the schedule (a logic loop, more than 400
  activities), it is left out with a line saying why, and everything else saves.

### CPM without cost loading

A CPM saves with activity IDs, logic and durations alone. The partial-loading
rule: a CPM is cost loaded once any activity carries a value other than 0 (an
owner-furnished value counts). Then every billable value must add up to the
contract to the cent, and an activity with no value counts as $0. A billing
forecast always ties. On a CPM that isn't cost loaded, `cpm_activities` and the
billing forecast say plainly that a billing forecast or earned value from the
schedule isn't available; they never spread dollars.

### RFIs handled outside Athena

An imported RFI, or one a member records with `rfi_record` action
`record_outside`, goes on Athena's RFI log marked "outside Athena", with where it
was handled, its number there, the date sent and to whom, and the answer, its
date and who gave it when known.

- Sent with no answer: state `sent_outside`, shown as "Sent outside Athena".
  An answer is then captured the usual way (`rfi_record` action `answer`).
- Answered: state `answered`; the answer text comes from Overwatch's comments
  (or a line saying none was recorded).
- No sent date: a draft.

It is never sent from Athena and has no send receipt. RFIs sent through Athena
keep their rule: status `submitted` still needs a send receipt, and an answer
can only be captured against a sent question. A reopened RFI is a new Athena
draft without the outside marker.

### Job logs

Three logs, read with `project_log` and written with `project_log_record`
(`log`: `claims`, `inspections` or `decisions`). Full job access reads and
writes all three; a Super reads and records inspections only, never their cost.
Every write carries a `request_id` for safe retries, and updates go by record
version.

- Claims register (`mcp_claims`, `mcp_claim_events`): number, type, status,
  money and time claimed and awarded, dates, outcome. A claim may link a delay
  event (`mcp_delay_events`), and so that event's claim open item, plus a
  change order and an IOR risk by title.
- Inspection log (`mcp_inspections`): type, authority, status and result,
  requested, scheduled and completed dates, attempt, reinspection, cost and
  schedule impact. A reinspection points at the inspection it follows.
- Owner decision log (`mcp_decisions`): what needs deciding, owner, due date,
  impact, outcome. It may link a change order, an IOR risk and a selection on
  the job's Good, Better, Best selection board (`selection_id`). That link is
  checked against the board when written and is read only: the board and its
  contract are unchanged. Overwatch's own selections are archived, not put on
  the board.

Overwatch statuses map as named; decision `resolved` is `decided`, and
`overdue` comes in `open` (Athena works out overdue from the due date). An
inspection with no result takes it from its status (passed is pass).

## What is not live in Athena yet

Files: the archive keeps each file's name and storage path; the files copy in a
later step.

Archived and counted on the card, but not separate Athena records: earlier pay
apps (the latest one becomes the opening balance), actual costs, subcontracts
and payments, selections, schedule updates and delay fragments, rejected and
void change orders, exposures with no hold, and dailies with no quantities or
older than the window. A format 1 file carries only counts for most of these;
they stay in Overwatch.

## Overwatch job export format

Overwatch's "Export for Athena" writes this JSON: one object, Overwatch's own
rows keyed by table name, as Overwatch stores them.

Version 2 (`"format_version": 2`) carries every job table as full rows
(`select *`, less payment-processor ids, browser fingerprints and secrets),
the company rows the job points at (`subcontractors`, `client_contacts`,
`crm_onboarding_tasks`), `counts` for every table and `left_out`. The table list
is `ATHENA_JOB_TABLES` and `ATHENA_LINKED_TABLES` in Overwatch's
`src/lib/athena-export.ts`. Version 1 (no `format_version`) is the shape below
and still imports. Any other version is refused.

```json
{
  "format": "overwatch.job_export",
  "exported_at": "2026-11-04T12:00:00Z",
  "project": {
    "id": "…",
    "job_number": "3101",
    "name": "…",
    "client": "…",
    "project_manager": "…",
    "original_contract": 250000,
    "default_retainage_pct": 10,
    "baseline_completion_date": "…",
    "forecast_completion_date": "…"
  },
  "cost_buckets": [],
  "change_orders": [],
  "change_order_allocations": [],
  "billing_applications": [],
  "billing_line_items": [],
  "submittal_log_entries": [],
  "schedule_activities": [],
  "daily_reports": [],
  "daily_wip_entries": [],
  "counts": { "cost_actuals": 0, "subcontracts": 0, "project_documents": 0 }
}
```

Samples: `src/lib/job-import/fixtures/overwatch-sample.json` (version 1) and
`overwatch-v2-sample.json` (version 2, built by hand from Overwatch's schema).

## Database

`supabase/migrations/20261104160000_athena_job_import.sql` (stage only; apply
through Lovable). Adds `mcp_import_batches`, `mcp_import_records`,
`mcp_import_opening_balances` and the functions `mcp_job_import_context`,
`mcp_job_import_stage`, `mcp_job_import_apply`, `mcp_job_import_cancel`.
Rollback: `supabase/rollbacks/20261104160000_athena_job_import.rollback.sql`.

`supabase/migrations/20261105090000_athena_job_import_whole_job.sql` (stage
only; Lovable writes its own drizzle copy when it applies the file) widens `mcp_import_records.source_kind`, adds `mcp_import_archive`, and
replaces `mcp_job_import_context` (adds `has_ior`, `archived`),
`mcp_job_import_stage` (accepts package version 2) and `mcp_job_import_apply`
(adds the IOR and archive steps; every earlier step unchanged). A package with
an IOR or archive is version 2, so a database without this migration refuses it
instead of saving part of it.

The job logs migration, in four parts applied in order (stage only; Lovable
writes its own drizzle copy of each; needs 20261105090000 first). It was one
file, split only to keep each paste small; no statement changed:

1. `supabase/migrations/20261105100000_athena_job_logs_part1.sql`: CPM save and
   outside RFIs.
2. `supabase/migrations/20261105100100_athena_job_logs_part2.sql`: the claim,
   inspection and decision tables.
3. `supabase/migrations/20261105100200_athena_job_logs_part3.sql`:
   `mcp_job_log_record` and `mcp_job_log_rows`.
4. `supabase/migrations/20261105100300_athena_job_logs_part4.sql`: the import's
   context, stage and apply.

Together they:

- Replaces `mcp_living_report_save` so a CPM ties only when cost loaded.
- Allows RFI state `sent_outside` and adds `mcp_request_record_outside`; patches
  `mcp_request_record` and `mcp_request_rows` to treat it as sent and mark
  `recorded_outside`.
- Adds `mcp_claims`, `mcp_claim_events`, `mcp_inspections`, `mcp_decisions` and
  `mcp_job_log_operations`: read by full job access, no direct writes.
- Adds `mcp_job_log_record` and `mcp_job_log_rows`.
- Replaces the import's context (adds `has_cpm`), stage (accepts package version 3) and apply (adds the schedule, RFI, decision, claim and inspection steps).

A package with any of these is version 3.
Rollback: `supabase/rollbacks/20261105100000_athena_job_logs.rollback.sql`
(keeps the log tables and their rows).
