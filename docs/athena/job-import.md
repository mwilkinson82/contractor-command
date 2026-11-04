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

| Old system | Athena |
| --- | --- |
| Job number, name, PM | New job (or the existing job, full access only) |
| Original contract, approved change orders, retainage, customer | Contract facts `contract_value`, `executed_change_orders`, `retainage`, `customer`, `contract_value_basis` |
| SOV lines (Overwatch cost buckets plus approved CO allocations) | Official SOV, fee 0% with basis "Imported from …" |
| Billing to date from the latest sent pay app | `mcp_import_opening_balances` per SOV line (work, stored, retainage). Pay app preparation does not read it yet. |
| Original budget per cost code | Budget facts |
| Pending change orders | Priced PCO drafts (`mcp_change_record` create + price). Not sent. |
| Submittal log | `mcp_submittal_log` import rows, source `imported` |
| Dailies with work quantities, last 28 days | `mcp_daily_report_save`, only on dates with no Athena daily |

Athena never overwrites: a known contract fact, an existing SOV, a budget cost
code, a submittal number and revision, or a daily already on the job are kept and
listed on the card.

## What stays behind for now

- RFIs. Athena's RFI log tracks RFIs it sends; a "sent outside Athena" state is
  the next step.
- The CPM schedule. It comes in through `schedule_workflow`, which ties
  activities to the SOV.
- Earlier pay apps (the latest one becomes the opening balance), actual costs,
  subcontracts and payments, files and photos, IOR, decisions, claims,
  inspections and selections.
- Rejected and void change orders, and dailies with no quantities.

Each is counted on the review card so nothing disappears silently.

## Overwatch job export format

Overwatch does not have a whole-job export yet. Athena reads this JSON: one
object, Overwatch's own rows keyed by table name, as Overwatch stores them.

```json
{
  "format": "overwatch.job_export",
  "exported_at": "2026-11-04T12:00:00Z",
  "project": { "id": "…", "job_number": "3101", "name": "…", "client": "…", "project_manager": "…",
               "original_contract": 250000, "default_retainage_pct": 10,
               "baseline_completion_date": "…", "forecast_completion_date": "…" },
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

A sample is in `src/lib/job-import/fixtures/overwatch-sample.json`. Adding an
"Export for Athena" button to Overwatch that writes this file is a separate change
in the Overwatch repo.

## Database

`supabase/migrations/20261104170000_athena_job_import.sql` (stage only; apply
through Lovable). Adds `mcp_import_batches`, `mcp_import_records`,
`mcp_import_opening_balances` and the functions `mcp_job_import_context`,
`mcp_job_import_stage`, `mcp_job_import_apply`, `mcp_job_import_cancel`.
Rollback: `supabase/rollbacks/20261104170000_athena_job_import.rollback.sql`.
