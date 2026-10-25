# Open items links and submittal history polish

This candidate follows the corrected job 2701 #283 test report. Submittal record
and log links already open through ChatGPT's normal external-link dialog. Their
navigation implementation and resource identities are unchanged.

## Changes

- `list_open_items` obtains the existing role-scoped job board links and adds
  **Open live open items**, even on an empty list. Each row points to the saved
  item's existing `item-<id>` section on that board. HTML, ChatGPT widget data,
  Markdown and the phone fallback all retain the same URL and token. Counts,
  filters and ordering are unchanged. No new access grant or share workflow.
- Package history shows a chronological **Build X of Y**, stable by original
  build instant then immutable copy ID, in the card and record page. Four old
  T-2 copies remain four original T-2 PDFs; their unique build positions identify
  them without inventing T-1/T-3 or rewriting historical transmittals or receipts.
- Upload links emit the router's final query encoding directly. The real router
  parse/validate/stringify round trip is identical, while old `upload=1` links
  remain accepted. Tokens and `#upload` remain. No sign-in behavior changes.

## Verification

- 2,531 tests across 244 files pass, including 17 locked behaviors.
- Production build passes. Typecheck retains exactly the same 32 baseline
  diagnostics, compared after line-number normalization; none added.
- New files pass strict ESLint. Other touched legacy files pass with their
  pre-existing formatting rule disabled; workflow-tools retains its pre-existing
  no-unused-expressions diagnostic.
- Real handler fixture: 32 open, 4 overdue, 20 due in seven days. Every item link
  matches an actual board anchor, the signed key survives rendering and JSON,
  the ChatGPT widget script executes, and empty/contract-only/link-error cases
  preserve the existing scope. This is fixture data, not a fresh live count.
- Real router and package-handler tests cover canonical upload URLs and visible
  build labels. Unit/record rendering tests retain four original T-2 identities.
- No migration, auth/Hub/email changes, server-side AI, package rebuild or data
  cleanup. Production P9 and the two test open items remain untouched.

## Remaining work and live gate

Grok Bot owns live retesting on job 2701, followed by the full #278 list. Existing
P9 upload, hash references, named job time zones, Both copies/All 4 copies,
Superseded labels and passing submittal links must remain passing. The same
items URL must reopen; follow its existing sign-in recovery if its board token
has expired. A missing/denied link RPC does not fabricate a signed link or block
the item data.

RFI, CO and RFC are separate forthcoming register work, not implemented or
represented as existing records by this patch. The user supplied the pattern
summary of "Athena Logs and Portfolio Rollup"
(https://claude.ai/artifact/67fDV2SAF8NmBVxPywACUs); its page was unavailable to
our web reader. Dedicated RFI/CO/RFC design pages are being prepared before
Phase 3/4 implementation. RFC means bid-stage Request for Clarification, distinct
from construction RFIs. Answered technical questions must not silently become
commercially resolved. Pricing, approvals, SOV/pay-app effects and schedule
impacts belong in those explicit designs.

The listed test records are marked for cleanup only after the next passing run;
nothing in this candidate deletes them.
