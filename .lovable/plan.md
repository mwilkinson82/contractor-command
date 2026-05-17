## Yes — pulling AOS dashboard data per member into the Command Center is possible.

ALPOS (which we're calling **AOS**) is a separate project with its own database. Today, the Vault page already reserves an "AOS signal" tile slot for this. To make it real, we connect Circle to AOS as a **read-only data source per member** — so when a member logs into Circle, their home and Vault show their own AOS scorecard, rocks, and issues.

There are three viable ways to do this. I recommend Option A.

---

### Option A — Shared identity + read-only API (recommended)

AOS exposes a small read-only API. Circle calls it server-side on behalf of the logged-in member.

```text
Circle (member logged in)
   │  serverFn: getAosSnapshot()
   ▼
Circle server
   │  POST https://aos.app/api/public/circle/snapshot
   │  Headers: x-circle-secret, x-member-email
   ▼
AOS server (verifies secret + looks up company by member email)
   │  reads scorecard, rocks, issues, todos
   ▼
returns JSON snapshot → Circle renders tiles
```

**What member sees in Circle:**
- Home hero: "AOS pulse" strip — scorecard on/off track count, rocks at risk, open issues, last AOS activity.
- Vault: live AOS signal tile (replaces the "Wiring soon" placeholder) — scorecard drift, top 3 open issues, rocks due this quarter.
- Tools: when a packet is saved, suggest the AOS area it belongs to (Issues / Scorecard / Rocks / Process) with a deep link.

**Identity model:** AOS already has user accounts. We match by **email** (member's Circle email == AOS user email) or by a one-time **AOS link code** the member pastes into Circle's Account page. No second login — Circle holds a shared service secret, AOS scopes the response to that member's company only.

---

### Option B — Embed AOS as an authenticated iframe panel

Add an `/aos` panel in Circle that iframes the AOS dashboard with SSO. Faster to ship, but the data isn't really "in" Circle — can't surface AOS numbers on Home or Vault tiles, can't tie packets to AOS areas.

### Option C — Move AOS onto the same backend as Circle

Cleanest long-term, biggest lift. Worth considering only if AOS is going to be rebuilt anyway.

---

### Scope for this build (Option A)

**In AOS (project: ALPOS):**
1. Add `src/routes/api/public/circle/snapshot.ts` — POST endpoint.
   - Verifies `x-circle-secret` (shared secret).
   - Looks up member by email → resolves their `company_id`.
   - Returns one JSON payload: `{ scorecard: {...}, rocks: [...], issues: [...], todos: [...], lastActivityAt }`.
   - Uses `supabaseAdmin` (server-only), never returns other members' data.

**In Circle (this project):**
1. Enable Lovable Cloud (needed to store the AOS shared secret + sign in members).
2. Add `AOS_SHARED_SECRET` + `AOS_BASE_URL` as server secrets.
3. Add `src/lib/aos.functions.ts` — `getAosSnapshot()` serverFn that calls AOS using the logged-in member's email.
4. Wire snapshot into:
   - Home (`src/routes/index.tsx`) — replace the static "Latest Replay" tile with a live **AOS pulse** tile.
   - Vault (`src/routes/vault.tsx`) — replace the placeholder "AOS signal" block with live data.
5. Account page — add "Connect to AOS" status row (shows email match / link code fallback).

**Out of scope for this pass:** writing back into AOS from Circle (still manual — the packet tells the member what to carry over), Stripe/Discord wiring, full member auth flows beyond email sign-in.

---

### Also in this pass — finish go-live readiness

You said you want to tie in the backend and go live. The minimum to do that:
- Enable Lovable Cloud + email sign-in (Google optional).
- Persist Vault packets to the database instead of `localStorage` (currently `src/lib/vault.ts` is browser-only — packets disappear if a member switches devices).
- Members table + RLS so each member only sees their own vault and AOS snapshot.

---

### One open question

How should we match a Circle member to their AOS account?

1. **Same email** — simplest, works if every member's AOS login email equals their Circle email.
2. **Link code** — member generates a code in AOS, pastes into Circle once. More setup, but works even when emails differ.
3. **Both** — try email first, fall back to link code.

If you say "same email," I'll build Option A with that assumption and we move fast.