# Claude follow-up after #203

Base: `8330f42d`, `codex/athena-passwordless-login-only`. Marshall reported deployment `b4be00c7`. No merge, deployment, connector reconfiguration or authentication change was performed for this follow-up.

## What was verified live

- Both supplied Claude conversations reproduce **Unable to reach Athena**, with counts-only prose and no card iframe. The lookahead says six saved items / four open / zero overdue; open items says 17 open / three overdue / five due within seven days.
- A fresh OAuth-authenticated MCP inventory now advertises the UI extension, resource capability and all three native tool bindings. A native resource read succeeds and returns the updated handshake HTML. This confirms #203 repaired the legacy discovery/resource path; it does not prove the same path works for Claude's newer protocol requests.
- [Sanitized live discovery projection](claude-v203-live-discovery.json). It is a normalized client projection, not an HTTP packet capture or Claude's historical server log.
- A fresh `lookahead_list` read returns six attached saved rows: two resolved and four open, none of the four overdue on the current job date. The existing `report` lookahead for the same LA-31BE8 additionally includes the job's overdue obligations and reports **three overdue**. These are different scopes, not evidence that the saved dates changed between hosts.

Claude conversations:

- https://claude.ai/chat/48d12c68-35e9-42ff-9927-c6c4df4a7c18
- https://claude.ai/chat/463516ac-bd94-41c4-b290-386d1092dec1

## Reproduced server defects

The actual installed SDK was exercised with valid MCP `2026-07-28` envelopes and routing headers, without registered resources, matching the missing resource registration already observed in the deployed bundle:

1. `server/discover` succeeded but did not declare UI/resource capabilities. #203 modified only `initialize`.
2. `resources/list` and `resources/read` returned **HTTP 404 / JSON-RPC -32601**. #203 inspected only HTTP 200, so its static-resource fallback was skipped.
3. Synthetic resource replies created after the SDK codec lacked the modern `resultType`, `ttlMs` and `cacheScope` fields.

The same integration tests pass after this change. The modern resource-read/list/template-list fallbacks return `resultType: complete`, `ttlMs: 0`, `cacheScope: private`; legacy replies keep their existing shape. `server/discover` now declares the same native resource/UI support as `initialize`.

Only an exact method-not-found error for the selected static resource methods may change HTTP 404 to 200. Other URIs, mismatched reply ids, HTML 404 pages, permission errors, HTTP 401/403/429/5xx, unrelated tools and the existing ChatGPT widget remain untouched. No session emulation, anonymous job endpoint, CORS relaxation or prototype override was added.

Modern client capabilities are taken from that request's envelope, never inferred from a prior legacy initialize. The compact native text now includes every backend card row, preserving full item detail if Claude cannot mount the app. Complete HTML and structured content remain available. ChatGPT and text-only fallback replies retain their existing behavior.

## Lookahead scope correction

`lookahead_get` keeps every attached saved item, including resolved rows. Its tiles now distinguish **Saved items**, **Open saved items** and **Overdue on job**. The overdue count and red obligation rows come from the same `lookaheadData` / `lookaheadModel` used by the existing report, using the job's current local date. The current 2701 shape is six saved / four open saved / three overdue on the job.

The result includes `as_of`, `overdue_scope` and the overdue rows. If the report context is unavailable, it explicitly labels the smaller saved-items scope rather than claiming a job-wide zero. No records or dates are changed. The established ChatGPT report calculation is unchanged.

## Verification and remaining gate

- Full Vitest: **171 files / 1,775 tests PASS**.
- Production build: **PASS**.
- Changed helper/test files pass semantic ESLint. `workflow-tools.ts` retains its existing line-745 `no-unused-expressions` failure, verified against the current base; the edited lines introduce no lint diagnostic.
- Typecheck: **34 diagnostics**, identical normalized signatures to the recorded base; it remains baseline-failing.
- New tests cover modern discovery/read/list/template-list through the real SDK; unrelated/auth/resource errors; complete six/seventeen-row native text; and the six saved / four open / three job-overdue shape, excluding resolved, due-today and foreign-job obligations.
- `widget-bridge.ts`, `cards/widget.ts`, sign-in, Hub, Site URL, email codes, connector address, schema and migrations are unchanged.

**Historical logs remain unavailable from the connected hosting tools.** The requested window is October 22, 10:32–10:42 PM Manaus, equivalent to October 23, 02:32–02:42 UTC. A redacted request/error export was requested from Marshall's team. No historical CORS/auth failure or Claude protocol version is claimed as verified. A public report of the same Claude symptom is [anthropics/claude-ai-mcp#636](https://github.com/anthropics/claude-ai-mcp/issues/636); it is supporting context, not Athena origin-log evidence.

The modern wire requirements are documented by the [MCP specification release](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) and [SDK cache guidance](https://py.sdk.modelcontextprotocol.io/client/caching/).

**Claude remains FAIL on the reported deployment. This candidate is UNTESTED live.** Per Marshall's instruction, the team reviews and publishes, then Codex retests the real Claude resource/card flow and the complete ChatGPT do-not-break list. A unit-test pass is not a live styling pass. No rollback is proposed on the evidence available.
