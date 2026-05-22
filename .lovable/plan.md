## What changes

### 1. Portal `/aos` — modal instead of inline panel

Right now `/aos` renders the `AosAddonsPanel` inline (book-buyer only), buried below the seat-count line. Replace that with a single line of UI on the seat-count row:

> `1 workspace · 2 seats · Upgrade · Add seats or workspaces →`

Clicking "Add seats or workspaces" opens a Radix Dialog containing the existing `AosAddonsPanel` (steppers + Stripe checkout). No business-logic changes — same `createAosAddonCheckout` flow, same Stripe pricing ($9.99/seat/mo, $25/workspace/mo).

Same modal trigger also drops onto `/upgrade` (replacing the inline panel buried at the bottom), so book buyers have one consistent entry point in both places.

### 2. Remove the inline panel from `/upgrade`

Take `<AosAddonsPanel />` out of the bottom of `/upgrade`. The add-ons entry on `/upgrade` becomes the same compact "Add seats or workspaces" affordance, in the page intro near the heading where it's visible without scrolling.

### 3. External AOS app → portal Stripe handoff

The AOS app lives on a subdomain and doesn't have access to the portal's Stripe. The cleanest pattern:

- Add a portal route `/aos/add-capacity?kind=seat|workspace&return_to=<aos_url>` that auto-opens the same modal on mount.
- In the AOS app, the "Add seats" / "Add workspace" buttons link to that portal URL (open in same tab; user is already SSO-linked to the portal).
- After Stripe checkout success, the existing webhook updates `aos_addons`, `get_user_aos_limits` reflects the new count, and we redirect back to `return_to` (the AOS app URL).

`return_to` is already validated by `isAllowedReturnTo()` and `createAosAddonCheckout` already accepts a `returnTo` param, so no backend changes needed — just the new route and the deep-link wiring.

### Technical notes

- **New file:** `src/components/portal/aos-addons-modal.tsx` — Dialog wrapper around `AosAddonsPanel`, exposes `<AosAddonsTrigger />` (the link) and accepts a controlled `open` prop for deep-link auto-open.
- **Edit `src/routes/aos.index.tsx`:** remove the inline `<AosAddonsPanel />` block; on the seat-count line, append the trigger link for book buyers.
- **Edit `src/routes/upgrade.tsx`:** remove the bottom `<AosAddonsPanel />`; add the same trigger link near the header for book buyers.
- **New route:** `src/routes/aos.add-capacity.tsx` — minimal page that renders the modal opened, reads `?kind` and `?return_to` from search params, persists `return_to` via existing `RETURN_TO_STORAGE_KEY`, and closes back to `/aos` on dismiss.
- **AOS app side:** out of scope for this repo, but document the URL contract in `docs/aos-sso-endpoint.md` so the AOS team can wire their "Add seats" button to `https://app.alpcontractorcircle.com/aos/add-capacity?kind=seat&return_to=<encoded-aos-url>`.

No DB migration, no new Stripe products, no webhook changes.
