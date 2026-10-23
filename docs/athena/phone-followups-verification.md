# Phone reply follow-ups after #207

The generic-host lookahead and open-items replies now always end with Athena's
next move. An explicit saved next action takes precedence; otherwise the footer
asks for a review of the first overdue item, then a delay/risk, then an upcoming
item. It uses the supplied owner and date and never marks work complete.

Known meeting-checklist headings use plain topic titles (Turnaround times,
Superintendent kickoff, Project supervision exposure). Their full source notes,
qualifications, money and clauses remain beneath those titles. Only the matching
job prefix and a leading Resolve/checklist wrapper are removed. Other activity
codes and other job numbers remain visible.

Resolved lookahead items now have separate complete bullets. A note such as
"Submittals: None block work in this window" retains the following preparation
status and due date instead of becoming a garbled one-line summary. Section
order, counts and existing red overdue/delay indicators remain unchanged.

An undated row says **Due date needed** once. A missing owner or the card's
literal `Needed` owner placeholder is omitted rather than producing
"Needed, due date needed"; known owners and dates remain visible. Missing dates
alone do not imply a waiting state. Unresolved checklist confirmations ask
"Can you confirm…?"; explicitly pending/awaiting/unconfirmed items retain their
source notes and ask for current status. Existing questions are not duplicated,
and resolved confirmations do not become questions. No record is resolved or
assigned a date by this presentation change.

## Local verification

- Default Vitest: **173 files / 1,850 tests passed**, including 17 phone
  regressions. Focused phone/lookahead/transport run: **55 passed**.
- Production build passed; targeted semantic ESLint and diff whitespace checks
  passed. Typecheck retains the base's 34 errors with identical file/code pairs.
- Separate role suite: **114 passed / 56 failed**, identical failing test names
  to base d5472066 (#208; same tested tree as 341443ea). This is an existing
  release finding, not a passing suite.
- Transport tests cover actual card-builder replies with no injected next_move,
  all six saved lookahead items and three overdue obligations, all 17 open rows,
  and unchanged ChatGPT/Claude content, HTML, card metadata and response identity.
  The 17/3/5 open-item fixture is pinned to October 22; live due-within-seven
  counts may change with the current date.

Only the generic-host phone renderer changes at runtime. No tool data, shared
card model, ChatGPT template/widget, Claude resource, transport, auth, storage,
schema or generated route changes. No merge or deployment was performed.
The branch is updated onto the team's merged #208, preserving its affirmative
crew answers and request/negative guards. This does not establish a live deploy.

## Team live acceptance

Gage reviews; Tess retests after the team's approved release. On job 2701 in
Grokbot, check the next-action footer without supplying one manually; plain
overdue titles with complete underlying notes; separate complete resolved rows;
all saved rows and correct current counts; owners/dates; existing section order;
red limited to overdue, delay and risk indicators; one **Due date needed** prompt
per undated row; and questions for pending confirmations. Markdown lists remain the
fallback for a host without an interactive card surface.

Rerun Marshall's do-not-break checklist in ChatGPT and Claude: hidden lookahead
line, correct job data, panning Gantt, repeat full brief with inbox/calendar,
delay Gantt, stored drawing pages, pay-app card, palette and board links. Local
tests do not prove the hosted acceptance tests. Marshall approves any release.
