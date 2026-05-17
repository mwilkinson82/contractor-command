## What you'll see when this ships

1. **Today:** The home hero will stop saying "Start your AOS" and instead say *"We found 5 AOS workspaces under wilkinson.marshall@gmail.com — which one is this Command Center for?"* with a picker. Click ALP → it locks in forever, hero collapses, AOS Pulse lights up. This unblocks you right now.

2. **One-time onboarding (first login after this ships):** A single welcoming screen — *"Let's set up your command center."* Three fields: **company name**, **company address**, **logo upload**. Skippable but nudged. Takes 30 seconds.

3. **Everywhere after:** Top of every page reads `[logo] ACME Construction · Command Center`. The greeting moves to a smaller secondary line: *"Good afternoon, Marshall."* The sidebar brand swaps from the generic "Contractor Circle" lockup to **your** logo + company name. Browser tab title becomes *"ACME Construction · Command Center"*.

4. **Account page** splits into two tabs: **Company** (logo, name, address, AOS workspace) and **You** (your name, email, password, sign out). The AOS workspace selector lives in the Company tab so it's set-and-forget.

---

## Order of work (4 chunks, each shippable on its own)

### Chunk 1 — AOS workspace picker on the hero *(small, unblocks you today)*
- Update `AosHero` to accept the `companies[]` array from the snapshot.
- When `linked: false` *and* `companies.length > 0`: render a workspace picker instead of the "Start AOS" CTA. *"We found N AOS workspaces. Pick the one this Command Center belongs to."*
- When `linked: false` *and* `companies.length === 0`: keep the current "Start your AOS" hero unchanged.
- Picking a workspace writes `aos.company_id` to localStorage AND `aos_links.company_id` in the DB (new column — added in Chunk 2's migration, but Chunk 1 can ship using localStorage only).
- Home's `useQuery` reads `aos.company_id` from localStorage and passes it as `companyId`, so it dedupes with `AosPulse` and the hero collapses immediately.

### Chunk 2 — Company schema + storage bucket
- New `companies` table: `id`, `owner_user_id` (unique — one company per user for v1), `name`, `address`, `logo_path`, `created_at`, `updated_at`. RLS: owner can read/write their row.
- New `company-logos` storage bucket, **public read**, RLS: owner can upload/update/delete their own folder (`{user_id}/logo.*`).
- Add `company_id` columns to `aos_links` and `vault_packets` (nullable for backfill safety). Backfill the existing row(s).
- A small `useCompany()` hook + a `getCompany` / `upsertCompany` server fn (or direct Supabase calls — owner-scoped, RLS does the work).

### Chunk 3 — Onboarding screen + Company-centric chrome
- New route `/onboarding` (or an inline modal on `/` first visit). Triggered when `companies` row missing OR `name` empty.
- Fields: company name (required), address (optional), logo (optional, upload to bucket).
- After save → redirect to `/`.
- **Header rewrite:** Sidebar brand block + home greeting band both read from `useCompany()`. Logo on the left, company name as the primary, "Command Center" as the eyebrow, "Good afternoon, {firstName}" as the small secondary line. Browser tab title via `<head>` updates to `{company} · Command Center`.

### Chunk 4 — Account page split (Company / You)
- Tabs at the top of `/account`: **Company** | **You** | **Membership**.
- **Company**: editable name/address/logo + AOS workspace picker (pulls list from snapshot, persists to `aos_links.company_id`).
- **You**: name, email (read-only), password change, sign out.
- **Membership**: existing Stripe portal + billing card.

---

## Technical notes

- **One company per user (v1).** Schema keeps `owner_user_id UNIQUE`. To go multi-company later, add a `company_members` join table — nothing breaks because every read already goes through `useCompany()`.
- **Storage:** logos go to `company-logos/{user_id}/logo.{ext}`. Public bucket so `<img>` works without signed URLs. Owner-only write via storage RLS using the user-id-as-first-folder convention.
- **AOS link:** `aos_links.company_id` becomes the source of truth; localStorage is just a hydration cache so the first paint isn't blank. If the localStorage value disagrees with the DB after fetch, DB wins.
- **No breaking change to vault_packets** — `company_id` is added nullable and stamped on new inserts. Existing packets stay readable by `user_id`.
- **Why a screen and not a modal** for onboarding: it's the first impression of "this is *your* company's command center" — selling that frame is worth a full screen.

---

## What I'll ask you mid-build (only if I hit ambiguity)

- For the address field — single line, or split into street/city/state/zip? My default: **single line** for v1 (faster onboarding, can split later if we ever need to format invoices/letters from it).
- Logo upload: do you want auto-background-removal/cropping helpers, or just "upload an image, we'll display it as-is"? My default: **as-is** with a circular mask + max-height — keeps onboarding under 30 seconds.

If those defaults are fine, I won't stop to ask. Approve and I'll start with Chunk 1 so AOS connects for you in this same turn, then move through 2 → 3 → 4.