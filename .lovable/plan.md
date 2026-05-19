# AOS access tiers + public AOS-only tier

## The model we're building toward

| Tier | Workspaces | Seats | Source |
|---|---|---|---|
| Book buyer | 1 | 2 | Comes with handbook purchase |
| Intensive | 2 | 6 | Comes with 6-week intensive |
| Circle member | unlimited | unlimited | Circle membership |
| **AOS-only (new public tier)** | 1 base + buy more | 1 base + buy more | Self-serve on Stripe |
| Admin (you) | unlimited | unlimited | role check |

AOS enforces the limits. Circle's job is to tell AOS, on every SSO, "this user's plan allows N workspaces and M seats." AOS uses that to block the next invite or workspace-create when over cap.

The AOS-only tier is a brand new public funnel: somebody who doesn't want the book or the intensive or the Circle can still buy AOS access on a per-seat / per-workspace basis. Cheaper entry point, still a magnet — and if they grow, they upgrade to Intensive or Circle and get the bundled allowance instead.

---

## What I build in this project (Circle portal)

### 1. Extend the tier system to carry limits, not just a label

Today `get_user_tier()` returns one of `book_buyer | intensive | circle`. We'll add a sibling function `get_user_aos_limits(uid)` that returns:

```
{ tier, workspace_limit, seat_limit, source }
```

Rules:
- Admin → unlimited / unlimited
- Circle (active or comped) → unlimited / unlimited
- Intensive → 2 / 6
- Book buyer → 1 / 2
- AOS-only → 1 base workspace + extra workspaces purchased, 1 base seat + extra seats purchased (read from subscription metadata / quantity)
- No active subscription → 0 / 0 (button disabled)

If a user has multiple active subscriptions (e.g. book buyer who later buys extra AOS seats), take the **max** of each limit independently — they get the best of both.

### 2. New `aos_only` tier value

- Add `aos_only` to the `app_tier` enum (rank below `book_buyer`)
- Update the Stripe webhook mapping so a purchase against the new AOS-only price IDs creates a subscription row with `tier = 'aos_only'` and `metadata.seats` / `metadata.workspaces` reflecting the purchased quantity
- Update `claim_pending_subscription` trigger to recognize `product: aos_only` in pending claims

### 3. Pass limits in the SSO token

Today `mintAosSsoToken` signs `email|ts|nonce`. We extend the signed payload to:

```
email|ts|nonce|tier|workspace_limit|seat_limit
```

Token shape stays URL-safe. AOS's verify endpoint will read those extra fields and trust them because the HMAC covers them.

### 4. Open the AOS gateway to all paying tiers

Today the AOS button is gated to Circle (and admin). Change the gate to "any tier with `seat_limit > 0`" — which means book buyers, intensive grads, Circle members, and AOS-only buyers all see the button. The button text / sublabel can show their current allowance ("1 workspace · 2 seats — upgrade for more").

### 5. New upgrade/buy-more surface in the portal

A new page at `/aos/seats` (or a section on the existing `/upgrade` page) showing:
- Current plan + current allowance
- "Add a seat" / "Add a workspace" buttons that open Stripe Checkout for the per-seat / per-workspace prices (requires you to create these in Stripe and give me the price IDs — see "What you do in Stripe" below)
- "Upgrade to Intensive / Circle" if they'd come out ahead

This is the funnel surface: a book buyer who needs a 3rd seat sees both "buy one seat for $X/mo" and "join Circle for unlimited."

### 6. Public signup for AOS-only

Today signup is invite-only (account creation only happens after a Stripe purchase seeds `pending_claims`). The AOS-only tier slots into that exact same flow — they buy on Stripe, webhook seeds the claim, they sign up, trigger grants them `aos_only` tier with their purchased seat/workspace counts. No new auth flow needed.

We'll add a public landing CTA somewhere (TBD with you — could be on the handbook marketing page, could be standalone) that links to the AOS-only Stripe checkout.

---

## What you do in Stripe

You mentioned you need to figure out pricing first. Once you have, you'll create:

1. **AOS-only base subscription** — gets them into AOS with 1 workspace + 1 seat
2. **Extra seat** — per-seat add-on (recurring, quantity-based)
3. **Extra workspace** — per-workspace add-on (recurring, quantity-based)

Then add the three new price IDs as secrets:
- `STRIPE_PRICE_ID_AOS_ONLY`
- `STRIPE_PRICE_ID_AOS_EXTRA_SEAT`
- `STRIPE_PRICE_ID_AOS_EXTRA_WORKSPACE`

The existing webhook will pick them up once I wire the mapping.

---

## Spec for the AOS project (separate Lovable project — you'll hand this to that AI)

This is the doc I'll generate as `docs/aos-tier-spec.md` for you to paste into the AOS project chat. Summary of what AOS needs to do:

1. **Update the SSO verify endpoint** (`/api/public/circle/sso`) to read `tier`, `workspace_limit`, `seat_limit` from the signed token and store them on the AOS user/workspace record.
2. **Find-or-create on first SSO**:
   - If user doesn't exist on AOS, auto-create them + 1 default workspace, mark them as owner
   - Store the limits from the token
3. **Enforce limits**:
   - Block "create workspace" button when user's owned workspace count >= `workspace_limit`
   - Block "invite seat" button in each workspace when seat count >= `seat_limit`
   - Show a clear "Upgrade on Circle" CTA when blocked, deep-linking back to `app.alpcontractorcircle.com/aos/seats`
4. **Refresh limits on every SSO** — Circle is the source of truth. If a user's Circle subscription changes, the next SSO carries the new numbers.
5. **Handle the snapshot endpoint** the same way (the `/api/public/circle/snapshot` HMAC channel currently used by the portal home page).

I can't touch any of that code from this project — you (or the AOS-project AI) implements it there.

---

## Order of operations

1. **You decide AOS-only pricing** + create the 3 prices in Stripe (this unblocks the rest)
2. **You add the 3 new price-ID secrets**
3. **I build the Circle-side changes** (tier enum, limits function, SSO token, UI, webhook mapping)
4. **You hand the AOS spec doc to the AOS project** and have its AI implement the verify endpoint changes + enforcement UI
5. **End-to-end test:** book buyer signs up → sees "1 workspace · 2 seats" on the AOS button → clicks → lands in AOS → can invite 1 more seat, 3rd is blocked

---

## Technical notes

### DB changes (one migration)
- `ALTER TYPE app_tier ADD VALUE 'aos_only' BEFORE 'book_buyer'`
- `public.get_user_aos_limits(uid uuid)` returning a composite of `(tier, workspace_limit int, seat_limit int)`. Reads from `subscriptions` (active or comped), takes max of limits across rows. Hardcoded defaults per tier; AOS-only reads `metadata->>'seats'` and `metadata->>'workspaces'`.
- `public.tier_rank` updated so `aos_only = 0` (below book_buyer)

### Webhook (`src/routes/api/public/stripe/webhook.ts`)
- Add price ID → tier mapping for AOS-only
- On `customer.subscription.created` / `.updated`, read the line items: if any are the extra-seat or extra-workspace price, write `quantity` into `subscriptions.metadata.seats` / `.workspaces`
- If the user has separate base + add-on subscriptions, that's fine — `get_user_aos_limits` aggregates across rows

### Server function changes
- `src/lib/aos.functions.ts`: `mintAosSsoToken` reads `get_user_aos_limits` and includes `tier`, `workspace_limit`, `seat_limit` in the signed payload
- Same function: the `getAosSnapshot` HMAC string stays as-is (snapshot is read-only, no enforcement needed there)

### Frontend
- `/aos` page: gate changes from "Circle only" to "seat_limit > 0", show allowance under the button
- New `/aos/seats` page (or section in `/upgrade`): "Add seat" / "Add workspace" Stripe Checkout buttons, plus tier-upgrade CTAs
- `useTier` hook gains a `useAosLimits` sibling

### Files I'll touch
- `supabase/migrations/<new>.sql` — enum value, new function, tier_rank update
- `src/lib/aos.functions.ts` — extended SSO token
- `src/routes/api/public/stripe/webhook.ts` — new price ID mapping + quantity capture
- `src/hooks/use-aos-limits.ts` — new hook
- `src/routes/aos.index.tsx` — looser gate, allowance display
- `src/routes/aos.seats.tsx` — new buy-more page
- `src/components/portal/aos-hero.tsx` — show allowance
- `docs/aos-tier-spec.md` — spec to hand to the AOS project

### Files I'll NOT touch
- Anything in the AOS project (different Lovable project)
- The existing book-buyer / intensive / Circle Stripe price IDs
- The signup flow (already works for the new tier)

---

## Open question before I build

You said *"I have to figure out what that cost is and set that up in Stripe."* Two things I need from you before step 3:

1. The 3 new Stripe price IDs (after you create them)
2. A decision on whether AOS-only buyers get the handbook too, or strictly AOS access only. (Affects whether `aos_only` ranks above or below `book_buyer` for handbook-reading RLS — current plan ranks it below, i.e. no handbook access. Easy to flip.)

Ready to implement once you give me the green light + those answers.
