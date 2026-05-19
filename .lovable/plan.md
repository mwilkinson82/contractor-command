## The model

Three tiers in this one portal. AOS stays a separate Lovable project (the engine). alphandbook.com stays the book's sales page.

| Tier | How they enter | What they get |
|---|---|---|
| **Book Buyer** | Bought on alphandbook.com → Stripe receipt email auto-claims on portal signup | Handbook v2 reader (clickable into AOS) + full AOS workspace (1 company, all modules) |
| **Intensive Grad** | Paid for 6-week intensive | Book Buyer + intensive materials |
| **Circle Member** | Today's paying members | Everything (calls, Vault, Marshall, community) — unchanged |

The portal is the single member home and the single upgrade surface. alphandbook.com sells the book. AOS runs the operating system. Email + auth + Stripe + upgrades all live here.

## Flow

```text
alphandbook.com  ──Stripe purchase──>  pending_claims (email + product=book)
                                            │
   reader follows link in book ──>  portal signup with same email
                                            │
                          claim trigger fires ──> Book Buyer tier
                                            │
              ┌─────────────────────────────┴─────────────────────────────┐
              ▼                                                            ▼
   Handbook v2 reader (clickable AOS hand-offs)        AOS workspace (1 company, full modules)
              │                                                            │
              └──────────────── upgrade cards ─────────────────────────────┘
                                            │
                          Intensive ($)  or  Circle ($$) — in-app Stripe
```

## Build phases

**Phase 1 — Tier model** (foundation)
- Add `tier` enum to `subscriptions` (`book_buyer | intensive | circle`). Default existing Circle rows to `circle`.
- Extend `has_active_access` and add `has_tier(uid, tier)` SQL helper.
- Update RLS on `replays`, `templates`, `ask_threads`, calls-related tables to require `tier >= intensive` or `circle` (whatever each one's audience is).
- Handbook reader + AOS get gated to `book_buyer`+.

**Phase 2 — Book purchase ingestion**
- New `/api/public/webhooks/alphandbook` server route. Verifies Stripe signature from the alphandbook.com account, writes a `pending_claims` row with `metadata.product = 'book_v2'`.
- Extend `claim_pending_subscription` trigger to map `product=book_v2` → `tier=book_buyer`.
- One-time backfill script for existing book buyers (CSV import → pending_claims).

**Phase 3 — Onboarding for Book Buyers**
- Marketing-light landing at `/welcome` (the URL printed in the book): "You bought the book. Create your portal account to unlock the interactive handbook + AOS."
- Signup flow auto-detects the claim and routes them to a Book Buyer first-run: pick a company name, optional logo, then dropped into the Handbook cover.
- Sidebar for Book Buyers shows only: Handbook, AOS, Account, Upgrade. (No Calls, no Vault, no Marshall, no Community.)

**Phase 4 — Upgrade paths (in-app Stripe)**
- Two new products in Stripe: 6-Week Intensive (one-time) and Contractor Circle (already exists).
- Persistent "Upgrade" card in the Book Buyer sidebar + contextual cards on gated screens ("Vault is a Circle benefit — see what's inside").
- Per the earlier answer: show both Intensive and Circle, let them self-select.
- Stripe webhook bumps `tier` on successful payment; user keeps the same account, just gains access.

**Phase 5 — Email to existing Circle members**
- "Handbook v2 is live — and now it's clickable into your AOS." No mention of AOS being new (they already have it). Headline is the magic moment: reading → doing without leaving the portal.

## Technical details

- **Tier source of truth:** `subscriptions.tier` (single highest-tier row per user wins). Derive in a `get_user_tier(uid)` SQL function and use it everywhere.
- **AOS hand-off:** unchanged — uses existing `aos_links` + `AOS_SHARED_SECRET`. Book Buyers get the same SSO bridge, just scoped to a single workspace by AOS (AOS-side enforcement; pass `tier` claim in the signed payload).
- **Handbook gating:** the existing handbook route moves under a `requireTier('book_buyer')` guard. Circle's existing access still satisfies the check.
- **Sidebar:** `app-sidebar.tsx` reads `tier` from a `useTier()` hook and renders the appropriate nav set. Three variants: book_buyer / intensive / circle.
- **No new auth surface.** Same Supabase email+password (+ Google) flow. The book URL points to `/welcome?ref=book` which is just a styled signup.
- **AOS subdomain stays** for now. The planned cutover to one domain is a separate, later piece of work; nothing in this plan blocks it.

## Out of scope (deliberate)

- No marketing site for the book on the portal — alphandbook.com owns that.
- No free/public tier. Every level of access requires a purchase.
- No AOS Lite / decoy Pro tier — scrapped per your pushback.
- No changes to AOS internals; only the SSO claim gains a `tier` field.
