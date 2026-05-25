# Scheduler Product Architecture Reset

Baseline is not a P6 clone with an AI side panel. It is a **construction CPM command center** that can build, inspect, explain, annotate, analyze, and publish schedules. This plan reorganizes the product around that thesis. No engine, engine2, persistence, XER, dry-run, or AI mutation changes. "Add to Schedule" stays disabled.

---

## 1. Primary navigation — Modes, not panels

Top strip carries a 3-mode switcher. Mode is the highest-level UI state; everything else (inspector, dock, panels) is scoped to the active mode.

| Mode | Purpose | Default surface |
|---|---|---|
| **Build** | Draft a schedule from scope / SOV / list / dictation | Full-screen three-column workspace |
| **Schedule** | Institutional CPM workhorse (table + Gantt + WBS) | Work surface + Inspector + Intel dock |
| **Publish** | Print preview, reports, owner narrative, trailer-wall output | Full-screen preview + format rail |

Build and Publish are **first-class modes**, not drawer tabs. Intelligence is no longer a "mode" — it is an ambient layer that surfaces inside Schedule mode (via the dock) and inside Build mode (via the Review column).

Secondary mode-scoped switcher (View) lives inside Schedule mode only: Table / Gantt / Network / Split.

---

## 2. Screen architecture

```text
TOP STRIP   project · status · KPIs · [Build | Schedule | Publish]
┌───────────────────────────────────────────────────────────────────┐
│  LEFT RAIL  │   WORK SURFACE (mode-specific)   │  INSPECTOR / CTX │
│  (48 icon)  │                                  │  (320, collapse) │
├─────────────┴──────────────────────────────────┴──────────────────┤
│  COMMAND BAR (clustered: Setup · View · Analyze · Output)         │
├───────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE DOCK — Strip ↔ Drawer ↔ Full (Schedule mode only)   │
└───────────────────────────────────────────────────────────────────┘
```

### Surface-routing rules

| Surface | Build | Schedule | Publish |
|---|---|---|---|
| Top strip | yes | yes | yes |
| Left rail | yes (collapsed) | yes | yes (collapsed) |
| Work surface | Build 3-col | Table / Gantt | Preview canvas |
| Inspector | Source context | Activity command center | Report config |
| Command bar | Build cluster only | full clusters | Format / Export |
| Intel dock | hidden (Review is in-mode) | Strip / Drawer / Full | hidden |

---

## 3. BUILD MODE — flagship workspace

Always full-screen. Three columns at ≥1280px, stacked at <1024px. No drawer-mode for Build going forward — Build is its own mode, not a tab.

```text
┌─────────────────┬──────────────────────────┬──────────────────────┐
│ 1. SOURCE       │ 2. DRAFT WORKSPACE       │ 3. REVIEW & APPROVE  │
│                 │                          │                      │
│ • Source picker │ Step rail:               │ • Assumptions        │
│   - Scope text  │   ▸ WBS                  │ • Open questions     │
│   - Activity    │   ▸ Activities + dur     │ • Warnings           │
│     list        │   ▸ Logic + lag          │ • Proposed change    │
│   - SOV         │   ▸ Milestones           │   set diff           │
│   - Estimate    │   ▸ Change set           │ • Approval checklist │
│   - Dictation   │                          │ • Add to Schedule    │
│ • Generate Draft│ each section: card,      │   (disabled, anchored│
│ • Load demo     │ count chip, regenerate   │   bottom)            │
│ • Guardrails    │ (future, disabled)       │                      │
└─────────────────┴──────────────────────────┴──────────────────────┘
```

Step flow is **non-blocking**: user can jump between sections, but the Review column tracks per-step status (drafted / reviewed / accepted). Approval checklist is the gate for the eventual commit flow.

Tagline anchored top of column 2: *"Describe the job. Baseline drafts the CPM."*

---

## 4. SCHEDULE MODE — institutional CPM workhorse

The trusted surface. Primavera-serious, Apple-usable.

Work surface: split table + Gantt (resizable), with view toggle (Table-only / Gantt-only / Split / Network). WBS tree lives as a collapsible left pane of the work surface (not the left rail, which is global nav).

Command bar clusters (single row, overflow into More):

- **Setup** — XER Import, Calendars, WBS, Resources, Baselines
- **View** — View mode, Filters, Group-by, Zoom, Critical-only, Near-critical threshold
- **Analyze** — DCMA, Open Ends, Fragnets, Compare vs. Baseline → opens Intel dock
- **Output** — Update Cycle, Save, Export CSV/XER, Go to Publish mode

Intel dock states (Schedule mode only):
- **Strip 56px** — review summary chip, chat unread, "expand"
- **Drawer 28–60vh** — Review / Chat tabs (Build tab removed; Build is a mode)
- **Full sheet** — Wide Review only

---

## 5. ACTIVITY INSPECTOR — command center

Persistent right column in Schedule mode. 320px default, collapses to 56px icon rail, pinning survives reload. When nothing is selected, shows portfolio summary (KPIs, open ends, critical-path count).

Sections, top-to-bottom, each collapsible with remembered state:

1. **Identity & status** — ID, name (inline edit), WBS path, type (task / milestone / LOE / hammock), status chip (Critical / Near-critical / On-track / Complete / Behind data date), tags, delay flag, change-order flag.
2. **Date intelligence** — ES/EF/LS/LF, TF, FF, calendar, constraints, baseline delta if a baseline is set, data-date delta.
3. **Logic & impact** — see §6 below. The heart of the inspector.
4. **Resources & codes** — assignments, crew, activity codes, calendar override.
5. **Annotations & flags** — notes, delay events, change-order markers (see §8). Filtered to selected activity.
6. **Impact preview** — read-only mini-Gantt: this activity + immediate preds/succs, driving relationships emphasized.

Inspector re-parents existing panel components — no rewrites.

---

## 6. Relationships UX (inside Inspector → Logic & impact)

Must handle 1 or 50 relationships equally well.

```text
LOGIC & IMPACT
─────────────────────────────────────
[ Predecessors (12) ] [ Successors (8) ]   ← tab pair, counts visible
─────────────────────────────────────
🔎 search relationships…
─────────────────────────────────────
▼ DRIVING (3)
  ▸ A-1020  Foundation pour          FS  +2d   ← row: id, name, type, lag
  ▸ A-1031  Rebar inspect            FS   0d
  ▸ A-1042  Form strip               FS  -1d
▼ NON-DRIVING (9)
  ▸ …
─────────────────────────────────────
[ What blocks this? ] [ What does this block? ]   ← expand chains
[ Open mini-network ]                              ← optional logic view
```

Each row: relationship type chip, lag, driving star, jump-to-activity. Group headers collapsible. Mini-network is an opt-in popover focused on the selected activity ± 2 hops; reuses existing network rendering code.

---

## 7. SCHEDULE INTELLIGENCE — analysis layer

Lives in the Intel dock (Schedule mode) and threads into Build mode's Review column. Not a settings panel.

Capabilities surfaced:

- Critical path narration ("X drives the finish via Y → Z")
- Near-critical exposure ranked by TF threshold
- Open-ended logic warnings (DCMA-style)
- Delay risk per chain
- Behind-data-date review
- Change-order flag rollup
- Annotation summary
- "What should I review first?" prioritized queue
- "What does this delay affect?" impact tracer (anchored to selected activity / flagged event)
- "What should go in the owner narrative?" — drafts narrative copy from flags + diffs

Connects to: annotations, change-order flags, baseline diffs, update cycle history, Publish mode narrative output.

Intel dock content stays advisory. No mutations.

---

## 8. Annotations / Delay / Change-order flags — design only

Architecture (no implementation this pass):

**Data model (future):**
- `activity_annotation` — note text, author, scope (activity / WBS / project), created_at.
- `delay_event` — activity_id, cause (owner / weather / subcontractor / RFI / other), start, duration, narrative, linked_change_order_id?
- `change_order_flag` — activity_id, CO number, status (potential / submitted / approved), cost/time impact.

**UX surfaces:**
- Inspector → Annotations & flags section (read + add).
- Right-click on Gantt bar → "Add note / Flag delay / Flag change order".
- Intel dock → rollup ("3 activities flagged delayed, 1 affects critical path").
- Build mode → annotations carry forward as assumptions on regenerated drafts.

**AI bridge (future):**
- Given flagged activity, AI explains affected successors, possible CP impact, drafts narrative language for owner submissions, and authors schedule-update commentary. Output goes to Publish mode reports.

This pass: reserve inspector section, reserve right-click menu items (disabled), reserve dock rollup chip (hidden until data exists).

---

## 9. PUBLISH MODE — print preview & reports

Full-screen mode. Left rail = report picker; main canvas = paginated preview; right column = format/config.

Report templates (designed, not all built yet):

- **Printable Gantt PDF** — full schedule or filtered slice, banner pages
- **Owner-facing schedule report** — Gantt + narrative + KPIs, branded
- **Trailer-wall schedule** — large-format landscape, high-contrast, minimal chrome
- **Lookahead report** — 2-week / 3-week / 6-week windows
- **Critical path report** — CP only, ladder + narrative
- **Delay / narrative report** — built from delay events + AI narrative
- **Annotations / change-flag report** — log of flags with status

Must read as something a PM can submit to an owner or post in a trailer. Typography, margins, header/footer, page numbering, legend, signature block all part of the spec.

This pass: design only. Replace the empty "Print Preview" with the mode shell + report picker; templates stay as placeholders that say "coming soon" with a real preview thumbnail.

---

## 10. WBS Tree — own workspace

Inside Schedule mode, WBS gets:

- A collapsible left pane on the work surface (tree view, always available)
- A full-screen "WBS workspace" via Setup cluster button for serious restructuring

Tree capabilities (UI only this pass; demo data wired so the tree can be evaluated):

- Visible hierarchy with indent guides
- Parent/child drag-and-drop
- Move activities between WBS nodes (drag from table → tree)
- Collapse/expand, expand-all, collapse-all
- Reorder siblings
- Inline edit WBS code + name
- "Insert child / Insert sibling" actions
- Activity counts per node, rollup duration/dates

Demo data: ship a fixture WBS so the tree renders meaningfully without a real project loaded.

---

## 11. Gantt hover popover & interaction fixes

Layering: popover must render at the top of the stacking context (portal to body, z-index above inspector, dock, and command bar). Never clipped by panel borders.

Popover contents:
- Activity ID + name
- WBS path
- Start / Finish / Duration
- TF / FF
- Status chip (critical / near-critical / on-track / complete)
- Pred / Succ counts
- "Open in inspector" button

Bar interactions:
- Click → select + scroll Inspector to Identity
- Double-click → select + expand Logic & impact
- Right-click → Add note · Flag delay · Flag change order · Show predecessors · Show successors · Filter to this path · Send to Intelligence

---

## 12. Visual system — strict

Tokens (`src/styles.css`, applied via classes only — never inline):

| Token | Use | Notes |
|---|---|---|
| `--status-critical` red | Critical path, blocking errors | Only these two uses |
| `--status-review` amber | Near-critical, AI assumptions, draft warnings | |
| `--status-ok` muted green | Complete, validated, on-track | |
| `--status-neutral` graphite | Default schedule data, non-driving arrows | |
| `--shell-ivory` | Page chrome, top strip, Inspector chrome | ALP shell |
| `--surface-cool` | Gantt/Table canvas | Cooler than shell so work area reads as focus |
| `--accent-build` brass/gold | Build mode primary, Intel "expand" affordance | Reserved — never used as a generic accent |

Rules:
- No generic SaaS palettes (no indigo/violet/teal CTAs).
- No pill-heavy form look. Inputs are flush, bordered, monospaced for numerics.
- No dashed placeholder boxes. Empty states use solid ivory cards with status chips and concise hint text.
- Typography: existing display/body stack. Section labels uppercase tracking-wide `text-[10px]`. Numeric columns `tabular-nums`.
- Spacing scale: 4 / 8 / 12 / 16 / 24. Inspector + Intel cards: 12px internal pad. Work surface: 8px gutters. Top strip 44px, Intel strip 56px, Command bar 40px.
- Driving arrows 1.5× weight; non-driving 0.75× and lower contrast.

---

## 13. Implementation sequence

Each phase is self-contained, behavior-parity tested against existing 331 tests, with a real-project smoke afterward.

| Phase | Scope | Risk |
|---|---|---|
| **PA-1** | Top-strip Mode switcher (Build / Schedule / Publish); route Build mode to dedicated full-screen route; remove Build from Intel dock tabs | Low — pure routing/layout |
| **PA-2** | Gantt hover popover portal + z-index fix + content upgrade | Low — isolated component |
| **PA-3** | Inspector re-home into shell as persistent right column; section structure + collapsible state | Medium — touches selection wiring |
| **PA-4** | Inspector Logic & impact relationships UX (search, group, driving-first, jump-to) | Medium |
| **PA-5** | WBS tree pane in Schedule mode + demo fixture | Medium |
| **PA-6** | Publish mode shell + report picker + placeholder templates | Low — new route |
| **PA-7** | Command bar clusters (Setup / View / Analyze / Output) | Low |
| **PA-8** | Visual system pass: token audit, remove SaaS palette leaks, kill dashed placeholders, restrict semantic colors | Low |
| **PA-9** | Annotations / delay / change-order architecture reserved surfaces (disabled UI, no data layer) | Low |
| **PA-10** | Intelligence dock content upgrade (prioritized queue, impact tracer, narrative drafter) — UI only, calls existing AI surfaces | Medium |

Guardrails across every phase: no engine/engine2 changes, no persistence changes, no XER/dry-run changes, no AI mutation behavior changes, "Add to Schedule" stays disabled, all existing tests stay green.

---

## Out of scope (deliberately deferred)

- AI-5 (SOV→Draft), AI-6 (commit/approval) — resume after PA-1..PA-4.
- Engine2 wiring, shadow comparison surfacing.
- Mobile / `scheduler-field`.
- Real annotation/change-order data layer (designed here, built later).
- Actual PDF rendering for Publish reports (shell + placeholders only this round).
