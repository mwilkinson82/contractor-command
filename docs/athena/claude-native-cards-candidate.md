# Claude native cards: contract terms, SOV, morning brief

Original Claude base: `codex/athena-passwordless-login-only` at `078c856` (0.8.20), candidate `c5935754` on `claude/native-cards-contract-sov-brief`. The corrected `codex/athena-native-cards-review` branch includes the current Athena base `4406c5ad` (#217 and #218). No live merge or deployment.

## Change

- `contract_terms`, `report` and `morning_brief` join `NATIVE_CARD_TOOLS`, so tools/list gives them `_meta.ui.resourceUri = ui://athena/native-card.html` and Claude's card view draws their `structuredContent.html`. ChatGPT's skybridge resource and `openai/outputTemplate` handling are unchanged.
- Claude's tool text on native card tools is facts only (`cards/claude-reply.ts`, applied in `native-card-transport.ts`):
  - kept: every markdown row, workflow guidance (next question, SOV delivery options, the inbox line);
  - removed: the dumped HTML document, `REQUIRED VIEW:` lines, `Card shown. Do not add text`, the `Display:` style line, and the house-style block (`HOST_DISPLAY_BLOCK`) from `structuredContent.assistant_guidance`;
  - added: one plain line, "The member sees this result as an Athena card."
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

The current base was independently tested: 1,904 passed, with the two inherited version-test failures. The corrected candidate has 1,923 default tests passing, including the three reproduced regressions and extra checks across HTML, markdown and ChatGPT's widget. Final build, type comparison, lint and #219 compatibility results are recorded below after completion.

The source branch on GitHub was not rewritten. The corrected review branch contains Claude's commits, the latest Athena changes and the focused fixes. No migration is required. Auth, Hub, Site URL, email code, connector address and `openai/outputTemplate` are unchanged. Runtime renderer behavior changes are limited to Claude's original layout changes and these data-preservation corrections. No new global SDK override is added.

The combined change with PR #219 needs the union of both `NATIVE_CARD_TOOLS` sets and #219's `TEXT_CARD_TOOLS`; do not resolve the shared line by dropping either set of tools. Compatibility is tested in a temporary local integration checkout; it is not a feature merge or deployment authorization.
