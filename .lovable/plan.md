## Scheduler Premium Pass — Pass 1 of 4 (Foundation)

Scope this turn only: sections 1 (visual hierarchy), 2 (layout composition), 8 (interaction polish). Build/Schedule/Inspector/Intelligence/Publish surface rework is deferred to passes 2–4 once you accept the new visual language.

Hard guardrails (unchanged across all 4 passes):
- No new scheduling features.
- No edits under `src/lib/scheduler/engine.ts`, `src/lib/scheduler/engine2/**`, `src/lib/scheduler/persistence*`, `src/lib/scheduler/xer*`, `src/lib/scheduler/intel-build-draft*`, `src/lib/scheduler/intel-build*`, dry-run, or Add-to-Schedule action handlers.
- `calculateSchedule` (legacy) remains the production engine. Add-to-Schedule stays disabled. AI-5 not started.

---

### 1. Scheduler design tokens (new file: `src/styles/scheduler-tokens.css`, imported from `src/styles.css`)

Establishes the locked palette as semantic CSS variables so every scheduler surface reads from one source instead of ad-hoc Tailwind classes.

```text
--sched-critical          (red — true critical path / danger ONLY)
--sched-critical-soft     (red tint for row bg)
--sched-near-critical     (amber — near-critical / needs review / assumptions)
--sched-near-critical-soft
--sched-validated         (green — complete / good / validated)
--sched-validated-soft
--sched-graphite          (neutral schedule data: bars, grid lines, text)
--sched-graphite-strong   (axis ticks, header text)
--sched-brass             (Build / Intelligence emphasis ONLY — hero CTAs, AI marks)
--sched-brass-soft
--sched-ivory             (shell background)
--sched-surface           (cool white / slate work surface)
--sched-surface-rule      (1px hairline divider on the work surface)
--sched-overlay           (popover/tooltip background, slight slate tint)
```

All values in `oklch()`. Mapped through `src/styles.css` so Tailwind arbitrary values like `bg-[var(--sched-surface)]` work; semantic shadcn tokens (`--primary`, `--destructive`, etc.) are NOT remapped — those keep their portal meanings outside the scheduler.

### 2. Color hierarchy enforcement (mechanical sweep)

Replace generic SaaS colors that leak into scheduler files:
- `text-blue-*`, `bg-blue-*`, `border-blue-*` → brass or graphite per role.
- `text-red-*`, `bg-red-*` outside true critical-path semantics → graphite or amber.
- `text-green-*`, `bg-green-*` outside true validated semantics → graphite.
- Heavy `bg-muted` + `bg-secondary` pill stacks on form rows → single hairline rule + smaller type.
- Excessive `bg-amber-50 / bg-stone-50 / bg-neutral-50` beige washes → `--sched-surface` with `--sched-surface-rule` borders.

Files in scope:
`src/components/scheduler/CpmGrid.tsx`, `ActivityInspectorPanel.tsx`, `ScheduleKpiBar.tsx`, `DcmaPanel.tsx`, `OpenEndsReport.tsx`, `EmptyScheduleState.tsx`, `IntelBuildWorkspace.tsx`, `IntelChatPanel.tsx`, `shell/SchedulerShell.tsx`, `shell/IntelDock.tsx`, and the top-level `src/routes/scheduler.$projectId.tsx`.

### 3. Layout composition fixes (section 2 acceptance criteria)

Geometry math is already correct (`src/lib/scheduler/geometry.ts` + tests are green). This pass fixes the *visual* composition on top of it:

- **No left-rail overlap anywhere.** Build mode + Publish mode containers switch from absolute-positioned panels to flex children inside the scheduler shell's main column so they cannot underlap the rail. Focus mode keeps zeroing the rail width via the existing `--app-sidebar-w` variable.
- **No Gantt-to-inspector white gutter.** Remove residual right padding on `CpmGrid`'s scroll container; let the timeline canvas paint the full work-surface width computed by `computeWorkSurfaceWidth`. The inspector boundary becomes a 1px `--sched-surface-rule` divider, not a gap.
- **Inspector visually connected.** Inspector panel loses its outer card shadow and floating margin; it shares the shell's top rule and bottom rule with the schedule. Collapsed rail width unchanged.
- **Intelligence dock visually distinct from status bars.** Dock gets `--sched-brass-soft` left edge accent + slightly elevated background vs `ScheduleKpiBar`. Status bars become a single hairline strip.
- **Build & Publish fit viewport.** Both surfaces become `flex-1 min-h-0 overflow-hidden` with internal scroll containers, so the headline + source input / template rail + gallery are always visible without scrolling the whole shell.

### 4. Interaction polish (section 8)

- **Gantt hover card clipping & z-index.** Hover popover rendered through a portal at `z-50`, with viewport collision detection so it flips above/below the bar near the edges. Replaces the current inline absolute card that clips inside `overflow:hidden` containers.
- **Open in Inspector action.** Renamed to "Open in Inspector" (was already mostly there) and surfaced as the primary action in the hover card and row context affordance; consistent label across grid and Gantt.
- **Drag/resizing affordances.** Cursor + 4px hit-strip on bar ends; hover-only, no visual change at rest.
- **Focus mode affordance.** Add a small chevron indicator on the focus toggle showing current state; tooltip "Focus mode (F)".
- **Inspector collapse/expand affordance.** Rail-edge handle becomes a 16px hover target with a directional chevron; current 6px strip is too thin to find.
- **Intelligence dock expand/collapse clarity.** Collapsed = single-row strip with severity dot; expanded = elevated panel with brass accent + soft shadow. State transition gets a 150ms ease.

### 5. Deliverable (section 9, scoped to this pass)

You said you'll log in — once you do and open a project, I'll capture:
- before: Schedule mode (inspector expanded), Focus mode, Build mode, Publish mode, Inspector selected
- after: same five states, plus a hover-card detail crop

Screenshots saved under `/mnt/documents/scheduler-pass1/` and surfaced via `<presentation-artifact>` tags so they render inline in chat.

### 6. Verification

- `npm test` — all geometry tests still green; no test edits.
- `npx tsc --noEmit --pretty false` — clean.
- `npm run build` — clean.
- Manual confirm: `engine-selector.ts` still routes production to `calculateSchedule`; Add-to-Schedule button stays disabled; no new mutation paths.

---

### What this pass deliberately does NOT touch

- Build Mode hero / draft workspace / review column composition (pass 2).
- Schedule Mode grid clarity / WBS bands / dependency line readability / timeline header (pass 3).
- Activity Inspector content reorganization beyond color/composition (pass 3).
- Intelligence panel content / expanded states beyond the dock chrome (pass 4).
- Publish Mode placeholder report cards (pass 4).

Each subsequent pass will land as its own plan + commit so you can accept or reject independently.

### Technical notes

- New tokens live in `src/styles/scheduler-tokens.css`, `@import`-ed from `src/styles.css` so Vite picks them up without touching the portal-wide token set.
- `geometry.ts` and its 24 tests are untouched.
- Composition fixes are pure CSS/JSX class changes inside `src/components/scheduler/**` and `src/routes/scheduler.$projectId.tsx` — no state, no data, no engine wiring.
- Hover-card portal uses the existing Radix `Popover` primitive already in the project (`src/components/ui/popover.tsx`), no new dependency.