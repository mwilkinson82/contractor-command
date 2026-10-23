# Persisted PM schedule confirmations

## Failure and correction

The #208 parser could resolve `pm:crews` correctly, but the tool rendered the
data loaded before that write. Later reads did not consume any confirmation
record. A successful save could therefore still show crews as Not confirmed.
The note footer also described every note as filed on the risk log, including
meeting confirmations.

This change stores a versioned confirmation inside the existing guided meeting
snapshot, reads it back and then renders the updated card. Each check is read
independently, so later accounting notes or another answer cannot erase it.
Confirmation is scoped to the job, selected visible lookahead and its revision,
window, CPM version/data date and crew mode. Changed context requires a fresh
answer. Old free-text notes and resolved issues are not retroactively treated as
approvals. Named answers work even if a host has already advanced a stage.

Crew confirmation and lookahead lock are separate. "Subs and crews confirmed,
no issues" confirms crews; it does not approve the lookahead or claim the job is
on schedule. "The lookahead is locked in" supplies the separate lock answer.
Unanswered schedule checks keep the tool on the schedule stage instead of
directing the host to advance. Explicit negatives reopen the corresponding
confirmation. Missing/unreadable records remain unknown.

A guarded snapshot save is attempted before updating the meeting checklist.
Failed saves do not close the item. A success message requires a read-back in
the same context with matching answers. If verification fails, the card says
"Could not verify the meeting confirmation. Try again."

## Database and scope

No migration is needed. The existing `mcp_guided_sessions` table and
`mcp_guided_save` function are used. Read-only inspection of the Cloud database
verified the function's active-member/full-job-scope guard and the existing
full-scope SELECT RLS policy. No production data or schema was changed by Codex.
Any future required migration must go through Marshall's Lovable Cloud release
process, never direct Supabase execution.

The single-sentence PM tool description and extracted manifest are synchronized.
No sign-in, Site URL, Hub, connector address, widget/outputTemplate, native
resource, card renderer, drawing storage or phone fallback changes. This branch
starts at d5c15b04 (#199 + #208), independently of held #209.

## Local verification

- Default Vitest: **175 files / 1,886 tests passed**; 14 new handler regressions.
- The Claude and ChatGPT save-and-render cases both fail against unchanged base
  d5c15b04 with Not confirmed, and pass on this branch. This is an in-process
  handler/transport test, not a live Claude/ChatGPT test.
- Tests cover immediate and later reads, morning reuse, separate crew/lock
  answers, later accounting notes, host stage advancement, negatives/requests,
  revised lookahead/CPM context, failed saves/read-backs, another job's record,
  unversioned legacy notes, contract-only denial and the sample no-write path.
- Production build and targeted semantic ESLint passed; diff whitespace check
  passed. Typecheck retains 34 errors with identical file/code pairs to base.
- Separate role suite: **114 passed / 56 failed**, identical failing test names
  on candidate and clean base d5c15b04. Existing release finding, not a passing
  permissions suite.

## Team acceptance after approved publication

On job 2701, in Claude and ChatGPT:

1. Open the PM schedule and note the actual current crew/lock states.
2. Say "Subs and crews confirmed, no issues". The returned card must say crews
   Confirmed and show the verified confirmation message, not the risk-log claim.
3. Reopen the schedule in a new tool call. Crews must remain Confirmed. A
   crew-only answer must not newly lock the lookahead.
4. Explicitly confirm the lookahead lock, then reopen again. Both independent
   confirmations must be present. Ordinary later-stage notes must not erase them.
5. Repeat the negative/request checks. They must remain unconfirmed/open.
6. On fictional test fixtures, verify changed lookahead/CPM context needs new
   confirmation and failed saves never claim success. Do not revise live CPM
   solely for this test.
7. Rerun Marshall's do-not-break list: hidden lookahead line, current job data,
   panning Gantt, repeat brief with inbox/calendar, red delay Gantt, stored drawing
   pages, pay-app card, palette and board links.

Nothing was merged, deployed, emailed or uploaded by Codex. Gage reviews; Tess
tests the actual approved deployment. Marshall's release approval remains
required. Hosted acceptance is unverified for this candidate.
