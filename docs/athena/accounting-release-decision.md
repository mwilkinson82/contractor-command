# Accounting release decision — follow-up review

**GO for private engineering review of the local candidate. NO-GO for managed application or production publication until the environmental checks and exact release approval below are complete.** No remaining reproducible end-user authorization bypass was found in the reviewed accounting paths. No actual migration directory/journal, live grants/security settings, database, remote branch or PR was changed.

## Finding disposition

| Finding | Disposition | Release significance |
| --- | --- | --- |
| Privileged event mutation | **Documented backend credential boundary; not an identified end-user bypass.** | Verify effective managed ACLs/credential containment before release. No blanket immutability claim against privileged credentials. |
| Billing snapshot bytes | **Fixed locally.** 1 MiB aggregate source-text budget before JSON grouping and 2 MiB complete UTF-8 envelope cap; oversize returns complete=false with both financial payloads null. Caller independently rejects oversized envelopes. | New producer draft/hash must be reviewed; never deploy the older uncapped source as the fixed version. |
| Snapshot caller wait | **Fixed locally.** Each reconciliation snapshot RPC has a 5-second response deadline and uses transport abort when available; late answers cannot replace unavailable results. SQL cancellation 57014 is treated as unavailable rather than partial evidence. | HTTP abort is not proof the database stopped working. Effective API statement timeout/cancellation is still a managed verification gate. |
| Durable supplier / PO revision links | **Locally verified, no further source fix required.** Optional generated identity columns have party/PO/revision FKs; immutable PO/version rows preserve references. | Include the existing integration bridge in the approved order. It is not installed live. |

### Precisely who can mutate events

Athena company roles (including owner/AP) are business roles inside the shared **authenticated** PostgreSQL principal. For all eight reviewed event tables—accounting approvals, single payments, shared payments/allocations, payment corrections, business approvals/withdrawals and request operations—the source revokes direct writes from authenticated, anon and inherited PUBLIC. Both PGlite and native PostgreSQL ACL checks confirmed this; owner/PM/superintendent/outsider attempts were denied. Company ownership does not grant database-administrator rights.

The source explicitly grants **service_role** table authority. This is a privileged application-backend credential, so the exposure is **not confined to a human database administrator**. A holder can update these event rows through the database/Data API where exposed. Native tests proved a same-value payment update succeeds as service_role and fails as authenticated. A regression also changed a synthetic reference inside a rolled-back service transaction to demonstrate the distinction. Version/posting mutation is additionally blocked by triggers; other event tables rely on ACLs and append-only RPCs.

The reviewed accounting entry points do not hand this credential to a member or accept an arbitrary table/mutation. Financial attestation helpers create service clients server-side, resolve the actor from the verified bearer token, and call specific claim/register/link RPCs. The receipt service-only RPCs and private review consumer are not executable as authenticated. Cost accounting/PM/correction RPCs check membership/scope, review and version, and append evidence rather than editing old events. Existing source and new executable tests cover these boundaries. A backend credential compromise or unauthorized privileged maintenance remains an operational trust risk. Adding further immutable-event triggers or narrowing service grants would be a separate hardening change; neither is needed to repair an end-user exploit found here, and neither was made under this task.

### What the durable bridge guarantees

Foreign keys prevent missing supplier/PO identities and nonexistent exact PO revisions; a party-only bill remains permitted. Tests now cover party-only deletion denial, invalid revision rejection, immutable cost facts, later PO revisions leaving earlier cost references unchanged, and the superintendent's empty own-submission view rather than ledger access. Existing writer tests reject wrong-company/job/party and mismatched snapshots. The FK bridge does not independently authenticate invoice contents or prevent an all-powerful administrator from disabling constraints; those are not promises of this feature.

### What remains about time and size

The byte limits and response deadline are covered by UTF-8, metadata-only envelope, stalled/late transport and independent AP/billing coverage regressions. No financial fact is truncated, rounded or silently discarded into a partial total. A legitimate large job can be unavailable; that is a deliberate coverage limit.

The native lab verified a timeout set **before** the snapshot query cancels a blocked statement with 57014 and a later read succeeds. It did not assert that an HTTP abort kills database work, or that the current managed timeout has any particular value. Supabase documents API/function/role timeout behavior in its [timeouts guide](https://supabase.com/docs/guides/database/postgres/timeouts). Verify the effective PostgREST/function/role timeout and cancellation in authorized synthetic staging through the supported lane. Do not alter role/global settings or reuse a denied history route to obtain it. If the existing managed bound is absent or unacceptable, stop and request a narrowly specified configuration change separately.

## Exact proposed SQL order and hashes

These are **nine unregistered proposal artifacts**, not assigned managed migrations. Source baseline in the repository is `0034_athena_financial_documents`; actual managed history and the next identity are unknown here. No identity such as 0035 is asserted as available. Prerequisite hashes, source hashes, execution mode and dependencies are in [manifest.json](managed-accounting-proposal/manifest.json); the source map is [accounting-integration-sources.json](accounting-integration-sources.json).

| Order | Artifact | Execution | Exact proposed SQL SHA-256 |
| --- | --- | --- | --- |
| 1 | [purchase_orders](managed-accounting-proposal/01-purchase-orders.proposed.sql) | One runner transaction | `6625d8f5f1606a585ac0fbaf3955c089504fce68fecdf96fa637e990a1fec5a9` |
| 2 | [ap](managed-accounting-proposal/02-ap.proposed.sql) | One runner transaction | `8eb78744a8a5ee685cc124749e7dc915af4f41f6787ec4d1d80948f67f8aff7b` |
| 3 | [ap_references](managed-accounting-proposal/03-ap-references.proposed.sql) | One runner transaction | `97b4692dd0a3fcfba19d3a01180d5b4ea252a1c12ca8b5ca8f25f54e4e889dff` |
| 4 | [receipts](managed-accounting-proposal/04-receipts.proposed.sql) | One runner transaction | `72601894c0b3b7946421f711fe71b76820ec0d8ac7911865933ec70b1e2e64a5` |
| 5 | [ap_snapshot](managed-accounting-proposal/05-ap-snapshot.proposed.sql) | One runner transaction | `6d5b30f60be11a30d5390a979ff949c50af6bb0c36797c67d8b7dd8aedae4ede` |
| 6 | [billing_allocation_index](managed-accounting-proposal/06a-billing-index.proposed.sql) | One command outside any transaction | `a1517e61ebaba5539b1a51137f323426dab3a0fbe0ada8e8195cfcdd54471f0b` |
| 7 | [billing_reversal_index](managed-accounting-proposal/06b-billing-index.proposed.sql) | One command outside any transaction | `bb0b525bedddbf3553879c7c6a98361ee07a874daaed921a6f74d66d65f02f2f` |
| 8 | [billing_document_index](managed-accounting-proposal/06c-billing-index.proposed.sql) | One command outside any transaction | `636b181f5755a1913ca5cdfe97259492f49598716f49937abc165c6e65646538` |
| 9 | [billing_snapshot](managed-accounting-proposal/07-billing-snapshot.proposed.sql) | One runner transaction | `eba644b16272c22e6f86d9f183800bcb1909b1e589cee2e47ce699d61b6d3a7b` |

The revised billing source SHA-256 is `98dc34e24fdcca3984db78871de5630863a4b747221e75d0b6fe110280c9daf9`; its upstream PR355 source was `fdaba5220ef955e50137e4c47df9e1492368590481f3cd590868622819bc3be6`. The other frozen source drafts, including the bridge, remain unchanged. Proposed transactional payloads add explicit local lock/statement timeouts; the three existing-table indexes are separately proposed as concurrent commands. Thus proposed payload hashes differ deliberately from raw-source hashes. The final billing function payload excludes those index commands.

Run `node scripts/prepare-accounting-managed-proposal.mjs` and `node scripts/verify-accounting-release-sources.mjs` to verify the frozen artifacts. The preparer refuses to overwrite a differing existing artifact. It contacts no database and writes no migration/history directory. Both tools must fail if reviewed sources or proposed SQL drift.

The native PostgreSQL 18.4 lab installed these exact nine hashed artifacts with their declared transaction boundaries and confirmed all three concurrent indexes are valid/ready. The runner must supply one transaction for each transactional artifact. Each concurrent index is a single command outside a transaction, with session timeouts set in separate commands; no blocking-build fallback is approved. This still requires supported Lovable runner compatibility, current object/name checks, actual history mapping and real-size plans/build duration. If that lane cannot run the concurrent steps, the full package remains NO-GO; do not bypass it with a direct route or silently substitute blocking creation.

## Verified local result

323 test files and 3,048 tests passed; four existing skips and two todos remain explicit. TypeScript, default ESLint on all follow-up code/script files (including formatting), and production build passed. The original integration still has inherited repository formatting debt. The native PostgreSQL lab passed nine cases on the exact proposal artifacts. Built Workers route/auth smoke remains in `artifacts/preview-smoke.log`; the verification summary is [accounting-integration-verification.json](accounting-integration-verification.json).

## Actual release gates, separated from limitations

1. **Supported managed verification:** resolve actual latest history, exact prerequisites/objects/helper definitions, effective inherited table/function/schema privileges, private bucket, server credential containment, backup readiness, effective query timeouts and advisors. Use approved supported read/rehearsal routes only. Source files are not evidence of application.
2. **Supported runner and isolated staging:** map the frozen artifacts to actual new identities without conflicts, confirm transactional/nontransactional support, rehearse exact hashes/locks/cancellation on representative synthetic data, then run actual member-role and receipt-byte/host-approval UAT. Do not use customer records. No application is authorized by this task.
3. **Exact release approval and exact-head CI:** present the resulting target, app commit, nine mapped SQL artifacts/hashes, rollback and staging evidence for the specific authorized publication/application/deployment. Prior green CI on individual drafts does not certify this local revised commit.

Other limitations remain explicit and are **not additional implementation blockers for this bounded scope**: supplier-bill originals, shared settlement (still hard-disabled), per-job settlement allocation, external ledger completeness, cross-source atomic close, currency conversion, tax/payroll, bank transfer/refund verification and complete P&L are unsupported. Existing unknowns stay Unknown. PM/owner approval is separate from accounting posting/payment evidence. The host confirmation flag is an assertion; the staging UX must demonstrate the existing exact-draft/separate-okay behavior.

## Smallest external actions requiring approval

- **Review publication only:** authorize the exact local revised commit to a GitHub review branch, the pending latest reporting push, and specific draft metadata updates. No merge, database application or deployment is included. Prepare/show those exact remote changes before requesting the owner's final okay.
- **After supported verification:** authorize the isolated staging application/publication of the exact mapped nine artifacts and matching app, plus synthetic UAT. Read-only supported inspection itself does not need to be inflated into a new approval request where already authorized.
- **After successful staging and exact-head CI:** authorize the concrete production merge/schema application/app publication as one reviewed coordinated release. No grant/security changes, blocking index fallback, customer writes, emails or payments are included.

If verification discovers drift, a missing runner capability or a needed security/configuration change, report that exact new blocker before proposing an expanded action. No denied route has been retried. Existing rollback/containment instructions in the [release checklist](accounting-integration-release-checklist.md) preserve all financial evidence and originals.
