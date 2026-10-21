# Athena v0.8.17 accounting P1–P7 + AR (staged, not published)

Branch `codex/athena-accounting-p2-7` off the deploy base `codex/athena-passwordless-login-only` at `ff02ec2` (after PR 113).
All migrations are additive and NOT APPLIED. Nothing here is merged or published.

## Decisions (all closed, Marshall 2026-10-20)
D1 retainage rule per job, no default · D2 stored materials at the same rate unless the contract says otherwise · D3 only owner or all-access approve an overbill · D4 footer "Prepared in AIA G702/G703 format. Not an AIA document." · D5 fade alert at more than 5 points · D6 condition-precedent notices alert at 3 days or less · D7 Excel by default, Google Sheet when Drive is connected and asked · D8 over/under is cost-to-cost · D9 PMs see dollars on their own jobs · D10 transmittals numbered per job · D11 payment-term rule per job (pay-when-paid with an Estimated date that recomputes, or N days after approval/submission), no default; due dates drive AR aging.

## Phases and migrations
| Phase | Built | Migration |
|---|---|---|
| 1 Foundations + D1/D2/D11 | cents, retainage rule, payment-term rule, numbering, record versions | 20261022000000_athena_accounting_p1.sql |
| 2 Pay apps | payapp_draft/check/get/save/certify, payment_record; B1–B5 | 20261022010000_athena_accounting_p2_payapps.sql |
| 2b AR | ar_aging, ar_settings_save, ar_invoice_save, ar_followup_log; standing AR in every greeting/briefing | 20261022020000_athena_accounting_ar.sql |
| 3 Living logs | log_get, log_save | 20261022030000_athena_accounting_p3_logs.sql |
| 4 Transmittals | transmittal_draft/save/mark_sent | (uses the P3 log tables) |
| 5 Ledger | job_costs_import, ledger_get/preview/save; ties T1–T7 | 20261022040000_athena_accounting_p5_ledger.sql |
| 6 Project Record | project_record_get/save; fixed section order; count check; super view without dollars | 20261022050000_athena_accounting_p6_record.sql |
| 7 Licensed form maps | form_map_save (field map only) | 20261022060000_athena_accounting_p7_form_maps.sql |

## Still open (not decisions)
- Morning briefing / PM meeting tools live in coach PR 112 (not on the base). AR is wired through the server rule, the ar_aging description and the pure arSection/standingAr helpers; the briefing tool call-in needs a small follow-up once PR 112 lands.
- Pay app lines are stored as jsonb on mcp_pay_apps rather than a separate lines table.
- ar_aging's default as_of uses America/New_York when no job is given (per-job calls use the job time zone elsewhere).
- New log numbers are taken before the save, so a failed save skips a number.
- The SQL has not been run on a real Postgres; apply to a staging database first.
