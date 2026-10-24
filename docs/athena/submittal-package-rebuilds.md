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

- Full Vitest suite: **2,448 tests across 233 files**, including **17/17 locked behaviors**.
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
