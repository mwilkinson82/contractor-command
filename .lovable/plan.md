# SOP PDF Restyle — AOS Brand

Adopt the **structure** from the Perplexity mockup (hero with summary panel, banded sections, carded steps, two-column overview, branded footer). Drop its color scheme and fonts entirely. Stay on the existing AOS "ALP Engine" palette already in `src/styles.css` — warm paper cream `#F4F3EF`, deep ink `#1A1918`, signal orange-red `#E4573D`, warm border `#D1CFC7`, Instrument Serif for display, Helvetica Neue for body, JetBrains Mono for labels.

No AI prompt changes. Same JSON shape in / out. **No API cost change.**

## Visual bands (top → bottom)

1. **Hero block** — cream background with a thin signal-orange rule across the top.
   - Eyebrow: `STANDARD OPERATING PROCEDURE` in JetBrains Mono, 8pt, ink-muted.
   - Title: Instrument Serif, ~26pt, tight leading, ink.
   - Metadata row directly under title: `Department · Owner · v1 · Generated May 22, 2026` in 9pt Helvetica, muted.

2. **Summary panel** — single bordered card (warm border, paper-deep fill) holding Purpose, Scope, Trigger as three labeled rows. Replaces the current tracked-out `P U R P O S E` headers with normal small-caps labels (no manual letter-tracking — the kerning bug was fixed earlier, we don't need the workaround anymore).

3. **Inputs / Outputs** — two side-by-side bordered cards, equal width, bulleted.

4. **Procedure** — section heading in Instrument Serif. Each step as a **carded module**:
   - Left rail: square ink badge (~22pt) with white step number, signal-orange accent on the badge's left edge.
   - Right column: bold action line (Helvetica 11pt), then detail in muted 9.5pt with a hanging indent flush to the action text.
   - Subtle warm divider between cards (1pt at 8% ink).
   - Keep-together logic preserved — step card stays intact across page breaks.

5. **Control band** — three small panels in a row: Definition of Done, KPIs, Exceptions/Escalation. KPIs render the existing `Metric → Target` split as a stacked label/value pair inside each row.

6. **Footer bar** — runs on every page: left `AOS · {SOP title}` (clipped), right `v1 · Page N of M · Review {cadence}`, 8pt mono, hairline rule above.

## Color mapping (Perplexity → AOS)

| Perplexity mockup | AOS token |
|---|---|
| `--color-primary` teal `#0d5c63` | `--signal` orange-red `#E4573D` (use sparingly — step badge edge, eyebrow accent, top hero rule) |
| `--color-bg` `#f7f6f2` | `--cream` `#F4F3EF` |
| `--color-surface` `#fcfbf8` | `--card` `#FCFBF9` |
| `--color-surface-2` panel fill | `--paper-deep` `#ECEBE5` |
| `--color-border` | `--paper-edge` `#D1CFC7` |
| `--color-text` / `--color-text-muted` | `--ink` / muted ink |
| Boska display | Instrument Serif |
| Satoshi body | Helvetica Neue |

All rendered in jsPDF as solid RGB equivalents of these oklch tokens (jsPDF can't do oklch directly — we hard-code the matching hex once at the top of the renderer).

## Files touched

- **`src/components/portal/tools/sop-document-builder.tsx`** — only the PDF rendering pipeline. Refactor into small helpers: `drawHero`, `drawSummaryPanel`, `drawTwoColumn`, `drawProcedureCard`, `drawControlBand`, `drawFooter`. Replace the current tracked-label workaround with normal small-caps drawn at 8pt with `setFontSize` (no charSpace).
- No changes to `sop-draft.ts`, `/api/sop-draft.ts`, prompts, schema, or the email template.

## Out of scope (separate decision)

- Adding "Why this matters" / "Common failure" per step — that's the only change that would raise token cost. Hold for a separate go/no-go after you see the restyle.
- Changing the on-screen SOP preview component. This plan is PDF-only since the on-screen view already matches the AOS aesthetic.

## QA

After implementation, render a sample SOP to PDF, convert pages to images, and inspect every page for: footer alignment, step card spacing, keep-together on the Exceptions section, no clipped text, signal-orange used only as accent (never as fill behind body text).
