# Do the read tools write rows? — Yes (finding + STAGED fix, not applied)

Every read tool writes one row to `public.mcp_audit_log` per call:
- `report` → src/lib/mcp/tools/workflow-tools.ts:1103 (`view_lookahead_report`), :1111 (`view_setup_report_<audience>`), :1405 (`sov_refused`), :1412 (`view_sov`)
- `list_open_items` → workflow-tools.ts:1227 (`view_open_items`)
- `contract_terms` → workflow-tools.ts:1341 (`view_contract_terms`)
- also `cpm_activities` (living-tools.ts ~109), `living_report_get` (~176), `morning_briefing` (morning-tools.ts:66), and onboarding `read` (workflow-tools.ts:137 `company_view`)

Path: `audit()` in src/lib/mcp/jobs.ts:82 → `sb.rpc("mcp_audit")` → SQL `public.mcp_audit` (drizzle/migrations/0003_mcp_module1_job_setup.sql:200)
→ `INSERT INTO public.mcp_audit_log (actor, company_id, job_number, tool, action, object_id)`. Failures are swallowed.
No other writes on these paths (report's notice de-dup is display-only; `logWorkflow` → `mcp_workflow_log` is only on failures).
Rows are internal (ids/keys only, no user content, not user-visible state).

## Options (Marshall + dev decide)
A. Keep readOnlyHint true and justify: "Writes only a server-side access-log row (who viewed which job); no user data changes."
   This is the current staged state on this branch.
B. Minimal code fix (staged as patch, NOT applied): make read audits a no-op unless `ATHENA_AUDIT_READS=1`:
```ts
// jobs.ts
export async function audit(sb, job, tool, action, objectId?, companyId?) {
  if (action.startsWith("view_") && process.env.ATHENA_AUDIT_READS !== "1") return; // reads stay read-only
  ...
}
```
   Covers all `view_*` actions. `sov_refused`/`company_view` would need the same prefix check (rename to `view_sov_refused`, `view_company`).
   Trade-off: lose the per-view access trail used for usage review.
