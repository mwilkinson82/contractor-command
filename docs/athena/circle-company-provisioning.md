# Circle company provisioning (T-004)

An eligible recurring Circle/Hardcore source provisions one Athena workspace,
including the owner plus five additional seats and all seven existing roles.
Provisioning runs after subscription/evidence writes and at the first Athena
request. No Hub sign-in, auth trigger, profile trigger, email, checkout or Stripe
mutation is added.

The binding records the exact subscription/customer IDs, payment email, company
and stable account UUID. Existing owner companies are reused, preferring the one
with jobs. Concurrent customer/owner operations serialize before creation.
Renewals and retries reuse the workspace. A genuinely unclaimed paid source
reserves a company without members; only its verified payment-email identity can
claim it. A previously linked account can use its established login address and
retain access when its email changes. A new unrelated account cannot claim a
workspace by typing somebody else's payment email. Identity conflicts remain on
review; no names, email domains or editable auth metadata authorize a claim.

The explicit Circle entitlement is not a permanent license: company plan access
rechecks canonical source evidence. Expiry, refund/review and inactive sources
cannot be bypassed by a stale active entitlement row. Existing standalone paid
plans and extra purchased seats remain intact. Circle takes priority while live.
An exceptional owner-directed Athena access restoration can be recorded with an
explicit expiry, actor and reason; it does not alter Hub membership, payment
evidence or invoice status. All provisioning and overrides are audited.

Apply the checked migration only through the existing Lovable Cloud project.
The migration contains no real member data or automatic historical backfill.
Reconcile the owner's private payment-email roster separately against live Stripe
and the existing source/user bindings. Exclude removed members and retain all
scheduled cancellation dates. Never send a welcome/invite during this repair.

When consolidating duplicate companies, preserve the canonical company with its
jobs, combine nonconflicting profile details, save complete original rows and
dependencies in the team audit, move references, and verify job IDs/counts before
removing empty duplicate shells. Do not infer that unrelated companies owned by
one member should be merged.

The SQL regression suite executes the real membership/team/provisioning
migrations. It covers evidence ordering, owner plus five seats, all roles,
idempotent company reuse, unclaimed renewal reuse, verified first claim, later
email changes, refusal of other/unverified identities, source-binding changes,
payment holds, bounded overrides, expiry for invited seats, retained standalone
plans/extra seats, private ACLs and append-only audit access. No real identities,
live billing mutations or mail delivery are used in tests.
