# Claude native-card recovery after #202

Base: `codex/athena-passwordless-login-only`, `92621150` (#202). Marshall reported that this squash is live in deployment `23b691e2`; the deployment id itself was not independently inspected.

## Live evidence before the change

A fresh OAuth-authenticated MCP client discovered the server at `https://app.meetathena.io/mcp`. Its returned tool catalog contained `lookahead_get`, `lookahead_list` and `list_open_items`, all without `_meta.ui.resourceUri`. Server capabilities contained only `tools`, and reading `ui://athena/native-card.html` returned `-32601: Method not found`.

[Sanitized discovery and resource-read capture](claude-native-discovery-before.json). This is a projection of the remote MCP replies through Codex's authenticated MCP client (`mcpServerStatus/list` full inventory and `mcpServer/resource/read`), not a packet capture. No credential was exported, logged, or added to the repository. This proves the deployed discovery/resource path differs from the earlier local prototype-registration test; it does not identify which bundling/SDK step lost registration.

A real Claude read-only request reproduced the reported failure: six saved lookahead items, correct current window, and open-item counts 17 / 3 overdue / 5 due within seven days, displayed as plain tables/lists. There was no native card. A separate fresh authenticated open-items read confirmed 17 returned rows, with exactly five flagged rows (three overdue and two delay-notice tasks).

Claude baseline conversation: https://claude.ai/chat/9e61813a-685a-4dce-978b-2225a3c88288

## Change

- The view accepts a successful parent-window initialization reply with id `1` and an object result, including a different or omitted `protocolVersion`. It still rejects errors, other ids and messages from other windows; subsequent messages must match the initialized parent's origin. It then sends `ui/notifications/initialized` and its size.
- A new presentation middleware runs only for selected POST requests to `/mcp`, after the existing SDK handler and gates. No request handler or server prototype is overridden by this change, and no generated transport route is edited.
- Successful initialize responses advertise the MCP Apps extension and static resource support. The toolkit's definition type has no capabilities option, so `index.ts` exports the declaration and this scoped wire pass supplies it on the actual response.
- Missing `_meta.ui.resourceUri` is restored only for the three affected tools. Other metadata, including any `openai/outputTemplate`, stays unchanged. Already-correct native metadata passes through.
- If the authorized SDK response says the native resource handler is absent, the middleware serves that one static shell. Other resource URIs and permission errors are untouched. HTTP 401, 403, 429 and 5xx responses pass through unchanged. Resource discovery includes the shell without removing existing resources.
- Explicit MCP Apps hosts receive a short title/job/KPI text summary; their complete card HTML, rows, images and result metadata stay in the reply. ChatGPT/OpenAI clients and unidentified or text-only clients keep the original full styled fallback.
- Legacy stateless clients' successful initialize hints are remembered for at most 15 minutes in a bounded 128-entry worker-local map, keyed by a SHA-256 bearer fingerprint plus user agent. No raw token or project data are stored. A cold worker, unknown client, expired hint or token refresh keeps the full fallback rather than assuming UI support. This is presentation state, never an access decision.
- The native shell retains navy/blue/gray and adds a blue card accent. Red-row classification remains the existing backend rule; it was not recomputed or loosened.

`widget-bridge.ts` and `cards/widget.ts` are byte-for-byte unchanged from #202. Sign-in, Hub, Site URL, email codes, connector address, existing authorization logic, database schema and migrations are unchanged.

## Local verification

- Full Vitest: **171 files / 1,768 tests PASS**.
- Production build: **PASS**.
- Semantic ESLint: **PASS** (repository formatting rule disabled on existing files); new transport/helper tests are formatted with Prettier.
- Typecheck: base and branch retain the same **34 diagnostic signatures**. It remains baseline-failing; this is not a typecheck pass.
- Actual SDK tests cover both normal resource registration and the missing-resource-handler wire error seen live; JSON and SSE, discovery metadata repair, capability declaration, non-200 passthrough, other-resource errors, short native replies, identical ChatGPT fallback/metadata, legacy-client isolation/expiry, and unchanged Gantt/other routes are covered.
- Chrome local iframe checks used the fresh saved backend HTML. A successful initialization reply with no version produced all six lookahead rows and an open-items card with 17 rows / 3 overdue / five red rows, navy headers and blue accents. These are **local candidate checks, not live Claude acceptance passes**.

## Live acceptance status and handoff

Marshall chose: **the team publishes the reviewed PR, then Codex retests**. Nothing in this PR was merged or deployed by Codex.

The pre-change Claude visual test is **FAIL**, as reproduced above. The corrected Claude MCP path is **UNTESTED live** until the team publishes this candidate.

A fresh ChatGPT browser baseline request for the lookahead, then the saved CPM/delay view, displayed `This response couldn’t load`, including after one reload. This was before deployment of any candidate change. It is a browser-session observation, not proof of a new Athena regression and not a passing do-not-break run.

ChatGPT baseline conversation: https://chatgpt.com/c/6adac38a-682c-83e9-a4f1-6388ea6a0191

After team publication:

1. Capture fresh authenticated initialization, tool metadata and native resource read again. Require native UI metadata on all three tools, Apps/resource capabilities, and a successful native resource read with the updated view code.
2. In real Claude, request the job 2701 lookahead and open items. Require a visible styled card, six lookahead items, and current saved counts (baseline 17 open / 3 overdue / 5 due within seven days / five red rows). Reconcile to fresh data if the fixture has changed. Plain Markdown remains **FAIL**.
3. Run the full supplied ChatGPT do-not-break list and the relevant Claude checks: no Hidden line, correct lookahead data, panning CPM Gantt, full repeated brief with inbox/calendar, red saved-delay banner and intact #190 stored drawing-page retrieval. Do not manufacture a delay or duplicate a saved event solely to test this presentation change.
4. Verify ChatGPT's existing widget/output-template behavior, full fallback, and that authentication/connector configuration is unchanged. No real email, checkout, real contact or original drawing modification is part of these tests.

Release remains contingent on these live checks and Marshall's approval. A local fixture or unit-test pass cannot close the live styling gate.
