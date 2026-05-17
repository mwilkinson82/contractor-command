
## What I heard

The portal is a **command center for paying Contractor Circle members ($497/mo)**, not a marketing site and not a rebuild of AOS. When a member signs in, they should immediately feel: *"this is the cockpit I run my construction business from."* Premium, slim, ChatGPT/Claude-grade simplicity — but contractor-flavored and Marshall-flavored.

What members are actually here for (the non-negotiables):

1. **Biweekly group calls with Marshall** — Zoom link, add-to-calendar, next session front and center
2. **Submit a topic** for the next biweekly call
3. **Monthly Bootcamp** — date, Zoom link, submit a topic for it
4. **Book the 6-Week Intensive** ($5k 1:1 — the real upsell funnel)
5. **Templates library** — contracting templates organized by problem
6. **Replay library** — every Zoom recording, searchable
7. **AOS** — external link to the existing app at alpos.alpcontractorcircle.com
8. **Command Tools** — Growth Constraint Map, Owner Dependency Scorecard, more C-suite tools to come
9. **Discord** — community lives there, one-click join
10. **Field Tools** — Basis, Baseline, ConstructLine, Cost Library, Trade Rate Library
11. **Account / billing** — Stripe customer portal so they can manage their card and subscription

What it must NOT be: a wall of cards, a generic dashboard, a calculator UI, or a rebuild of AOS. The Estimating tool flopped because it was over-featured — keep restraint everywhere.

## Design direction

Slim, editorial, "command center" feel. Building on the Instance.io / Neuform aesthetic already in `src/styles.css`:

- Warm paper background, deep ink, restrained orange-red as signal, mono labels with `· ID ·` style markers
- One focal action per screen, generous whitespace, large radius cards, bracket-corner framing on hero blocks
- ChatGPT/Claude-style minimal nav — no double sidebars, no card walls
- Charcoal ink-panel reserved for the single most important block on each screen (next session, active command tool result)
- "Good morning, Marshall" greeting + live time + next-action focus block as the home centerpiece

## Information architecture (v2)

Single top bar: wordmark · primary nav · member chip / account. No sidebar.

```text
Home (/)                — command center: greeting, next session focus block,
                          submit topic, latest replay, AOS launch, Intensive nudge
Calls (/calls)          — next biweekly + next bootcamp, Zoom + add-to-cal,
                          submit-topic forms (biweekly + bootcamp), full replay library below
Templates (/templates)  — contracting templates by problem (Sell / Estimate / Contract /
                          Launch / Manage / Bill / Lead / Install)
Command Tools (/tools)  — Growth Constraint Map, Owner Dependency Scorecard,
                          "more tools shipping" line. No wall of placeholders.
  /tools/growth-constraint
  /tools/owner-dependency
AOS (/aos)              — short explainer + single "Open AOS" button (external)
Field Tools (/field-tools) — Basis, Baseline, ConstructLine, Cost Library, Trade Rate Library
Vault (/vault)          — saved Command Packets + Issue Packets (operating memory)
Intensive (/work-with-marshall) — 6-Week Intensive positioning + request CTA
Community (/community)  — Discord join + posting etiquette + what lives there
Account (/account)      — profile + Stripe customer portal link + plan status
```

Routes being removed/folded:
- `bring-one-issue.tsx` folds into Calls page as "Submit a topic for the next call" (same five-question structure, but framed as topic submission, not a separate destination)

## Home screen (the most important screen)

Charcoal focus block, centered, with bracket corners:

- `· LIVE ·` Good morning, Marshall · {local time, day}
- Next session: *Biweekly Call — Thu Nov 21, 11:00 AM PT*
- Primary: **Join Zoom** · Secondary: Add to Calendar · Tertiary: Submit a topic
- Below in three slim rows (not cards): latest replay · open AOS · book the Intensive
- Bottom strip: Discord status ("12 members active right now") + jump in

No "stats." No fake metrics. One action, one focus.

## Calls page

Two stacked focus blocks:
1. **Next Biweekly Call** — date, Zoom, add-to-cal, submit-topic form (5 prompts, saves to Vault as Issue Packet, tagged for the session)
2. **Next Monthly Bootcamp** — same pattern, separate topic submission

Below: **Replay library** — chronological list with title, date, tags, related AOS area, replay link. Search + tag filter.

## Tools page

Two real tools live now (Growth Constraint, Owner Dependency). One restrained line: *"More command tools shipping — Cash Position, Sales Pipeline, Hiring Readiness, Estimating Discipline."* No empty cards. Both existing tools keep their charcoal result panel + Command Packet output → Vault.

## AOS, Field Tools, Templates, Intensive, Community, Account, Vault

- AOS — keep as short launcher, no duplication of AOS itself
- Field Tools — five external tools, one-liner each, in a slim list
- Templates — organized by problem, downloadable/copyable
- Intensive — clear positioning, single "Request Intensive" CTA → form posts to Vault + (later) email Marshall
- Community — Discord invite + what's there (channels, etiquette)
- Account — name/email/plan, "Manage subscription" → Stripe portal (placeholder URL in v1, real Stripe portal when Cloud + Stripe wired)
- Vault — unchanged, still the operating memory layer

## Persistence

- **localStorage today** for: saved packets (vault), submitted topics, intensive requests — already partially in place via `src/lib/vault.ts`
- Schemas already shaped for Supabase. **Not enabling Cloud in this pass** — user said feed members first, ship the experience. We can flip persistence to Supabase in a single follow-up once stable.
- Zoom links, replay URLs, call dates: static content for v1 in a typed `src/lib/program.ts` module so Marshall (or me) updates one file. Same for templates metadata and field tool links.

## What I'll build in this pass

1. **Redesign Home** as the command center described above — replace current `index.tsx`
2. **New `/calls`** combining next session + next bootcamp + topic submission + replay library (absorbs `bring-one-issue`)
3. **New `/community`** — Discord-focused
4. **Update `/account`** with subscription management slot
5. **Update top nav** to the new IA (Home · Calls · Tools · Templates · AOS · Field · Vault · Intensive · Community · Account chip)
6. **Add `src/lib/program.ts`** with typed schedule + replays + templates + field tools content so it's one place to edit
7. **Polish all existing pages** to the slim Instance.io aesthetic so the whole portal feels like one product
8. **Remove** the standalone `bring-one-issue.tsx` route (folded into Calls)

## Out of scope this pass

- Real auth / Stripe portal / live Zoom API / Discord OAuth (all stubbed with real-looking content + working forms that save locally)
- The rest of the Command Tools (one honest line, not placeholders)
- Supabase migration (schemas are ready when you say go)
- New estimating tool / Gantt fork

## Open questions before I build

1. **Discord invite URL** — do you have one I should hard-code, or use a placeholder `#` for now?
2. **Stripe customer portal** — same question: real URL or placeholder?
3. **Next biweekly call + next bootcamp dates + Zoom links** — give me real ones for the demo or I'll use realistic placeholders you can swap in `src/lib/program.ts` later?
4. **Replay library** — do you have 3–5 real past sessions (title, date, Zoom recording URL) to seed it with, or should I scaffold realistic placeholders?

If you don't want to answer those now, I'll use clearly-marked placeholders in `program.ts` so you can swap them in a single file.
