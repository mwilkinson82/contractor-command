# Backfill Past Book Buyers

## The situation
Past alphandbook.com buyers exist in Stripe but **not** in the portal's `pending_claims` table. Until we seed them, the `claim_pending_subscription` trigger has nothing to match against — a past buyer who signs up today would land as a free signup with no Book Buyer tier.

## What this plan does
Adds a one-time admin tool that pulls every past book purchase from Stripe and seeds `pending_claims` with `product: book_v2`. After that runs once, any past buyer who signs up with their book-purchase email is automatically granted the Book Buyer tier by the existing trigger.

No email blast. No code changes for future buyers (the webhook already handles them live).

## Steps

1. **Admin server function** — `src/lib/admin-backfill.functions.ts`
   - `backfillBookBuyers` (admin-only, `requireSupabaseAuth` + role check)
   - Uses `supabaseAdmin` + Stripe SDK
   - Lists Stripe charges/payment_intents matching the book product (filtered by `STRIPE_PRICE_ID_BOOK` or amount/product metadata)
   - For each successful charge, upsert into `pending_claims`:
     - `email` = customer email
     - `stripe_customer_id`
     - `status` = `'active'`
     - `metadata` = `{ product: 'book_v2', source: 'backfill', charge_id }`
   - Skip rows where email already exists in `pending_claims` OR a `subscriptions` row already covers that email
   - Returns `{ scanned, inserted, skipped, errors[] }`

2. **Admin UI** — new route `src/routes/admin.backfill.tsx`
   - Single "Run book buyer backfill" button + dry-run toggle
   - Shows the result counts and any errors
   - Linked from `admin.index.tsx`

3. **Verification step** (manual, in this plan)
   - Before writing anything, run a dry-run that only counts how many Stripe charges would match — so we can confirm the filter (price ID vs. product ID vs. amount) is correct for the alphandbook.com purchases. If the count looks wrong, we tune the filter before flipping to write mode.

## What's NOT in this plan
- No email blast to past buyers (per your call — "don't notify yet")
- No changes to the webhook (already handles live purchases)
- No changes to the signup flow or trigger (already works)

## Technical notes
- Stripe pagination via `stripe.charges.list({ limit: 100, starting_after })` loop
- Idempotent: re-running won't duplicate rows (unique-by-email check before insert)
- Long-running: backfill runs server-side; if there are thousands of charges, we batch in chunks of 100 with a progress return
- Uses existing `STRIPE_PRICE_ID_BOOK` secret to identify book purchases. If alphandbook.com used a different/legacy price ID, the dry-run will surface 0 matches and we'll add a secondary filter (product ID or amount).

## After this runs
Past buyers can land at `app.alpcontractorcircle.com/signup`, sign up with the email they used on alphandbook.com, and get Book Buyer tier instantly — no manual work, no support tickets.
