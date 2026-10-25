# Member upload lookup after #280

## Confirmed cause and scope

The real Supabase RPC builder is PromiseLike: it has `then`, but no `catch`.
`loadMemberSubmittalRecord` called `.catch()` on that builder for its freshness
lookup, throwing `TypeError: rpc(...).catch is not a function` before the member
record request. Earlier mocks returned native Promises and missed this contract.
The regression now uses the installed Supabase client and reproduces that exact
failure against the previous source.

The router's actual default search parser also decodes `upload=1` to numeric 1.
The record route kept only string values, losing the upload intent and selecting
the freshness path above. The route now retains that one numeric flag as `"1"`,
preserving the board key, package ID and other existing string fields.

Read-only Cloud relationship inspection confirms job 2701's ALP account has the
company owner role, allowed without an explicit job-access entry. A diagnostic
record call in a Lovable Cloud transaction using the existing authenticated
account returned `scope: full`, `read_only: false`; the transaction was rolled
back. This is backend diagnostic evidence, not a captured browser HTTP response
or a live file-picker pass. No membership, gate, grants or RLS changes are needed.

## Final behavior

- Await the actual RPC builder in try/catch. A freshness failure still proceeds
  to the authoritative member record. Full access must come from that record;
  token-only, read-only, cross-job and denied results never enable uploads.
- The page logs `[athena] submittal.member-read` on a failed record lookup with
  only RPC name, HTTP status, code and a redacted message. The same diagnostic is
  available under **Upload access details**. No session, headers, response
  payload, email, token or signed URL is logged.
- An actual SDK response is run through the page query in a test; the actual
  upload component renders its `type=file` control for the Owner. Denied reads
  expose diagnostics and render no file control. This is local verification.
- Duplicate filename warnings say **Both copies are kept** for two; three or
  more retain **All N copies are kept**. Matching filenames still do not assert
  identical contents.
- Card and record history show build dates/times in **America/Manaus (UTC-4)**.
  `2026-10-24T19:11:33+00:00` displays `Oct 24, 2026, 3:11 PM Manaus (UTC-4)`.
  Original timestamps, transmittals, copy IDs and PDF links are unchanged. Host
  history facts include `built_at_display` beside the original `created_at`.

Cloud-generated migration 0025 alters functions created by each submittal feature
suite, outside the older base fixture. The base test fixture is explicitly
bounded through 0024; the member-read SQL regression loads the prerequisites and
then tests the actual generated 0025 migration. No production migration changes.

## Verification and retest

2,504 tests / 241 files pass; 17/17 locked behaviors pass. Changed files pass
ESLint (existing unformatted legacy render/tool files checked with their existing
Prettier noise excluded). Typecheck still reports the same 32 baseline diagnostics
with identical normalized messages; none added. See the private verification
record for build/CI and publication status.

Grok Bot owns live acceptance in ChatGPT, Claude and Grok Bot. Reload the existing
job 2701 / 05 12 00-001 upload link, retain `t=`, verify the browser account, and
confirm the file picker appears for the Owner without another sign-in form.
Check the two-/four-copy wording and the T-2 example time. No new package, upload
or send is needed for these checks. If a lookup still fails, capture its visible
diagnostic or browser console event, excluding tokens and authorization headers.

No auth, Hub, email-code, session-storage, permission, package-engine or migration
changes; no emails, uploads, package builds or live acceptance tests by Codex.
