# Restyling ALPOS to match the Circle portal

This doc is meant to be **pasted directly into the ALPOS Lovable project's chat** to its AI. It tells that AI exactly what to do, what to leave alone, and gives it the full CSS to drop in.

ALPOS and Circle already share the same stack (TanStack Start + Tailwind v4 + shadcn/ui sidebar + `oklch` tokens), so this is a theme swap, not a rewrite. **No component logic should change.**

---

## Goal

Make ALPOS feel like the same product as Contractor Circle (`app.alpcontractorcircle.com`). One visual system across both apps so a member moving between them never feels the seam.

Reference aesthetic: Instance.io / Neuform — warm paper, deep ink, orange-red signal, Instrument Serif italic display, JetBrains Mono labels, tech-frame corner brackets, 20px rounded cards.

---

## Scope — what to change

1. **Replace `src/styles.css`** with the file at the bottom of this doc.
2. **Add Instrument Serif + JetBrains Mono** (the new `styles.css` already imports them via Google Fonts — nothing extra to install).
3. **Audit a handful of components** that hardcode the old palette:
   - Anywhere a button uses `bg-gold` / gold gradients as the primary CTA → switch to `bg-primary text-primary-foreground` (primary is now ink/black, not gold).
   - Anywhere the old `blue` accent is used decoratively → it now maps to signal-green; if you want orange-red, use `text-signal` / `bg-signal`.
   - Replace any `font-display` headline that used Fraunces' weight 600/700 — Instrument Serif is weight 400 only, so drop `font-semibold`/`font-bold` on serif headings.
4. **Sidebar logo**: keep `alpLogo` but render the wordmark in `font-display italic` to match Circle's brand voice.

## Scope — what NOT to touch

- Auth flows, RLS, server functions, Stripe wiring, Supabase schema — none of this is visual.
- Component logic (Dashboard, Vision/V/TO, Rocks, L10, Scorecard) — only their classNames if a hardcoded color slips through.
- Routes, file structure, `_app.tsx` layout — already correct.
- The dark mode block (focus panels like the L10 timer) — leave as-is for now; can be retuned later.

---

## Visual primitives the new CSS gives you

After dropping in the new `styles.css`, these utilities become available app-wide:

- `font-display` → Instrument Serif (italic-forward serif for headlines)
- `font-mono` / `.mono` → JetBrains Mono (use for stat numbers, timestamps, labels)
- `.label-mono` → small serif caption for chrome labels ("ROCKS · Q1", "SCORECARD")
- `.label-signal` → italic serif with built-in pulsing signal dot — perfect for "● Live · L10 in progress"
- `.tech-frame` + `.bracket-corners` (with `.bc-tl/tr/bl/br` spans) → corner-bracket inset frames for hero sections
- `.grid-field-dots` + `.grid-field-glow` → ambient dotted background for hero bands
- `.hover-lift` → soft 1px translateY + shadow on hover, app-wide
- `[data-reveal]` → fade-in-on-scroll. Add to any element; a small effect in your root component reveals them as they enter the viewport (see "Reveal-on-scroll wiring" below)
- `.auth-rise` + `.auth-rise-delay-{1,2,3}` → soft lift+fade entrance for login/signup cards
- `.animate-signal-pulse` → pulsing orange-red dot for "live" indicators

All of these respect `prefers-reduced-motion`.

---

## Reveal-on-scroll wiring (one-time setup)

Add this effect once in `src/routes/__root.tsx` (or wherever you have a top-level layout) so any element with `data-reveal` fades in as it scrolls into view:

```tsx
useEffect(() => {
  const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
  );
  els.forEach((el) => io.observe(el));
  return () => io.disconnect();
}, []);
```

Then sprinkle `data-reveal` (and optional `data-reveal-delay="1..6"`) on hero sections, card grids, etc.

---

## Component-level mapping cheatsheet

| ALPOS today | Change to |
|---|---|
| `bg-gold text-ink` button | `bg-primary text-primary-foreground` (primary is now ink/black) |
| `text-blue` decorative accent | `text-signal-green` (or `text-signal` for orange-red attention) |
| `<h1 className="font-display font-bold">` | `<h1 className="font-display italic">` |
| Hero stat number | wrap in `<span className="font-mono tabular-nums">` |
| Section eyebrow ("DASHBOARD") | `<p className="label-mono">Dashboard</p>` |
| "● Live" indicator | `<span className="label-signal">Live · L10 in progress</span>` |
| Card hover | add `hover-lift` to the card |
| Hero band ambient bg | wrap in a relative div with `<div className="absolute inset-0 grid-field-dots" />` + `<div className="absolute inset-0 grid-field-glow" />` |

---

## Sidebar tweak

In `src/components/app-sidebar.tsx`, the brand block at the top should match Circle. Suggested header:

```tsx
<SidebarHeader>
  <div className="flex items-center gap-2 px-2 py-3">
    <img src={alpLogo} alt="ALP" className="h-6 w-6" />
    {!collapsed && (
      <span className="font-display italic text-lg leading-none">
        AOS<span className="text-signal">.</span>
      </span>
    )}
  </div>
</SidebarHeader>
```

(Use "AOS" — the product name — not "EOS" or "ALPOS" in user-visible copy.)

---

## QA checklist after the swap

- Background is warm paper (slightly cooler than before), not yellow-cream.
- Primary buttons are **black with cream text**, not gold.
- Headlines render in Instrument Serif (italic-forward), body in Helvetica/Inter.
- Card radius is noticeably rounder (20px).
- Sidebar still works, dashboard still loads data, L10 timer still functions — no logic regressions.
- On mobile, the sidebar drawer still opens via the trigger, and a "live" pulse dot is visible in the header.

---

## The full `src/styles.css` to drop in

Replace the entire current `src/styles.css` with this:

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap");
@import "tailwindcss" source(none);
@source "../src";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/*
 * AOS — ALP Operating System (Contractor Circle aesthetic)
 * Warm paper, deep ink, orange-red signal, technical inset framing, mono labels.
 * All colors expressed in oklch. Matches the Circle portal one-to-one.
 */

@theme inline {
  --font-sans: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Instrument Serif", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-serif: "Instrument Serif", ui-serif, Georgia, serif;

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  --radius-3xl: calc(var(--radius) + 16px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-ring-offset-background: var(--background);

  --color-cream: var(--cream);
  --color-ink: var(--ink);
  --color-ink-panel: var(--ink-panel);
  --color-gold: var(--gold);
  --color-gold-soft: var(--gold-soft);
  --color-blue: var(--blue);
  --color-blue-soft: var(--blue-soft);
  --color-signal: var(--signal);
  --color-signal-green: var(--signal-green);
  --color-signal-success: var(--signal-success);
  --color-paper-edge: var(--paper-edge);

  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --shadow-elegant: 0 10px 40px -20px oklch(0.18 0.005 60 / 0.25);
  --shadow-soft:
    0 1px 2px 0 oklch(0.18 0.005 60 / 0.05),
    0 4px 16px -4px oklch(0.18 0.005 60 / 0.08);
  --shadow-focus: 0 40px 100px -50px oklch(0.12 0.004 60 / 0.55);
}

:root {
  --radius: 1.25rem;

  --cream: oklch(0.965 0.005 80);
  --paper-deep: oklch(0.945 0.006 80);
  --ink: oklch(0.21 0.005 60);
  --ink-panel: oklch(0.26 0.005 60);
  --signal: oklch(0.66 0.17 36);
  --signal-green: oklch(0.78 0.14 165);
  --signal-success: oklch(0.72 0.17 148);
  --gold: oklch(0.66 0.17 36);
  --gold-soft: oklch(0.94 0.04 40);
  --blue: oklch(0.78 0.14 165);
  --blue-soft: oklch(0.94 0.04 165);
  --paper-edge: oklch(0.88 0.008 75);

  --background: oklch(0.965 0.005 80);
  --foreground: oklch(0.21 0.005 60);
  --card: oklch(0.987 0.004 80);
  --card-foreground: oklch(0.21 0.005 60);
  --popover: oklch(0.987 0.004 80);
  --popover-foreground: oklch(0.21 0.005 60);

  --primary: oklch(0.21 0.005 60);
  --primary-foreground: oklch(0.987 0.004 80);
  --secondary: oklch(0.93 0.006 75);
  --secondary-foreground: oklch(0.21 0.005 60);
  --muted: oklch(0.93 0.006 75);
  --muted-foreground: oklch(0.55 0.008 70);
  --accent: oklch(0.66 0.17 36 / 0.1);
  --accent-foreground: oklch(0.55 0.17 36);
  --destructive: oklch(0.55 0.2 27);
  --destructive-foreground: oklch(0.99 0 0);
  --border: oklch(0.9 0.007 75);
  --input: oklch(0.9 0.007 75);
  --ring: oklch(0.66 0.17 36 / 0.4);

  --chart-1: oklch(0.66 0.17 36);
  --chart-2: oklch(0.78 0.14 165);
  --chart-3: oklch(0.65 0.12 160);
  --chart-4: oklch(0.7 0.15 35);
  --chart-5: oklch(0.5 0.08 290);

  --sidebar: oklch(0.945 0.006 80);
  --sidebar-foreground: oklch(0.21 0.005 60);
  --sidebar-primary: oklch(0.21 0.005 60);
  --sidebar-primary-foreground: oklch(0.987 0.004 80);
  --sidebar-accent: oklch(0.66 0.17 36 / 0.1);
  --sidebar-accent-foreground: oklch(0.21 0.005 60);
  --sidebar-border: oklch(0.9 0.007 75);
  --sidebar-ring: oklch(0.66 0.17 36 / 0.4);
}

.dark {
  --background: oklch(0.22 0.012 80);
  --foreground: oklch(0.97 0.01 85);
  --card: oklch(0.26 0.014 80);
  --card-foreground: oklch(0.97 0.01 85);
  --popover: oklch(0.26 0.014 80);
  --popover-foreground: oklch(0.97 0.01 85);
  --primary: oklch(0.987 0.004 80);
  --primary-foreground: oklch(0.21 0.005 60);
  --secondary: oklch(0.3 0.014 80);
  --secondary-foreground: oklch(0.97 0.01 85);
  --muted: oklch(0.3 0.014 80);
  --muted-foreground: oklch(0.72 0.015 80);
  --accent: oklch(0.66 0.17 36 / 0.2);
  --accent-foreground: oklch(0.78 0.14 36);
  --destructive: oklch(0.65 0.2 27);
  --destructive-foreground: oklch(0.99 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 12%);
  --ring: oklch(0.66 0.17 36 / 0.5);
  --sidebar: oklch(0.22 0.012 80);
  --sidebar-foreground: oklch(0.97 0.01 85);
  --sidebar-primary: oklch(0.987 0.004 80);
  --sidebar-primary-foreground: oklch(0.21 0.005 60);
  --sidebar-accent: oklch(0.3 0.014 80);
  --sidebar-accent-foreground: oklch(0.97 0.01 85);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.66 0.17 36 / 0.5);
}

@layer base {
  * { border-color: var(--color-border); }
  html, body {
    background-color: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    font-feature-settings: "ss01", "cv11";
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  a, button, [role="button"], summary,
  input, textarea, select,
  [data-slot="button"], [data-slot="card"], [data-slot="sidebar-menu-button"] {
    transition:
      color 200ms ease,
      background-color 200ms ease,
      border-color 200ms ease,
      box-shadow 220ms ease,
      transform 220ms cubic-bezier(.2,.7,.2,1),
      opacity 200ms ease;
  }
  @media (max-width: 640px) {
    input, textarea, select { font-size: 16px; }
  }
  h1, h2, h3, .font-display {
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: -0.01em;
  }
  .font-mono, .mono { font-family: var(--font-mono); }
  .label-mono {
    font-family: var(--font-serif);
    font-size: 0.95rem;
    color: var(--muted-foreground);
    line-height: 1.1;
  }
  .label-signal {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 0.95rem;
    color: var(--signal);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .label-serif {
    font-family: var(--font-serif);
    font-style: italic;
    color: var(--muted-foreground);
  }
  .label-signal::before {
    content: "";
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 2px;
    background-color: oklch(0.66 0.17 36 / 0.1);
    border: 1px solid oklch(0.66 0.17 36 / 0.3);
    background-image: radial-gradient(circle, var(--signal) 0, var(--signal) 1.5px, transparent 1.5px);
    background-position: center;
    background-repeat: no-repeat;
  }
}

/* Tech-frame corner brackets */
@utility tech-frame { position: relative; }
.tech-frame::before {
  content: "";
  position: absolute;
  inset: 1rem;
  border: 1px solid var(--paper-edge);
  border-radius: calc(var(--radius) + 0.25rem);
  pointer-events: none;
}
.bracket-corners > span {
  position: absolute;
  width: 1.25rem;
  height: 1.25rem;
  border-color: var(--paper-edge);
  pointer-events: none;
}
.bracket-corners > .bc-tl { top: 1rem; left: 1rem; border-top: 1px solid; border-left: 1px solid; border-top-left-radius: calc(var(--radius) + 0.25rem); }
.bracket-corners > .bc-tr { top: 1rem; right: 1rem; border-top: 1px solid; border-right: 1px solid; border-top-right-radius: calc(var(--radius) + 0.25rem); }
.bracket-corners > .bc-bl { bottom: 1rem; left: 1rem; border-bottom: 1px solid; border-left: 1px solid; border-bottom-left-radius: calc(var(--radius) + 0.25rem); }
.bracket-corners > .bc-br { bottom: 1rem; right: 1rem; border-bottom: 1px solid; border-right: 1px solid; border-bottom-right-radius: calc(var(--radius) + 0.25rem); }

/* Signal pulse */
@keyframes signal-pulse {
  0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 oklch(0.66 0.17 36 / 0.5); }
  50%      { opacity: 0.7; transform: scale(1.05); box-shadow: 0 0 0 6px oklch(0.66 0.17 36 / 0); }
}
.animate-signal-pulse { animation: signal-pulse 2.4s ease-in-out infinite; }

/* Ambient grid for hero band */
.grid-field-dots {
  background-image: radial-gradient(circle at 1px 1px, oklch(0.21 0.005 60 / 0.08) 1px, transparent 0);
  background-size: 28px 28px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 35%, black 35%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 35%, black 35%, transparent 75%);
}
.grid-field-glow {
  background:
    radial-gradient(circle at 18% 20%, oklch(0.66 0.17 36 / 0.10), transparent 45%),
    radial-gradient(circle at 80% 30%, oklch(0.78 0.14 165 / 0.08), transparent 50%);
  animation: drift 18s ease-in-out infinite alternate;
}
@keyframes drift { 0% { transform: translate3d(0,0,0); } 100% { transform: translate3d(0,-10px,0); } }

/* Reveals + entrance */
.reveal-up { opacity: 0; transform: translateY(8px); animation: reveal-up 600ms cubic-bezier(.2,.7,.2,1) forwards; }
@keyframes reveal-up { to { opacity: 1; transform: translateY(0); } }

@keyframes auth-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.auth-rise { opacity: 0; animation: auth-rise 720ms cubic-bezier(.2,.7,.2,1) forwards; }
.auth-rise-delay-1 { animation-delay: 80ms; }
.auth-rise-delay-2 { animation-delay: 180ms; }
.auth-rise-delay-3 { animation-delay: 300ms; }

[data-reveal] {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 700ms cubic-bezier(.2,.7,.2,1),
    transform 700ms cubic-bezier(.2,.7,.2,1);
  will-change: opacity, transform;
}
[data-reveal].is-visible { opacity: 1; transform: translateY(0); }
[data-reveal][data-reveal-delay="1"] { transition-delay: 60ms; }
[data-reveal][data-reveal-delay="2"] { transition-delay: 120ms; }
[data-reveal][data-reveal-delay="3"] { transition-delay: 180ms; }
[data-reveal][data-reveal-delay="4"] { transition-delay: 240ms; }
[data-reveal][data-reveal-delay="5"] { transition-delay: 300ms; }
[data-reveal][data-reveal-delay="6"] { transition-delay: 360ms; }

.hover-lift {
  transition:
    transform 240ms cubic-bezier(.2,.7,.2,1),
    box-shadow 240ms cubic-bezier(.2,.7,.2,1),
    border-color 240ms ease;
}
.hover-lift:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 30px -16px oklch(0.18 0.005 60 / 0.25);
}

@media (prefers-reduced-motion: reduce) {
  .auth-rise, .auth-rise-delay-1, .auth-rise-delay-2, .auth-rise-delay-3 { animation: none; opacity: 1; }
  [data-reveal] { opacity: 1 !important; transform: none !important; transition: none !important; }
  .hover-lift { transition: none; }
  .hover-lift:hover { transform: none; box-shadow: none; }
}

/* Print styles preserved from original ALPOS */
@media print {
  @page { margin: 0.6in; }
  html, body { background: #fff !important; color: #111 !important; }
  [data-sidebar], header.sticky, .no-print { display: none !important; }
  main { padding: 0 !important; }
  .print-page { max-width: none !important; padding: 0 !important; }
  .print-block, table, .card, [class*="rounded-xl"] { break-inside: avoid; page-break-inside: avoid; }
  .bg-card, .bg-background, .bg-muted\/50, .bg-card\/50 { background: #fff !important; }
  .text-muted-foreground { color: #555 !important; }
  a { color: #111 !important; text-decoration: none !important; }
  .print-only { display: block !important; }
}
.print-only { display: none; }
```

---

## After the swap — staged follow-ups (don't do all at once)

1. **Stage 1 (this doc):** swap CSS, fix hardcoded gold/blue button colors, add reveal-on-scroll wiring. Done.
2. **Stage 2:** retouch the Dashboard hero with `tech-frame` + `grid-field-dots` + `label-signal` for the "live" indicator.
3. **Stage 3:** add a Circle-branded loading screen for the SSO return route (`/sso/return`) so the cross-app jump feels native — ink background, gold pulse, "Connecting to your Command Center…".
4. **Stage 4:** revisit the L10 timer focus panel — it can stay dark-themed but should pull its dark tokens from the new `.dark` block in this CSS, not its own.

End of brief.
