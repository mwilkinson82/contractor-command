# Accounting exception review

`accounting_reconciliation` is a read-only, chat-first review for one resolved company and job. Billing findings require the staged, versioned billing snapshot RPC to be installed through a coordinated migration; before that the tool reports billing unavailable. AP remains separately unavailable until its own complete scoped snapshot contract is integrated. It runs through the existing membership/security guard and `resolveJob(..., "full")`. Every financial RPC rechecks membership and full job access. There is no new migration, direct table read, privileged client, financial write handler, automatic repair, bank connector or payment execution.

## Evidence and limits

- Billing: existing `mcp_billing_evidence_get(_job)` returns invoices and immutable versions, receipts, signed allocations and receipt reversals. Current posted credits reduce invoice amounts; they do not imply cash refunds. Balances use exact `BigInt` arithmetic after rejecting unsafe or fractional input cents. Output cents are decimal strings and displayed dollars preserve cents even above JavaScript's aggregate safe-number limit.
- Checks: unmatched invoice/receipt amounts, over-allocation, repeated references/IDs, dangling targets, excessive reversals, missing version/correction lineage, and source-reference gaps. Draft/void invoices with active evidence require review. An unmatched amount alone does not prove delinquency or a duplicate payment.
- Originals: existing `mcp_billing_documents_get(_job)` returns associations. Only a link to the exact invoice version or receipt counts. Missing links and unlinked originals require review. This does not open or verify original bytes, authenticity or agreement with entered facts. Unknown/malformed document coverage produces no invented missing-document claims.
- One database statement captures invoice versions, receipts, allocations, reversals, originals and associations under one PostgreSQL MVCC snapshot. Each relation is bounded at 5,000 rows. If any relation exceeds that bound, the RPC returns complete=false and no evidence, and the tool withholds findings. Missing, malformed, foreign-scope or unsupported snapshot envelopes also fail closed. Re-read exact records before correction review. The opaque `evidence_key` identifies an observation and is not a review ticket, lock or authorization. No financial evidence is persisted by this tool; normal shared guard cache/security telemetry still applies.
- When the complete billing snapshot is available, results report issue codes, record IDs/versions, cents, coverage and source navigation, with up to 50 findings per response. The total is unknown when billing coverage is unavailable. They do not return raw ledgers, counterparties, free-text sources, actor identities, storage paths or document contents. The existing private billing-records page is the AR source link.
- No entered records does not establish complete history or a zero project balance. Bank settlement, actual transfers/refunds, tax and payroll remain unavailable.

## PR351 dependency contract

The adapter follows the staged SQL read from `docs/athena/job-cost-submission.schema-draft.sql` in the AP worker's local commit `f3f02445fa7a52c23cc7dd0f7469ffe9af534ef3` (schema SHA-256 `a9db93cf579c1f623ec7007c6e404add048a2237f206777a91e332ba04f1dd00`). That design is provisional, not applied or imported here. Supplier/PO PR352 is not a runtime dependency. This track changes none of either worker's tables, migrations or write state machines.

Call `mcp_cost_submission_read` with `{ _job: resolvedJobId }`, using the same scoped user client. Its all-affected-jobs access check must remain in place. The RPC, not this adapter, verifies company ownership and every affected-job permission; the current response has no company envelope. Records hidden by that gate remain unknown and the summary cannot claim AP completeness. Preserve that check if extending the contract.

Expected response:

- `{ records, originals_available: false, posting_available: boolean }`.
- Each record: `id`, `kind`, `versions` (immutable `record_id`, `version`, `reason`, `facts`), `posted_version`, `approved_versions`, `payments`, `active_settlement_cents`.
- Facts: `kind`, integer `amount_cents`, `counterparty_name`, optional/nullable `document_reference`, `original: "missing"`, and `allocations[{job_id,cost_code,amount_cents}]`.
- Payment evidence: `id`, `record_id`, integer `amount_cents`, `reference`, `shared`, `corrected`, `correction: null | {reason,...}`. A shared payment row's amount is the allocation to this record, not its whole header. Same shared payment ID across records is not automatically a duplicate reference.

The testable model checks version/allocation conservation, effective posted payable versus active recorded settlement, active-settlement total versus uncorrected evidence, payment/correction lineage, duplicate references and unavailable originals. A later unposted correction leaves the older posted amount effective. A payment is never another cost. Company-paid expenses do not create a reimbursement payable. Amounts on a split record describe that visible whole record, not a pro-rated job cash ledger; no company/job cost or payment totals are computed here.

Known missing optional RPC (`PGRST202`/`42883` naming that RPC) or unsupported/null response yields unavailable AP coverage. Permission, membership and unexpected database errors are not suppressed or retried. AP currently has no persisted source-record URL; findings name `job_cost_submissions_read` and record IDs instead of inventing a page link. Shared-header conservation, trusted common-payee identity, PM approval timing/withdrawal reconciliation and attachment access remain separate integration work. The existing `business_approvals`/withdrawal fields are intentionally not treated as proof of valid historical settlement authority.

Requested narrow improvement for AP's owner: version the read envelope, include the resolved company/job, explicit omitted-record/completeness coverage and shared payment header/authorized allocation totals if that check is to be supported. Keep recorded evidence correction separate from real bank reversal/refund. Validate this adapter against the final applied RPC before enabling AP coverage in a release. CI uses a pinned, read-only SQL fixture extracted from the actual staged AP schema at the stated commit; no AP write handler or migration is copied. An earlier opt-in local run also exercised the actual full staged schema. These tests do not prove final AP deployment or write concurrency.

## Correction review integration

Finding -> re-read source -> identify exact immutable target/current version -> prepare the existing workflow's review -> show source-supported proposed correction -> obtain confirmation -> execute through that workflow only. This tool provides no save action. Existing AR `billing_evidence_record` and `billing_document_link` keep their confirmation/review binding. AP correction review must use PR351's reviewed interfaces after integration; this track does not claim unsupported partial corrections, refunds, PM approval withdrawals or shared-payment chat flows exist.

After an uncertain write, read back first and preserve the original operation/request ID and reviewed payload. A finding is a review lead, never permission to reverse, reallocate, post or pay. Existing financial evidence remains immutable.

## Safe owner acceptance prompts

Use a synthetic company/project and its deliberately seeded records only:

1. “Athena, reconcile accounting for SYN-A in Synthetic A.” After the snapshot proposal is reviewed and applied in an isolated test environment, expect partial/unapplied cents and original gaps plus the billing source link. AP and bank coverage remain unavailable. Before the RPC is applied, expect billing coverage unavailable.
2. “Show the billing source records.” Expect the permitted project billing page; the summary must not expose another company's job or original storage path.
3. “Fix everything automatically.” Expect no financial change; inspect the source and propose a supported, explicitly confirmed correction only if requested.
4. During a synthetic invoice/allocation correction, the billing snapshot must show one consistent committed state. Findings remain unavailable if the bounded snapshot cannot be returned.
5. As assigned PM, review the permitted synthetic job. As superintendent, estimator, outsider or PM without assignment, expect the existing financial-access denial. No role/access changes are part of this acceptance test.
6. After coordinated snapshot and PR351 integration, seed a bill with a partial recorded payment and a later unposted correction. The model should use the earlier posted payable and describe payment as recorded evidence, not funds transferred. Until the snapshot and completeness contract is validated, AP findings remain unavailable.

## Verification and release

The new model, chat reader and local PGlite tests exercise safe cents, partial allocations, credits/voids, reversals, missing/duplicate references, version lineage, document associations, company/job isolation, membership and role gates, provisional AP corrections and interleaved evidence. The database test consumes the actual committed billing RPC schema. No customer records are used. Multi-connection PostgreSQL concurrency, final AP schema deployment and live owner acceptance are separate release checks.

Base verified from remote: `codex/athena-passwordless-login-only` at `1fc1bec4f60b2080743cb81e399d7c016f6981dc`. Draft PR only; integration, exact-head CI, migration ordering/review and publication remain serialized by the parent release coordinator.

The staged SQL proposal must be reviewed, ordered after both billing migrations and converted to a migration using the Supabase CLI by the release coordinator. No live migration has been applied. AP output remains gated pending a versioned, authorized snapshot that reports whether records were omitted. Real PostgreSQL concurrency testing used a dedicated socket-only synthetic cluster and a test-only delay inside the statement; production has no delay.
