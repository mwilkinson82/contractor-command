# Review: Claude's RFI / change-order design

Reviewed October 25, 2026 against [Athena RFIs and Change Orders](https://claude.ai/artifact/9fh6gPhrnuVSRzdRs9cApH#6749f067-dda2),
read through its visible artifact page. No artifact edit or sharing change was
made. Code inspected: live #283 at `386875b23f2d4f95ab20a1e9452698089b99b2ac`,
plus #284's separate links/history candidate. No production record was changed.

The record/log pattern is sound: immutable files, one persistent record, real
registered tools, host-owned drafting, server arithmetic and separate provider
receipts. The design is not ready to implement verbatim. In particular its CO
execution assumptions do not match the financial code. The companion
[regression contract](log-regression-contract.md) carries the passing behavior
and the earlier failures into every phase's acceptance criteria.

## Findings that block CO execution

### 1. A fully priced CO would be marked up again by the existing SOV builder

The proposal says to add a new SOV line equal to the executed CO total and use
the existing save/validation path. `src/lib/mcp/sov.ts:94-96` treats ordinary
line values as base work and divides their sum by `(1 - fee%)`.

Local reproduction using the real builder:

- $900 base work and 10% fee produce a $1,000 contract.
- Adding a $100 line at that same fee produces $1,111.11, an increase of
  $111.11 rather than the executed $100.

Correction: explicitly distinguish base work, contract fee and fully priced CO
adjustments. Prove the current contract increases by exactly the executed cents,
including rounding, multiple COs and credits. Do not simply append the total or
divide it heuristically to evade the mismatch. Keep the original contract basis.

### 2. Changing an existing SOV line can recalculate previous billing

`src/lib/mcp/superintendent.ts:477-483` derives prior dollars from the current
scheduled value times the previous percent. At 50% previously billed, raising a
$900 line to $1,000 changes its previous dollars from $450 to $500. The local
probe also shows previous certificates changing by $50 without another payment.

Correction: freeze certified dollar amounts and the applicable SOV/version basis
before allowing adjustment execution. Add/adjust/credit tests must prove every
past certificate, retainage and payment remains byte/value-equivalent as
appropriate. A new zero-billed CO line alone does not solve the existing-line
adjustment path. Do not rewrite a past pay app to make a new contract tie.

### 3. A SOV update does not update the shared contract answer

`src/lib/mcp/contract-value.ts:71-75` prefers job setup over SOV. With setup
$1,000 and SOV $1,100, the answer remains $1,000. Merely adding an original-sum
fact beside SOV lines will not establish the proposed shared current sum.

Correction: establish one authoritative original/current contract-value model,
preserving conflicting source facts rather than overwriting them. Verify every
consumer: contract answer/card, SOV, pay app, IOR and portfolio. Submitted or
approved but unexecuted PCOs must not alter the current contract sum.

### 4. The proposed SOV line and credit representations are unsupported

`src/lib/mcp/sov.ts:82-85` requires item numbers such as `03.01` and rejects
negative scheduled values. A literal `CO-003` item number and a standalone
negative credit both fail in the real builder. The design also says that a
credit never makes a line negative, contradicting its negative-line option.

Correction: use a compatible immutable SOV identity and a separate visible CO
label/reference. Define the credit representation and allocation constraints
with the financial model above. Do not weaken the validator before all the
downstream balance, fee, retainage and prior-billing tests exist.

## Corrections needed before the earlier log phases

### 5. Canonical CO number, label and lifecycle conflict

The introduction calls CO-001 the address; the body says PCO-003 keeps its
address for life. One passage assigns the CO label at approval, another at
execution. An owner-issued change starts at Priced-requested, which is absent
from the stated enum.

Use an immutable internal ID and one job sequence. Freeze the route convention
before implementation, preserve aliases once issued, and keep owner_number
separate. Distinguish approval from execution everywhere. Define every state,
permitted actor and transition explicitly; Directed/provisional billing remains
out of scope until separately decided. Never renumber an existing record/PDF.

### 6. An answer must not silently close an RFI

The no-impact row says it closes cleanly, while the lifecycle requires explicit
closure. An answer, a usable answer and permission to close are different facts.

Capture the answer and evidence as Answered; the member explicitly closes it.
Pending revised drawings remain a visible follow-up. Reopening preserves the
earlier answer, sent revision, deadline and events. Starting a PCO/TIA follow-up
is a separate confirmed action, never a side effect of model-written prose.

### 7. Default dates and contract dates need separate provenance

Ten working days without a clause is a proposed product default, not a known
contract requirement. The existing `computeDue` is a date-only calculator:
`src/lib/mcp/deadlines.ts:58-92`. It exposes assumptions for undefined working
days/holidays, and a contract-authorized weekend roll can move the date later.
It does not itself convert a provider timestamp into the job's local send date.

Use the saved clause revision, trigger, day type/calendar and job zone. Preserve
the calculator's precautions; convert the real send instant to the job date
before counting. Without a clause or explicit saved target, show Due date needed.
A confirmed target can be tracked but must say it is a target. Revisions and
reopens must not silently restart a contractual clock. No automatic default is
approved by this review.

### 8. Incoming mail matching needs a real capability and safer transitions

The draft promises overnight matching while also specifying no Athena mailbox.
Current delivery stores exact drafts and provider receipts; it does not prove a
background host-mail reader or a provider-enforced sent-threads-only scope exists.

Keep Phase 3's explicit answer capture independent of Phase 3b. For 3b, first
prove the available member-consented connector/runtime and its actual read
scope. Match the authorized account, job, stored message/thread ID and expected
counterparty. Subject tags alone are candidate matches. Do not automatically
accept an out-of-office response, bounce, ambiguous new thread or attachment
instructions as an answer. Duplicate messages cannot repeat transitions.
Do not add a server AI, new mailbox or broader mail access to fill that gap.

### 9. Internal links and role rules need a consistent access matrix

The design puts a record link in the architect's email, but existing board tokens
are internal job capabilities. `src/lib/mcp/board-link.ts:8,24-26` includes other
job pages, including IOR/pay app for full scope. Never put that token in external
mail. Use the reviewed PDF/draft flow; an external RFI share is a separate,
explicitly scoped capability and release decision.

The draft says pages allow full/super, then says a contract-only role can see CO
rows; its write rule is full-only. Those rules cannot all hold simultaneously.
The current role function maps estimating/contracts to contract scope. Specify
read, file, pricing, send, answer, close and execute permissions independently.
Filter money at the database response level, including totals/attachments/search
and portfolio aggregates. Do not widen existing roles to bypass this decision.

### 10. Completion-date mutation is unsettled

One passage changes job/portfolio completion upon approved days; the open
questions ask whether execution should change it at all. Default implementation
boundary for the early log phase: record requested/approved days and a linked
analysis requirement without editing CPM logic, baseline or completion dates.
A later approved scheduling operation must distinguish original completion,
authorized revised completion and the current forecast; store the signed basis.

### 11. RFC is missing from the design

Marshall explicitly requires a separate bid-stage Request for Clarification log.
It is not an alias for RFI and not a commercial open item. Add the following
companion to the corrected design before its phase is implemented:

- RFC-001 per bidding job, immutable ID/number/route; title, exact question,
  drawing/spec/bid-instruction reference with source ID/revision/page/paragraph,
  respondent, bid/clarification target dates, status, response and source file.
- Draft → Sent → Answered → Closed with explicit reopen; saved exact draft and
  receipt before Sent; addendum/answer attached to the record without altering
  the original documents. Log and record follow the regression contract.
- An answer can identify an estimating assumption, qualification or scope item
  to review. It cannot automatically invent a quantity, change a price, accept
  geometry or create an executed CO. Link downstream records with provenance.
- Design estimator access against the existing plan/role gates explicitly;
  construction RFI full/super rules cannot be copied over blindly.

## Verification performed

Six private characterization probes use the actual SOV, pay-app and contract
value functions. They reproduce the four financial incompatibilities above;
they do not change financial code or certify a future implementation. The
combined run passed 2,537 tests in 245 files (2,531 application tests plus the
six private probes). #284 separately passed the build, 17/17 locked behaviors
and both required CI checks. No production SQL or live member workflow ran.

## Delivery boundary

Keep the existing submittal tools/readers/renderers and their acceptance fixtures.
Add separate RFI, CO and RFC records and typed links; share only proven helpers.
Do not replace the working submittal implementation with a new generic engine
in the same change. First settle the early log state/route/access contract, then
implement its SQL/tool/card/record flow with the regression tests in place.
Phase 3b and CO execution remain distinct deliveries with their own evidence.

Grok Bot/Tess performs live acceptance in all three hosts after an exact approved
release. Supabase changes go only through existing Lovable Cloud. This review
authorizes no deployment, new access, email send or cleanup of job 2701.
