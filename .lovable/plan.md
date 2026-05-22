
# AOS seat & workspace add-ons (book buyers)

Sell extra AOS capacity to book buyers as monthly recurring add-ons that stack on top of their base 1 workspace / 2 seats.

- **Extra seat**: $9.99/month each
- **Extra workspace**: $25/month each
- **Cadence**: monthly recurring
- **Who can buy**: book buyers only (other paid tiers already have unlimited)

## Where it shows up

1. **`/aos` page** — when the viewer is a book buyer, show a small "Need more capacity?" panel under the workspace/seats pill with two stepper rows ("Extra seats — $9.99/mo", "Extra workspaces — $25/mo") and a single "Add to plan" button. Hidden for tiers that already get unlimited.
2. **`/upgrade` page** — replace the existing placeholder block ("Seat/workspace pricing is configured in AOS — this section will become a checkout once AOS-side billing is wired") with the same stepper UI, shown only when `tier === 'book_buyer'`.
3. **AOS gateway** — already reads `get_user_aos_limits()`, so once the DB function returns the larger numbers, AOS itself sees them with no extra work.

## Data model

New table `public.aos_addons` to track each active add-on subscription line. One row per Stripe subscription item:

```
id              uuid pk
user_id         uuid          -- nullable until claimed (mirrors subscriptions)
email           text not null
kind            text not null check (kind in ('seat','workspace'))
quantity        int  not null default 1
stripe_subscription_id  text unique
stripe_customer_id      text
status          text not null  -- 'active' | 'canceled' | 'past_due' …
current_period_end timestamptz
metadata        jsonb not null default '{}'
created_at / updated_at
```

RLS: users read their own rows; admin manages all.

Updating `get_user_aos_limits()` for the book-buyer branch:
- Keep base 1 workspace / 2 seats.
- `SUM(quantity)` from `aos_addons` where `status IN ('active','trialing')` is added on top.
- Other tiers' branches stay untouched.

## Stripe wiring

Two new monthly prices on the existing product (or two products, doesn't matter — we only need the price IDs). Stored as secrets so we never hardcode:

- `STRIPE_PRICE_ID_AOS_SEAT_MONTH`  → $9.99/month
- `STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH` → $25/month

Both are quantity-based — one Stripe subscription per add-on type per user, quantity bumps when they buy more.

Checkout flow (new server fn `createAosAddonCheckout` in `src/lib/billing.functions.ts`):
- Inputs: `{ kind: 'seat'|'workspace', quantity: number, returnTo?: string }`
- Validates book-buyer tier server-side (no upsell to tiers with unlimited).
- If an active addon row of that kind already exists, send the user to the Stripe billing portal (`createBillingPortalSession`) to bump quantity rather than starting a second subscription.
- Otherwise create a new Stripe Checkout session with the price + quantity, success/cancel URLs back to `/aos`.

Webhook (`src/routes/api/public/stripe/webhook.ts`) gets a new branch:
- On `checkout.session.completed` / `customer.subscription.updated|deleted`, if the price ID is one of the two add-on price IDs, upsert the matching `aos_addons` row (kind, quantity, status, period end). Reuses the existing `pending_claims` flow for the email→user link when the user hasn't signed up yet.

## UI components

- New `src/components/portal/aos-addons-panel.tsx`:
  - Two stepper rows with +/− buttons (min 0).
  - Live total: "+N seats · +M workspaces = $X.XX/mo".
  - Single CTA button → calls `createAosAddonCheckout` per kind that changed.
  - When the user already has an active addon, the CTA becomes "Manage in billing portal" and links there.
- `/aos` page: mount the panel inside the existing limits row when `limits.tier === 'book_buyer'`.
- `/upgrade` page: replace the existing `aos_only` placeholder block with this panel, gated on `tier === 'book_buyer'`.

## Secrets you'll need to set

Before the checkout works:
- `STRIPE_PRICE_ID_AOS_SEAT_MONTH`
- `STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH`

I'll prompt you to add both when you approve the plan.

## What this does NOT change

- Other tiers stay at unlimited (no checkout shown).
- Intensive grads keep their 2/6 cap unchanged — they were not in scope for this round. We can add the same panel for them later by flipping one boolean.
- AOS-only buyers already have the metadata-driven `1 + extras` logic; that stays put and is independent of this new flow.
