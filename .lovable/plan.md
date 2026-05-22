## The gap

Today, tier flows Circle → AOS **only inside the signed SSO token** generated when a member clicks into AOS from the portal. If a member signs into AOS directly (Google, password, magic link on the AOS site), AOS never sees a token and falls back to whatever it has stored — usually base/no-tier — so Circle privileges don't apply.

Ken hitting AOS directly is exactly this case.

## Fix

Add a **pull-based** tier lookup so AOS can re-sync any user from Circle on demand, no SSO required.

### 1. New Circle endpoint — `POST /api/public/aos/tier-lookup`

- Auth: HMAC of the request body using `AOS_SHARED_SECRET` (same secret already shared), in an `X-AOS-Signature` header. Same pattern as the SSO token signing string, just over the JSON body. Reject anything older than 60s (timestamp in body).
- Input: `{ email, ts, nonce }`
- Output: `{ tier, workspaceLimit, seatLimit }` — exactly the values `get_user_aos_limits` would return for that email. `-1` = unlimited.
- Behavior: lowercase + trim email, look up via existing `get_user_aos_limits` logic (extended to accept an email when there's no `user_id` yet — same email-match path the function already uses).
- No PII beyond what's asked; never returns user lists.

### 2. AOS-side changes (separate project — spec doc only, no code in this repo)

Update `docs/aos-tier-spec.md` with a new section:

> **On every AOS sign-in (and ideally on session refresh), call `POST https://app.alpcontractorcircle.com/api/public/aos/tier-lookup` with the user's email. Use the returned `{tier, workspaceLimit, seatLimit}` to overwrite the cached caps in AOS's own user record.** This makes Circle the source of truth even when the user never SSOs.

Hand that updated doc to the AOS project so Codex/AI can wire the call.

### 3. Immediate unblock for Ken

Independent of the endpoint work, confirm Ken's AOS account uses `ken@gmworksonline.com`. If yes, the tier-lookup will resolve him as Circle the moment AOS adopts step 2. If his AOS account is under a different email, he needs to either:
- change his AOS email to `ken@gmworksonline.com`, **or**
- use `/aos/link` from the Circle portal to bind his alt AOS email to his Circle account (the `aos_links` table already supports this; `get_user_aos_limits` would need a small extension to also match via `aos_links.aos_email`, which I'd include in the same migration if you want belt-and-suspenders).

## Technical detail

```text
File changes (Circle repo):
  + src/routes/api/public/aos/tier-lookup.ts   # new endpoint
  ~ src/lib/aos.functions.ts                   # extract shared lookup helper
  ~ supabase migration                         # overload get_user_aos_limits(_email text)
                                               #   + optional aos_links email match
  ~ docs/aos-tier-spec.md                      # new "Pull-based tier sync" section
```

No client UI changes. No new secrets. Reuses `AOS_SHARED_SECRET`.

## Out of scope

- Building the AOS-side caller (that's the AOS project's job; the spec doc tells them what to do).
- Auto-merging duplicate emails between AOS and Circle.
