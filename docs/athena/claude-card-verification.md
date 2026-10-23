# Claude lookahead and open-items card verification

Base: `codex/athena-passwordless-login-only` at `5c3b672f` (includes #196, #197, #198 and #201).

## Change

The failed Claude conversation called `lookahead_list`, received an index without its saved item rows, and attempted the PDF/export tool for those rows. It also treated presentation instructions inside returned tool text as embedded instructions. This change supplies a native MCP Apps view rather than relying on Claude to construct an artifact.

- `lookahead_get` is a real, guarded, read-only tool in tools/list and the generated manifest. It returns the chosen lookahead's saved items directly, including closed rows with their status, plus the current CPM window and overlapping activities. With no saved CPM, saved lookahead dates and items still display.
- `lookahead_list` preserves its existing index/count fields and also includes the latest populated lookahead's actual saved rows, in text, structured content and the backend-rendered card. Reading either tool does not invoke a PDF, email, storage upload, share-key mint or item write. Existing membership, security and read telemetry remain.
- Scoped item reads page through all rows. Ordinary callouts are navy/blue. Explicit risks, delays, delay-notice tasks and overdue open rows retain red under #201's classification. Closed rows do not acquire overdue flags.
- `ui://athena/native-card.html` uses `text/html;profile=mcp-app`, the published 2026-01-26 Apps handshake, and `_meta.ui.resourceUri` on **only** `lookahead_get`, `lookahead_list`, and `list_open_items`.
- It displays `structuredContent.html`, already rendered by Athena on the backend. It accepts messages only from its initialized parent, strips active markup and event attributes, rejects remote CSS loads, and makes no tool calls, sampling requests, network requests or chat submissions.
- The existing ChatGPT `ui://athena/card.html`, its MIME type, script and result-only `openai/outputTemplate` are unchanged. That key remains absent from tools/list. No list/request handler is patched; native registration uses the existing resource/tool registration bridge.
- The full server-built HTML and branded Markdown fallback remain in tool text. This does not guarantee that a text-only host will display HTML or apply color; visible styling remains an acceptance requirement, even when the data are correct.
- CPM/Gantt, IOR, morning brief and drawing tools retain their existing presentation paths. No authentication, sign-in, Hub, Site URL, email code, existing tables or migrations changed.

The generated manifest also refreshes previously stale descriptions from the unchanged source tools. No generated transport routes were edited.

## Verified locally

- Full Vitest: **170 files / 1,745 tests PASS** after updating onto #201.
- Production build: **PASS**.
- Semantic ESLint: **PASS** on new helpers, tests and registration bridge with the repository's formatting rule disabled.
- TypeScript: the current base and this branch both produce **34 diagnostic signatures**, with none added or removed. Typecheck is baseline-failing; it is not reported as passing.
- Protocol-level tests inspect the real SDK's tools/list, resources/list and resources/read. Compatibility checks retain ChatGPT's output-template placement and keep CPM/Gantt tools outside the new view.
- A real Chrome local iframe fixture completed the Apps handshake and displayed backend-rendered fictional data with navy/blue/gray, red delay/overdue rows, and all six items. This was a local fixture, **not a live Claude or ChatGPT pass**. The fallback HTML was retained and inspected separately.

## Marshall / Tess acceptance before release

Use job 2701. Refresh Athena's connector/tool catalog if the new tool/resource is cached. Use the single existing connector at `app.meetathena.io/mcp`.

1. ChatGPT: rerun the full supplied do-not-break checklist before deployment. Confirm no "Hidden" line, correct lookahead data, full brief including inbox/calendar on repeated explicit requests, panning CPM Gantt, red delay banner and stored drawing pages.
2. Claude: ask for the 14-day lookahead. Verify all saved items appear without authorizing `lookahead_pdf`, a PDF export, email or upload. Check the current CPM window rather than an old chat's dates.
3. Claude: ask for open items. Reconcile the displayed counts to the returned rows. Require a visible Athena card with navy/blue/gray; a plain table or Markdown-only reply is a **FAIL**.
4. Confirm ordinary callouts stay navy/blue and only real risk/delay/overdue rows are red, including delay-notice obligations introduced by #201.
5. Verify the native UI and the fallback appearance in the actual clients. If the client does not load the view and only displays Markdown, styling has **not passed**, regardless of unit tests or returned HTML.
6. Grok Bot: run the equivalent read-only requests and check visible styling. Native-view support is not presumed.

No live job data were changed, messages/emails sent, migrations applied, PRs merged, or deployments performed. Client acceptance and Marshall's express release approval remain required.
