## Fix "Best value" placement on /work-with-marshall

You're right — I put the badge on the middle card for visual balance, not based on the math. $833/session (6-pack) beats $1,000/session (3-pack) by a clear margin.

### Changes

**`src/routes/work-with-marshall.tsx`**
- Move `badge: "Best value"` from the 3-call pack to the 6-call pack.
- Make the highlighted (dark `bg-ink`) card the **6-call pack** (rightmost) instead of the middle one. The "best value" card should be the visually primary one.
- 3-call pack becomes a standard light card.

**`src/lib/upsell-catalog.ts`**
- Same swap: move the `badge: "Best value"` from `call_3.plans[0]` to `call_6.plans[0]` so it's consistent anywhere call packs surface (e.g. /upgrade cards).

### Not changing
- Prices, copy, per-session math (already correct).
- Card order (1 → 3 → 6 stays left-to-right as a price ladder).
- Anything in billing, webhook, or Stripe wiring.
