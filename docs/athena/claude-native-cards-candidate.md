# Claude native cards: contract terms, SOV, morning brief

Base: `codex/athena-passwordless-login-only` at `078c856` (0.8.20). Branch `claude/native-cards-contract-sov-brief`. Not merged, not deployed.

## Change

- `contract_terms`, `report` and `morning_brief` join `NATIVE_CARD_TOOLS`, so tools/list gives them `_meta.ui.resourceUri = ui://athena/native-card.html` and Claude's card view draws their `structuredContent.html`. ChatGPT's skybridge resource and `openai/outputTemplate` handling are unchanged.
- Claude's tool text on native card tools is facts only (`cards/claude-reply.ts`, applied in `native-card-transport.ts`):
  - kept: every markdown row, workflow guidance (next question, SOV delivery options, the inbox line);
  - removed: the dumped HTML document, `REQUIRED VIEW:` lines, `Card shown. Do not add text`, the `Display:` style line, and the house-style block (`HOST_DISPLAY_BLOCK`) from `structuredContent.assistant_guidance`;
  - added: one plain line, "The member sees this result as an Athena card."
  Claude treats orders inside a tool result as untrusted text, so they never made it render; the card view does.
- Claude is detected from clientInfo (per call or remembered from initialize) by name `claude`/`anthropic`. Errors are untouched. ChatGPT replies stay byte-for-byte (tested).

## Reverses an earlier decision

#206 kept Claude's full reply, HTML included, after the #203 "counts-only" regression. This branch keeps every row in Claude's text but drops the HTML and the orders. Tests that pinned "Claude byte-for-byte" now pin the new contract; ChatGPT's tests are unchanged.

## Known gaps (not fixed here)

- The contract card is inferred from text lines (`cards/infer.ts`): raw `**` markdown, header lines counted as clauses (16 for 13 clauses), no per-clause card. ChatGPT gets the same HTML.
- The SOV card shows the first 8 text lines only (4 of 10 SOV lines).
- On a stateful session where initialize landed in another isolate and the call carries no clientInfo, Claude is not recognized and gets the old reply.
- Two baseline tests fail on the base too (version pins `0.8.18` / `0.8.1x` after the 0.8.20 bump).

## Screenshots

`scripts/card-screenshots/run.sh [out-dir]` renders the three cards from job 2701 fixture data (fictional; no backend) through the real `native-card.html` view and a minimal MCP Apps host, at 1280 and 390 wide, plus `<card>.claude.md` showing what Claude reads. Uses local Chrome; Playwright installs to `~/.cache/athena-card-screenshots`, not the app's dependencies. Default output `artifacts/` is git-ignored.

## Verified locally

- Vitest: 1,896 pass, 2 fail (the baseline version pins above).
- Production build: pass.
- ESLint with the formatting rule off: pass on changed files.
- Screenshot run: all three cards completed the Apps handshake and rendered.

**Not a live Claude, ChatGPT or Grok pass.** Before release: in a normal Claude chat (not the Code tab), ask for contract terms, the SOV and the morning brief on job 2701 and confirm the card appears; then run the full do-not-break list on ChatGPT.
