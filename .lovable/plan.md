# Today's Move — Curated + Smarter Fallback

## Goal

Make the **Today's Move** card on `/` show what Marshall wants members focused on this week, with a sensible auto-derived fallback when no curated move is active.

## Part 1 — Curated weekly move (admin-pushed)

### New table: `weekly_moves`

| Column        | Type        | Notes                                         |
| ------------- | ----------- | --------------------------------------------- |
| `id`          | uuid PK     |                                               |
| `headline`    | text        | Big bold line on the card                     |
| `body`        | text        | 1–3 sentence explanation                      |
| `cta_label`   | text        | Button text (e.g. "Open the SOP builder")     |
| `cta_to`      | text null   | Internal route (e.g. `/tools/sop-priority`)   |
| `cta_href`    | text null   | External URL (mutually exclusive with cta_to) |
| `source`      | text null   | Small "From · …" tag under the button         |
| `active_from` | timestamptz | When it starts showing                        |
| `active_to`   | timestamptz null | Optional auto-expiry                     |
| `created_by`  | uuid        | admin profile id                              |
| `created_at`  | timestamptz | default now()                                 |

RLS: `SELECT` for `authenticated` where `active_from <= now() AND (active_to IS NULL OR active_to > now())`. Full CRUD limited to admins via `has_role(auth.uid(), 'admin')`. Standard GRANTs (`authenticated`, `service_role`).

### Admin page: `/admin/weekly-move`

- Lists past moves (most recent first), shows which one is currently active.
- "New move" form: headline, body, CTA label, CTA route OR URL, source, active_from (defaults to now), active_to (optional).
- Edit / archive (set `active_to = now()`) on past entries.
- Linked from the existing admin index page.

### Server functions (`src/lib/weekly-move.functions.ts`)

- `getActiveWeeklyMove()` — public to authenticated members, returns the single currently-active row or null.
- `listWeeklyMoves()` — admin only.
- `upsertWeeklyMove(input)` — admin only.
- `archiveWeeklyMove(id)` — admin only.

### Wiring on `/`

`src/routes/index.tsx` already passes `packets` to `<TodaysMove />`. Add a TanStack Query call to `getActiveWeeklyMove` and pass the result as the `curated` prop. The component already prefers `curated ?? deriveMove(packets)` and already swaps the eyebrow label to "Marshall's move this week" when curated is present — no component-level changes needed for this part.

## Part 2 — Smarter auto-derive fallback

Edit `deriveMove()` in `src/components/portal/todays-move.tsx`:

1. **Recency filter.** Ignore any packet older than **14 days**. A stale "Client communication / leverage 60" from two weeks ago should not be today's move.
2. **Rule re-order.** Current order privileges `intensiveRecommended` above all else, which is why the older SOP Priority packet beats the newer Contract Readiness one. New order:
   - (a) Newest `command` packet within 14 days that is `intensiveRecommended`.
   - (b) Newest `command` packet within 14 days (any).
   - (c) Newest `issue` packet within 14 days.
   - (d) Cold-start nudge (unchanged).
3. **Cold-start copy refresh.** Keep pointing at Growth Constraint Map, but soften copy so it doesn't look like a default for someone who's been around a while — add a secondary line: "Already run it? Re-run quarterly — the numbers move."

No schema impact for Part 2.

## Out of scope

- Per-tier or per-segment targeting of the curated move (everyone sees the same one for now — matches today's behavior).
- Scheduling multiple future moves in a queue (admin sets `active_from` manually; only one active at a time is enforced by query, not by constraint).
- Analytics on CTR for the move card.

## Technical notes

- New files: `src/lib/weekly-move.functions.ts`, `src/routes/admin.weekly-move.tsx`.
- Modified files: `src/routes/index.tsx` (fetch + pass `curated`), `src/components/portal/todays-move.tsx` (smarter `deriveMove`), `src/routes/admin.index.tsx` (add link).
- One migration: create `weekly_moves` + GRANTs + RLS + policies.
- The `curated` prop and "Marshall's move this week" label are already in place — no breaking changes to the component contract.
