# Full replies and independent Claude card resources

Base: `9e637188`, the #203 rollback (#205), on `codex/athena-passwordless-login-only`. This replaces the compact-reply proposal in #204. No merge or deployment was performed.

## Full reply contract

The presentation middleware excludes **every `tools/call` request**. It never rewrites, summarizes, truncates, or removes any tool text or result metadata, regardless of host, advertised UI capabilities, or whether the native card loads. There is no client hint cache or host-specific reply branch.

The backend's full styled Markdown/HTML remains in `content`, with all rows in `structuredContent` as well. ChatGPT's `widget-bridge.ts`, `cards/widget.ts` and `openai/outputTemplate` handling are unchanged from the rollback base.

The lookahead keeps all six saved rows, including resolved rows, and uses the established report's job-local overdue calculation. Its tiles distinguish six **Saved items**, four **Open saved items**, and three **Overdue on job** for the 2701 test shape. The three job overdue obligations are also returned as rows. The job-wide overdue count is not derived only from the four future-due saved items.

## Independent card path

The resource path supplies the static `ui://athena/native-card.html` shell. It fetches no separate copy of job data. The host passes the same tool result's `structuredContent.html` into that shell through `ui/notifications/tool-result`; the view renders the backend HTML. Loading a resource cannot replace or shorten the full text reply.

The resource plumbing includes the corrections reproduced against the actual installed SDK:

- UI/resource capabilities on both legacy `initialize` and modern `server/discover`.
- Native tool metadata/resource discovery without changing ChatGPT's output template.
- Exact static-resource method misses handled at HTTP 200 (legacy) and 404 (modern). Other resource URIs and authorization failures pass unchanged.
- Required modern `resultType`, `ttlMs: 0`, `cacheScope: private` on synthetic resource results, including empty template discovery.
- Successful native UI initialization accepts a different or omitted returned protocol version, then sends initialized and size notifications.

No prototype/request-handler override, generated-route edit, CORS relaxation, alternate connector, job-data endpoint, authentication change, schema change or migration was added.

## Verification

- **171 test files / 1,779 tests PASS**.
- **Production build PASS**.
- Semantic lint passes for the new helper/tests and other checked presentation files. `workflow-tools.ts` retains the existing line-745 `no-unused-expressions` error, previously verified on the base; edited lines introduce no diagnostic.
- Typecheck retains the same **34 baseline diagnostic signatures**; it remains baseline-failing.
- Job 2701 handler + transport tests cover **Claude and ChatGPT**, each with card available and unavailable: all six saved rows, all three job overdue obligations, complete styled text/HTML, identical structured content, no foreign-job data, no writes.
- Both hosts also retain all 17 open-item rows, three overdue, five due within seven days, full styled text and the existing output-template metadata.
- Actual SDK tests cover modern discovery, native resource reads/lists/templates, protocol fields, and unchanged unrelated/permission/error responses. The earlier authenticated metadata projection is retained as a historical regression fixture, not claimed as a fresh live acceptance run.

The supplied do-not-break checklist was reviewed. The full unit suite passes, but this unpublished candidate has **not passed live Claude/ChatGPT acceptance**. Gage reviews the PR; Tess tests the deployed candidate and the complete do-not-break list before any shipping decision. Plain-text-only Claude output or an **Unable to reach Athena** card is still a live FAIL.
