## What you're asking

Keep the Circle layout as-is. Just make sure the **colors** read identical to AOS (cream `#F4F3EF` paper, ink `#1A1918`, orange-red `#E4573D` signal, warm muted `#8E8B82`, warm border `#E2DED6`, plus the burnt-orange marker `#b8442a`).

The full audit last turn already swept hardcoded `bg-white`, `text-black`, `bg-gray-*`, `text-red-600`, and the burnt-orange marker into shared tokens (`bg-cream`, `bg-card`, `text-ink`, `text-[color:var(--danger-warm)]`). This pass is just confirmation + cleanup.

## Plan

1. **Screenshot the live portal home** at `/` (logged-in) and visually diff against the AOS reference. Look specifically at:
   - Top strip background + border tone
   - Sidebar surface vs main canvas (both should sit on cream, not pure white)
   - `HomeHero`, `SignalTiles`, `TodaysMove`, `HandbookAnchor`, `AosHero`, `AosPulse`, `PacketCard` — every card surface, eyebrow, divider
   - Orange usage: should be `--signal` (`#E4573D`) for live accents, `--danger-warm` (`#b8442a`) for marker-style annotations only

2. **Fix any residual drift** I find in the screenshot — expected to be small:
   - Any card still rendering on `bg-card` that reads too white against cream → swap to `bg-cream` or `bg-card/60`
   - Any border still on default `border` that reads too cool → confirm `--border` resolves to `--paper-edge` warm tone
   - Any blue/indigo/slate residue in `home-hero.tsx`, `signal-tiles.tsx`, `todays-move.tsx`, `aos-hero.tsx`, `aos-pulse.tsx`

3. **Leave intentionally branded spots alone**:
   - Discord blurple on `/community` and the Discord chip in `routes/index.tsx:339` — those are brand-correct, not drift
   - Handbook tokens — already orange-aligned

4. **No layout, no copy, no type changes.** No new hero, no scorecard graphic on the portal home (you said no to that earlier).

## Technical scope

Files I'd touch *only if* the screenshot shows drift:
- `src/components/portal/home-hero.tsx`
- `src/components/portal/signal-tiles.tsx`
- `src/components/portal/todays-move.tsx`
- `src/components/portal/aos-hero.tsx`
- `src/components/portal/aos-pulse.tsx`
- `src/components/portal/sidebar*.tsx`, `top-strip.tsx` (chrome)
- `src/styles.css` — only if a token itself needs a nudge (e.g., card surface tone)

Out of scope: tool drawer internals, ALP Engine compute UI, handbook reader, sign-in pages (already aligned), Discord/community page.

## Deliverable

A short report of "checked these surfaces, here's what shifted (or: nothing shifted, you're done)." If nothing shifts, the previous sweep was complete and we close this thread.