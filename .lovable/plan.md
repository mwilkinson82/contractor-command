# Bringing AOS into the Circle (AOS Pulse)

Goal: When a member signs in, the dashboard pulls their **live AOS** data
(scorecard, rocks, issues, todos, meetings) from the ALPOS project and shows
it as the centerpiece of the Command Center.

## Architecture

Two separate Lovable projects, two separate databases:

```text
[Circle portal]                        [AOS / ALPOS]
  user signs in                          owns the real data
  needs AOS data  ── HTTPS+HMAC ──▶      /api/public/circle/snapshot
  renders dashboard                      returns JSON snapshot for that user
```

We do NOT cross-query databases. Circle asks AOS over the network, signed
with a shared secret, scoped to one user at a time.

## Step 1 — Add the snapshot endpoint in AOS (ALPOS project)

I'll prepare the code; you paste it into the ALPOS project (I can't write
to it from here). It's one file:

`src/routes/api/public/circle.snapshot.ts`

- `POST { email, ts, sig }` where `sig = HMAC_SHA256(email|ts, CIRCLE_SHARED_SECRET)`
- Rejects requests older than 5 minutes (replay protection)
- Looks up the AOS user by email → returns:
  - `scorecard`: last 4 weeks per-measurable with status (on/off track)
  - `rocks`: this quarter's rocks with % complete and on/off-track
  - `issues_open`: count + top 3
  - `todos_due_this_week`: count + top 3
  - `next_meeting`: date + type (L10, quarterly, annual)
  - `last_login_at`
- Adds secret `CIRCLE_SHARED_SECRET` to ALPOS

If the email isn't in AOS yet, endpoint returns `{ linked: false }` and the
Circle shows a "Link your AOS account" CTA instead.

## Step 2 — Circle-side server function

`src/lib/aos.functions.ts` → `getAosSnapshot()`:

- Requires Supabase auth
- Reads `aos_links` row for the user (email-match by default, link-code
  fallback — we already built this)
- Calls AOS `/api/public/circle/snapshot` with HMAC
- Returns a typed DTO to the client
- Caches per-user for 60s to keep the dashboard snappy
- Records `last_sync_at` and any sync errors on `aos_links`

Secrets to add in Circle:
- `AOS_BASE_URL` = `https://eos-builder-buddy.lovable.app`
- `AOS_SHARED_SECRET` (same value as ALPOS)

## Step 3 — Make AOS the dashboard centerpiece

Rebuild the home (`/`) layout around AOS Pulse:

```text
┌─────────────────────────────────────────────────────────────┐
│  Hello, {first name}     ·     Week of {Mon date}            │
│                                                              │
│  ╔════════════ AOS PULSE ═════════════╗   ┌─ Next session ┐ │
│  ║ Scorecard (4-week strip)            ║   │ Date · Topic  │ │
│  ║ ▮▮▯▮  ▮▮▮▮  ▯▯▮▮  ▮▮▮▮              ║   └───────────────┘ │
│  ║                                     ║   ┌─ Open issues ┐ │
│  ║ Quarterly Rocks       3 / 5 on-track║   │ count · top 1 │ │
│  ║ ────────── 60% ─────                ║   └───────────────┘ │
│  ║                                     ║   ┌─ Todos due    ┐ │
│  ║ [Open AOS →]                        ║   │ count · top 1 │ │
│  ╚═════════════════════════════════════╝   └───────────────┘ │
│                                                              │
│  Tools · Templates · Vault · Community  (mini-rows)          │
└─────────────────────────────────────────────────────────────┘
```

Empty / unlinked states:
- **Not linked yet** → AOS Pulse becomes a "Link your AOS account" panel
  pointing to `/account`.
- **Linked, no data yet** → "AOS is connected. Add your first rock to see
  your dashboard light up." with a direct link into AOS.
- **Sync failed** → muted error strip with "Retry" and timestamp.

A dedicated `/aos` route gets the full breakdown (per-measurable charts,
all rocks, all issues, all todos), with deep links back into the AOS app.

## Step 4 — Polish + go-live readiness

- Loading skeletons matching the editorial layout (no spinners).
- "Last synced 2m ago · refresh" affordance.
- Sidebar shows AOS status dot (green/yellow/red) so members can tell at a
  glance whether the bridge is healthy.
- Sign-out path tested.
- Auth emails still using Lovable defaults — fine for go-live; we can
  brand them later via the email-templates scaffold.

## What I need from you

1. Approve adding the two Circle secrets (`AOS_BASE_URL`,
   `AOS_SHARED_SECRET`) — I'll prompt the secret entry when you say go.
2. After I generate the snapshot endpoint code, paste it into the ALPOS
   project and add `CIRCLE_SHARED_SECRET` there (same value).

Once both sides are wired, the dashboard goes live with real per-member
AOS data. Ready to start with Step 1?
