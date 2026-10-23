# Athena submittal package verification

Release state: review only. No merge, deployment, production migration or email send was performed by this change. Apply the staged migration through the approved Cloud release. Host acceptance is a separate release gate; local tests are not a Claude/ChatGPT/Grok pass.

## What the workflow does

- `submittal_log` / `submittals_list` / `submittals_import` retain the existing canonical log and revision/transmittal allocator. The log now reads real transmittal numbers and package pieces, shows spec, revision, explicit Overdue Yes/No, and separate package-send evidence. All four reads paginate rather than silently truncating.
- `submittal_package` is a real listed tool: `get`, `upload_piece`, `build`, `renew_link`, `revoke`. Use the saved submittal id or number. Set up required pieces and their supplier/manufacturer/sub contacts through the existing log, then upload received files against each piece id. Sources are immutable private objects. PDF/image pages follow the cover; native DOCX/XLSX/CSV files are embedded PDF attachments, identified on the cover. Every source original is embedded unchanged and its SHA-256/reference retained in the manifest. Some browser PDF viewers hide native attachments; use a PDF reader's attachments panel.
- Building requires a real spec section and every required piece/file. Company branding supplies the letterhead (company wordmark when no supported stored logo exists), job, spec, contents, date, revision and the existing T-number. No spec text, contact or review outcome is invented. Rebuilding unchanged content reuses the package; a revision receives its own transmittal through the existing allocator.
- `submittal_delivery` saves the exact email (`draft`), approves that saved draft (`approve` with its key and `confirmed:true`), and records an actual successful connected-email receipt (`record_sent`). A draft/approval is never a send. This tool does not itself send mail or authenticate to an email provider. The host supplies its successful provider message id and sent timestamp; this is a recorded host receipt, not independent inbox verification. A failed/declined send has no receipt and cannot mark the submission complete. Repeated identical receipts cannot double-count.
- Package review links expire after ten minutes. Recipient download capabilities activate only after approval and last at most thirty days. Renewal rotates the capability, leaves the file unchanged and requires a new reviewed draft/yes. Revocation preserves all files. Old revisions remain readable; writes use the current revision.
- Chase targets are canonical current log entries, one per missing required piece. A1020/A1030 schedule milestones are no longer fabricated submittals. Missing contact/name/spec produces a specific question and no sendable draft. Each actual chase send starts the existing seven-day follow-up loop, using the job time zone and receipt's date; received pieces stop the chase. Due follow-ups remain on the morning brief. Every chase waits for approval. Normal `submittal_chase` calls persist the exact draft and return its delivery id/key before asking for yes; `preview_only:true` is explicitly read-only and cannot authorize sending. Repeated approval does not authorize a blind duplicate send: the host must reconcile connected Sent mail when a prior approval has no recorded receipt.
- The six visual submittal tools now advertise the existing `ui://athena/native-card.html` resource. Full rows stay in fallback text. Submittal results omit the hidden HOUSE STYLE block. This is scoped to submittals: it is not the proposed all-tool UI migration. `widget-bridge.ts`, `cards/widget.ts`, the ChatGPT URI and `openai/outputTemplate` are unchanged.

## Database handoff

Stage only: `supabase/migrations/20261028120000_athena_submittal_packages.sql`.

Apply through Lovable Cloud after review, never a workstation Supabase command. It runs atomically with a short lock timeout, creates two additive tables and the private `athena-submittals` bucket (50 MiB), guards writes with active membership and full job scope, preserves the existing anonymous file-share behavior, and adds separate approved-download and short-preview lookups. Existing `athena-files`/`athena-drawings` caps, drawing originals, auth and Hub are unchanged. No existing rows are deleted/backfilled and no migration is applied by tests or CI to production.

The migration also repairs ambiguous PL/pgSQL variable references in the existing submittal log/item writers using a per-function directive. Contact-only updates preserve received files, status and chase history; the item writer independently enforces active membership and full job scope. These paths are exercised against the actual local SQL.

Deploy the migration and server code together; the new readers/tools require these functions/tables. Rollback must preserve the new stored files and evidence tables. Do not reapply historical storage migrations or reset existing bucket limits.

## Automated evidence

Run from the repository:

```sh
npm test
npm run build
npx vitest run --config tests/mcp-roles/vitest.config.ts
npx tsc --noEmit --pretty false
```

The PR workflow runs the default suite and build only, never deploys or sends email. Its install explicitly uses MCP SDK 3.0.5 and Zod 4.4.3, matching the committed manifest; the inherited lock is incomplete for the MCP SDK, so `npm ci` cannot be used without a separate lock repair. The app's existing dependency ranges are unchanged except for adding pinned `pdf-lib` 1.17.1.

Final local default suite (including #218): **1,929 tests passed across 180 files**. Production build passed. Separate role suite: **114 passed / 56 failed**, matching the base. Focused lint passed. Type checking: 34 existing diagnostics, no new file/error-code diagnostics compared with the starting base.

Focused coverage includes the real local SQL/RLS, current revision transmittals, separate piece contacts, false received states without files, source immutability, cover-first page merging, native attachments, byte/hash preservation, actual handler upload/build/reuse, review vs send, changed recipients/body, stale packages, receipt idempotency, preview expiry, renewal/revocation, foreign-job/anon/inactive/role denial, resource discovery, complete row fallbacks and unchanged ChatGPT metadata. No real provider send is exercised.

For repeatable desktop/phone and light/dark-host render fixtures:

```sh
ATHENA_RENDER_PROOF_DIR=/absolute/private/output npx vitest run src/lib/mcp/submittal-render-proof.test.ts
python3 -m http.server 8769 --bind 127.0.0.1 --directory /absolute/private/output
```

Open the local index. It uses the actual native resource and a local initialization/tool-result bridge, with prominently fictional job 2701 data. This checks the UI shell, not live Claude negotiation. The generated PDF and original source support independent text, page-order, attachment/hash and visual checks.

The untouched starting base was `86f64db2`; the final candidate is updated onto `37d85089` (including #218, #215 and #213), with Athena version 0.8.21 to refresh discovery for the two new tools. The legacy role suite is 114 passing / 56 failing on both base and candidate; these failures are not hidden in the default-suite count. Type checking has 34 pre-existing diagnostics on the starting base; compare diagnostic locations/codes (one SDK union message grows when tools are added). The default base suite had one stale version assertion, corrected here to use `ATHENA_VERSION`.

## Live browser baseline, October 23, 2026

Read-only checks in signed-in regular chat, not Claude Code:

- Claude chat: https://claude.ai/chat/abefd628-c12f-40f5-9946-229f578aa188 . Current deployed log had three saved rows; chase added A1020/A1030, missing name/email/spec and the greeting `there,`; output was ordinary tables. FAIL. No records changed and no mail sent.
- ChatGPT chat: https://chatgpt.com/c/6adb4662-54f4-83e9-a176-9d9634393763 . Combined log/chase request and a separate log-only retry both ended `This response couldn't load`, including after page reload. FAIL; do not describe current ChatGPT submittals as passing based on older reports.
- Browser automation subsequently lost its connection. A contract-card follow-up was not verified complete. No candidate has been installed into either live connector; no candidate host pass is claimed. Grok Bot was not exercised in this run.

Baseline screenshots and the rendered fictional cover are saved privately with this task. The legacy general-tool HOUSE STYLE/refusal instructions and the lack of native metadata on contract/SOV/brief tools remain separate work; this PR does not claim to solve all Athena rendering.

## Required release acceptance

After Gage reviews and the team publishes the approved candidate/migration, run on job 2701 using only fictional people and example.com emails:

1. Existing log shows the saved rows with spec, revision, actual transmittal, ball owner, due date and explicit Overdue Yes/No; chase ids are a subset of current saved log ids.
2. Add an explicitly fictional submittal with required product cut/shop drawing/document pieces and named example.com contacts. Each missing source has its own draft; no `there,`, placeholder recipient or invented spec.
3. Upload each piece once, build the package, open the private preview and inspect company cover, T-number, date, contents and all source pages/attachments. Compare original hashes. Rebuild without a change: same package.
4. Create a revision: different T-number and dated cover, previous package and source remain intact.
5. Show a complete exact draft. Decline: no send and no completed submission. Approval alone: still not sent. Never send during this acceptance run; actual-send behavior is covered by local fixture receipts. Do not fabricate a production receipt to make a test pass.
6. Change recipient/body or package after draft review: fresh approval required. Turn off a link: original files survive. Renew it: previous approval cannot authorize the new link.
7. ChatGPT and regular Claude must show the Athena-rendered navy/blue/gray card with all rows. A plain model-authored table is a styling FAIL. Verify Grok's full usable fallback and counts; record whether that host actually advertises/supports MCP Apps, rather than pretending text is an interactive card.
8. Rerun [Marshall's do-not-break list](athena-do-not-break.md). Preserve the one connector, hidden-line behavior, Gantt pan/red delay, repeatable inbox/calendar brief, stored drawings, pay apps, palette and board access. Never touch Hub sign-in or send real email.

Record the candidate commit and deploy id with screenshots and host-specific PASS/FAIL. Any live styling/data/do-not-break FAIL holds release. No merge or production publish is authorized by a green local/CI result.
