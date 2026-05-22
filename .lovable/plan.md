## Add `return_to` support to the portal `/upgrade` flow

Goal: when AOS deep-links a blocked user to `https://app.alpcontractorcircle.com/upgrade?tier=...&return_to=https://aos.alpcontractorcircle.com/workspaces/new`, the portal remembers the destination and bounces the user back there after successful Stripe checkout.

### 1. Validate `return_to` on the upgrade page (`src/routes/upgrade.tsx`)

- Add Zod-validated search params via `validateSearch` so `tier` and `return_to` are typed.
- Sanitize `return_to`: only accept absolute URLs whose host ends in `alpcontractorcircle.com` (covers `aos.alpcontractorcircle.com` and any future subdomain). Drop anything else silently.
- Persist the sanitized value in `sessionStorage` under `alp.cc.returnTo` on mount so it survives the Stripe round-trip (Stripe strips our query string on return).
- Pass `returnTo` into every checkout handler call.

### 2. Thread `returnTo` through the checkout server functions (`src/lib/billing.functions.ts`)

- Add an optional `returnTo: z.string().url().optional()` to the input validators of `createCircleCheckout` and `createSkuCheckout`.
- Re-validate host on the server (same allowlist) — never trust the client.
- When present, append `&return_to=<encoded>` to the existing `success_url` so the success route can read it. Cancel URL stays on `/upgrade` and the client already has it in sessionStorage.

### 3. Honor `return_to` after success

Two success destinations are in play today:
- Circle: `success_url = /?circle=welcome`
- All SKU upsells: `success_url = /?upsell=<product>`

Both land on `src/routes/index.tsx`. Add a tiny effect there:
- On mount, if URL has `return_to` OR `sessionStorage` has `alp.cc.returnTo`, validate the host again, clear the storage key, and `window.location.replace(returnTo)`.
- Show a one-line toast "Welcome — sending you back to AOS…" before the redirect so it doesn't feel abrupt.

### 4. Update the AOS prompt in `.lovable/plan.md`

- Change the upgrade CTA section to show the new URL shape: `https://app.alpcontractorcircle.com/upgrade?tier=<tier>&return_to=<encoded AOS URL>`.
- Note that the portal only honors `return_to` values on `*.alpcontractorcircle.com`.

### Technical notes

- Host allowlist lives in a single `isAllowedReturnTo(url: string): string | null` helper in `src/lib/return-to.ts` so both the route and the server functions import the same logic.
- No DB changes, no new tables, no Stripe webhook changes — `return_to` is purely a client/redirect concern.
- Existing `?circle=cancelled` / `?upsell=cancelled` banners on `/upgrade` keep working because the user lands back on `/upgrade` with the sessionStorage key still set.

### Out of scope

- No changes to the Stripe webhook or `subscriptions` table.
- No tier-specific landing pages on the portal.
- AOS-side changes (AOS just needs to include the `return_to` param when it builds the upgrade link — covered in the prompt update).