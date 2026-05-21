## What changes

Two surfaces stop being dark ink/gold and become warm paper/ink to match the rest of the portal (Backfill, Handbook, Home):

1. **`/aos` — the AOS gateway page** (the "Welcome back. Step inside." screen)
2. **The full-screen interstitial overlay** that appears while AOS is being opened ("Opening the door / Opening AOS in a new tab…")

The `/aos/link` page is already on the light palette and doesn't need work.

## Design move

Keep the entire composition — same headline, same sub copy, same CTA position, same right-column "What lights up inside" card, same step-eyebrow, same allowance pills, same reveal animations. Only the skin changes.

**Palette swap (gateway + interstitial):**
- Background: `bg-ink text-cream` → `bg-background text-foreground` (warm paper)
- Ambient dot field: cream dots on ink → ink dots on paper at low opacity
- Ambient warm glow: gold radial on the right → softer warm/clay radial, lower intensity (paper doesn't take heavy bloom)
- Scan line: gold gradient → ink/30 gradient
- Cream-tint borders/fills (`border-cream/10`, `bg-cream/[0.03]`) → `border-border`, `bg-card`
- Body copy `text-cream/75` → `text-muted-foreground`
- Eyebrow `label-mono !text-cream/55` → standard `label-mono` (already muted)

**CTA — Enter AOS:**
- Currently solid gold pill on ink. On paper, solid gold reads loud and breaks the calm. Switch to **solid ink button with cream text** (matches the "Run for real" button on Backfill that you just praised), keeping the Compass + ArrowUpRight icons and the hover lift.

**Right card — "What lights up inside":**
- `border-cream/10 bg-cream/[0.03]` → `border-border bg-card`
- Bullet dots stay warm (use `--gold` or `--clay`) at small size so the list still has a spark of color
- Title text → `text-foreground`, body → `text-muted-foreground`

**Interstitial overlay (full-screen while minting):**
- Same paper background, same ink text
- Ping/ring around the Compass icon uses ink/clay instead of gold-on-ink
- Headline stays serif display, sub copy stays mono uppercase eyebrow — just inverted to dark-on-light

## Files touched

- `src/routes/aos.index.tsx` — palette swap on the section wrapper, ambient layers, CTA, right card, interstitial overlay, and all text-color utility classes. Layout, copy, animations, server-fn logic untouched.

## Out of scope

- `src/components/portal/aos-hero.tsx` (the in-portal "Start your AOS" hero) — this is a different surface; not in screenshot. Leave for a follow-up if you want it reskinned too.
- `src/routes/aos.link.tsx` — already light.
- No copy changes, no structural changes, no animation changes.
