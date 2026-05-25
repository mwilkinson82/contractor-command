
# Scheduler UI 2.0 — Architecture Plan

Pure UI reorganization. No engine, engine2, persistence, XER, dry-run, scheduling, or AI behavior changes. Production still calls `calculateSchedule`. Add to Schedule stays disabled. Drafts stay advisory.

## Where we are today

The scheduler route is a single 3,457-line file (`src/routes/scheduler.$projectId.tsx`) with a left grid + right resizable Intelligence drawer (380px default). The drawer crams Review / Chat / Build into one 320–520px column, plus a separate full-screen expand mode for Build. The grid is `CpmGrid` (1,084 lines). The command/toolbar lives inline. Inspector state exists but has no dedicated home — selection details bleed into the grid row.

Symptoms this plan addresses:
- Build Mode reads as a drawer sub-tab, not a workspace pillar.
- Intelligence Review, Chat, Build all share one cramped column; mode switching feels modal.
- Toolbar is a flat strip of ~20 controls with no grouping.
- Inspector content is scattered across the row, panels, and the drawer.
- Color usage doesn't enforce critical / near-critical / complete semantics.

## Target zone model

```text
┌─────────────────────────────────────────────────────────────────────┐
│  TOP STRIP   project · status · KPIs · primary mode switcher        │
├──────────────┬──────────────────────────────────┬───────────────────┤
│              │                                  │                   │
│  LEFT RAIL   │        WORK SURFACE              │  INSPECTOR        │
│  (icon nav)  │   Gantt / Table / Network        │  (selected acty)  │
│              │                                  │                   │
│              ├──────────────────────────────────┤  collapsible to   │
│              │   COMMAND BAR (grouped)          │  56px icon rail   │
├──────────────┴──────────────────────────────────┴───────────────────┤
│  INTELLIGENCE DOCK — compact strip · expand → drawer · expand → full│
└─────────────────────────────────────────────────────────────────────┘
```

Zone classification:

| Zone | Role | Default | Collapsed |
|---|---|---|---|
| Work surface (Gantt/Table) | **Primary** | Fills viewport | — |
| Intelligence Dock | **Primary pillar** | Bottom strip 56px | Strip ↔ Drawer ↔ Full-screen |
| Inspector | **Secondary, persistent** | Right column 320px | 56px icon rail |
| Command bar | **Secondary** | Above work surface | Single-row, overflow menu |
| Left rail | **Tertiary nav** | 48px icon rail | — |
| Top strip | **Chrome** | 44px | — |
| Build Mode | Mode of Intelligence | Drawer or full-screen | — |
| Chat | Mode of Intelligence | Drawer | — |

Key shift: Intelligence stops being a right-side utility drawer and becomes a **bottom-anchored dock** with three escalation states (Strip → Drawer → Full-screen). This is what lets Build Mode feel flagship.

---

## UI-2.0 — Layout architecture refinement

Goal: introduce the zone model above without breaking any existing wiring.

- Extract the route shell into 3 components inside `src/components/scheduler/shell/`: `SchedulerShell`, `WorkSurface`, `IntelDock`. Route file becomes a composition + state owner only.
- Add a `SchedulerLayoutContext` that owns: `intelMode` (`strip | drawer | full`), `intelTab` (`review | chat | build`), `inspectorOpen`, `inspectorPinned`, `drawerWidth`. Persist to the same localStorage key already in use.
- Replace the right-side drawer with a **bottom Intelligence Dock** with three states:
  - **Strip** (default, 56px): horizontal status — Review summary chip, Chat unread, Build draft state, "Expand" affordance. Always visible.
  - **Drawer** (40vh, resizable 28–60vh): full Intelligence content, three tabs.
  - **Full-screen Sheet**: Build Mode and "Wide Review" only.
- Inspector moves to a persistent right column (was implicit). Collapses to 56px icon rail; pinning survives reload.
- All existing panels (Structure, Calendars, Resources, Baselines, DCMA, Reports, Update Cycle, Annotations, Fragnets, Dashboards) keep their components and wiring; they get re-homed into Inspector / Intelligence / Command-bar overflow per the IA below.

No behavior changes. Selection, calculation, save, XER import paths untouched.

---

## UI-2.1 — Build Mode as flagship workspace

Goal: Build Mode reads as "Describe the job. Baseline builds the CPM." — not a third tab in a side drawer.

Promotion:
- Build Mode opens **full-screen by default** when entered from the Intel Dock or from an empty-schedule state. Drawer-mode Build remains available for quick edits.
- The empty-schedule state (`EmptyScheduleState.tsx`) gains a primary CTA "Build with AI" that opens Build full-screen.

Build Mode IA (three-column when full-screen, single-column when in drawer):

```text
┌────────────────────┬─────────────────────────────┬──────────────────┐
│  SOURCE INPUT      │  DRAFT WORKSPACE            │  REVIEW & APPROVE│
│                    │                             │                  │
│ • source picker    │  ▸ Draft WBS                │ • Assumptions    │
│ • textarea / upload│  ▸ Draft Activities         │ • Open questions │
│ • Use sample (dev) │  ▸ Draft Logic              │ • Warnings       │
│ • Generate Draft   │  ▸ Milestones               │ • Change-set     │
│ • Load demo        │  ▸ Proposed Change Set      │   preview        │
│                    │                             │ • Approval check │
│ guardrails footer  │  per-section "Regenerate"   │ • Add to Schedule│
│                    │  (future, disabled)         │   (disabled)     │
└────────────────────┴─────────────────────────────┴──────────────────┘
```

- Each draft section becomes its own card with its own header (count + status chip) so users can scan WBS → Activities → Logic linearly.
- "Assumptions / Questions / Warnings" promoted from a 3-of-many panel into the dedicated **Review column** — this is where the user actually decides whether to trust the draft.
- Approval checklist moves next to "Add to Schedule" so the gating reads as one unit.
- Commit pathway placeholder: a single, disabled "Add to Schedule" button anchored at the bottom of the Review column. No new code path, no mutation surface; just the visual anchor for the future commit flow.
- Build "Expand" toggle stays. Collapsing Build returns to the Intelligence drawer with the same draft state preserved.

---

## UI-2.2 — Inspector as command center

Goal: when a task is selected, the right column tells the whole story of that activity.

Layout (top-to-bottom, sections collapsible, last-state remembered):

1. **Identity & status** — ID, name (inline-editable), WBS, type (task / milestone / LOE), status chip (Critical / Near-critical / On-track / Complete), tags.
2. **Date intelligence** — ES/EF/LS/LF, Total Float, Free Float, calendar; baseline delta if a baseline is set; constraints.
3. **Logic & impact** — Predecessors and successors with type/lag, driving flag, "What blocks this?" / "What does this block?" expandable lists, one-click "Jump to" link per related activity.
4. **Resources & codes** — assignments, crew, activity codes (`ActivityCodeChips`), calendar override.
5. **Notes & annotations** — `AnnotationsPanel` filtered to the selected activity.
6. **Impact preview** (read-only) — small mini-Gantt showing this activity + immediate predecessors/successors so logic is *visible*, not just listed.

Inspector reuses existing panel components — they get re-parented, not rewritten. When no activity is selected, the column shows a portfolio summary (KPIs + open ends + critical-path count).

---

## UI-2.3 — Command bar simplification

Today's flat toolbar becomes four named clusters in a single row, with overflow into a "More" menu. Each cluster gets a thin label above its buttons in the expanded state, hidden in compact.

| Cluster | Contents |
|---|---|
| **Setup** | XER Import, Calendars, Structure (WBS), Resources, Baselines |
| **View** | View mode (Gantt / Table / Network), Filters, Group-by, Zoom, Show critical only |
| **Analyze** | DCMA, Open Ends, Fragnets, Dashboards, Compare vs. baseline |
| **Output** | Update Cycle, Reports, Export CSV/XER, Save |

Rules:
- Setup and Output cluster buttons open as **modals or full-screen sheets** (they're configuration work, not in-context).
- View cluster buttons are **inline toggles**.
- Analyze cluster opens in the **Intelligence Drawer** (Review tab) — this is the bridge that makes Intelligence feel central.
- Engine2 debug stays in a dev-only overflow under "More" — unchanged.

---

## UI-2.4 — Gantt + interaction polish

Scope-limited, no engine changes:
- Bar hover popover: name, ID, ES–EF, TF, status chip, calendar; one-line predecessors / successors with click-to-jump.
- Click bar → selects + scrolls Inspector to top section. Double-click → opens Inspector "Logic & impact" expanded.
- Right-click on a bar → context menu: Add note, Show predecessors, Show successors, Filter to this path, Send to Intelligence (Review with this activity pre-selected).
- Critical bars use a single saturated red; near-critical (TF ≤ user threshold, default 5d) uses amber; complete uses muted green; everything else uses graphite. Driving-relationship arrows are 1.5× weight; non-driving are 0.75× and lower contrast.
- Today line, baseline ghost bars (when a baseline is loaded), and milestone diamonds get consistent z-order and tooltip styling.
- Network diagram (currently in `SchedulerRoughView`) is *not* in scope here — it's the rough preview, not the live workbench.

---

## Visual hierarchy rules (apply across 2.0–2.4)

Surfaces:
- **Ivory shell** `oklch(0.97 0.01 85)` — page chrome, top strip, Intel Dock strip, Inspector chrome.
- **Cool work surface** `oklch(0.985 0.005 240)` — Gantt/Table canvas. Cooler than the shell so the work area reads as the focus.
- **Paper card** white with `oklch(0.93 0.01 85)` 1px border — all content cards (Build sections, Inspector sections, Intelligence panels).

Semantic color (encoded as tokens in `src/styles.css`, applied via classes — never inline):
- `--status-critical` red — critical path, blocking errors. **Only** these two uses.
- `--status-review` amber — near-critical, AI assumptions, draft warnings, "needs review".
- `--status-ok` muted green — complete, validated, on-track.
- `--status-neutral` graphite — default schedule data, non-driving relationships.
- `--accent-build` brass/gold (already in use as `#f7e9b8`/`#1f241f` pair) — reserved for Build Mode primary actions and the Intelligence Dock "expand" affordance, so the AI pillar reads as a distinct material.

Spacing: 4 / 8 / 12 / 16 / 24 scale. Inspector and Intel cards use 12px internal padding; work surface uses 8px gutters. Top strip 44px, Intel strip 56px, Command bar 40px.

Typography: keep existing display/body stack. Section labels uppercase tracking-wide `text-[10px]`. Numeric columns tabular-nums.

---

## Sequencing & guardrails

Implementation order (each a self-contained pass):
1. UI-2.0 shell extraction + Intel Dock state machine (no visual rewrite yet; just the new container).
2. UI-2.1 Build Mode flagship layout.
3. UI-2.2 Inspector re-home.
4. UI-2.3 Command bar clusters.
5. UI-2.4 Gantt interaction polish.

Across every pass:
- No changes to `engine`, `engine2`, persistence functions, XER pipeline, dry-run, or AI server functions.
- "Add to Schedule" stays disabled and has no `onClick`.
- All 331 existing tests must stay green; add UI tests only for new shell state.
- Behavior parity check after each pass: open a real project, run the smoke (Generate Draft → preview renders, save schedule, export CSV) and confirm no regression.

## Out of scope (deliberately)

- New AI capabilities (AI-5 SOV→Draft, AI-6 commit/approval) — resume after UI-2.x lands.
- Engine2 wiring or shadow comparison surfacing.
- Mobile / `scheduler-field` view — separate track.
- Network diagram rework on the live workbench.

