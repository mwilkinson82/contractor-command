# Claude native cards: contract terms, SOV, morning brief

Original Claude base: `codex/athena-passwordless-login-only` at `078c856` (0.8.20), candidate `c5935754` on `claude/native-cards-contract-sov-brief`. The corrected `codex/athena-native-cards-review` branch includes the current Athena base `4406c5ad` (#217 and #218). No live merge or deployment.

## Change

- `contract_terms`, `report` and `morning_brief` join `NATIVE_CARD_TOOLS`, so tools/list gives them `_meta.ui.resourceUri = ui://athena/native-card.html` and Claude's card view draws their `structuredContent.html`. ChatGPT's skybridge resource and `openai/outputTemplate` handling are unchanged.
- Claude's tool text on native card tools is facts only (`cards/claude-reply.ts`, applied in `native-card-transport.ts`):
  - kept: every markdown row, workflow guidance (next question, SOV delivery options, the inbox line);
  - removed: the dumped HTML document, `REQUIRED VIEW:` lines, `Card shown. Do not add text`, the `Display:` style line, and the house-style block (`HOST_DISPLAY_BLOCK`) from `structuredContent.assistant_guidance`;
  - no line claims the card is on screen (an earlier candidate added one; the host draws the card only after the resource loads, so the claim was wrong whenever that load failed).
  Claude treats orders inside a tool result as untrusted text, so they never made it render; the card view does.
- Claude is detected from clientInfo (per call or remembered from initialize) by name `claude`/`anthropic`. Errors are untouched. ChatGPT replies stay byte-for-byte (tested).

## Contract and SOV cards built from structured rows

`cards/structured.ts` replaces the text-inferred cards for these two results. The handler sets `structuredContent.card`, so ChatGPT's widget, the HTML card and the markdown all draw the same model.

- `contract_terms` (when clauses are on file): one framed card per clause. Header is the section and heading; next line is the day count and trigger; the exact wording sits in a ruled quote panel with extraction `**` removed and nothing else changed. Delay, liquidated damages and claim clauses (`lineAlert`) get a red border and header. KPIs: contract value, substantial completion, clauses, risk clauses. The summary offer stays the card question. No clauses on file: the old inferred card.
- `report` SOV: every line in one table (line, cost code, division, description, scheduled value, % of total), the fee row when there is one, and the total that ties to the contract sum. The divisions view shows the division roll-up.
- Renderers (`html.ts`, `widget.ts`, `markdown.ts`): new `framed`/`flag` section fields and a `quote` row tone; blank table cells stay blank (they printed "Item"); money and percent cells never wrap; under 520px every table row stacks into label/value pairs instead of scrolling off screen. Palette unchanged: no new colors.
- Claude also drops the SOV table/chart styling guidance (`SOV_PRESENTATION_LEAD`, `SOV_CHART_RULE`). The card replaces both, so Claude no longer builds its own SOV artifact or chart. The delivery question is now its own guidance line and stays.

**ChatGPT changes too:** its contract and SOV cards now render these models. Run the do-not-break list there.

## Reverses an earlier decision

#206 kept Claude's full reply, HTML included, after the #203 "counts-only" regression. This branch keeps every row in Claude's text but drops the HTML and the orders. Tests that pinned "Claude byte-for-byte" now pin the new contract; ChatGPT's tests are unchanged.

## Known gaps (not fixed here)

- Clause recipients are not stored as a field, so the clock line shows days and trigger; the recipient is in the quoted wording.
- On a stateful session where initialize landed in another isolate and the call carries no clientInfo, Claude is not recognized and gets the old reply.
- The inherited version assertions pinned `0.8.18` / `0.8.1x` after the 0.8.20 bump; the corrected branch checks the advertised current version and the minimum numeric version instead.

## Screenshots

`scripts/card-screenshots/run.sh [out-dir]` renders the three cards from job 2701 fixture data (fictional; no backend) through the real `native-card.html` view and a minimal MCP Apps host, at 1280 and 390 wide, plus `<card>.claude.md` showing what Claude reads. Uses local Chrome; Playwright installs to `~/.cache/athena-card-screenshots`, not the app's dependencies. Default output `artifacts/` is git-ignored.

## Corrections from Codex review

- Preserve underscore blanks, literal/unpaired markers, identifiers, whitespace and the stored source. Only paired `**` extraction emphasis is removed from displayed quotes.
- Include a nonzero contractor fee before the contract total in the division view as well as the line view. Values and percentages still come from the existing cents-based SOV builder; no financial calculation changed.
- `include_summary:true` adds the saved notice explanations and contract-term summaries to a separate card section headed `Summary — the clause text above governs`. The summary offer remains when no summary was requested; verbatim clauses remain distinct.
- Fix the new test's TypeScript cast. Correct the two inherited version-test assertions rather than accepting permanent default-suite failures.
- Add a PR-only GitHub Actions test/build workflow. It pins the existing verified MCP SDK/Zod runtime because the inherited lock omits the SDK; it has read-only repository permissions and performs no deployment or email send.

## Verified locally (original Claude candidate)

- Vitest: 1,902 pass, 2 fail (the baseline version pins above).
- Production build: pass.
- ESLint with the formatting rule off: changed files pass; `workflow-tools.ts` keeps its existing `no-unused-expressions` error (now line 746).
- Screenshot run: all three cards completed the Apps handshake and rendered.

**Not a live Claude, ChatGPT or Grok pass.** Before release: in a normal Claude chat (not the Code tab), ask for contract terms, the SOV and the morning brief on job 2701 and confirm the card appears; then run the full do-not-break list on ChatGPT.

## Corrected candidate verification

The current base was independently tested: 1,904 passed, with the two inherited version-test failures. The corrected candidate has 1,928 default tests passing, including the three reproduced regressions and extra checks across HTML, markdown and ChatGPT's widget. Production build and focused lint pass. Type checking reports the same 34 existing diagnostics as the current base, with no new file/error-code diagnostics. The separate role suite is 114 passed / 56 failed on both current base and candidate; the exact failed test names match.

The source branch on GitHub was not rewritten. The corrected review branch contains Claude's commits, the latest Athena changes and the focused fixes. No migration is required. Auth, Hub, Site URL, email code, connector address and `openai/outputTemplate` are unchanged. Runtime renderer behavior changes are limited to Claude's original layout changes and these data-preservation corrections. No new global SDK override is added.

The combined change with PR #219 needs the union of both `NATIVE_CARD_TOOLS` sets and #219's `TEXT_CARD_TOOLS`; do not resolve the shared line by dropping either set of tools. Compatibility is tested in a temporary local integration checkout; it is not a feature merge or deployment authorization.

Combined local verification with PR #219: **1,956 tests pass**, production build passes, and type checking retains the same 34 baseline diagnostics. Resolve `cards/native.ts` with the union of both native tool lists and #219's text-card list. Resolve the inherited `v0810.test.ts` overlap by keeping the numeric minimum-version assertion. The shared current-version import is aligned so it merges once. This trial integration is not part of the published card branch.

GitHub CI runs the full default suite and build on the review PR. The earlier fixture screenshots were produced by Claude; Codex verified the corrected data with the real renderers and did not claim a new live-host or screenshot pass. All normal-Claude and ChatGPT do-not-break acceptance gates above remain pending the team's approved candidate deployment.

## Exact-draft cleanup follow-up

Claude's review cleared the three contract/SOV corrections and identified a pre-existing #219 draft-rendering issue. #219 now displays exact reviewed draft fields in a literal panel. This branch's companion cleanup recognizes fenced member data and leaves it untouched, including line breaks, pipes, spacing, quoted HTML and sentences that resemble display instructions. Real card HTML and display notes outside the draft still disappear from Claude's model-facing text. Ordinary ChatGPT responses retain the unchanged transport path. Tests cover LF and CRLF, embedded backticks, nested code fences in card HTML, and display-like email content.

Updated standalone default suite: **1,928 passed**. No production email was sent and no live-host acceptance is claimed. This follow-up changes no database schema; #219 retains its existing Lovable Cloud migration handoff.

## Card load timing (diagnostics)

Claude reported a live claude.ai reproduction on 2026-10-23: the contract terms and SOV cards rendered on the first try in two fresh chats, and the card that had failed earlier rendered from Claude's cache (`assets.claude.ai`) on reopening, with no new `resources/read`. The reported wire sequence was `server/discover` → `tools/list` (`_meta.ui.resourceUri`) → `resources/read` (`text/html;profile=mcp-app`, served) → card. No CSP or app errors were reported in the console. Those successful reads do not locate the intermittent failure or establish its cause.

To place it, every native card request now logs milliseconds, never content:

- `[athena] card.resource` (existing) gains `sdkMs`, `totalMs`, `requestNo`, `isolateAgeMs`, `cold`.
- `[athena] card.call` for a native card tool call: `tool`, `protocol`, `host` (`claude` / `card-host` / `text-host`), `status`, plus the timing fields.
- `[athena] mcp.entitlement` on tools/call: `ms` and `outcome` (`allowed` / `denied` / `check-failed`).
- `[athena] card.presentation` only when the presentation pass itself throws.

`totalMs` begins at the MCP timing middleware, before membership checks and request-body inspection. `sdkMs` measures the downstream SDK-handler phase separately. Every request under `/mcp` is counted, including pings, notifications, non-card tools, and requests rejected by the membership gate. The timings are held per request and discarded when its middleware pipeline completes.

`cold` means the first MCP request observed since this module loaded, not a measured platform cold start. `isolateAgeMs` measures elapsed time since that first observed MCP request. Its clock starts inside the request because Workers can report zero for module-scope `Date.now()`. Neither field includes network latency or platform startup before the middleware runs. `served` means Athena constructed a static resource response, not that the host received or rendered it. Correlate the server logs with browser network timing and errors before concluding a host deadline was exceeded; a large `totalMs` or `cold: true` alone does not prove that diagnosis.

Entitlement outcomes distinguish `allowed`, `denied`, and `check-failed`, including when the membership source returns `unavailable` without throwing. Authentication, the entitlement gate's decision, the SDK path and ChatGPT's `openai/outputTemplate` templates are unchanged.

Corrected diagnostics verification: **1,995 tests passed across 187 files**, production build passed, and ESLint passed on the changed TypeScript files. The 12 new middleware regressions include the three review reproductions, allowed/denied responses, unchanged SDK authentication challenges, resource auth failures, non-card requests, and overlapping requests. No live-host acceptance or deployment is claimed for this instrumentation change.

`cold` is true on the first MCP request an isolate serves; `isolateAgeMs` is how long the isolate had been up. A failed card whose `card.resource` line shows `served` with a large `totalMs` or `cold: true` is a deadline race on the host side, not a protocol fault. Authentication, the entitlement gate, the SDK path and ChatGPT's `openai/outputTemplate` templates are unchanged.

## Editable email card (prototype)

`ui://athena/email-card.html` (`cards/email-card.ts`) is a second MCP Apps view for `email_draft` and `submittal_delivery`: editable To, Cc, Subject and Body, the link or attachment line, and one **Approve and send** button. Pressing it records the exact text with Athena through the host's `tools/call` bridge (`email_draft` → `email_confirm_send` when edited, or `submittal_delivery draft` → `approve`), then posts the approved text to the chat with `ui/message` so the member's connected email account sends it. Athena still sends no mail. The button is disabled when the host does not advertise `serverTools`, or when sending is off; Athena's refusals ("This draft changed after it was reviewed…") show on the card verbatim. Result data is written with `textContent`/`value` only; the CSP allows no network.

`email_draft` now echoes `job_number`/`company_id` and `submittal_delivery` echoes `kind`, `submittal_id`, `package_item_id`, `job_number`, `company_id` in `structuredContent` so the card can re-draft and approve. Claude's text for these tools drops the email artifact spec lines. ChatGPT's `openai/outputTemplate` on `submittal_delivery` is kept next to the email card reference. The chase (`submittal_chase`) stays on the native card because it lists several submittals.

Fixture: `scripts/card-screenshots/run.sh` renders `email-draft` (desktop, phone) and, after editing the body and pressing the button against a mock host, `email-draft-approved`, printing the view→host sequence. Verified locally in Chrome: `tools/call email_draft` → `tools/call email_confirm_send` → `ui/message`. **Not a live Claude pass**: whether claude.ai grants `serverTools` and `message` to the view is read from its `ui/initialize` reply on the first live run.
