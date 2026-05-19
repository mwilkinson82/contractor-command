
# Contractor Circle 2.0 — Cutover & Drip Plan

Three answered decisions locked in:
- **Marketing site** = separate Lovable project (later).
- **Drip engine** = built in this portal (path a — fully owned).
- **Member cutover** = magic-link email → "set your password" landing page.
- **Domain** = portal lives at `app.alpcontractorcircle.com`.

---

## Phase 1 — Domain cutover (do first, ~15 min of your time)

1. In **Project Settings → Domains**, connect `app.alpcontractorcircle.com`.
2. Add the A record (`app` → `185.158.133.1`) + TXT verification record at your registrar (wherever `alpcontractorcircle.com` DNS lives now — probably Manus or GoDaddy/Namecheap).
3. Wait for SSL to provision (usually <1hr, can be up to 72hr).
4. Update Supabase Auth **Site URL** + **Redirect URLs** to include `https://app.alpcontractorcircle.com/*` so magic links and Google OAuth keep working.
5. Update the AOS SSO `ALLOWED_RETURN_ORIGINS` (or equivalent) on the AOS side to include the new origin.

No code change needed — just config.

---

## Phase 2 — Member migration from Manus (one-shot)

**Goal:** every existing Manus member gets one email → lands on `/welcome` → sets password → is in.

1. **Export from Manus**: CSV of `email, full_name` for all current members.
2. **Import script** (admin-only server function): for each row, call `supabase.auth.admin.inviteUserByEmail(email, { data: { full_name, migrated_from: 'manus' }, redirectTo: 'https://app.alpcontractorcircle.com/welcome' })`. Supabase sends a magic invite link; no password needed yet.
3. **Custom invite email template** (auth email — scaffolded via Lovable Email): "The new Contractor Circle portal is live. Confirm your email and set your password." One CTA button → magic link.
4. **New `/welcome` route**: after the magic link consumes, user lands here with a session. Form asks: *Set your password*. Calls `supabase.auth.updateUser({ password })`, then redirects to `/`.
5. **Admin dashboard tile** (small): "Migration status — X of Y members activated" so you can chase stragglers.

Existing signup/login flows stay untouched. New members from the marketing site (later) hit the normal `/signup` route.

---

## Phase 3 — Drip engine (built into this portal)

Lightweight, fully owned. Reuses the existing Lovable Email infra you already have for transactional sends.

### Data model (one migration)
- `lead_magnets` — `id, slug, title, file_path, created_at` (the 4 PDFs/resources, stored in Supabase Storage).
- `drip_sequences` — `id, lead_magnet_id, name, active`.
- `drip_steps` — `id, sequence_id, step_order, delay_days, email_template_name, subject`.
- `subscribers` — `id, email, name, source_magnet_id, subscribed_at, unsubscribed_at`.
- `drip_enrollments` — `id, subscriber_id, sequence_id, current_step, next_send_at, status` (active/completed/unsubscribed).
- `drip_send_log` — append-only audit (which step sent to who, when).

RLS: all admin-only; subscribers table writes are server-function only.

### Opt-in flow (lives on the marketing site, calls back to this portal)
- Public server route `POST /api/public/lead-magnet/subscribe` — accepts `{ email, name, magnet_slug }`, with Zod validation + simple rate limit.
- Creates/updates `subscribers` row, returns a signed download URL for the PDF, enrolls them in the matching `drip_sequence` with `next_send_at = now() + step1.delay_days`.

### Dispatcher (pg_cron, every 5 min)
- Calls `POST /api/public/drip/process` (apikey-authed).
- Pulls `drip_enrollments WHERE next_send_at <= now() AND status='active'`, sends via existing `sendTransactionalEmail` helper using the step's template, advances `current_step`, sets next `next_send_at` or marks `completed`.

### Templates
- One React Email template per step in `src/lib/email-templates/` (e.g. `drip-magnet1-step1.tsx`). Register in `registry.ts`. Brand-matched (cream/ink, your existing design tokens).

### Admin UI (one new route `/admin/drip`)
- List sequences, see enrollment counts per step, view send log, manual unsubscribe.
- Add/edit sequence steps inline (no redeploy needed to change copy — pull template content from DB if we want, or keep code-defined for v1 simplicity).

### Unsubscribe
- Already handled by the existing Lovable Email unsubscribe footer + `/email/unsubscribe` route. We just check `email_unsubscribe_tokens`/`suppressed_emails` before each drip send (the helper already does this).

---

## Execution order (what I'd actually do next, in order)

1. **You**: tell me to start Phase 1 — I can't add the domain for you, but I'll prep the auth redirect URL updates the moment DNS is wired.
2. **Me**: build Phase 2 (migration tool + `/welcome` + custom invite email) — this is the unblocker for everything.
3. **You**: export Manus list, drop it in, I run the import.
4. **Me**: build Phase 3 (drip engine + admin UI). You give me the 4 lead magnet files + their email copy (or I draft from your existing Manus copy if you export it).
5. **Marketing site**: separate project, last. The opt-in form there just POSTs to `app.alpcontractorcircle.com/api/public/lead-magnet/subscribe`.

---

## Open questions before I build

1. **Domain registrar** — where does `alpcontractorcircle.com` DNS live today? (Need to know if Manus controls it or you do, so the A-record add is clean.)
2. **Portal name in the invite email** — "Contractor Circle Portal", "Contractor Circle 2.0", or just "Contractor Circle"?
3. **Drip cadence default** — typical sequence length? (e.g. 5 emails over 14 days, or longer?) I'll set sensible defaults but want to match what's working in Manus now.
4. **Lead magnet copy** — do you want me to draft fresh drip emails in your voice, or will you export the Manus copy for me to adapt?
