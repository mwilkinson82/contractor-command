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

## Verified payment-email sign-in

Some members already have a backend-linked account at a different login address.
A first Athena request from the actual verified Stripe payment email can attach
that account to the same company as an owner, without replacing the original
linked account or creating another company. The payment-login UUID and claim
timestamp are recorded in the private binding/audit. Later email changes on that
same account retain the link. A second unrelated account that later obtains the
old address cannot take an already claimed slot. Neither a typed payment email,
an unverified address, a name match, nor an unpaid/review-held source can claim
ownership. The claim changes only Athena membership/settings and its audit;
Hub identity, auth confirmation and payment evidence remain untouched.

## Company-specific subscription cutoff

A provisioned company gets Circle access only while its own bound source is live.
Its source period end is an exclusive cutoff: access is allowed before that
instant and refused at or after it, including when Stripe still reports active,
its cancel-at-period-end boolean is false, an older invoice extends paid-through,
or the user has a warm positive gate cache or unrelated owner grant. The three
reviewed scheduled cancellations have a Stripe cancel_at equal to the source's
current_period_end; keep those timestamps intact and use their actual instant,
not a calendar-date guess. Existing source/evidence triggers continue to process
renewals and payment holds. No timer, email, auth hook or Hub change is required.

The cutoff covers owner/team administration, company membership, job access and
all Circle roles. A seat's own active company cannot reopen an ended company.
A separate active Athena PM/Office plan continues with its own narrower roles;
legacy companies without a Circle provisioning binding keep existing behavior.
Nothing deletes companies, memberships, jobs, files or audit history. A verified
renewal restores access to the same company. A stored provisioning/entitlement
status is descriptive, never authority to bypass the live cutoff.

Apply the forward expiry migration through Lovable Cloud only, after review.
SQL regressions cover before/at/after expiry, stale cache/owner grants, a seat
with another live company, denied owner/job/team writes, preserved records,
standalone PM restrictions, and renewal of the original workspace.
