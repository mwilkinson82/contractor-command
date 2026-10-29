# Release-blocker assessment (read-only)

## 1. Predecessor table privileges

Observed policies (pg_policies):
- mcp_companies: SELECT only (permissive, authenticated): `mcp_is_company_member(id)`; `mcp_is_company_viewer(id) AND EXISTS(super-view job)`. No INSERT/UPDATE/DELETE policy.
- mcp_company_members: SELECT only (permissive, authenticated): `mcp_is_company_member(company_id)`. No write policy.
- mcp_jobs: permissive SELECT (company/contract/super-view); permissive ALL "own rows" `user_id = auth.uid()` USING and WITH CHECK; restrictive SELECT/UPDATE/DELETE guards `company_id IS NULL OR mcp_job_scope(id) IS NOT NULL`. No restrictive INSERT guard.

Table state: all three RLS on, force-RLS off, owner postgres.
Roles: anon / authenticated are NOLOGIN, no BYPASSRLS, not superuser. authenticator is LOGIN, no BYPASSRLS. service_role has BYPASSRLS.

Exposure findings:
- Company / member role rows: no write policy, so REST INSERT/UPDATE/DELETE affects 0 rows. No self-role or company escalation path through the grants.
- mcp_jobs: users can write their own rows through "own rows". This is the intended legacy path. Company-scope fields on those rows are separately constrained by the guards and definer functions. This was not newly analysed for escalation.
- TRUNCATE: RLS does not apply to it, but PostgREST has no TRUNCATE verb and anon/authenticated cannot log in directly. The only EXECUTE-able public routine whose body matches TRUNCATE/EXECUTE is `mcp_contract_document_save`, and its match is only the JSON key `'truncated'`. No dynamic SQL found. No routine exposes TRUNCATE or arbitrary SQL. The grant is pre-existing and has no ordinary application path. It is a hygiene item, not a blocker for the accounting release.

Verdict: not a release blocker.

## 2. Migration position

The evidence:
- The recovered normal receipt (#2311) shows 0034 applied, with 0013/0015 skipped.
- The journal is byte-identical from 6de52b68 to 609f0a97: 35 entries, whens strictly increasing.
- Native predecessor objects for 0034 are present.

Together this is sufficient operational evidence that only a newly appended entry (0035+) would be pending.

Residual: the receipt is historical. The one smallest supported observation that would make it current-state is the latest managed migration hash/created_at matching 0034 (when 1793203738604). This is optional assurance, not mandatory.

## Mandatory vs optional
- Mandatory (met): the policies, RLS, roles and routine scan above; an unchanged monotonic journal; the 0034 receipt.
- Optional: confirm the latest managed migration identity, an INSERT restrictive guard review for mcp_jobs, and baseline TRUNCATE grant hygiene (later, separately approved).

No writes, migrations or publication were performed.
