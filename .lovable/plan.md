
# Unify Circle's color system with AOS

## The good news

The AOS palette and Circle's tokens are already the same paint:

| AOS | Circle token | Value |
|---|---|---|
| Paper bg | `--cream` / `--background` | `#F4F3EF` |
| Card paper | `--card` | `#FCFBF9` |
| Ink (text + CTA) | `--ink` / `--foreground` | `#1A1918` |
| Orange marker | `--signal` / `--gold` | `#E4573D` |
| Muted text | `--muted-foreground` | `#8E8B82` |
| Border warm | `--border` / `--paper-edge` | `#E2DED6` |

Fonts already match (Instrument Serif headings, mono eyebrows). So this is **not** a redesign — it's an enforcement pass to drag every surface onto the shared tokens.

## What changes

Per your read: keep editorial type, keep layouts, **just change colors** so a member moving between AOS and Circle feels they're inside one product.

### 1. Audit + replace off-token colors across the portal

Sweep every component under `src/components/portal/` and every authenticated route, replacing hardcoded Tailwind colors with semantic tokens:

| Off-token (current) | → | On-token (AOS) |
|---|---|---|
| `bg-white`, `bg-slate-*`, `bg-zinc-*`, `bg-neutral-*` | → | `bg-cream` / `bg-card` / `bg-paper-edge` |
| `text-black`, `text-slate-900`, `text-zinc-900` | → | `text-ink` / `text-foreground` |
| `text-gray-500`, `text-slate-500` | → | `text-muted-foreground` |
| `border-gray-*`, `border-slate-*` | → | `border-border` / `border-paper-edge` |
| any blue/indigo/purple accents | → | `text-signal` / `bg-signal` (orange-red) |
| any emerald/green status (non-success-state) | → | `text-signal-green` only for true success states |

Files most likely to drift (will verify file-by-file):
- `app-sidebar.tsx`, `top-strip.tsx`, `tool-drawer.tsx`
- `compute-stream.tsx`, `compute-theater.tsx`, `signal-tiles.tsx`, `packet-card.tsx`, `todays-move.tsx`, `home-hero.tsx`, `aos-hero.tsx`, `aos-pulse.tsx`, `greeting-icon.tsx`, `page-header.tsx`, `handbook-anchor.tsx`
- Tool components: `contract-readiness-tool.tsx`, `estimate-throughput-tool.tsx`, `margin-leak-tool.tsx`, `sop-priority-tool.tsx`, `sop-document-builder.tsx`
- Routes: `index.tsx`, `tools.tsx`, `vault.tsx`, `calls.tsx`, `community.tsx`, `ask.*.tsx`, `field-tools.tsx`, `replays.tsx`, `templates.tsx`, `account.tsx`, `upgrade.tsx`, `work-with-marshall.tsx`, `admin.*.tsx`

### 2. Tune ALP Engine (tool compute UI) to AOS palette

Keep the layout (left inputs / right compute+finding) and the paper feel. Pull these specifically:
- Compute stream lines: ink on cream, mono caption color `--muted-foreground`, no slate/zinc.
- Step pulse + finding callouts: `--signal` orange-red, not blue/indigo.
- Finding card: cream/card surface with `border-paper-edge`, ink heading in Instrument Serif, mono eyebrow.
- Live "thinking" dots: `--signal` at 60% opacity.

### 3. Sign-in pages — color only (no layout change)

Confirmed: keep AuthCard, keep "Boring wins.", keep `bulldozer` image. Sweep for any stray non-token color the same way. (Quick scan: AuthCard already uses `bg-cream`, `text-ink`, `border-ink/*` — likely zero changes here, will verify.)

### 4. Add two small shared accents from AOS

To make the kinship obvious without adding new components:
- **Orange eyebrow rule**: the small orange `─── EYEBROW` treatment used above AOS section headers — already exists as `.eyebrow--accent` in handbook styles, lift it into `src/styles.css` as a portal-wide `.eyebrow-rule` utility and use it on page headers.
- **Marker-circle annotation** (optional, for the home hero only): the orange handwritten "who owns this?" / "fix weekly" annotation feel — apply as a small italic-serif `--signal` caption next to one or two home tiles ("watch this week", etc.). One subtle nod, not a full scorecard recreation.

### 5. Handbook stays as-is

The handbook reader already uses warm paper + Instrument Serif + orange brand accent via `--hb-brand-accent: hsl(24 95% 53%)` — that's the same orange. No change needed.

## Technical notes

- All work is in component class names and `src/styles.css`. No business logic, no schema, no server functions.
- Tokens in `:root` don't need to change — values already match AOS. The lift is search-and-replace at the component level.
- I'll grep the codebase for `bg-white|bg-slate|bg-zinc|bg-neutral|text-gray|text-slate|text-zinc|border-gray|border-slate|indigo|emerald|blue-[456]00|purple` and walk each hit.
- After the sweep, I'll spot-check the home, tools, vault, calls, and ask routes against the AOS screenshot to confirm visual parity.

## Out of scope

- No new scorecard hero on the portal home (you said no to that).
- No layout changes anywhere.
- No copy changes.
- No type changes (already aligned).

## Deliverable

One PR-sized pass that, after merge, makes Circle and AOS look like the same product when you tab between them.
