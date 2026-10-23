# Athena release preflight (PRs #219, #221) — findings and release steps

Read-only check. I changed nothing: no files, SQL, settings, emails, or publish.

## Findings

1. **Code in this workspace:** HEAD is `4406c5ad4ec3e2a8c945694b145c00019abbe5a5` ("Split combined meeting notes… (#217)"). The local branch is a Lovable working branch (`edit/edt-86648b…`), and the working tree is clean. I cannot see the connected GitHub repo or which branch is selected for sync. The owner must confirm both under Project settings → Git. HEAD shows PR #217 as the latest merge. **I cannot see #219 or #221 in this checkout,** so they are not synced here yet.
2. **Domains:** the published app is `contractor-command.lovable.app` (also the primary address). Custom domains are `app.meetathena.io` and `app.alpcontractorcircle.com`. My tools can't see the currently published commit or deploy id.
3. **Shared deployment:** both custom domains belong to this one project. So `app.meetathena.io/mcp` is served from this project's single published build, and publishing also changes `app.alpcontractorcircle.com` and the Lovable address. You can't publish to one domain only.
4. **Backend:** Lovable Cloud, managed. One live instance (ref `qcbbjjjxcacrscfhgfmf`) serves both the preview and the published app. Any database migration goes live as soon as it is applied, before you publish.
5. **Pending database files:** the newest applied-tool record is `drizzle/migrations/0024_athena_reopen_open_item.sql`. The repo also has files in `supabase/migrations` dated 2026-10-26/27 (drawing_sets, report_item_severity, delay_notice_severity, drawing_versions). I have not checked whether these are already in the database. I'll check that before applying anything.

## Supported workflow (needs approval to run)

1. **Sync:** merge #219 and #221 into the synced branch on GitHub. Lovable pulls them automatically when that branch receives a push. Then I confirm HEAD equals the approved merge commit and that the diff covers only those PRs.
2. **Find the one staged migration:** identify the single new SQL file from those PRs and check read-only that it isn't applied yet.
3. **Apply the migration:** run it once, unchanged, through Lovable Cloud's migration tool. This takes effect on the live database immediately. The tool also writes its own drizzle copy and journal entry and refreshes `types.ts`. That's expected bookkeeping, not a code change.
4. **Verify:** check the build log, typecheck, and confirm the migration's tables and functions exist. I won't count preview results or test runs as proof that the release is deployed.
5. **Publish:** Publish → Publish changes, triggered by the owner or by me on explicit instruction. This updates all three domains together.
6. **Post-check:** after publishing, read-only checks of `https://app.meetathena.io/mcp` metadata and the manifest version.

Sign-in settings, Site URL, Hub, and permissions stay untouched throughout.
