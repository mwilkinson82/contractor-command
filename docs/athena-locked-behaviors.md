# Athena locked behaviors

These behaviors are already working. A change that breaks one of them fails `src/lib/mcp/athena-locked-behaviors.test.ts`. Tool results may drop render-command lines (`REQUIRED VIEW`, `REQUIRED:`, `Do not add text`). The member-facing content below stays.

## Icon and sign-in

- No `openai/outputTemplate` key in Athena source. That key hid the Athena A icon.
- The MCP server icon is the mono-blue PNG set on `https://app.meetathena.io`. The Athena favicon is served on that host.
- Athena sign-in emails an 8-digit code. The Athena and consent login pages ask for that code. The Hub sign-in is unchanged.
- On a `*.lovable.app` host, `/oauth/...` redirects to `https://app.meetathena.io` and keeps the query. `/login` redirects only when it is returning to OAuth consent. A Hub `/login` with no consent return stays put.

## Cards

- Tool results do not carry imperative render text. Rendering rules stay in the server instructions and the one-sentence tool descriptions.
- Red (`#DC2626`) is only for a risk, a delay, or an overdue item. The brand mark is `#1E5FED`.
- The pay app G703 lists every schedule-of-values line and prints that line's scheduled value, including a line with no progress.
- The report card table lists every schedule-of-values line from `structuredContent.sov.line_items`.
- When Athena cannot tell the job, the reply is the Which job? card.
- Asking for the morning brief returns the full brief every time, including From your inbox and calendar. The once-a-day limit applies only to the proactive morning card.
- Conversational openers such as Hey Athena route to `athena_hello` or `morning_brief`.
- Platform lists name Grok Bot next to ChatGPT and Claude.

## Confirmed by QA

- ChatGPT output has no line that says Hidden. Setup and merged lookaheads are left out of the count without that word.
- The Claude CPM Gantt still pans: the schedule page wraps the chart in `overflow-x:auto`.
- S-100 drawing markup findings stay as they are. An undefined dowel count on S-100 note 10 stays an open question. A line whose note already shows the math is not called a gap.
- Lookahead data stays: window, data date, ref, and activity names.
- The brief keeps the From your inbox and calendar section, the email placeholder, and the Connect Google Calendar line when the server cannot see the host calendar.
- A fragnet delay Gantt keeps its red delay banner (`Delay: +X WD (Y CD)`). A normal activity bar is not that banner.
- The email draft card keeps its `To:` line as the first line of the draft.
- Drawing markup callouts default to navy `#1E5FED`. Red `#DC2626` is only for a callout flagged risk, delay, or overdue. The markup is a styled card with the drawing embedded, not a bare image.
