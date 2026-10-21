# Athena accounting phase 1 + D1 (staged, not published)

Branch `codex/athena-accounting-p1` off `a03ceabf`. Migration `20261022000000_athena_accounting_p1.sql` is NOT APPLIED.

## Built
- `accounting/cents.ts`: integer-cent money, basis-point rates, half-up rounding. No floating-point money.
- `accounting/retainage.ts`: D1 rule per job (rate, reduction method, threshold and its basis, reduced rate, release terms, quoted clause or PM answer). No default. Computes prospective, whole-balance, period-start-status and flat readings; lines always sum to the tier total.
- `accounting/payapp-math.ts`: G702/G703-format math and blocking checks B1 to B5. B4 enforces the saved rule to the cent, line by line and in total.
- `accounting/foundations.ts`: approved + base_version guard, one role scope check, job-time-zone stamp, sequence labels.
- `retainage_rule_save` tool (ask-first write). `contract_terms` returns the saved rule (or "Needed") in text and structuredContent.
- Server instructions direct the host to read the retainage clause at job setup, or ask the PM when the contract is silent.

## Later phases and the open decisions they wait on
| Phase | Waits on | Estimate |
|---|---|---|
| 2 Pay app tools | D2 stored-materials rate (5a/5b), D3 overbill approver (B3 approval path), D4 footer wording, D11 pay date when pay-when-paid | 2.5 to 3 days |
| 3 Living logs | D6 condition-precedent red timing, D11 pay app log due date, D10 if the transmittal log rides here | 3 days |
| 4 Transmittals | D10 numbering per job or per company | 1.5 to 2 days |
| 5 Job ledger | D5 fade points, D7 Excel vs Google Sheet, D8 over/under billing basis, D11 days late, D2 retainage tab | 3 days |
| 6 Project Record | D9 who sees dollars, D4 footer, plus phases 2 to 5 | 2 days |
| 7 Licensed AIA form fill | D4 counsel review, D2 for the 5a/5b fields | 1.5 days |
