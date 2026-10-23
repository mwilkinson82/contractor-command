# Re-extract plan: verbatim contract clauses (migration 0021)

Status: PLAN ONLY. Nothing here has been run against live data. Every write step needs Marshall's own approval.

## Scope
Jobs on ALP Construction (company 5300fd46-5185-45d9-a43d-f0964d34be08): **1001, 2601, 2602, 2603**.
Today these jobs hold contract terms only as summary facts (`notice_timing`, `claim_process`, `notice_requirements`, etc.) and deadline rows. The audit found paraphrased (§6.4, §7.4, §8.1), invented (§8.3 on 2603) and missing (§3.4, §6.3, §11.1, §7.4 claim process) terms. Migration 0021 adds `mcp_contract_documents` and `mcp_contract_clauses`. Those tables start empty for every job.

## Order of operations
1. **Deploy 0021 first** (separate approval). It is additive: it adds new tables and functions only, and no existing row changes. Reports keep showing the legacy facts under "Other saved terms (summary fields)" until clauses exist. On client reports, any legacy contract string that mentions a claim stays hidden in full.
2. **Inventory (read-only)** for each job: list current facts, contract deadline rows, open `clause_*` items and any stored document. Save the snapshot to `docs/reextract-snapshots/<job>.json` for rollback and comparison.
3. **Find the source contract text** for each job (see the next section).
4. **Dry run.** Extract clauses from the full contract text: every notice and time clause, copied exactly, one entry per section, with section number and heading. Then compute locally, without writing, what `mcp_clauses_save` would do: each clause's source (document or unverified), parsed days, day type and trigger, and the missing-notice checklist. Diff the result against the legacy facts and deadline rows. Show Marshall the diff per job.
5. **Apply (approval needed per job).** Run one `intake section=clauses` call per job with `clauses[]` and `contract_text`. Each call is idempotent (upsert on job + section). The tool opens `clause_missing:*` and `clause_unverified:*` confirm items itself. It never fills in a missing clause.
6. **Legacy facts.** Leave them in place for now. They are no longer used for due-date math once clause rows exist, and on client reports their claim text stays hidden. After the dry-run diff is approved, mark paraphrased legacy facts that conflict with a verified clause as superseded. Delete nothing.
7. **Deadline rows.** Contract deadlines derived from paraphrased text, and the invented §8.3 deadline on 2603, are not deleted. Flag each one with an open item ("Check against §X as written") and close it only after a person confirms. 2603 is TEST data: close only what is needed there.
8. **Verify.** For each job, `contract_terms` should print `§X Heading: ‹exact text› (document)`. The client report must have no §7.4 and no claim text. A delay event's due dates must match the clause days (on 2603, §6.4 is 3 calendar days and §7.4 is 7 calendar days).

## Source text per job
| Job | Expected source | Action |
|---|---|---|
| 2603 (TEST) | `/workspace/athena/sample-subcontract.md` (Lakeview, RB-2611-16E) | Use it as `contract_text`. The test `tests/mcp-roles/verbatim-clauses.test.ts` proves all 10 clauses are verbatim and that there is no §8.3. |
| 1001, 2601, 2602 | Unknown. No full contract text is stored today, because the server never kept documents before 0021. | Search the member's uploads and email attachments (read-only) for the signed subcontract. If it is found, use it. If not, follow the next section. |

## When no contract text is stored
- Do **not** rebuild clauses from the legacy summary facts. That would lock in the paraphrase.
- Ask the member, after Marshall approves the message, to upload the signed contract (all pages, including any rider or exhibit). Until it arrives:
  - Clause rows may be saved only from text the member pastes, and each one is stored **UNVERIFIED** with an open "check against the contract" item. `mcp_clauses_save` does this on its own when no body is on file.
  - Each missing checklist notice (delay, claim, non-payment, cure, schedule disagreement) gets a confirm item. Nothing is filled in.
  - Legacy facts stay hidden on client reports where they mention a claim.
- When the document arrives, re-run step 5 with `contract_text`. The rows switch to `document` and the matching unverified items close, resolved as verified.

## Rollback
Restore from the step-2 snapshots: delete the job's `mcp_contract_clauses` and `mcp_contract_documents` rows and reopen any items that were closed. No legacy data is changed, so no rollback is needed for it.
