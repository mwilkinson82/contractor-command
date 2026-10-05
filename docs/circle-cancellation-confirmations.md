# Contractor Circle cancellation confirmations (draft, disabled)

This adds a factual confirmation for a member requesting cancellation and an independent notice to Marshall. Existing purchase/welcome emails, membership rules, billing portal, refunds and audience reconciliation remain in place. No attendance assumptions, retention offers or automated personal follow-ups are included.

## Copy for review

**Member subject:** Your Contractor Circle cancellation confirmation

Scheduled cancellation:

> Your Contractor Circle subscription is scheduled to cancel on {verified effective date/time, UTC}.
>
> Verified paid Circle access from this subscription runs through {verified paid-through date/time, UTC}.
>
> Any other active subscription or separately granted access is handled independently.
>
> Questions about your cancellation or billing? Reply to this email.
>
> View Contractor Circle membership options

For immediate/effective cancellation, the first sentence becomes “Your Contractor Circle subscription was canceled on {verified effective date/time, UTC}.” If the effective date is unavailable, it explicitly says that date is under review. If paid coverage is unverified or requires review, replace the coverage sentence with “Your paid-access end date is under review. Reply to this email if you need help.” An immediate cancellation with retained verified paid coverage still states the paid-through date; it does not promise immediate access removal, no further charges or a refund.

Support uses `marshall@marshallwilkinson.com`, the existing Hub reply-to. The neutral membership-options link uses the existing Circle upgrade route, `https://app.alpcontractorcircle.com/upgrade?tier=circle`. It does not create a checkout or offer a discount. Existing tier controls determine available options.

**Owner subject:** Contractor Circle cancellation

The owner notice uses the existing notifications inbox, `wilkinson.marshall@gmail.com`, and shows the Stripe customer's name when provided, verified member/billing email, request date, current scheduled/effective date, verified paid-through date or review status. Stripe reason, feedback and comment appear only when supplied. HTML escapes comments. It does not infer participation history or send a personal follow-up. Identity and never-email holds are stated for review.

Both messages use the existing Contractor Circle header, logo, footer, sender domain and Lovable transactional queue. No new Resend client, API key or provider is introduced.

## Lifecycle and reliability

- Only fresh `customer.subscription.updated`/`deleted` events can initiate notices. The webhook retrieves current Stripe subscription/customer/payment state first; an obsolete canceled event cannot manufacture a current cancellation.
- One cancellation episode is anchored to Stripe's `canceled_at`. Scheduled request and subsequent effective end share one member key and one owner key. Undoing and later requesting cancellation creates a new episode. Dunning/dispute termination is excluded from customer-request automation.
- Missing cancellation anchors produce an explicit failed-webhook/manual-review error after the membership snapshot is saved. Dates are never guessed from webhook arrival. Historical episodes before activation are excluded, including historical webhook retries.
- `circle_cancellation_notice` in the existing service-written source metadata tracks current episode and verified coverage. Enabled refreshes clear it on resumption and update it on invoices/refunds. This is messaging state, not an entitlement grant or revoke.
- A service-only migration adds an immutable per-recipient deduplication ledger and an RPC. The RPC shares the existing subscription advisory lock, verifies exact source/episode/observation and recipient, and commits ledger, audit, unsubscribe token and queue together. Queue failure rolls back; webhook returns 500 for retry. A stale competing observation also requests retry. Each channel is atomic; retry of an already committed member channel can still queue the owner channel.
- Both Hub consumers verify the current episode and exact recipient at delivery, check native suppression/unsubscribe again, and re-render current facts. Cancellation confirmation does not require membership to remain eligible. Resumed/replaced episodes or disabled activation are withheld. Provider sends keep the durable notice key for idempotency.
- Native suppressions and existing never-email rules continue to apply. Member identity ambiguity withholds that channel; the separately addressed owner alert remains available for review. This feature does not override consent/suppression, grant access, cancel billing, refund a charge or revoke any grant.

## Activation requires separate review

This branch is a draft. No migration, runtime setting, deployment or send has been performed.

1. Review the copy, owner destination, suppression policy and source/migration changes.
2. Apply the single additive migration through the approved Lovable migration/publication workflow; regenerate Supabase types there as appropriate. Never apply it directly to production with a local Supabase CLI.
3. Set the **nonsecret** `CIRCLE_CANCELLATION_EMAILS_ENABLED_FROM` to the agreed activation instant in explicit UTC ISO form, e.g. `YYYY-MM-DDTHH:mm:ssZ`, in the actual Hub server environment. Missing/malformed/future values disable the workflow. Do not set a historical cutoff to backfill notices.
4. Publish the reviewed code/config through Lovable and verify the actual Hub runtime. Existing queue processing must already be operational; no new cron is added. First use a synthetic/test cancellation event, with approved test-only recipients, through the existing test workflow.
5. Review `circle_cancellation_notices`, `email_send_log`, queue/DLQ and failed Stripe webhook events for the first authorized cancellations. Ledger `queued` means committed to the queue, not delivered; email-send audit records hold delivery outcomes.

To pause, remove the activation setting. Already queued cancellation labels are withheld by both consumers while disabled. Changing the cutoff intentionally invalidates old episodes; activation review should account for any pending messages. Supabase metadata and email logs contain personal data, so use existing protected admin/operations access.

## Validation

Synthetic tests exercise request/effective end deduplication, resumption/new episode, obsolete/historical events, independent owner channel, paid-through versus refund review, escaped supplied comments, both actual Hub queue handlers, post-enqueue suppression/unsubscribe, source failures, forged bindings, queue rollback/retry, additive migration permissions and disabled-default behavior. All fixtures use fake providers and local in-memory PostgreSQL; they do not send email or mutate clients.

Verification completed: 686 tests across 53 files passed; TypeScript, focused ESLint and production build passed. Baseline build warnings concern chunk sizing and the existing Cloudflare Wrangler main override.
