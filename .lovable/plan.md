# Support release proposal: read-only planning report

No changes were made. Every item below comes from local git or project files.

## Confirmed
- **Backend binding:** Lovable Cloud, one instance shared by preview and the published app. The project id is in `.env`.
- **Latest source revision:** HEAD `1569ab03f61e7bd8e6eab1258fc1b193742857f1` ("Updated Athena logo to PNG"), tree `1b2b284d4b37d3e3ab8f7c9c9b2b029f4f4ededc`. The working tree is clean, on internal edit branch `edit/edt-a7f86b99…`.
- **Candidate base:** `1569ab03` is the current HEAD. Nothing newer has been added since, so I found no drift against the base.
- **Candidate `32412c41…`:** not in this repo (`could not get object info`). It isn't installed, and I didn't infer what it contains.
- **Migration bookkeeping:** the latest managed entry is `0034_athena_financial_documents`. The latest source file is `20261101120002_athena_financial_documents.sql`.
- **Managed migration process used so far:** check HEAD and tree, check the SQL hash, then submit once through the managed migration tool. That tool rejects `BEGIN`/`COMMIT` and `storage.buckets` writes, and it records a numbered drizzle file, a snapshot, the journal and regenerated types. Each run has needed owner authorization. The tool still reports `0013` and `0015` as skipped; both are pre-existing and haven't been touched.

## Unknown
- **Deployed revision:** I couldn't see which commit is live on the published site or custom domains. Nothing I can read here exposes it.
- **Live migration history:** I can't read it, because that access has been denied. The managed tool's own results are the only evidence of what was applied.
- **Candidate contents:** unknown until `32412c41` is synced into this project.
- **`origin/main` alignment:** not compared in this pass.

## Proposed execution (needs separate owner approval)
1. Sync `32412c41` into the project, with no other changes.
2. Check that its parent is `1569ab03`. Diff it against HEAD and stop if any newer change would be lost.
3. If it has migrations, apply each one through the managed tool, once each, with hash checks.
4. Run the support and resend tests, then report the HEAD and tree. Publishing stays with the owner.
