# PM meeting readiness

## Corrected behavior

A dated lookahead is evidence of a saved date window, not PM approval. An issue
log without crew or delay rows is not a crew confirmation or a schedule check.
The meeting loader now leaves those unverified answers as `Needed`, including
when an issue read fails. Existing open crew issues remain unconfirmed and open
delay issues keep their red delay flag.

Crew notes that explicitly say not confirmed, ask for confirmation or describe a
conditional confirmation keep the existing meeting item open. An affirmative
“All subs, suppliers and crews confirmed” still closes it. So does a confirmation
that uses an affirmative phrase containing a negating word: “no issues”,
“no problems”, “nothing open”, “no concerns”, “all good”, “none outstanding”,
and “nothing outstanding”. Those phrases match regardless of case or punctuation.
A real negative still leaves the item open: “no”, “not confirmed”, “not yet”,
“no, still waiting”, “subs not confirmed”, and “issues with crews”. The meeting
dedupe key is unchanged. The loader still reads current CPM
progress, forecast figures and the saved IOR comparison without writing them.

The affirmative phrases apply to the crew confirmation, not unrelated notes.
“Confirm subs and crews for Monday; no issues elsewhere” remains a request and
keeps the crew item open. “Subs and crews are not confirmed; no issues with
deliveries” also stays open. The full affirmative answers using “no issues”,
“no problems” or “nothing open” are tested through the guarded save and pass
`_close: true`; unrelated notes cannot close the crew meeting item.

There is currently no authoritative lock/confirmation record consumed by this
loader. This change does not invent one or infer confirmation from a resolved
issue's text. A later workflow needs an explicit confirmation tied to the current
lookahead revision before the loader can report a positive confirmation.

## Local verification

- Default Vitest: 172 files, 1,833 tests passed. This includes the team's 27
  affirmative/negative phrase cases and 10 additional guarded-save, request and
  unrelated-note cases. Focused readiness run: 51 passed. Before the request
  guard, the three new request cases failed; all now pass.
- Production build passed.
- Typecheck: 34 existing errors, same file/code pairs as base; no new errors in
  the changed loader or test.
- Targeted semantic ESLint and `git diff --check` passed. Prettier checking was
  disabled for this targeted lint run, consistent with the existing source style.
- The separate role suite is not included in the default Vitest command. It
  remains 114 passed / 56 failed, identical failing test names to clean base
  e8f66d3c. This is an existing release concern, not a passing permissions suite.

No schema, auth, generated route, connector, ChatGPT template, widget or native
transport changes. This branch remains independent of the drawing PR. It is now updated onto
`e8f66d3c` (#207), retaining the team's Grokbot fallback. The full default suite,
build and type baseline were rerun after the update.

## Live acceptance still required

On a test job with no recorded confirmations, open the PM schedule and morning
schedule stages in ChatGPT, Claude and Grokbot. They must ask for confirmation;
they must not invent `Locked`, `Confirmed` or `Yes`. With an open crew issue and
an actual delay, the issue and red delay flag must remain visible. Saving a note
must not silently approve or modify the CPM.

Rerun Marshall's do-not-break checklist: hidden lookahead row, correct job data,
Gantt pan, repeated full brief with inbox/calendar, red delay Gantt, stored drawing
pages, pay-app card, palette and board links. Local tests do not prove those
host-level checks. Team review and live testing precede Marshall's release yes.
