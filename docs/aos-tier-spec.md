# Circle → AOS tier handoff (spec for the AOS project)

This is a spec for the AOS Lovable project. The Circle portal (this repo, `app.alpcontractorcircle.com`) has been updated to pass each user's **tier** and **AOS allowance** (workspaces + seats) in the signed SSO token. AOS needs to consume those fields and enforce the caps.

Hand this whole doc to the AOS-project AI in a single chat message.

---

## Background

Circle members buy access on Stripe and get one of four tiers:

| Circle tier | AOS workspaces | AOS seats |
|---|---|---|
| `aos_only` (public, per-seat purchase) | 1 + extras purchased | 1 + extras purchased |
| `book_buyer` (came with the ALP Handbook) | 1 | 2 |
| `intensive` (6-week intensive grads) | 2 | 6 |
| `circle` (Contractor Circle members) | unlimited (sent as `-1`) | unlimited (sent as `-1`) |

Circle is the **source of truth** for tier and allowance. On every SSO into AOS, Circle re-computes the user's caps and signs them into the token. AOS trusts the signed values (HMAC-verified) and enforces them.

---

## What changed in the SSO token

### Old shape (still being honored — see migration plan below)

```
token = "{email}.{ts}.{nonce}.{sig}"
sig   = HMAC_SHA256(AOS_SHARED_SECRET, "{email}|{ts}|{nonce}")
```

### New shape (live on Circle now)

```
token = "{email}.{ts}.{nonce}.{tier}.{workspace_limit}.{seat_limit}.{sig}"
sig   = HMAC_SHA256(AOS_SHARED_SECRET, "{email}|{ts}|{nonce}|{tier}|{workspace_limit}|{seat_limit}")
```

Where:
- `email` — URL-encoded, lowercased
- `ts` — Unix timestamp in seconds (string). Reject if older than 60s.
- `nonce` — random opaque string (Circle dedupes elsewhere; AOS may also dedupe)
- `tier` — one of `aos_only`, `book_buyer`, `intensive`, `circle`, or empty string if the user has no active subscription (treat empty as `aos_only` for safety, or reject — your call)
- `workspace_limit` — integer string. `-1` means unlimited. `0` means no AOS access (should not happen on a successful sign-in; reject the token if you see 0).
- `seat_limit` — same convention

The signing string concatenates with `|`. The token itself joins fields with `.`. URL-encode `email` and `tier` before assembling the token; decode after splitting.

---

## What AOS needs to implement

### 1. Update `/api/public/circle/sso` to verify the new token shape

In `src/routes/api/public/circle/sso.ts` (or wherever the handler lives):

```ts
// Pseudocode — adapt to your handler's actual style.
const parts = token.split(".");
if (parts.length !== 7) {
  return new Response("Invalid token shape", { status: 400 });
}
const [emailEnc, ts, nonce, tierEnc, wsLimitStr, seatLimitStr, sig] = parts;

// Verify timestamp window (replay protection)
const tsNum = Number(ts);
if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 60) {
  return new Response("Token expired", { status: 401 });
}

// Verify HMAC
const email = decodeURIComponent(emailEnc).toLowerCase().trim();
const tier = decodeURIComponent(tierEnc);
const workspaceLimit = Number(wsLimitStr); // -1 = unlimited
const seatLimit = Number(seatLimitStr);

const signingString = `${email}|${ts}|${nonce}|${tier}|${workspaceLimit}|${seatLimit}`;
const expected = createHmac("sha256", process.env.AOS_SHARED_SECRET!)
  .update(signingString)
  .digest("hex");

if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
  return new Response("Bad signature", { status: 401 });
}

if (seatLimit === 0) {
  return new Response("No AOS access on this plan", { status: 403 });
}
```

### 2. Find-or-create the user, persist the caps

After signature verification:

```ts
// Find or create user by email (lowercased)
let user = await findUserByEmail(email);
if (!user) {
  user = await createUser({
    email,
    user_metadata: { provisioned_by: "circle_sso" },
  });
  // Auto-create their first workspace
  await createWorkspace({ owner_user_id: user.id, name: "My workspace" });
}

// Always overwrite caps on every SSO — Circle is the source of truth.
// If their plan changed, the next SSO carries the new numbers.
await upsertUserPlan({
  user_id: user.id,
  tier,                              // store the raw string
  workspace_limit: workspaceLimit,   // -1 = unlimited
  seat_limit: seatLimit,             // -1 = unlimited
  source: "circle",
  updated_at: new Date(),
});
```

Schema suggestion for AOS:

```sql
create table if not exists public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null,
  workspace_limit integer not null,  -- -1 = unlimited
  seat_limit integer not null,       -- -1 = unlimited
  source text not null default 'circle',
  updated_at timestamptz not null default now()
);
alter table public.user_plans enable row level security;
create policy "own plan read" on public.user_plans
  for select using (auth.uid() = user_id);
```

### 3. Enforce the caps in AOS

Two enforcement points:

#### a) "Create new workspace" button

Before creating a workspace owned by the user:

```ts
const plan = await getUserPlan(userId);
const ownedCount = await countWorkspacesOwnedBy(userId);

if (plan.workspace_limit !== -1 && ownedCount >= plan.workspace_limit) {
  throw new Error("Workspace limit reached. Upgrade on Circle to add more.");
}
```

UI: disable the "New workspace" button when `ownedCount >= workspace_limit` and show:

> You've used all **N** workspaces on your plan.
> [Upgrade on Circle →](https://app.alpcontractorcircle.com/upgrade)

#### b) "Invite seat" button (per workspace)

Before sending an invite or accepting the first sign-in of an invited user:

```ts
const workspace = await getWorkspace(workspaceId);
const ownerPlan = await getUserPlan(workspace.owner_user_id);
const seatCount = await countSeatsIn(workspaceId); // includes the owner

if (ownerPlan.seat_limit !== -1 && seatCount >= ownerPlan.seat_limit) {
  throw new Error("Seat limit reached. Upgrade on Circle to add more.");
}
```

Important: count seats against the **workspace owner's** plan, not the inviter's. (A book buyer's workspace has 2 seats total, regardless of which seat does the inviting.)

UI: disable the "Invite" button when `seatCount >= seat_limit` and show:

> This workspace has all **N** seats filled.
> [Upgrade the workspace owner's plan on Circle →](https://app.alpcontractorcircle.com/upgrade)

### 4. Apply the same change to `/api/public/circle/snapshot`

The snapshot endpoint (used by the Circle home page to pull a member's AOS pulse) is currently a 3-field HMAC. **Leave the snapshot endpoint alone** — it's read-only and doesn't need the caps. Circle is not changing the snapshot signing string in this iteration.

---

## Migration / backwards compatibility

For the first 24 hours after AOS deploys the new verifier, the Circle portal will be sending the **new** token shape only. If you want a grace period where both old (4-field) and new (7-field) tokens verify, check `parts.length`:

```ts
if (parts.length === 4) {
  // Legacy path: email|ts|nonce signing, no caps. Treat user as
  // unlimited (admin-only fallback) OR reject. Recommend: reject after
  // a 24h grace window.
} else if (parts.length === 7) {
  // New path — verify caps as above
}
```

After AOS ships, please confirm here in writing so Circle can drop the legacy code path on its side if any remains.

---

## Test plan

1. **Book buyer** (Circle tier = `book_buyer`):
   - Token shows `workspace_limit=1, seat_limit=2`
   - First SSO: auto-creates user + 1 workspace, persists caps
   - Invite a 2nd seat → succeeds
   - Try to invite a 3rd seat → blocked with upgrade CTA
   - Try to create a 2nd workspace → blocked
2. **Intensive grad** (`intensive`): 2 workspaces / 6 seats — same flow, blocked at 7th seat / 3rd workspace
3. **Circle member** (`circle`): `-1` / `-1` — no blocks anywhere
4. **AOS-only buyer** (`aos_only`): caps depend on what they bought; verify the numbers in the token match what Stripe says they paid for
5. **Plan downgrade**: a Circle member who lets their sub lapse — next SSO carries `aos_only` or `book_buyer` caps; AOS should immediately enforce the smaller cap. (Existing workspaces / seats over the cap stay accessible; new ones blocked.)

---

## Contacts

- Circle SSO mint function: `src/lib/aos.functions.ts → mintAosSsoToken`
- Circle limits function (DB): `public.get_user_aos_limits(_user_id uuid)`
- Shared secret: `AOS_SHARED_SECRET` (same secret on both projects — rotate together)

---

## Pull-based tier sync (for direct AOS sign-ins)

The SSO token only fires when a member clicks into AOS from the Circle portal. If a member signs into AOS directly (Google, password, magic link on the AOS site), AOS never sees a token — so its cached tier/caps stay stale. This is the bug where a paid Circle member shows up in AOS as base/no-tier.

The fix: on **every AOS sign-in** (and ideally on every session refresh), AOS should call Circle to re-sync the user's tier.

### Endpoint

```
POST https://app.alpcontractorcircle.com/api/public/aos/tier-lookup
Content-Type: application/json
x-aos-signature: <hex sha256>

{ "email": "user@example.com", "ts": 1700000000, "nonce": "abc123..." }
```

- `email` — lowercased, trimmed
- `ts` — unix seconds; rejected if more than 60s old
- `nonce` — any opaque string (4–128 chars)
- `x-aos-signature` — `HMAC_SHA256(AOS_SHARED_SECRET, "{email}|{ts}|{nonce}")` as hex (same signing convention as the SSO token's 3-field variant)

### Response (200)

```json
{
  "email": "user@example.com",
  "tier": "circle",          // or "intensive" / "book_buyer" / "aos_only" / null
  "workspaceLimit": -1,      // -1 unlimited, 0 no access, otherwise the cap
  "seatLimit": -1
}
```

`null` tier means no active or comped subscription resolved for that email — treat as no Circle access.

### AOS implementation

In the AOS sign-in handler (and any session-refresh path), call this endpoint with the freshly-authenticated email and overwrite the user's cached `tier` / `workspaceLimit` / `seatLimit` with the response. Fall back to existing cached values on network/HTTP failure (don't lock someone out of AOS because Circle is briefly unavailable).

Pseudocode:

```ts
import { createHmac } from "crypto";

async function syncTierFromCircle(email: string) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const signingString = `${email}|${ts}|${nonce}`;
  const sig = createHmac("sha256", process.env.AOS_SHARED_SECRET!)
    .update(signingString)
    .digest("hex");

  const res = await fetch("https://app.alpcontractorcircle.com/api/public/aos/tier-lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-aos-signature": sig },
    body: JSON.stringify({ email, ts, nonce }),
  });
  if (!res.ok) return; // keep cached caps on failure
  const { tier, workspaceLimit, seatLimit } = await res.json();
  await persistCapsForUser(email, { tier, workspaceLimit, seatLimit });
}
```

### Email-mismatch coverage

The Circle-side resolver also matches against `aos_links.aos_email`. So if a member's Circle email is `marshall@example.com` but they linked their AOS account under `marshall+aos@example.com` via `/aos/link`, calling tier-lookup with **either** email resolves to their Circle tier.
