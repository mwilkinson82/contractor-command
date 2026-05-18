# Library: wire Templates + Replays to the database

## Goal

Move Templates and Replays off hardcoded arrays and onto the real DB tables (`templates`, `replays`) that already exist. Give you an admin UI to add/edit records and upload PDFs. Reorganize the sidebar so Library is its own thing, Calls is just scheduling, and Build is field tools only.

## What exists today (current state)

- DB tables `templates` and `replays` exist with correct columns + RLS (active members read, admin manages) — but both are **empty**.
- `/templates` shows a hardcoded list of ~20 titles with "Open" buttons that do nothing.
- `/calls` page contains: next sessions, topic submission, AND a hardcoded replay archive at the bottom (`REPLAYS` from `src/lib/program.ts`).
- Sidebar: Templates is under "Build" next to Field tools. No Library group.

## Changes

### 1. Storage

Create one private storage bucket `template-files` for PDFs/decks. Admin-only writes, signed-URL reads for active members (so the download link expires and can't be passed around forever).

### 2. Sidebar reorg (`src/components/portal/app-sidebar.tsx`)

```text
Daily       Home · Ask Marshall · AOS · Calls · Community
Library     Templates · Replays                     ← NEW group
Command     Tools · Vault
Build       Field                                   ← Templates removed
Program     Intensive · Account
```

Calls page keeps next session + topic submit; the hardcoded replay archive at the bottom moves to a new `/replays` route backed by the DB.

### 3. New + rewritten routes

- `src/routes/templates.tsx` — **rewrite**: fetch from `templates` table, group by `category`, featured row at top. Each card shows title, category, pages, badge, "Open" → opens the file (signed URL from `download_url` path, or external URL if it's a full link). Search + category filter.
- `src/routes/replays.tsx` — **new**: fetch from `replays` table, list by `recorded_at desc`, tag filter, search. "Watch replay" → `video_url`.
- `src/routes/calls.tsx` — **edit**: strip the `ReplayLibrary` section (lives on `/replays` now). Keep next sessions + topic submission.
- `src/routes/admin.library.tsx` — **new** (admin-only): two tabs, Templates and Replays. Table view with add / edit / delete / publish toggle. Template form supports PDF upload (writes to `template-files` bucket, stores the path in `download_url`). Replay form takes video URL, thumbnail URL, duration, tags. Route is gated by `has_role(uid, 'admin')` via a server fn; non-admins get redirected.

### 4. Data access

- Reads (member-facing pages): use the browser supabase client — RLS already restricts to `published AND has_active_access(uid)`.
- Admin writes: small set of `createServerFn` handlers in `src/lib/library.functions.ts` using `requireSupabaseAuth` + an `assertAdmin(userId)` check, calling `supabaseAdmin` to insert/update/delete and to mint signed URLs for private template downloads.

### 5. Seed starter rows from hardcoded lists

Insert all current hardcoded titles into the DB so you have a starting point to fill in. Templates seeded as **unpublished drafts** with empty `download_url` so they don't appear to members until you attach a file. Replays seeded from `REPLAYS` in `src/lib/program.ts` with their existing `zoomUrl` mapped to `video_url`; unpublished if no URL exists.

After seeding I'll give you the list of which template rows are missing files so you can send me PDFs (or upload them yourself in the admin UI).

### 6. Cleanup

- Delete the hardcoded `FEATURED` / `GROUPS` arrays in `templates.tsx` and the `REPLAYS` export in `src/lib/program.ts`.
- Leave `UPCOMING` (sessions) alone — sessions aren't in the DB yet, separate task.

## Out of scope (next pass, your call)

- New Build tools (you mentioned wanting more — I'll do that after Library is wired).
- Moving `UPCOMING` sessions into the DB.
- Public/free funnel gating split (memoryed for later).

## Technical notes

- `templates.download_url` becomes either a full `https://` URL (external) or a storage path inside `template-files`. The "Open" handler checks: starts with `http` → open directly; otherwise → call a server fn that returns a 5-minute signed URL.
- Admin check uses the existing `has_role(uid, 'admin')` SQL function — no new policies needed; the table policies already permit admin CRUD.
- No schema changes required. The existing `templates` and `replays` columns are sufficient. One storage bucket + its policies is the only migration.
