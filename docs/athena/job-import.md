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

| Old system                                                                                                                                                                                                    | Athena                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Job number, name, PM                                                                                                                                                                                          | New job (or the existing job, full access only)                                                                         |
| Original contract, approved change orders, retainage, customer                                                                                                                                                | Contract facts `contract_value`, `executed_change_orders`, `retainage`, `customer`, `contract_value_basis`              |
| SOV lines (Overwatch cost buckets plus approved CO allocations)                                                                                                                                               | Official SOV, fee 0% with basis "Imported from …"                                                                       |
| Billing to date from the latest sent pay app                                                                                                                                                                  | `mcp_import_opening_balances` per SOV line (work, stored, retainage). Pay app preparation does not read it yet.         |
| Original budget per cost code                                                                                                                                                                                 | Budget facts                                                                                                            |
| Pending change orders                                                                                                                                                                                         | Priced PCO drafts (`mcp_change_record` create + price). Not sent.                                                       |
| Submittal log                                                                                                                                                                                                 | `mcp_submittal_log` import rows, source `imported`                                                                      |
| Dailies with work quantities, last 28 days                                                                                                                                                                    | `mcp_daily_report_save`, only on dates with no Athena daily                                                             |
| IOR (format 2): project contract, cost budget, phase, % complete, completion dates; cost codes' actual and forecast to complete; approved and pending change orders with cost and probability; open exposures | Version 1 of the job's IOR living report (`data.ior_model`, via `mcp_living_report_save`), only when the job has no IOR |
| Every row in the file, every table (format 1 or 2)                                                                                                                                                            | `mcp_import_archive`: read-only, one row per source table and row id, as the source stored it                           |

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

## What is not live in Athena yet

With a format 2 file these are in the archive, read-only, and the card says so:

- RFIs. Athena's RFI log tracks RFIs it sends; a "sent outside Athena" state is
  the next step.
- The CPM schedule. It comes in through `schedule_workflow`, which ties
  activities to the SOV.
- Owner decisions, claims, inspections, and files (the archive keeps each file's
  name and storage path; the files copy in a later step).

Archived and counted on the card, but not separate Athena records: earlier pay
apps (the latest one becomes the opening balance), actual costs, subcontracts
and payments, selections, rejected and void change orders, exposures with no
hold, and dailies with no quantities or older than the window. A format 1 file
carries only counts for most of these; they stay in Overwatch.

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

`supabase/migrations/20261105090000_athena_job_import_whole_job.sql` (same
content as `drizzle/migrations/0079_athena_job_import_whole_job.sql`; stage
only) widens `mcp_import_records.source_kind`, adds `mcp_import_archive`, and
replaces `mcp_job_import_context` (adds `has_ior`, `archived`),
`mcp_job_import_stage` (accepts package version 2) and `mcp_job_import_apply`
(adds the IOR and archive steps; every earlier step unchanged). A package with
an IOR or archive is version 2, so a database without this migration refuses it
instead of saving part of it.
