# Access first, company onboarding second

Marshall clarified on October 24, 2026 that a missing company is normal before
onboarding. Active Circle members and people granted Circle access may enter
Athena, then provide their company name during onboarding. A company must not be
invented from a payment email or profile name.

## Correction

The #259/#260 subscription, payment-evidence and sign-in paths call
`mcp_private.ensure_circle_company`. Previously that helper inserted a placeholder
company when it could not find an existing one. The forward migration removes
that insert and returns null instead. The entitlement decision and company setup
RPC stay unchanged: eligible members without companies still pass `mcp_gate`,
and `getting_started` asks for the company name. An explicit
`onboarding/save_company` creates the named company. The existing sync attaches
Circle benefits to that company on the next guarded call.

Existing companies, memberships, current-company selection, verified payment-email
claims, independently purchased plans, extra seats, renewal and expiry rules are
preserved. The migration updates a function only; it does not create, rename,
delete or move any existing company, job or member row. It does not change Hub
sign-in, auth settings, email codes, connector addresses or send any email.

The current allowance remains the existing Circle owner plus five additional
seats. This change does not redefine that allowance. Standalone Athena purchaser
onboarding is not proven by these Circle tests; no purchaser is simulated as a
Circle member or granted access to make a test pass.

## Verification

- 2,333 application tests pass across 221 files.
- 17/17 locked behaviors pass, preserving the original 16.
- Production build passes. ESLint and Prettier pass on the new test file.
- Eight new tests run the actual guarded SQL in isolated PostgreSQL (PGlite),
  applying #259/#260 before the new migration. They cover paid access with no
  company; active owner grants with no Stripe subscription; explicit chosen-name
  onboarding and Circle benefits; an unclaimed payment followed by first sign-in;
  unchanged existing company records and renewal; verified payment-email claims;
  expiry without deleting company records; and denial without an entitlement.
- The onboarding tests use real RLS through the scoped test client and render the
  actual company-setup card. Repeated subscription/evidence events and gate calls
  are checked for unchanged company/member/binding counts.
- No production records were changed. Live acceptance remains pending an approved
  Lovable Cloud migration and deployment.

## Release and live verification

Apply the forward migration only through the existing Lovable Cloud project,
after approval of the final PR head. Do not reapply old backfills or remove
previously created companies. Record company/member/access hashes before and
after the migration and check that they match.

With an approved fictional account that already has Circle access and no company,
open Athena in regular ChatGPT and Claude chat. Ask to get started and confirm the
company-name prompt appears without a company or seat error. Reading the prompt
must not create a company. Creating a named QA company needs its own approved
fixture; do not create a real member's company to force a pass. Confirm existing
users retain their companies, jobs and roles. Keep member communications separate
from this release.
