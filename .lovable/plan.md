## What's going on

The "Connect your AOS" card on the dashboard is gated behind an AOS snapshot check:

```
{!aosUnknown && !aosLinked && <AosHero ... />}
```

`aosData` comes from a `useQuery` that calls the `getAosSnapshot` server function. That server function is a `POST`, and every POST now goes through the `csrfOriginGuard` middleware added in `src/start.ts`:

```ts
if (originHost !== url.host) {
  return new Response("Cross-origin request blocked", { status: 403 });
}
```

In the Lovable preview, the browser origin is `…lovableproject.com` while the server function is served from `…lovable.app`. The hosts don't match → every authenticated server fn POST returns 403 → `aosData` stays `undefined` → `aosUnknown` stays `true` → the AosHero (Start AOS / pick workspace / "connect existing") never renders. The AOS gateway page (`/aos`) throws the same error visibly (the one captured in runtime errors).

This isn't an AOS problem — it's a same-origin guard that's too strict for our hosting setup. Mlee, custom-domain users, and the preview are all affected.

## Fix

Soften `csrfOriginGuard` in `src/start.ts` so legitimate same-site traffic isn't blocked, while still rejecting true cross-site POSTs.

Approach: accept the request when any of these are true:
1. `Sec-Fetch-Site` header is `same-origin` or `same-site` (set by every modern browser, cannot be forged by cross-site attackers).
2. The Origin/Referer host matches `url.host` (current behavior).
3. The Origin/Referer host is one of our trusted hosts: `*.lovable.app`, `*.lovableproject.com`, and the configured custom domain(s) (`app.alpcontractorcircle.com`, `contractor-command.lovable.app`).

Only block when none of the above hold. Keep the existing bypass for `/api/public/*` and `/lovable/*`.

This restores the dashboard AOS hero, fixes the `/aos` gateway error, and keeps the CSRF defense-in-depth (`requireSupabaseAuth`'s Bearer check is still the primary auth gate).

## Files to change

- `src/start.ts` — rewrite `csrfOriginGuard` per the rules above.

## Out of scope

- No changes to `getAosSnapshot`, the dashboard layout, AosHero, or AosFeatureSubmit.
- No DB or RLS changes.
