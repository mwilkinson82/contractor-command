## What's changing

### 1. Welcome email — full redesign (not a tweak)

Throw out the Manus step-card breakdown entirely. Rebuild as a single editorial composition modeled on the login screen ("Boring wins.") — print-ad bones, modern tech overlay, one unified paper tone all the way down.

**Visual rules (one consistent paper, no boxed cards):**
- One paper background end to end (`#F4F3EF`). No nested cards with different beige tones, no rounded boxes stacked on top of each other. That mismatched-coloring problem goes away because there's only one surface.
- A single hairline column down the page does all the structure — section labels in tiny uppercase mono, big Instrument Serif headlines, justified columnar body copy where it makes sense.
- Signal orange used only as: top 2px rule, a couple of inline accents, and the "Set your password" button. Nothing else colored.
- Headline pattern from the login: oversized serif with a hard `<br>` break ("Welcome / inside."). One big moment up top, not three step-card titles competing.

**Composition (top to bottom, one continuous page):**
1. Orange hairline rule.
2. Tiny eyebrow: `ALP · CONTRACTOR CIRCLE — FOUNDING MEMBER`.
3. Hero serif headline: `Cesar, / welcome inside.` (personalized when we have the name; falls back cleanly).
4. Short editorial lede — 2 sentences, copy-driven, no "step 01 of 03" framing.
5. Primary CTA: pill button `SET YOUR PASSWORD` + one-line subtext with the portal link.
6. Hairline rule.
7. **"What you actually get."** — a 3-column justified-prose block in the login's voice. Each column covers one truth, not a step number:
   - **The room.** Bi-weekly Sundays 5 PM ET with Marshall, monthly deal reviews, monthly bootcamps. The Zoom: correct link (`us06web.zoom.us/j/83215167292`), correct Zoom ID `832 1516 7292`, passcode `321266` — pulled straight from the live Calls page so it can't drift.
   - **The Discord.** Where the room lives between calls. One-liner on how to intro yourself, link to join.
   - **The Engine.** This is the section that was missing. Names **Ask Marshall** (private thinking partner trained on the system), **Vault** (contracts, SOPs, scorecards), **Replays**, and the **AOS Command Tools** by name — Contract Readiness, Margin Leak, Estimate Throughput, SOP Priority, Owner Dependency, Growth Constraint. Frames them as "the operating system, not a dashboard."
8. Hairline rule.
9. Marshall pull-quote in Instrument Serif italic, left-ruled with the orange hairline (no boxed card — just the rule + the type).
10. Hairline rule.
11. **"What founding member means."** — three tight one-liners in justified prose: price locked, seats capped, you shape what this becomes. No subheadings stacking up.
12. Final CTA repeat.
13. Signoff: "— Marshall & the ALP team".
14. Footer micro-copy: tiny uppercase tracking, `$2.5 BILLION IN CONSTRUCTION` style.

**Type system (matches login exactly):** Instrument Serif for all headlines, Helvetica/Arial for body, JetBrains Mono for eyebrows/labels/button text. Justified body with hyphenation in the 3-column block. Same letter-spacing values as the auth shell.

### 2. Zoom data — pull from one source

The Zoom URL, ID, and passcode currently come from defaults inside the email template. That's how the wrong link slipped in. New approach: read them from the Calls config (same place the Calls page renders them) and pass them into the email render at send time. One source of truth. Fix the immediate value to the link you sent.

### 3. Re-render the preview

Update `scripts/render-invite.tsx` so the preview HTML in `/mnt/documents/` reflects the new design with the correct Zoom data and the Cesar personalization. You'll see the new file the moment it's regenerated.

### 4. Discord bot — free path

You don't need to pay. Two free options, pick later (this plan doesn't build it yet, just locks the direction):

- **4a — GitHub Actions cron bot (free, recommended).** Tiny Node script in `bot/` that runs on a GitHub Actions schedule (every 15 min). It calls Discord's REST API with a bot token to list current guild members, diffs against our `discord_members` table, and posts a welcome DM + welcome-channel embed for new joiners. No always-on server, no monthly cost, GitHub Actions free tier covers it forever for our volume. Trade-off: up to 15 min delay on the welcome (fine for our use case).
- **4b — Discord bot in a free Fly.io / Render free-tier worker.** Persistent gateway connection, instant welcome. Free tiers exist but they sleep/cold-start, which can drop gateway events. Worse than 4a for reliability at $0.

Recommendation: **4a.** Reliable, truly free, dead simple, and the welcome embed/DM can be as polished as the email.

### 5. Out of scope this round

- Stripe webhook cutover (still needs your action in the Stripe dashboard — separate todo).
- Building the bot itself (decide 4a vs 4b first, then I build).
- Reskinning login-nudge and discord-nudge — I'll port the same one-paper aesthetic to them in the next pass once you sign off on the welcome design.

---

## Technical notes (for me)

- `src/lib/email-templates/invite.tsx` — rewrite from scratch. Drop `stepCard`, `includesCard`, `quoteCard` styled blocks. One `Body` with `PAPER` background, `Container` at 600px, sections separated by `<Hr>` hairlines, not nested cards. All inline styles (React Email constraint). Instrument Serif + JetBrains Mono `@font-face` blocks stay.
- Surface Zoom data: add a `callConfig` import (read from the same module the `/calls` route uses) and thread `zoomUrl` / `zoomId` / `zoomPasscode` through the props. If the Calls page reads from DB, the send function loads it before render.
- Update `scripts/render-invite.tsx` to pass the correct preview values.
- Caller sites (`src/lib/billing.functions.ts` or wherever invite send is wired) get the new props passed in. No schema change.
