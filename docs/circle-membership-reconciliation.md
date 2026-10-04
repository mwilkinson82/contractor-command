# Circle membership reconciliation — review and release plan

This branch targets `mwilkinson82/contractor-command`, the Hub at `app.alpcontractorcircle.com`. It contains no production backfill identities, credentials, sends, account deletions, or deployment actions. Apply schema changes and publish through Lovable only after the exact source reconciliation has been reviewed.

## Membership contract

The canonical database decision is the union of verified, settled recurring Circle paid periods and independently recorded owner grants. `get_user_tier`, `has_active_access`, Circle-derived AOS limits, Hub Circle announcement selection, queued announcement delivery, and Resend Circle segment reconciliation use that decision.

- Scheduled cancellation preserves access until the paid-through boundary. The comparison is strictly `paid_through > now()`. Expiry does not depend on receiving another webhook.
- Canceled or expired sources cannot negate another paid source or active owner grant.
- Owner grants have an actor, reason, optional expiry, revocation, and change history. The admin Comp action creates/revokes a grant without rewriting Stripe billing status. Multiple independent sources survive revocation of one source.
- Existing non-Circle products and rank-based access remain unchanged. Power Hour, S&M School and Contractor School can retain their existing Hub features without becoming Circle announcement members. Hardcore grants retain their rank. Admin access is operational access, not an automatic Circle announcement copy.
- No grace period or free-trial membership is invented. Missing payment evidence, pending renewals after the paid period, delinquency, mismatched identities, and unreviewed comp flags produce `review`.
- `circle_legacy_reviews` captures pre-migration access for unresolved legacy rows. A review hold is not verified membership and cannot qualify for Circle marketing. New unresolved records gain no access. Existing canceled non-comped rows stay ineligible.
- Resolving a legacy comp requires an explicit grant decision. Do not copy every `is_comped` flag into the grant table. Mark a retired duplicate `resolution='superseded'` only after reviewing its independent sources.

## Implementation

The migration adds service-only evidence, grant/history, review and audience-outbox tables, with RLS and explicit role grants. Private SQL functions calculate entitlement; the existing Hub tier RPC becomes a consumer. No scheduler is installed by the migration. No blanket source-ID correction or membership grant is included.

Stripe handlers retain the existing API version and catalog mapping to avoid a billing API upgrade in this fix. They verify signatures and claim event IDs, retrieve current subscription state for unordered events, handle `invoice.paid` and async checkout success, preserve real `past_due`, and accept paid-through evidence only from a settled positive invoice with matching non-proration subscription lines. The newest observation wins under a database advisory lock. Source state and the outbox are committed together. Historical paid-through evidence is not shortened by a failed renewal.

Paid signup still writes pending claims and uses the existing idempotent Lovable Circle welcome/magic-link path. A Resend failure happens after that provisioning, remains visible in the outbox and Stripe event status, and returns HTTP 500 for retry. Ambiguous membership produces a visible review job. An old event cannot restore an obsolete subscription snapshot.

Invoice `status=paid` is insufficient after a refund. The webhook now retrieves the current underlying Charge (directly or through PaymentIntent/invoice payments), verifies customer/invoice linkage and captured amount, and rejects fully refunded or disputed payments as paid evidence. Partial refunds, missing charge evidence, and unresolved dispute outcomes go to explicit review. Existing legacy review access and independent owner grants or other paid subscriptions retain their existing behavior; there is no blanket revocation.

Each verified source snapshot records its backing invoice as `subscriptions.metadata.circle_paid_invoice_id`. Refreshes revalidate that invoice as well as the latest invoice and triggering paid/reversal invoice. This prevents an open renewal from hiding a refunded prior payment. Because the existing SQL retains the greatest paid-through date, any future stored date not covered by freshly verified payment remains on review. The private backfill must include this exact validated invoice reference alongside its paid-through evidence. No live identity or invoice IDs are included in this repository. `charge.refunded` and `charge.dispute.created/updated/closed` refresh Circle sources only; verify these event subscriptions separately through the approved Stripe workflow. Provider failures return a retryable error. The API version and database schema are unchanged by this correction.

Public capture rejects `segment=circle` before any provider call. The generic contact-upsert helper also refuses Circle; other capture segments keep their existing behavior.

Both announcement paths separate membership from marketing permission. Resend operations change only Circle segment membership: they never delete contacts, remove other segments, or set `unsubscribed=false`. Hub suppression, used unsubscribe tokens, the existing never-email rules, and Resend global unsubscribe are respected. Lovable Circle announcements recheck membership and suppression before enqueue and again immediately before delivery; older queue entries resolve their saved audience from their announcement log. Authentication/welcome mail remains independent.

## Review surfaces

Explicitly approved multiple-account or billing-address mappings use the separate [source alias review and release plan](circle-source-aliases.md). They follow the paid source's lifecycle and never create an independent comp. The mapping table starts empty; source-specific imports and retirement of duplicate legacy holds require their own exact private review.

Admin-only server functions in `src/lib/membership/admin.functions.ts`:

- `previewCircleReconciliation`: reads the canonical source and complete paginated Resend segment; returns the proposed changes and a SHA-256 plan hash. Resend-only identities are review cases, not inferred cancellations.
- `applyCircleReconciliation`: requires that exact current plan hash and rejects unresolved review cases. Queues changes and processes a bounded batch. Its sync counts report attempted work, not completion of the entire plan.
- `retryCircleAudienceSync`: retries a bounded batch of failed or pending jobs. Status, attempts, last error and last success remain inspectable in `circle_audience_sync`.

The outbox serializes work with a lease and revision checks. Each drain processes up to 10 contacts, paced within the process; provider rate limits remain retryable. Each provider request has a timeout. Additional batches may be required.

The opt-in `POST /api/public/circle/reconcile` endpoint authenticates with the existing service-role bearer credential. It is disabled unless `CIRCLE_RECONCILIATION_ENABLED=true`. It queues known identities to catch paid-period and grant expiry and drains one batch. No credential or schedule is created here.

## Required production review, in order

1. Review the independent read-only source plan. Resolve exact subscription IDs, canonical email/user mappings, verified invoice periods, explicit owner grants, retired comps and review holds. Keep that private identity plan out of this public repository. Preserve independent product purchases and manual grants. Do not treat a prior marketing segment as membership evidence.
2. Approve a concrete Lovable schema/backfill/publish plan. Rehearse the migration and the approved source-specific backfill in an isolated staging database. Re-run Supabase security advisors there; local tests cover privilege assertions but do not replace hosted advisors or all deployed schema/trigger behavior.
3. Apply the migration and the approved evidence/grant backfill through Lovable, then publish this app code as one coordinated release. Publishing code without the migration causes RPC failures; applying it without reviewed evidence leaves legacy review holds and intentionally blocks Circle audience generation. Do not enable the scheduler during this staging step.
4. Verify current paid signup, scheduled cancellation, one expired cancellation, independent grant retention, grant revoke, old canceled plus new paid, pending renewal, a suppression, and unrelated-product access in staging. Check welcome idempotency and queue delivery guards. Verify the Stripe endpoint subscribes to the newly handled invoice/async/paused/resumed events; this branch does not modify that setting.
5. Review the actual marketing diff and current plan hash. Configure the existing Resend credential through the approved Lovable workflow only after capture protection is deployed. Missing Resend credentials currently block Circle audience synchronization and Circle announcement delivery; they do not erase Hub entitlement. Apply only the approved diff and drain/verify every batch.
6. Approve and configure an expiry/retry schedule through Lovable using the existing service-role credential in its secret store. Choose a cadence and enough batch capacity for the roster (for example, one bounded batch per minute). Confirm the endpoint remains inaccessible without the service credential, then explicitly enable `CIRCLE_RECONCILIATION_ENABLED`. Hub access and Lovable delivery already evaluate expiry at request time; Resend segment expiry needs this scheduler.
7. Before a Resend broadcast, require a fresh reconciliation and zero pending/failed/review jobs for the approved audience. A direct Resend dashboard or separate sender can bypass this repository; it must follow that release check. This branch sends no broadcast and cannot enforce access to another application's send button.

The production rollout remains blocked on those explicit reviews, the actual grant/identity/evidence backfill, Resend credential configuration, webhook-event verification, and scheduled expiry/retry configuration. No live access has been revoked or granted by preparing this branch.

## Verification

Run `npm ci --ignore-scripts`, `npm test`, `npm run build`, and `npx tsc --noEmit`. The production build regenerates the route tree (also repairing an existing missing Resend inbound entry). PostgreSQL integration tests execute the actual migration in PGlite against a minimal existing schema and synthetic members; HTTP/provider tests are mocked. They never contact Stripe, Supabase or Resend.

The npm lockfile had `@lovable.dev/vite-tanstack-config` 2.12.0 while the manifest already required 2.23.1; this branch aligns that lock entry and adds a pinned PGlite test dependency. Existing repository-wide lint failures are separate from this fix; avoid an unrelated formatting sweep.

## Recovery

Disable the optional expiry scheduler before investigating a failed rollout. Retain evidence, grants, grant history and outbox state. Retry failed jobs after fixing the cause; do not replay welcome mail or force-resubscribe contacts. Restoring the old tier RPC would restore the original cancellation bug and must not be used as an automatic rollback. Prepare any rollback of schema/entitlements as a source-specific reviewed Lovable change.
