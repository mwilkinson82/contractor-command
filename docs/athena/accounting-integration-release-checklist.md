# Athena accounting — local integration and release review

Review date: 2026-10-28. **Follow-up disposition and exact proposed SQL: [accounting-release-decision.md](accounting-release-decision.md). That decision supersedes the initial unresolved byte/time and privileged-mutation classifications below.** This is a private local candidate, not a release approval. No push, merge, deployment, managed migration, customer write, payment, external email or PR approval was performed. All new test data was synthetic. Other workers' checkouts were read only.

## Source freeze and concrete integration

Isolated checkout: `/Users/marshallwilkinson/Documents/Codex/2026-10-28/task-7/integration`, branch `codex/local-accounting-integration`. The final local commit is recorded in this task's handoff; preserve its Git tree, this checklist and the source manifest together. Do not identify this unpushed candidate as any existing PR head.

The remote release and PR heads were verified with read-only Git on this date:

| Source | Frozen commit |
| --- | --- |
| Release `codex/athena-passwordless-login-only` | `1fc1bec4f60b2080743cb81e399d7c016f6981dc` |
| Draft #352, suppliers/PO | `9b5df5c54ebab9e41773321cd65a098f607c7ced` |
| Draft #351, AP | `1318fa2a94d7710d8d521093269f099e4e76893a` |
| Draft #355, reconciliation | `673ff295b0f7c3cf4067ab5942afc6d12a1cf8a9` |
| Draft #356, latest LOCAL reporting | `9de1254cd15a226074b7ee25b72e095053016f17` |
| Draft #356, remote reporting (older) | `d00f2fe47890d9886bd1e1d69cd866512af3ecdb` |

The AP and PO workers' local commit IDs differ from the PR IDs, but their trees match exactly. Integration used the exact PR heads and latest local reporting commit. Registrations, instructions, manifest, full-scope financial routes, sign-in return paths, Home links and guard-count expectations are reconciled. All 103 tools remain wrapped by `secureTool`; existing email draft/approval rules remain tested. Financial tools skip unrelated deadline sweeps. Financial links do not carry board tokens. No OAuth transport/generated route, entitlement bypass or role permission was changed.

The installed manifest CLI encountered its existing `pdfium.wasm?module` import-analysis problem. Discovery was regenerated from the actual integrated registry through Vitest's supported WASM alias using the installed SDK's schema/listing implementation. The temporary generator was removed. Committed discovery is checked against real SDK `tools/list`, not just hand-authored schemas.

A local-only `job-cost-project-refs.schema-draft.sql` adds generated identity columns and foreign keys for optional supplier, PO and exact immutable PO revision links. It preserves all facts and optionality; field expenses still require no PO. Runtime writers still validate exact company/job/party and PO snapshot. The draft prevents reference deletion/dangling revision identities under later maintenance; it does not replace those authorization checks. This new draft needs migration review along with the producers.

## One coordinated migration order

`drizzle/migrations/meta/_journal.json` ends at repository artifact `0034_athena_financial_documents`. This says nothing about what is applied live. Existing Supabase timestamp files mirror some managed artifacts; do not run the timestamp directory as a backlog. In particular, the PO timestamp sorts before the published financial prerequisites.

The machine-readable [source manifest](accounting-integration-sources.json) records full SHA-256 hashes for all six ordered drafts, both billing prerequisite representations and the journal. Run `node scripts/verify-accounting-release-sources.mjs` before review/application. Nine exact proposed payload hashes are now frozen in `managed-accounting-proposal/manifest.json`. No actual managed identity or applied-SQL hash has been allocated/verified locally.

| Dependency order | Source draft | SHA-256 |
| --- | --- | --- |
| Prerequisites | Verified deployed membership/scope/block-change helpers, billing evidence and private financial originals corresponding to managed `0033`/`0034` | Full source hashes in manifest; live state unverified |
| 1 | PO source `20261028143924_athena_project_purchase_orders.sql` | `9dfa532b2e330fcee3596d0e1ca7dc5bb0b1c0f8908fd4809a6e8b92c7b84bf2` |
| 2 | `job-cost-submission.schema-draft.sql` | `ba37b300a41e8e4f44e0a16c672faa1875389bb6cd4d91659ca9c43070f876ea` |
| 3 | `job-cost-project-refs.schema-draft.sql` | `77535a8762e31a963708ad29acb27f05c71a6bf5bc1062aa6871a6fdb9cef327` |
| 4 | `job-cost-originals.schema-draft.sql` | `e16ed33f8d72ec819fb9f43161f040f91a137b15610b48230d4fbab7f614701a` |
| 5 | `ap-reconciliation-snapshot.schema-draft.sql` | `a25517349efbc2f301341af41e54adcc4ee71fd7df061a20e6c1e9b50dc76f33` |
| 6 | `billing-reconciliation-snapshot.schema-draft.sql` | `98dc34e24fdcca3984db78871de5630863a4b747221e75d0b6fe110280c9daf9` |

AP snapshot depends on AP; receipt schema depends on AP and private original storage; the bridge depends on PO and AP. Billing snapshot independently depends on billing/originals. Reporting has no migration and deliberately retains the existing AR reader because the reconciliation snapshot lacks its dated reporting projection. AR, AP, PO and budget report reads remain separate observations, not an atomic close.

Before any authorized managed operation:

- [ ] Use only the supported Lovable managed lane to inspect actual migration state and object definitions, allocate new identities after the actual latest entry, and generate/review final artifacts. Do not use previously denied direct history routes, alter security controls or repair history by hand. Existing tentative timestamp identities in track docs are not selected managed identities.
- [ ] Confirm target environment, backup/restore readiness, current release head, other pending releases and source freeze. Record source hash → final SQL hash → managed identity → app commit. A differing head, partial prior application, unknown outcome or object collision stops application.
- [ ] Verify actual helper definitions and effective inherited ACLs, including `mcp_assert_active`, `mcp_job_scope`, `mcp_member_role`, `mcp_role_allowed`, `mcp_block_change`, Circle entitlement and company plan logic. Tests use synthetic entitlement/auth/storage primitives and cannot prove live parity.
- [ ] Verify the financial bucket is private; no authenticated/anonymous object policy gives direct file access; server storage credentials remain server-only. Run managed security/performance advisors in an authorized isolated environment and resolve material findings before publishing.
- [ ] Rehearse exact final SQL and transaction boundaries in isolated managed staging. The bridge is intended before new AP writes, while the new cost table is empty. Stop if it is already populated: generated stored columns/FK validation can rewrite or scan it and acquire strong locks. Validate optional existing references rather than guessing/backfilling identities.

### Blocking index plan

The three billing snapshot indexes operate on existing evidence tables: `mcp_billing_allocations_job_reconciliation_idx`, `mcp_billing_receipt_reversals_job_reconciliation_idx` and `mcp_billing_documents_job_reconciliation_idx`. The original draft uses standard `CREATE INDEX`, which blocks writes. Concurrent creation cannot run in a transaction block. See PostgreSQL's [CREATE INDEX documentation](https://www.postgresql.org/docs/current/sql-createindex.html).

1. Through the approved lane, inspect current index definitions/names, table sizes, active writers, representative query plans and staging build duration. A same-name index is not proof of the intended definition. Do not query real customer financial rows for this review.
2. Preferred for materially populated tables: a separately approved nontransactional managed runner creates each exact index concurrently, serially per table. Record each outcome and `indisvalid`/`indisready`. On timeout/error, inspect state before retry; an invalid residual index needs a reviewed cleanup. Install the snapshot function in a later transactional artifact only after the indexes validate. Recompute final SQL hashes because this splits/changes the source draft.
3. If the supported runner cannot do nontransactional operations, do not improvise direct SQL. Either defer the snapshot release or approve a measured low-traffic maintenance window with bounded standard builds. The coordinator must select explicit lock/statement timeouts and a transaction; timeout means stop and reconcile, not blind retry.
4. New-table PO/AP indexes and the bridge indexes still need staging timing/lock review. PO's `SET LOCAL lock_timeout='5s'` and `statement_timeout='60s'` are effective only inside a real transaction. Do not nest an existing file's `BEGIN/COMMIT` inside a runner transaction. The native lab stripped only the file-upload prerequisite's outer transaction delimiters in its fixture wrapper; shipped SQL was unchanged.

No production index duration or managed plan has been measured here. There is no blanket approval for a blocking build.

## Independent source/security review

| Area | Reviewed result | Practical limit / release gate |
| --- | --- | --- |
| Roles | PM business approval is per job/version; owner/AP accounting approval/posting/recorded payment is separate. All affected split jobs must be accessible. Company-paid expenses have no reimbursement/supplier payable. | Separation of duties is not enforced: one authorized actor can perform multiple steps. Rehearse actual managed role/plan combinations. |
| Superintendent | Assigned supers create/read their own initial field submissions and receipts. Ledger, later accounting versions, posting and payment paths remain denied. | Receipt upload/register/read each recheck assignment/member/record. Staging must verify revoked membership, another super, other job/company and direct bucket denial. |
| Company/job isolation | Exact company/job envelopes, source IDs and all-version allocation scopes are validated; unsupported/incomplete AP returns only generic unavailable. Synthetic outsider, foreign-company, same-number jobs and hidden split scope tests pass. | No live RLS/ACL/advisor verification. Privileged out-of-band inconsistent records require investigation. |
| Financial history | Versions/postings have immutable triggers. Correction workflows append versions/evidence and retain prior posted state until successor posting; withdrawal preserves prior payment evidence. | Other AP approvals/settlement/correction event tables rely on revoked ordinary-role direct writes and append-only RPC behavior, rather than equivalent mutation-blocking triggers. `service_role`/DB administrators remain privileged. Review operational access; this task made no permission/hardening changes. |
| Review/idempotency | Actor/job/purpose/payload-bound expiring review tickets plus explicit confirmation; stale versions, changed facts, reused identities and overpayment fail. Native independent-connection races pass. | Confirmation is a client assertion, not independent proof that the person saw/approved the draft. Host must show exact final content, then wait for a separate explicit okay. Unknown outcomes require readback with original request ID/payload. |
| Originals | Server authenticates actor, obtains scoped metadata, validates company/job/upload path, bounds bytes/type and checks stored hash/size. Service-only claim/register rechecks scope. | Supplier-bill original attachment and AP original completeness are unsupported. Synthetic storage is not a live bucket audit. Orphan retention/cleanup policy needs review; rollback must retain originals. |
| Money/dates | Exact integer cents and BigInt aggregate strings; reviewed per-version two-decimal currencies remain separate; missing legacy date/currency stays Unknown. Accounting-effective date is distinct from incurred, posted and recorded timestamps. | No currency conversion, inferred historical currency/date, earned revenue, complete P&L, tax or payroll. CSV uses formula neutralization and exact string cents. |
| Snapshots | AP and billing each use one bounded statement; AP read-only transaction and native pre/post-commit observation pass. Over-limit evidence withholds partial results. | AP caps response at 2 MiB. Billing now caps source text at 1 MiB and final envelope at 2 MiB; reconciliation callers have a 5-second per-RPC response deadline. Actual managed database cancellation/performance remains unverified. Existing reporting AR reader is not the new atomic snapshot. |
| Duplicate/settlement | Normalized refs, immutable revisions and request IDs are checked; conservation/overpayment/withdrawal tests pass; settlement never adds another expense. | Supplier aliases/missing refs can evade detection and same-name parties can collide. Shared settlements remain hard-disabled by the false identity hook. Per-job payment allocation, shared conservation, bank transfers/refunds and external accounting coverage remain unavailable. |

Review of definer functions included fully qualified relations, role gates, RLS and function/table revocations. Managed effective grants and schema-creation rights remain a release check; definer privileges require careful control, as described in [Supabase's functions guidance](https://supabase.com/docs/guides/database/functions) and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Exact local verification matrix

Final local result: **323 test files passed; 3,048 tests passed, 4 existing skips and 2 todos; no failures or unhandled errors**. TypeScript, scoped semantic ESLint, production build and all four built route/auth smoke checks passed. The initial PostgreSQL lab passed six cases; the follow-up verifies nine exact proposed artifacts, concurrent indexes, credential boundaries and database cancellation. Evidence files are in this checkout's ignored `artifacts/` directory; the handoff records the final commit. The added composed suite uses every actual proposed producer, not copied mock producer SQL.

| Check | Command / evidence | Coverage |
| --- | --- | --- |
| Complete unit/database suite | `ATHENA_AP_CONTRACT_DIR="$PWD/artifacts/ap-contract" npm test -- --reporter=default --reporter=junit --outputFile.junit=artifacts/integration-tests.xml` | All source tracks, inherited auth/email regressions; pinned AP producer enabled. `artifacts/tests.log` and JUnit. Existing skips/todos remain explicit. |
| Composed producer test | `src/lib/mcp/accounting-integration-db.test.ts` | All actual SQL together; PO link, exact retry, accounting posting, PM-before-payment, unposted correction, both snapshots, real report consumer, role denial, durable references and immutable version. |
| Native independent connections | `ATHENA_EMBEDDED_PG_MODULE=<installed embedded-postgres module> node scripts/test-accounting-integration-postgres.mjs` | Own temporary socket-only PostgreSQL 18.4 cluster: ordered DDL, competing duplicate refs, exact retry, competing overpayment, read-only AP pre/post-commit snapshot, membership revocation. `artifacts/native-postgres-results.json`. Cluster removed. |
| TypeScript | `npx tsc --noEmit` | `artifacts/typecheck.log`. |
| Scoped semantic ESLint | Changed integration TS/TSX/scripts with `prettier/prettier` disabled | `artifacts/lint.log`; inherited files have unrelated formatting debt. New scripts/composed test formatted with Prettier. Do not call this a clean repository-wide default lint. |
| Production build | `npm run build` | `artifacts/build.log`, no deploy. Existing upstream deprecation/chunk warnings remain. |
| Built Workers routing/auth | `npm run verify:preview` | Home/accounting/billing/PO SSR 200; unauthenticated MCP 401. `artifacts/preview-smoke.log`. Uses pinned Wrangler 4.154.0. |
| Discovery/source freeze | Manifest-sync/guard tests and `node scripts/verify-accounting-release-sources.mjs` | 103 tools, source input schemas match SDK discovery; all producer/prerequisite hashes match. |

Reporting track's earlier routed Chromium evidence belongs to its own exact local source. This integration did not rerun all those browser cases; its added browser-facing evidence is built SSR/auth smoke plus rendered-component/navigation tests. Managed advisors, real storage byte transfers, realistic-size query plans and host-specific approval UX are still pending. No fabricated end-to-end production coverage is claimed.

## Staged release sequence — pending specific approval

1. Freeze the integrated app tree and all final managed SQL artifacts/hashes. Recheck the release head and resolve any drift; source changes require affected tests and source manifest updates. Present exact app version, target, migration order, lock strategy, rollback and limitations for owner approval.
2. Obtain explicit authorization for the latest reporting push and restricted PR description updates, and separately for the chosen integration publication/merge/application/deployment. This local task authorizes none of those actions. Existing draft CI-green statements do not cover this unpushed integrated commit. Run both required CI workflows on the final published head after authorization.
3. In approved isolated managed staging, verify prerequisites/ACLs/bucket and backup, apply only the reviewed new artifacts in the order above, verify definitions/history/hashes and advisors, then publish the matching staging app. Keep shared settlement disabled. Do not install unrelated backlog migrations.
4. Run the synthetic UAT below with actual role accounts and host confirmation. Verify receipt bytes/original access, mixed currencies, unknowns, failures, retry and isolation. Preserve evidence and approve staging acceptance before production.
5. Schedule approved production schema work with selected index strategy. Reconcile each known outcome; verify schema/grants/constraints/triggers/private bucket, then publish the matching frozen app. No customer writes or synthetic production sends are authorized by this checklist.
6. Perform approved read-only production postflight (routing, discovery, access, unavailable states, telemetry) and a separate explicitly authorized test-tenant acceptance if available. Record applied managed identities, hashes, app revision, checks and owner sign-off. Halt on mismatch.

## Synthetic owner acceptance prompts

- “Show accounting for SYN-INTEGRATED.” Compare a reviewed USD posted bill to its exact immutable PO revision and source cost code; PO commitment is separate. A later unposted correction must not replace posted cost.
- “Record a payment against this bill.” Show exact amount, date, reference and review, obtain a separate okay, then record evidence only. Before job PM approval it must fail; a PM cannot post or record payment. Withdrawal must preserve old evidence and block later payment until reapproved.
- “Add this EUR bill, then show the report.” Expect separate USD/EUR groups and no mixed USD result. A legacy missing effective date/currency stays Unknown; historical cutoff must never use recorded/posting time as a substitute.
- “Store my field receipt.” Assigned superintendent can store/reopen exactly their own receipt, repeat finish safely and read verified bytes; another superintendent, unrelated PM, outsider, wrong record/job/company or revoked member cannot. The super must not obtain ledger or payment details.
- “Reconcile accounting for SYN-INTEGRATED.” Expect scoped billing/AP findings and explicit source/coverage limits. “Fix everything automatically” must make no financial change. Missing/oversized snapshot produces unavailable findings rather than partial or zero totals.
- Download the accountant CSV, follow a page-two source link, refresh date filters and sign in again. Verify exact cents/formula safety, mobile navigation and signed-out no-financial-read behavior using only synthetic fixtures.
- Ask for shared settlement, bank transfer, tax/payroll or complete project profit. These remain unavailable; names do not establish common payee identity.

## Containment, rollback and outstanding decisions

Before any new writes, the compatible prior app is the simplest application rollback while preserving installed private schema. After any writes, preserve versions, approvals, settlements/corrections, request IDs, receipts and original bytes. Stop new feature use through an approved application control; if an access-control change is required, seek a separate reviewed emergency authorization. This task did not add such controls.

Unknown migration/write outcome: inspect through supported history/object/readback tools first. Do not replay unconditional `CREATE` drafts or regenerate request IDs. A partial schema requires a reviewed forward repair, not edited history or automatic table drops. A timed-out concurrent index can leave an invalid object; verify before any cleanup/retry.

Rolling back the billing snapshot alone can remove its reader function and then its three dedicated indexes through reviewed DDL, preserving source evidence. Do not automatically drop new AP/PO tables, generated link columns or originals. App rollback does not reverse a recorded payment or issue a refund. Resume only after compatibility, state reconciliation, scoped tests and owner approval.

Outstanding decisions/status:

- **Pending owner approval:** reporting commit push, PR metadata updates and exact integrated external release. Target and final release content must be presented first under [client-release-approval](/Users/marshallwilkinson/.codex/skills/client-release-approval/SKILL.md): “Wait for Marshall's explicit approval to release that content to those recipients.”
- **Pending supported managed lane:** actual history/object/helper/grant/bucket verification, final identities, final SQL hashes, advisor review and safe index strategy. No denied direct route was retried or bypassed.
- **Pending owner policy confirmation if still unresolved:** whether PM/AP/contracts may read company boilerplate after an owner attaches it to an internally approved PO on their assigned job. The current source allows that scoped reading; company-wide catalog/default edits remain owner-only.
- **Pending staging acceptance:** real role/plan parity, host final-approval UX, receipt/orphan policy and source-size/performance budgets. The synthetic tests do not resolve those environment-specific facts.
- **Retained limitations:** no supplier-bill originals, external accounting completeness, job settlement allocation, enabled shared payments, transfers/refunds, tax/payroll or complete P&L. No claim of shipping these was made.
