## What gets added to the portal

A new section called **Handbook** that lives at `/handbook` inside Contractor Circle. Every active CC member (and admins) gets it automatically — no separate purchase, no separate login, no entitlement table for them. It just shows up.

### Where it shows up in the UI

1. **Nav** — new "Handbook" item in the left sidebar/top nav, sitting alongside Replays, Templates, Tools, Vault, Calls.
2. **Welcome / dashboard tile** — a card on `/welcome` promoting it ("Read the ALP Handbook — the operating manual behind the system").
3. **Route** — `/handbook` is the reader. It opens to the table of contents; clicking a chapter takes you to `/handbook/$chapterSlug`. Reading progress is remembered per user.

### What the reader looks and feels like

Same reading experience as the standalone site — ChapterHeader, Section, Parable, FloatingTOC, ReadingProgress, AudioPlayer, ExpandableImage, all 28 chapter components — restyled to match the portal's design tokens so it doesn't feel like a different product. Two route files:

- `src/routes/_authenticated/handbook.tsx` — layout + TOC landing
- `src/routes/_authenticated/handbook.$chapterSlug.tsx` — individual chapter

The `_authenticated` placement means the existing auth gate handles login. We add one extra check in `beforeLoad`: `has_active_access(uid)` must be true. If they're logged in but not an active member, they hit a "Handbook is included with Contractor Circle membership" upsell page.

### What does NOT come over

- Sales page (`/`), purchase-success, refund/privacy, admin, preview — those stay on the standalone marketing site at the handbook's own domain. Standalone purchasers keep buying and reading there exactly as they do today. Nothing about that flow changes.

### Standalone purchasers — do they get anything in the portal?

**Not in this phase.** Per your decision, the portal handbook is a CC member perk. Standalone buyers continue using the standalone site. If later you want to migrate them into the portal (magic link + entitlement table), that's a follow-up — small, but separate.

### Content source

The 28 chapter components in the handbook project are React components with the prose hardcoded in JSX. Fastest path: copy them into `src/components/handbook/` in the portal as-is, then restyle. No CMS, no database for chapter content. Edits go through code like they do today.

### Effort

One focused session:
- Copy `components/handbook/` (~48 files) into the portal
- Create the two route files with the auth + active-access gate
- Add nav entry + welcome tile
- Restyle headers/buttons to portal tokens (light pass — the reader is already clean)
- QA the chapter pages render and TOC navigation works

No database migration needed. No new Stripe wiring. No new emails. No webhook changes.

### Technical notes

- Handbook project is Vite + React Router; portal is TanStack Start. The chapter components are pure JSX/Tailwind — they port without changes. Only the page-level wrappers (which used React Router's `useParams`, `Link`) need to be rewritten as TanStack route files. That's the two new route files above.
- Reading progress: store per-user in a new tiny table `handbook_progress (user_id, chapter_slug, last_read_at, percent)` with RLS scoped to `auth.uid()`. Optional — can ship v1 without it and add later.
- Audio files / images from the handbook project: copy into `src/assets/handbook/` or upload to Supabase storage if large.

---

Confirm this matches what you want and I'll build it. The one open question: **do you want reading progress tracking in v1, or ship the reader first and add progress later?**