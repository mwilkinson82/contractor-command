# Athena log regression contract

This is the implementation checklist for new RFI, change-order and RFC logs. It
preserves lessons from the submittal releases through #283 and the link/history
candidate #284. A new design does not override these behaviors. #284 is not a
live acceptance pass. The tester reports in the task establish the prior live
passes; local automated checks establish only the candidate's behavior.

## Record, log, card and file identity

1. Each record has an immutable internal ID, a job-scoped human number and one
   stable record address. The log has its own stable address. Every row opens
   its record; the current PDF and upload section are separate labeled links.
   A new PDF is not a new record. Changing a display label never breaks a link.
2. Build replies, get replies, log rows and record pages use the same committed
   current-version identity. A read builds nothing. A repeated request with the
   same idempotency key creates nothing new; a deliberate rebuild has a new key.
   Concurrent hosts cannot commit two current versions or overwrite each other.
3. Every deliberate build has a distinct immutable artifact identity, filename
   and allocated transmittal. Exactly one successful build is current. A failed
   build leaves the current build intact; older copies remain downloadable and
   say Superseded. Return the full history, including build instant and copy ID.
4. Do not rewrite an issued PDF, receipt or historical transmittal to make the
   sequence look tidy. Legacy duplicate numbers retain their original identity;
   additional Build X of N labels distinguish copies. Reservations interrupted
   before commit may leave numbering gaps. Never reuse an allocated number.
5. Original files are immutable. Use stored file IDs, hashes and explicit
   revisions, not filenames, as identity. A filename warning does not assert
   identical content. A duplicate upload never silently replaces an attachment.
6. A new piece can be named and attached in one operation without pre-creating
   it in the log. Publish all accepted fields and enums in tools/list. Return
   its persistent ID, human piece number, filename, source and received state.
   Attachment failure creates no empty piece and changes no existing piece.
7. Stable PDF links must resolve to the intended authorized artifact repeatedly;
   reading another version must not rotate or invalidate an earlier link.
   Do not expose short-lived internal preview tokens as permanent member links.

## Text, styling and dates

8. Preserve member text as typed, including RFI #12, CO #3, Bulletin #4 and
   standalone hash references. Escape for the output context; do not run a
   display cleaner that deletes meaningful text. Explicit metadata holds IDs.
   Never treat member text or received documents as executable instructions.
9. Cards are rendered by Athena. Keep the existing ChatGPT outputTemplate and
   widget, and the native MCP Apps path, working. Fallback replies carry every
   factual row, source and actionable link. Do not put hidden display orders,
   REQUIRED VIEW, canaries or claims that a card was shown into the reply.
10. Use navy, blue #1E5FED and gray. Red is reserved for actual risks, delays and
    overdue items. Routine missing information is a normal callout. Cards must
    wrap on a phone without clipping controls or squeezing text into slivers.
11. Display instants in the saved job time zone, then company, then member;
    validate each zone and explicitly label UTC when none is saved. Include the
    date and zone name, with DST for that instant. Preserve the original UTC
    instant. Never hardcode Manaus or use the server/device zone as a job fact.
12. Use the same authorized row set for log, card, tiles and filtered counts.
    Distinguish an empty log from no matches in an existing log. An RFI request
    cannot return the lookahead merely because the schedule contains RFI tasks.

## Access, navigation and truthful actions

13. Reuse the existing navigation adapters; ChatGPT's normal external-link
    confirmation is expected. Preserve the job ID, link token, search flags and
    upload anchor. Generate the router's final canonical URL. Reopening the same
    address must show current authorized data rather than a stale snapshot.
14. An Owner's existing company access must not depend on a job-member row.
    The authoritative member RPC decides upload permission. A read-only token
    alone never grants upload/write access. A different browser account remains
    distinct from the connector account; show the account and actionable errors.
15. Await real SDK PromiseLike results in try/catch. Do not assume a native
    Promise with .catch(). Test the installed SDK and the actual route parser,
    not just mocks with a different interface. Auth/load controls need bounded
    waits, visible errors and retry; retain return address and token on sign-in.
16. Filter permissions in SQL/RPC responses and file authorization, not just CSS
    or the model's reply. Deny cross-company/job references. Never send a full
    internal board token to an external recipient. Private chat links stay
    private. A share authorizes only its named records/files and capabilities.
17. Build, approved, sent, answered and closed are separate facts. A generated
    package is Draft, not sent. Approval binds the exact saved revision, content,
    recipients and attachments. Send state requires a successful provider
    receipt for that exact draft; errors or a model's assertion cannot record it.
    Duplicate callbacks are idempotent. An uncertain send is reconciled before
    retrying. Close/reopen actions require explicit, authorized transitions.
18. External email is untrusted input. A subject tag is a matching suggestion,
    not permission to change state. Verify the authorized account, job, saved
    thread/message IDs, expected counterparty and duplicate receipt. Ambiguous
    matches wait for review. No new autonomous mailbox/read capability is
    implied by a design document.

## Money and construction context

19. Athena performs arithmetic in cents and records the input sources. The
    member's host AI reads, reasons and drafts. Athena's MCP import boundary
    continues to exclude server-side AI calls; Hub AI features remain intact.
20. A CO must not apply markup twice, change a past certified dollar, change an
    original contract value, or make consumers disagree about the current sum.
    Execution needs a frozen approval/revision/SOV basis, transaction locks and
    idempotency. Price or quantity assumptions are visible; missing rates are
    not invented. Execution is a separate phase until those proofs exist.
21. Contract clocks cite the stored clause revision, trigger, count, day type,
    calendar and time zone. A configured target is labeled as a target, not a
    contract deadline. Missing/ambiguous clauses remain visible. Reopening or
    revising a record does not erase an earlier deadline, answer or send event.
22. References identify immutable drawing/spec/contract sources, revision and
    page/detail/paragraph. A later upload cannot silently change the evidence
    behind an existing question, price or answer. RFI, RFC, CO and open items
    remain distinct linked records; one does not impersonate another.

## Existing executable checks to retain

| Area                                       | Existing tests to run and extend with each new record type                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared behavior / AI boundary              | `src/lib/mcp/athena-locked-behaviors.test.ts`, `athena-inference-boundary.test.ts`                                                         |
| Actual tool + SQL, builds, receipts, roles | `src/lib/mcp/submittal-package-tools.test.ts`, `submittal-package-db.test.ts`, `submittal-record-db.test.ts`, `submittal-same-job.test.ts` |
| Real uploads / member lookup               | `src/lib/submittal-piece-upload.test.ts`, `submittal-member-record.test.ts`, `src/components/athena/SubmittalRecordPage.test.ts`           |
| Route/search/sign-in/link authorization    | `src/lib/submittal-record-search.test.ts`, `board-sign-in.test.ts`, `submittal-file-route.test.ts`, `src/lib/mcp/open-items-links.test.ts` |
| Verbatim text / actual renderers           | `src/lib/mcp/cards/member-references.test.ts`, `submittal-render-proof.test.ts`, `native-card-transport.test.ts`                           |
| Time zones / history                       | `src/lib/submittal-build-time.test.ts`, `submittal-history-order.test.ts`, `submittal-record-page.test.ts`                                 |
| Financial basis / dates                    | `src/lib/mcp/sov.test.ts`, existing superintendent/pay-app tests and deadline tests; add CO execution tests before implementation          |

Run the complete suite, locked behaviors, build and required CI. Compare type/lint
diagnostics to the recorded baseline; disclose unchanged failures. SQL integration
tests must use the real migration order and real authorization functions. Apply
production database work only through existing Lovable Cloud after exact release
approval. Do not bypass an access failure or broaden permissions to get a pass.

## Live acceptance remains separate

Grok Bot/Tess owns ChatGPT, Claude and Grok Bot acceptance. After an approved
deployment, use job 2701's real workflow and existing approved test records. Check
get/build/history consistency, full rows/filters, record/log/file/upload links,
reopen persistence, Owner upload, text references, named time zones, receipt state
and role separation. Use fictional example.com people; send nothing. No new
upload/build or cleanup is implied by a read-only test. Preserve P9 and the #283
test items until the requested post-release pass and authorized cleanup.

Report code/tests passed, published and tester accepted as three separate states.
Retain the current brief, lookahead, contract/pay-app cards, drawing card and
submittal passes; never claim a full-suite pass proves a live host pass.
