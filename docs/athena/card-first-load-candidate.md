# Native card first-load delivery candidate

Base: `codex/athena-passwordless-login-only` at `43661b42` (the published #219/#221 integration, including #217). This branch contains no migration and must not be merged or published without Marshall's approval. #216 and #220 remain held.

## Observed failure and limits of the diagnosis

Normal Claude and ChatGPT chats received the correct saved records but failed to open the initial card. Earlier cards rendered after Retry/reload. A further Claude `submittals_list` test reproduced the first-load failure, and browser request inspection confirmed a `resources/read` for `ui://athena/native-card.html`. This is beyond tools/list discovery.

The SDK builds a fresh server per request. A resource-only request does not register Athena's tool-attached resource handlers, so the SDK returns method-not-found. Athena's scoped presentation layer already repairs that exact error after SDK authorization. On the legacy protocol the repaired resource was returned inside the SDK's SSE/keep-alive response; the modern protocol used JSON.

That delivery difference is verified locally through the actual installed SDK. It is a candidate explanation, not proof of the live failure's cause. Claude's own visualize display also failed during the CPM test. Browser console warnings have not established an Athena auth or CSP fault. No security setting is relaxed by this candidate.

## Change

- A single successful native-shell read returns a finite JSON-RPC JSON response if the client's Accept header permits JSON. Stream-only clients retain SSE framing; extra messages in an SDK stream are not discarded.
- The shell response is `no-store`. Discovery points to `ui://athena/native-card-v2.html` so hosts fetch this resource revision. The old URI remains readable for existing conversations and cached tool lists.
- `[athena] card.resource` records only protocol family, SDK HTTP status, final HTTP status, outcome and response format. No bearer, user/session/RPC identifiers, request headers, HTML, email or job content is logged.
- SDK authorization failures and other resource errors pass through. Only the two static native-shell URIs are eligible. No new SDK prototype handler override is introduced.

ChatGPT's `ui://athena/card.html`, `openai/outputTemplate`, widget script, card renderers, tool reply text and structured data are unchanged. The standard MCP Apps resource metadata points to the versioned URI on existing native tools, including hosts that support both interfaces.

JSON is an allowed response for a Streamable HTTP request when negotiated: [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Verification

- The new tests exercise the first resource read through the actual SDK on legacy and modern protocols and through a real MCP HTTP client, without a prior tool call. They cover the old URI, stream-only negotiation, multi-message streams, rejection pass-through, diagnostic privacy and exclusion of the ChatGPT resource.
- **1,978 tests pass in 185 files**, including 16 new delivery/client tests, the existing six-item/three-overdue lookahead checks and #217's do-not-break 26 split/deduplication checks. The production build passes. The separate role suite was not rerun for this static-resource change; its previously recorded failures are not represented as passing here.
- Type checking retains the 34 baseline diagnostics; there are none in this change's files. Existing repository formatting errors are not reformatted wholesale. Focused ESLint passes with the inherited formatting rule disabled; the new test and modified transport also pass that rule.
- A local Chrome fixture fetched the shell through the actual SDK/presentation layer, then initialized and rendered the contract, ten-line SOV and morning brief on the first mount. Each read returned `application/json`; the brief retained its inbox/calendar section. These were fictional fixtures, not live host acceptance.

## Required live acceptance after an approved candidate publication

1. Refresh Athena's tool catalog in normal Claude and ChatGPT; confirm the new native resource reference. Do not disconnect or alter permissions/sign-in.
2. In new chats, open contract terms, SOV, brief, lookahead and open items for fictional job 2701. Repeat fresh openings. An error, blank card or required Retry/reload is a FAIL.
3. Verify every saved lookahead row and the job's current overdue count; do not confuse open saved lookahead items with project-wide overdue obligations. Retain the complete text fallback.
4. If a first opening fails, correlate its time with `card.resource`: distinguish SDK rejection, missing static card, and successful JSON/SSE delivery before another code change. A `served` log alone is not a UI pass.
5. Rerun the full do-not-break list, including Gantt rendering/panning, repeated brief availability, stored drawing retrieval and meeting-notes check #26. For #26 the five specified lines must create three separate risks and two meeting notes, and repetition must add nothing. Use fictional data and send no email.
6. Confirm Grok's complete styled text fallback. This candidate does not add a native-card capability to Grok Bot.

The new resource has not been tested inside the live Claude or ChatGPT connector before publication. Initial-load reliability, live Gantt panning, live #26 and the full three-host checklist remain acceptance gates. Do not describe the candidate as a completed live fix based on local tests.
