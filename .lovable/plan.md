## What's broken

Every Stripe `checkout.session.completed` webhook for **book purchases** has been failing today (4 failures, 4 attempts). Root cause:

- `src/routes/api/public/stripe/webhook.ts` calls `supabaseAdmin.from("pending_claims").upsert(row, { onConflict: "stripe_subscription_id" })`
- `pending_claims` has no unique constraint on `stripe_subscription_id` — only `subscriptions` does
- Postgres rejects the upsert: *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*

The same bug exists in both the subscription path (line 271) and the one-time purchase path (line 376), but only the one-time path is hit in practice (book buyers without a profile yet).

## Why today still mostly worked

Your 15:58 manual backfill scraped all 4 of today's purchases straight from Stripe into `pending_claims`. kennycastro09 then signed up at 16:11 and the `claim_pending_subscription` trigger promoted them to a real Book Buyer subscription. The other 3 are sitting in `pending_claims` waiting to claim on signup.

## The fix

1. **Migration:** add a unique index on `pending_claims.stripe_subscription_id` (partial, where not null, so it doesn't block legacy rows).

   ```sql
   CREATE UNIQUE INDEX pending_claims_stripe_subscription_id_key
   ON public.pending_claims (stripe_subscription_id)
   WHERE stripe_subscription_id IS NOT NULL;
   ```

2. **Replay the 4 failed webhook events** so today's purchases get a proper webhook-created `pending_claims` row (idempotent — already-claimed/already-subscribed ones become no-ops). Mark them as processed afterward, or just leave the row state — the data is already correct from backfill.

3. **Verify:** trigger a test book purchase (or replay one of today's events from Stripe dashboard) and confirm `stripe_webhook_events.status = 'processed'`.

## Out of scope

- No code change to `webhook.ts` — the upsert call is correct; only the missing DB constraint needs to be added.
- No changes to the backfill flow or subscription tiers.
- Not touching the historical `pending_claims` rows from the May 15 CSV import (they have null `stripe_subscription_id`, which the partial index allows).

Want me to apply the migration?
