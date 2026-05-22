Paste the block below into the AOS Lovable project. It tells AOS what the portal sells, what each tier unlocks in AOS (workspaces + seats), how to read entitlement at runtime, and what to do when a user tries to exceed their cap.

---

## Prompt to paste into the AOS project

> We're wiring AOS up to the Contractor Command portal. The portal owns billing and entitlement; AOS reads it and enforces seat + workspace caps. Build the gating to match the tier table below.

### Source of truth

- Portal Supabase project: `qcbbjjjxcacrscfhgfmf`
- Entitlement function: `public.get_user_aos_limits(_user_id uuid) returns (tier app_tier, workspace_limit int, seat_limit int)`
  - `workspace_limit = -1` and `seat_limit = -1` mean unlimited
  - Admins always return `circle / -1 / -1`
- Tier enum: `aos_only | book_buyer | power_hour | sm_school | contractor_school | intensive | circle | hardcore`
- The portal also exposes the user's email via the JWT; AOS should match by `auth.uid()` first, then by lowercased email fallback (same logic the function already uses).

### Tier → AOS entitlement table

```text
Tier               Price (portal)              AOS workspaces   AOS seats     Notes
-----------------  --------------------------  ---------------  ------------  -------------------------------------------
aos_only           standalone SKU (TBD)        1 + metadata     1 + metadata  Caps stack from subscriptions.metadata.workspaces / .seats
book_buyer         $497 one-time (Handbook)    1                2             Entry tier; ships with the book
power_hour         $997/mo or $2,997/qtr       inherits         inherits      Add-on, no extra AOS caps of its own
sm_school          $497/mo or $1,497/qtr       inherits         inherits      Add-on, no extra AOS caps
contractor_school  $497/mo or $1,497/qtr       inherits         inherits      Add-on, no extra AOS caps
intensive          6-week intensive            2                6             Granted for the duration of the cohort
circle             Contractor Circle membership UNLIMITED       UNLIMITED     Flagship recurring tier
hardcore           ALP Hardcore (pricing TBD)  UNLIMITED        UNLIMITED     Superset of circle + all schools
```

Rules the portal already enforces and AOS must mirror:

1. Caps **stack via GREATEST**, they do not sum. A user who holds both `book_buyer` and `intensive` gets `max(1,2)=2` workspaces and `max(2,6)=6` seats.
2. `circle` or `hardcore` anywhere on the account => unlimited, period.
3. `aos_only` adds `1 + metadata.workspaces` and `1 + metadata.seats` (so a comped row with `{workspaces: 2, seats: 4}` yields 3 workspaces and 5 seats).
4. Only `status in ('active','trialing')` OR `is_comped = true` rows count.

### What to build in AOS

1. **Entitlement hook**: on session load, call `get_user_aos_limits(auth.uid())` and cache `{tier, workspaceLimit, seatLimit}` in a context. Treat `-1` as unlimited.
2. **Workspace create guard**: before insert, count the user's existing workspaces; block if `workspaceLimit !== -1 && count >= workspaceLimit`.
3. **Seat invite guard**: before sending an invite, count active seats across all their workspaces; block if `seatLimit !== -1 && count >= seatLimit`.
4. **Upgrade CTA**: when a guard blocks, link out to `https://app.alpcontractorcircle.com/upgrade` (not an in-AOS paywall) and include the current `tier` as a query param so the portal can highlight the right card.
5. **Admin bypass**: if `tier === 'circle'` and both limits are `-1`, hide caps from the UI entirely.

### What NOT to build in AOS

- No billing UI, no Stripe, no checkout. The portal owns all of that.
- No tier upgrades, no comp logic, no seat top-ups. If they need more seats, they upgrade in the portal and AOS picks it up on next session refresh.
- No separate user table. Use the shared Supabase auth; the portal's trigger `handle_new_user` already creates a profile row on signup.

### Open items to confirm with Marshall before shipping

- Standalone `aos_only` price (the portal currently only grants AOS access as part of `book_buyer` or higher — there's no AOS-only SKU live yet).
- Whether `intensive` cohort seats expire at the end of the 6 weeks or persist (`current_period_end` is the natural cutoff).
- Final `hardcore` price once it moves off "TBD".

---

## Technical section (for the AOS agent's reference)

- The portal's `get_user_aos_limits` is `STABLE SECURITY DEFINER`, safe to call from any authenticated session over PostgREST RPC: `supabase.rpc('get_user_aos_limits', { _user_id: user.id })`.
- The `subscriptions.metadata` jsonb shape used by `aos_only` adders: `{ "workspaces": <int>, "seats": <int> }`.
- If AOS needs realtime cap changes (e.g. user just upgraded in another tab), subscribe to `public.subscriptions` filtered by `user_id` and re-fetch limits on any change.
