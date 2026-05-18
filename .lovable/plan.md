## Templates page redesign — Option D

Rebuild `/templates` around two zones: a small art-directed **featured zone** that always looks composed, and a dense, scalable **library zone** that stays beautiful as content grows from 20 → 200 templates.

### Zone 1 — Featured: AOS

A single full-width hero band dedicated to **AOS** (Marshall's Augmented Operating System). Not part of the grid, not a card in a row — its own moment.

- Eyebrow: `THE OPERATING SYSTEM` · small orange signal dot (same as top strip)
- Headline: "AOS — Augmented Operating System"
- One-paragraph lede positioning AOS as the foundation
- Inside the band: the 9 AOS templates rendered as a compact 3-column list (title + one-line description + Open button), grouped under one frame
- Subtle paper/engine treatment to match the ALP Engine aesthetic — not a colored gradient block

This replaces the current "Top prescribed path" featured row. The `featured` flag on templates becomes "AOS-only" by convention going forward.

### Zone 2 — The Library (everything else)

Below the AOS band: one unified, searchable, filterable list. No grid of category cards.

**Controls row** (sticky on scroll):
- Search input (existing, widened)
- Category filter chips (horizontal scroll): All · Operations · Leadership · Finance · Sales · Contractor Circle · Field
- Sort: Newest · A–Z (default Newest, so new weekly drops surface at top within each category)
- Result count ("47 templates")

**List rendering** — grouped by category, but each category is a *section heading* not a card:

```text
─────────────────────────────────────────────────
CONTRACTOR CIRCLE                          12 items
─────────────────────────────────────────────────
  Week 24 Deck — Pricing Without Apology
  Bi-weekly call deck · PDF · Added May 18      [ Open ]
  ─────────────────────────────────────────────
  Week 22 Deck — The Owner Trap
  Bi-weekly call deck · PDF · Added May 4       [ Open ]
  ─────────────────────────────────────────────
  ...

─────────────────────────────────────────────────
OPERATIONS                                 11 items
─────────────────────────────────────────────────
  Client Onboarding Checklist
  ...
```

Each row: title (display font), one-line meta (type · pages · added date), Open button right-aligned. Hairline dividers between rows. Generous vertical rhythm. No card chrome — the *list itself* is the design.

This pattern:
- Looks identical whether a category has 2 items or 50
- Adds a Contractor Circle deck = one new row, zero design work
- Scans like Linear/Vercel/Notion template galleries (the reference for "premium template library")
- Filter chip + search make a 200-template library feel effortless

### Empty/loading states

- Loading: skeleton rows in the same shape (not spinners)
- Empty search result: single centered line "No templates match 'xyz'." with a Clear button

### Out of scope

- No backend changes. `featured` stays on the schema (used to gate AOS hero membership later if needed).
- No new categories. Current set stays.
- Admin upload flow unchanged.

### Files to change

- `src/routes/templates.tsx` — full rewrite of the render layer (the data fetching stays). Replace `featured` row + 2-col grouped cards with: AOS hero band + filter controls + grouped list.
- Possibly extract `AOSFeaturedBand` and `TemplateRow` into small components inside the same file for readability.

### Confirm before I build

1. AOS hero is its own band above everything else, with the 9 AOS templates listed inside it — correct?
2. Category filter as horizontal chips (not a dropdown) — okay? Chips scale better visually as categories grow.
3. Default sort = **Newest** so your weekly Contractor Circle drops auto-surface at the top of that section?
