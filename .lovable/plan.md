Paste the block below into the AOS Lovable project as a single message. It tells AOS (1) how the portal is the source of truth for tier + seat caps, (2) what to enforce, (3) where to send users to upgrade, and (4) how to bounce them back after they pay.

---

## Prompt to paste into the AOS project

> We're wiring AOS up to the Contractor Command portal. The portal owns billing, tier, and entitlement. AOS reads entitlement from the portal's database and enforces seat + workspace caps. There is no billing UI in AOS.

### Source of truth

- Portal Supabase project ref: `qcbbjjjxcacrscfhgfmf` (same Supabase auth, shared `auth.users`).
- Entitlement function: `public.get_user_aos_limits(_user_id uuid) returns (tier app_tier, workspace_limit int, seat_limit int)`
  - `workspace_limit = -1` and `seat_limit = -1` mean **unlimited**.
  - Admins always resolve to `circle / -1 / -1`.
  - It's `STABLE SECURITY DEFINER` — call from any authenticated session: `supabase.rpc('get_user_aos_limits', { _user_id: user.id })`.
- Tier enum: `aos_only | book_buyer | power_hour | sm_school | contractor_school | intensive | circle | hardcore`.

### Tier → AOS entitlement table

```text
Tier               Portal price                AOS workspaces   AOS seats     Notes
-----------------  --------------------------  ---------------  ------------  -------------------------------------------
aos_only           standalone SKU (TBD)        1 + metadata     1 + metadata  Caps stack from subscriptions.metadata.workspaces / .seats
book_buyer         $47 one-time (Handbook)     1                2             Entry tier; ships with the book
power_hour         $997/mo or $2,997/qtr       inherits         inherits      Add-on, no extra AOS caps of its own
sm_school          $497/mo or $1,497/qtr       inherits         inherits      Add-on, no extra AOS caps
contractor_school  $497/mo or $1,497/qtr       inherits         inherits      Add-on, no extra AOS caps
intensive          6-week intensive            2                6             Granted for the duration of the cohort
circle             Contractor Circle           UNLIMITED        UNLIMITED     Flagship recurring tier
hardcore           ALP Hardcore (pricing TBD)  UNLIMITED        UNLIMITED     Superset of circle + all schools
```

Rules the portal already enforces and AOS must mirror:

1. Caps **stack via `GREATEST`**, they do not sum. Holding both `book_buyer` and `intensive` => `max(1,2)=2` workspaces and `max(2,6)=6` seats.
2. `circle` or `hardcore` anywhere on the account => unlimited, period.
3. `aos_only` contributes `1 + metadata.workspaces` and `1 + metadata.seats` (a comped row with `{workspaces: 2, seats: 4}` yields 3 workspaces and 5 seats).
4. Only `status in ('active','trialing')` OR `is_comped = true` rows count.

### What to build in AOS

1. **Entitlement hook** — on session load, call `get_user_aos_limits(auth.uid())` and cache `{tier, workspaceLimit, seatLimit}` in a context. Treat `-1` as unlimited.
2. **Workspace create guard** — before insert, count the user's existing workspaces; block if `workspaceLimit !== -1 && count >= workspaceLimit`.
3. **Seat invite guard** — before sending an invite, count active seats **against the workspace owner's plan**, not the inviter's. Block if `seatLimit !== -1 && count >= seatLimit`. (A Book Buyer's workspace has 2 seats total no matter who does the inviting.)
4. **Upgrade CTA** — when a guard blocks, link the user out to the portal with their current tier and a `return_to` so we can bounce them back after payment:

   ```
   https://app.alpcontractorcircle.com/upgrade?tier=<currentTier>&return_to=<encoded AOS URL>
   ```

   - `return_to` must be an absolute `https://` URL on `*.alpcontractorcircle.com` (e.g. `https://aos.alpcontractorcircle.com/workspaces/new`). The portal silently drops anything else.
   - After successful Stripe checkout the portal shows a brief "sending you back to AOS…" toast and `window.location.replace`s the user back to `return_to`.
   - If the user cancels checkout they stay on `/upgrade` with the `return_to` cached in `sessionStorage`, so retrying works without re-passing the param.
5. **Realtime cap refresh** — subscribe to `public.subscriptions` filtered by `user_id` and re-call `get_user_aos_limits` on any change so an upgrade in another tab takes effect immediately.
6. **Admin bypass UI** — if `tier === 'circle'` and both limits are `-1`, hide cap counters entirely.

### What NOT to build in AOS

- No billing UI, no Stripe, no checkout, no pricing pages. The portal owns all of that.
- No tier upgrades, no comp logic, no seat top-ups inside AOS. The portal grants; AOS reads.
- No separate user table. Use the shared Supabase auth — the portal's `handle_new_user` trigger already creates a `profiles` row on signup.
- No edge functions for entitlement. The RPC is enough.

### Open items to confirm with Marshall before shipping

- Standalone `aos_only` price (the portal currently only grants AOS access bundled with `book_buyer` or higher — no AOS-only SKU is live yet).
- Whether `intensive` cohort seats expire at the end of the 6 weeks or persist (`current_period_end` is the natural cutoff).
- Final `hardcore` price once it moves off "TBD".

### Technical reference

- `subscriptions.metadata` jsonb shape for `aos_only` adders: `{ "workspaces": <int>, "seats": <int> }`.
- The portal's `/upgrade` route already validates `return_to` host (`*.alpcontractorcircle.com` only) and persists it through the Stripe round-trip in `sessionStorage` under `alp.cc.returnTo`. AOS does not need to do anything beyond constructing the URL.

---

That's the entire AOS message. Once you send it, AOS only needs the portal's Supabase project ref (already in the prompt) plus its anon key (already provisioned because both projects share the same Supabase project) to wire up the RPC call.