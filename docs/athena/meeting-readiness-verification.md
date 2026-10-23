# PM meeting readiness

## Corrected behavior

A dated lookahead is evidence of a saved date window, not PM approval. An issue
log without crew or delay rows is not a crew confirmation or a schedule check.
The meeting loader now leaves those unverified answers as `Needed`, including
when an issue read fails. Existing open crew issues remain unconfirmed and open
delay issues keep their red delay flag.

Crew notes that explicitly say not confirmed, ask for confirmation or describe a
conditional confirmation keep the existing meeting item open. An affirmative
“All subs, suppliers and crews confirmed” still closes it. The meeting dedupe key
is unchanged. The loader still reads current CPM
progress, forecast figures and the saved IOR comparison without writing them.

There is currently no authoritative lock/confirmation record consumed by this
loader. This change does not invent one or infer confirmation from a resolved
issue's text. A later workflow needs an explicit confirmation tied to the current
lookahead revision before the loader can report a positive confirmation.

## Local verification

- Default Vitest: 172 files, 1,796 tests passed (1,782 on base plus 14 regression
  cases). Focused meeting, readiness, open-feed and brief run: 65 passed.
- Production build passed.
- Typecheck: 34 existing errors, same file/code pairs as base; no new errors in
  the changed loader or test.
- Targeted semantic ESLint and `git diff --check` passed. Prettier checking was
  disabled for this targeted lint run, consistent with the existing source style.
- The separate role suite is not included in the default Vitest command. It
  remains a release concern; see the role-suite comparison in the PR.

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
