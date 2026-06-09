## The real problem

You named it. The portal grants **privileges** (you’re tier X, so the code in places A, B, C, D, E each decides separately what tier X sees). That’s why Justin had Circle privilege but couldn’t see Contract Scan — the privilege existed in one place, the visibility decision lived in another, and they disagreed. It’s also why admin shows duplicates of the same person and why every new tier breaks something.

The fix is **entitlements**: one row per person, one row per thing-they-bought, access = sum of active entitlements. Everything else (sidebar, route gates, tool visibility, admin view) reads from that one source.

But handbook users are waiting and I’m not going to rip the foundation out under your feet first. Here’s the sequence.

---

## Phase 1 — Stop the bleeding (this week, before any handbook invites)

Goal: you can look at admin and trust it, and you can fix one person’s access in one click.

1. **Unified Person view in admin**
   - Dedupe by `lower(email)` across `profiles`, `auth.users`, `subscriptions`, `pending_claims`. One row per person, even if they exist in 3 places under slightly different states.
   - For each person show, in plain English: what they bought, what they can see, what they can’t, whether they’ve logged in, whether their account is wired up correctly.
   - Inline "what’s wrong" badges: `no auth account`, `email mismatch`, `subscription not linked to user`, `pending claim unclaimed`, `tier disagrees with purchase`, `no company set up`.

2. **One-click "repair access" per person**
   - Detects the broken state and fixes it: link orphan subscription to user id, claim pending claims by email, resend invite or reset link, fix tier, mark comped, send the right email.
   - Logs every repair to a server-side log so we can see what we did and why.

3. **Pre-invite preflight (CSV in, report out)**
   - Paste the handbook user list. Server runs the same diagnostic per email **without sending anything**.
   - Output is a pass/fail matrix: `ready to invite`, `already in good shape, no email needed`, `needs repair first`, `invalid email`.
   - You eyeball it before any email goes out. Live run only sends to the rows you approved.

4. **Tier impersonation hardening for QA**
   - Already exists in the sidebar but is admin-eyes-only. Add a small "QA panel" page (admin-only) that lets you flip through every tier and confirm, side-by-side, what that tier’s sidebar / routes / tools look like. This is the per-tier QA dashboard you asked for.
   - I’ll use this myself before saying "done" on anything that touches access.

5. **My own QA rule going forward**
   - Before claiming any access/visibility change is done, I will: impersonate the relevant tier in the preview, click the actual feature, and report what I saw. No more "should work."

---

## Phase 2 — Entitlements refactor (planned, not started yet)

This is the real foundation. Sketching it now so Phase 1 is built in a way that doesn’t make Phase 2 worse.

- New table: `entitlements(person_id, kind, status, source, granted_at, expires_at, metadata)`.
- `kind` values: `handbook`, `aos_workspace`, `aos_seat`, `circle_membership`, `intensive_program`, `power_hour`, `sm_school`, `contractor_school`, `hardcore_room`, `call_credit`.
- New table: `persons` — the deduped identity row, with stable id, linked to `auth.users.id` once they sign up, with `email_aliases` for the people who buy under one email and sign up with another.
- `get_user_tier()` and route gates become derived: "if person has entitlement X, they can see feature Y." Tier becomes a display label, not a switch.
- Webhook, pending_claims, and admin "comp" all write to the same `entitlements` table.
- Sidebar, route gates, and tool visibility all read from one helper that returns `{ can: ['handbook','aos','ask','vault','tools', ...] }`. No more per-component tier switches.

Phase 1 stays compatible with this. The Person view in admin is the human-facing version of the same dedupe logic.

---

## Phase 3 — Make entitlements shareable across tools

You said the cross-tool DB split is part of the problem. I won’t solve it inside the portal alone, but I will make portal entitlements **the source of truth** that AOS and future tools can read.

- A signed, read-only entitlements endpoint at `/api/public/entitlements/lookup` (HMAC-signed like the existing AOS endpoint). Given an email, returns the person’s active entitlements.
- AOS already calls `/api/public/aos/tier-lookup`. This replaces it with a richer payload, and any future tool reads the same one.
- Long term: when you consolidate Supabase projects, this same shape becomes the internal interface — nothing has to change for AOS or other tools.

---

## What I’ll NOT do in this plan

- I’m not bulk-inviting handbook users until you’ve seen the preflight report and approved it.
- I’m not changing your portal’s look or current member-facing flows.
- I’m not touching AOS itself.
- I’m not deleting any existing data.

---

## Handbook entitlement scope (locked from your answer)

When a handbook buyer is granted the `handbook` entitlement, they get: Handbook + AOS + Ask Marshall + Tools + Vault. They do NOT get: Circle Calls, Templates, Replays, Community, Hardcore.

The portal’s current `book_buyer` tier maps to "handbook + AOS + Ask only" — too narrow for what you actually want to sell handbook buyers. I’ll fix the route/sidebar gates in Phase 1 so handbook buyers see the right surfaces.

---

## Technical notes (skip if not interested)

- All admin diagnostics and repair actions go through TanStack server functions with `requireSupabaseAuth` + admin role check. No service-role key ever reaches the browser.
- Person dedupe uses `lower(email)` and `user_id` as the join keys, surfacing every conflict instead of silently picking one. Same logic used by preflight and Person view, so they can never disagree.
- Repair actions are idempotent — running them twice does nothing the second time.
- Server-side log of every repair action (who, what, when, before/after) so we have an audit trail when someone says "you broke my access."
- Per-tier QA page reuses existing `tier-impersonator` infrastructure; no new auth surface, no impersonation of real users (admin still acts as themselves at the DB level).
- Phase 2 entitlements table will follow the project’s grant pattern: explicit `GRANT` to `authenticated` + `service_role`, RLS on, policies scoped to `person_id = auth.uid()` for reads, admin-only writes.

---

Reply with anything you want changed, or "go" and I’ll start Phase 1.