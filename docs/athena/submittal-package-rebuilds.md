# Submittal package rebuilds and live log

Private candidate based on the live Athena branch after #274. No production data was
changed and no email was sent during development. The staged migration must be applied
through the existing Lovable Cloud project as part of an approved release.

## Acceptance

- Three explicit builds of the same submittal revision produce three immutable PDFs,
  three filenames and three job-wide transmittal numbers. Each cover prints its own number.
- Exactly one package matches the current document fingerprint. Older copies remain
  downloadable in the record and show **Superseded**, with their original transmittals.
- Reading a package does not rebuild it. A failed render, upload or save does not replace
  the current package. A stale build cannot commit after the source context changes.
- The log and package/Collect cards include **Open live submittal log**, retaining the
  existing authorized job address and key. Both the chat log and web log point their
  primary rows at the exact current PDF; the record remains a separate link.
- A current unsent package reads **Ready for internal review · Draft, not sent** in the
  log. This is a display state: build never records submission, approval or a send receipt.
  A previous package's receipt never makes a new copy look sent.
- The new function requires the existing active entitlement and full job access. Read
  permissions, board authorization, sign-in, Hub, AI boundaries and send approval stay intact.

- A logged submittal with zero package pieces can receive an attachment directly with `upload_piece` and `new_piece` (`kind`, `source_party`, optional `required`). The piece gets its own ID and P-number in the reply; a second upload preserves all earlier pieces. The host-supplied filename is retained and shown on the card. Existing pieces still use their ID or P-number.
- File-source ambiguity, unsupported filenames, failed downloads and invalid metadata never create a new log piece. The writer adds the piece and attaches its already-stored file in one transaction, under the existing entitlement and full-job gate. A bad storage reference rolls the new row back. Distinct pieces from the same supplier/kind remain distinct.

## Implementation

The old build was idempotent only while its fingerprint matched. A changed source could
produce another PDF using the same submittal transmittal, and history labeled every PDF
using the revision's current number. Packages now store their own transmittal identity.

`mcp_submittal_package_reserve` takes the existing job lock and reserves a job-wide number
bound to the exact submittal and input fingerprint. The first build may use its original
allocated number; rebuilds take a new one. Only `save` switches the submittal's current
transmittal and commits the package, in one transaction after all existing storage and
context checks. Interrupted reservations may leave number gaps; numbers are not reused.

Historical bytes, filenames, original source files and delivery receipts are preserved.
The migration recovers historical transmittals only from the old builder's printed-number
filename pattern on the same job. It does not renumber old PDFs. Unknown historical
numbers say **Transmittal not recorded**, rather than borrowing today's number.

The deployed first-build path remains compatible during migration/publication. An old
builder attempting a rebuild is refused rather than allowed to reuse an old number.
After publication, the normal tool reserves the new identity before rendering the cover.

The web log now reads the same current package context as the tool log; its change stamp
also includes package writes and receipt/revocation state. The sibling-link helper retains
`open=package` and `package_id` when adding the existing board key. No access decision or
sign-in flow changed.

## Verification

- Full Vitest suite: **2,453 tests across 233 files**, including **17/17 locked behaviors**.
  Production build passes; changed-file semantic lint has no errors (three existing
  React Fast Refresh warnings). Type output is byte-identical to the 32-diagnostic baseline.
  One run alongside the Vite build hit an inherited five-second drawing-test timeout;
  the final suite ran after the build with two workers and all tests passed. No drawing
  tests or timeouts were changed.
- Real SQL via the existing local PostgreSQL/PGlite harness: rebuilds, current/superseded
  identity, concurrent reservations, stale writes, rollback, role restriction and rollout
  compatibility. Source and historical-package hashes remain unchanged.
- The real package tool, both log readers and record renderer are exercised together.
- Three generated PDFs were extracted and their covers checked: distinct T-5, T-6 and T-7
  on revision 0. The private record preview shows one current copy and two superseded copies.
- No live-host pass is claimed for this unreleased candidate. Tess's reported all-host
  package pass applies to the previous release, not these new rebuild changes.

## Approved release and retest needed

Apply only `20261030120000_athena_package_build_identity.sql` through Lovable Cloud,
then publish the reviewed application tree through that same project. Refresh the existing
host definitions if required. No new connector or sharing permissions are needed.

After approval, rebuild only the existing owner-only fictional QA package, twice, and
check all three copies and covers in each host. Confirm old package links still open,
the current log row opens the newest PDF, the separate record URL stays on the same
submittal, and the live log link preserves those results. Send nothing.

Job 2701's stored name remains unchanged. Marketing should use a separate clearly named
demo job rather than changing the construction record to improve a screenshot.

## Tess release acceptance — required in all three hosts

This candidate is not done until Tess passes these live in normal ChatGPT, Claude and Grok Bot:

1. On the existing owner-only fictional QA submittal, start with an empty piece list; upload a received PDF with its kind and fictional supplier source, without first editing the log. Its ID, P-number, filename, source and received state appear. Add a second piece and verify the first is unchanged; build a real merged package with its cover/transmittal. Send nothing.
2. Rebuild twice. All three PDFs and original attachments remain available and unchanged. Exactly one copy is current, older copies say Superseded, and all covers and filenames carry distinct transmittals.
3. Open the live-log link on the log, package and Collect cards. It keeps the same job and authorized access; the row opens the current PDF, and the separate record link keeps the same submittal. Draft, not sent is visible, with no new send receipt.
4. Retry after a failed/invalid file input. No blank piece or replacement of another piece appears. A caller without full job access cannot add one.

Code/tests passed, published, and Tess passed are separate states. No live-host pass is claimed by a local integration or screenshot. Estimating PR #276 is parked while submittals, PM, follow-ups and accounting complete in that order.
