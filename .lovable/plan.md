## What's changing

Three coordinated changes across the portal. AOS-side seat/workspace pricing stays out of scope (you'll do that in the AOS project later).

---

### 1. Replace "Six-Week Intensive" with "Work with Marshall" call packages

Today there's one $5,000 Intensive product. We replace it with three SKUs so the price ladder feels lighter and members can self-select depth:

| Package | Sessions | Suggested price (you confirm) |
|---|---|---|
| Single Call | 1 × 60 min | $750 |
| Three Call Pack | 3 × 60 min | $2,000 |
| Six Call Pack | 6 × 60 min | $3,750 |

Changes:
- `/work-with-marshall` becomes a 3-card page (replaces single Intensive card).
- Add 3 new Stripe prices: `STRIPE_PRICE_ID_CALL_1`, `STRIPE_PRICE_ID_CALL_3`, `STRIPE_PRICE_ID_CALL_6`. You'll create these in Stripe and we add them as secrets.
- New server fn `createCallPackCheckout` in `src/lib/billing.functions.ts` (keep `createIntensiveCheckout` for any legacy in-flight links; mark deprecated).
- Stripe webhook maps any of the 3 new price IDs to a new tier label `marshall_calls` OR we keep treating these as one-time service purchases that don't change tier (recommended — they're consulting, not access). I'd recommend **no tier change** on purchase; just record the entitlement in `subscriptions.metadata.calls_remaining`.
- Sidebar label changes from "Intensive" → "Work with Marshall".

### 2. Tier-specific upsell rails on `/upgrade` + sidebar

Rebuild `/upgrade` to show only what makes sense for the viewer's tier:

| Viewer tier | Cards shown on `/upgrade` |
|---|---|
| `aos_only` | Book Buyer → Contractor Circle → Work with Marshall |
| `book_buyer` | **Contractor Circle (primary)** → Power Hour → S&M School → Work with Marshall |
| `power_hour` | Contractor Circle (primary) → S&M School → Work with Marshall |
| `sm_school` | Contractor Circle (primary) → Power Hour → Work with Marshall |
| `intensive` | Contractor Circle (primary) → Work with Marshall |
| `circle` | Power Hour → S&M School → Hardcore → Work with Marshall |
| `hardcore` | Work with Marshall only |

Sidebar:
- Circle members get a new "Add-ons" section linking to /upgrade with Power Hour + S&M School cards visible.
- Book buyers' "Go further" still points to /upgrade but Circle becomes the headline card.

Stripe prices needed (placeholder secrets to add later): `STRIPE_PRICE_ID_POWER_HOUR`, `STRIPE_PRICE_ID_SM_SCHOOL`, `STRIPE_PRICE_ID_HARDCORE`. Webhook maps each to its tier.

### 3. Hardcore tease + locked replay shelves

**Hardcore in sidebar (all non-hardcore tiers):**
- New "Hardcore" group at the bottom of the sidebar, single grayed-out item with a small lock icon, label "Hardcore Room". Clicking opens `/upgrade` scrolled to the Hardcore card.
- Tooltip: "Daily Power Hour, S&M School, Contractor School. Upgrade to unlock."
- For Hardcore members: same item appears in full color and links to `/hardcore`.

**Replays page:**
- Render all 4 category shelves always (Circle Calls, Power Hour, S&M School, Contractor School).
- For shelves the viewer can't access: show 3 ghost cards with a centered "Unlock [Category] — $X/mo" CTA button overlay. No titles/thumbnails of actual content.
- Tier-to-shelf visibility stays governed by existing `can_read_replay_category` RLS — we just stop hiding the locked shelves in the UI.

---

## File changes

```text
src/routes/work-with-marshall.tsx        — 3-card layout
src/routes/upgrade.tsx                    — tier-aware card filtering
src/routes/replays.tsx                    — render locked shelves with upsell
src/components/portal/app-sidebar.tsx    — grayed Hardcore item + Circle add-ons section
src/lib/billing.functions.ts              — new createCallPackCheckout, createPowerHourCheckout, createSmSchoolCheckout, createHardcoreCheckout
src/routes/api/public/stripe/webhook.ts  — map new price IDs to tiers/entitlements
```

No DB migrations needed — `app_tier` enum already includes `power_hour`, `sm_school`, `hardcore`.

---

## What I need from you before I build

1. **Confirm call-pack pricing** (or give me your numbers).
2. **Confirm "calls don't change tier"** — they're consulting, recorded in `subscriptions.metadata.calls_remaining`. Means a Circle member buying 3 calls stays a Circle member with 3 calls in the bank.
3. **Stripe prices for Power Hour / S&M School / Hardcore** — give me $/mo for each, or I'll put placeholder amounts in the card UI marked "Pricing TBD" and you can fill in Stripe when ready.
4. **AOS seat/workspace upsell** — confirmed deferred to the AOS project. I'll leave a stub note in `/upgrade` for `aos_only` viewers ("Need more seats? Manage in AOS →") with no checkout.

Reply with the four answers and I'll execute.
