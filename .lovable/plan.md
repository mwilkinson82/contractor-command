## Goal

Replace the Manus/Resend welcome sequence with our own end-to-end purchaser onboarding — owned by us, branded like the portal, and behaviorally smart (don't nag people who already did the thing).

Four moving parts, sequenced so each one is independently shippable.

---

## Part 1 — Fix the Stripe webhook (blocker)

Nothing downstream works until Stripe actually fires events at us. Right now it's still pointed at Manus, which is why Cesar's purchase never hit our handler.

- Code-side, our endpoint is already live: `https://contractor-command.lovable.app/api/public/stripe/webhook` (in `src/routes/api/public/stripe/webhook.ts`). Already wired to `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.
- Action: you add our URL as a **second destination** in Stripe Dashboard → Developers → Webhooks (don't delete Manus's yet — keeps that flow alive while we cut over). Required events: `customer.subscription.created/updated/deleted`, `checkout.session.completed`, `invoice.payment_failed`.
- Stripe will give you a new signing secret for that destination — paste it into Lovable as `STRIPE_WEBHOOK_SECRET` (overwrites the existing one; ours becomes authoritative).
- I'll add a `/admin` widget showing the last 10 webhook events received (recipient email, event type, status) so you can verify in real-time the next time someone buys.
- Once you confirm a live purchase routes correctly, we kill the Manus destination in Stripe.

---

## Part 2 — One rich welcome email (replace the bare invite)

One email, fires immediately from the Stripe webhook → `subscriptions` upsert path. This is the existing invite call in `webhook.ts` (`invitePaidMemberIfNeeded`), just with a much richer template.

Content (ported from the Manus screenshots, restructured in our voice):
1. **Founding Member eyebrow** + Instrument Serif headline: *"{firstName}, welcome to the Circle."*
2. **Set your password** pill CTA → opens portal at `/welcome` (one-time invite link, same as today)
3. **Step 01 — Join the Discord** (with our new invite link)
4. **Step 02 — Add the bi-weekly call** (Sunday 5 PM ET, Zoom link, Google/Apple/Outlook calendar links)
5. **Step 03 — Start executing in the portal** (Vault, replays, AOS engine)
6. **Your membership includes** (paper card with checkmark list)
7. **Founding Member status** (Price Locked / Limited Spots / You're Shaping What This Becomes)
8. **Marshall quote** (Instrument Serif italic, signal-orange left rule) — the $2.5B / access / community quote
9. Sign-off + footer

Aesthetic: paper card on white, Instrument Serif headlines, JetBrains Mono eyebrows/step numbers, signal orange accents. Same system as the current `invite.tsx`, just expanded into a full sequence of nested paper sections.

Files: rewrite `src/lib/email-templates/invite.tsx`. Re-render to `/mnt/documents/welcome-invite-email.html` for visual review. No callsite changes needed — same props (`siteName`, `siteUrl`, `confirmationUrl`), plus optional `firstName` extracted from Stripe customer name.

---

## Part 3 — Two conditional nudge emails

A pg_cron job runs every 30 minutes, scans recent purchasers, and sends nudges only when warranted. Both nudges use the same paper aesthetic — short, single-purpose, one CTA.

**Nudge A — "Set your password" (login nudge)**
- **Trigger:** subscription was created ≥ 2 hours ago AND the matching `auth.users` row still has `last_sign_in_at IS NULL` (i.e. they never completed the invite flow).
- **Copy:** *"Your seat is waiting."* — one sentence, fresh magic-link button, mention it expires in 24h.
- **One-shot:** flagged on the subscription row so we don't re-nag.

**Nudge B — "Get into the Discord"**
- **Trigger:** subscription was created ≥ 24 hours ago AND the member is not yet in our Discord guild. This is where Part 4 (our own bot) earns its keep — the bot maintains a `discord_members` table mapping email → discord user ID, so we can answer "did they join?" with a simple join.
- **Copy:** *"The room is where the magic is."* — short, Discord invite button, one-line preview of who's currently active in `#general-chat`.
- **One-shot.**

New schema (one migration):
```
alter table subscriptions
  add column welcome_sent_at      timestamptz,
  add column login_nudge_sent_at  timestamptz,
  add column discord_nudge_sent_at timestamptz;

create table discord_members (
  email text primary key,
  discord_user_id text not null,
  discord_username text,
  joined_guild_at timestamptz not null default now()
);
```

Cron + dispatcher: TanStack server route at `/api/public/cron/onboarding-nudges` (HMAC-protected with `CRON_SECRET`), scheduled via `pg_cron` every 30 minutes. It picks eligible rows, calls `sendTransactionalEmail` for each, stamps the timestamp.

New templates: `src/lib/email-templates/login-nudge.tsx`, `discord-nudge.tsx`. Registered in `registry.ts`.

---

## Part 4 — Our own Discord welcome bot

Goal: replace Mattis's bot end-to-end. Two responsibilities:
1. **Welcome new joiners** — when someone joins the ALP guild, DM them + post a styled welcome embed in `#welcome` pinging them and pointing to the right channels.
2. **Maintain the `discord_members` table** — so Part 3's Discord nudge knows who's already in.

### Architectural reality check

Discord bots that listen for `GUILD_MEMBER_ADD` events need a **persistent WebSocket connection** to Discord's gateway. Cloudflare Workers (which is what runs our TanStack server) can't hold long-lived sockets — they're request/response only. So the bot can't live inside this codebase.

**Two viable options — I want your call before I build:**

- **Option 4a — Hosted bot (Railway / Fly.io, ~$5/mo):** A tiny Node.js process I write in this repo under `bot/`, deployed separately. It connects to Discord's gateway, handles join events, and POSTs to a webhook on our portal (`/api/public/discord/member-joined`) which writes to `discord_members`. You'd need to give me a Discord bot token (you create one at discord.com/developers, takes 2 minutes — I'll walk you through it) and pick a host. Most flexible, most ALP-controlled, costs a few bucks a month.

- **Option 4b — Discord HTTP Interactions only:** No persistent connection — Discord pings our webhook for slash commands only. We **can't** detect joins this way (Discord doesn't push join events over HTTP). So for the Discord nudge to work, we'd fall back to: assume they haven't joined unless they click a tracked invite link. Less accurate but zero hosting.

If you want the *real* welcome bot experience (auto-DM, auto-welcome embed, accurate join tracking), it's 4a. If you just want "good enough" with no extra infra, it's 4b.

### What the bot writes (Option 4a)

- Welcome embed in `#welcome`: ALP paper aesthetic translated to Discord embed colors, pings the user, lists the 3 channels they should visit.
- DM to the new member: short, signed "— Marshall & the ALP team", links to the portal and the bi-weekly call.
- Slash command `/circle whoami` for members to check their membership status.

---

## Recommended build order

1. **Part 1 first** (you add the webhook destination + paste the secret — 5 minutes on your end). Until this is done, none of the rest matters.
2. **Part 2** — rebuild the welcome email. Ship it. You can resend manually to Cesar to verify.
3. **Part 3** — schema + nudge templates + cron. Ship it.
4. **Part 4** — decide 4a vs 4b, then build.

---

## Out of scope (call out)

- Reskinning the other transactional templates (`topic-selected`, `vault-packet`, etc.) — they still use the old Georgia/Arial look. Worth a follow-up pass.
- An in-app `/admin/emails` preview gallery — still open from earlier. Easy add anytime.
- Migrating Mattis's existing Discord bot logic. Once ours is live, you remove his bot from the server and we're done.

---

## What I need from you before I start

1. Confirm you'll add our webhook URL to Stripe (Part 1) and what timing works.
2. Pick **4a** (hosted bot) or **4b** (HTTP only) for the Discord bot.
3. Confirm the Discord invite URL I should use in emails + the bot.
