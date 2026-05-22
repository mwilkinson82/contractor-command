## The bug

Bryan (`bryan@marshallwilkinson.com`) is `tier=hardcore`, `is_comped=true`, `status=active`. But the DB function `get_user_aos_limits` only has branches for `circle`, `intensive`, `book_buyer`, and `aos_only` — **there is no `hardcore` branch**. So for Bryan it falls through with `workspace_limit=0` and `seat_limit=0`.

Downstream effects on `/aos`:
- `useAosLimits().hasAccess` is `false` → "Enter AOS" button is disabled, status row shows "Your plan doesn't include AOS access yet."
- The "X workspaces · Y seats" pill never renders (gated on `hasAccess`).
- The sub-copy he sees is the generic Circle/unlimited line, but with no working button — which lines up with him reading the page as "it doesn't say unlimited / says seats are waiting."

`hardcore` should behave the same as `circle` (unlimited workspaces + seats).

## Fix

Migration: update `public.get_user_aos_limits` so the loop treats `hardcore` like `circle` — set `v_has_unlimited := true`. No other logic changes.

```sql
-- inside the FOR r LOOP body
IF r.tier IN ('circle', 'hardcore') THEN
  v_has_unlimited := true;
ELSIF r.tier = 'intensive' THEN ...
```

When `v_has_unlimited` is true, the function already returns `workspace_limit = -1`, `seat_limit = -1`, which `useAosLimits` interprets as unlimited.

## Verify

1. Re-run `select * from get_user_aos_limits('<bryan-user-id>')` — expect `workspace_limit = -1`, `seat_limit = -1`.
2. Impersonate `hardcore` via the admin tier switcher on `/aos` and confirm: button enabled, pill reads "Unlimited workspaces · Unlimited seats", sub-copy is the unlimited line.

## Out of scope

No frontend changes needed — the `/aos` copy already branches correctly for non-book-buyer tiers, and `useTier` already knows about `hardcore`. This is purely a DB function gap.
