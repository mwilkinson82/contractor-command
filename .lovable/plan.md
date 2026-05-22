
# CPM Workbench — Build-Out Plan

Goal: a Primavera P6-class CPM product with Apple/Perplexity-level feel. Built in phases where each phase is independently usable and the next phase plugs into the bones of the previous one. Internal Circle tool first; architecture stays clean for a future public/paid split.

## Phase 0 — Foundations (small, do first)

Quiet plumbing the next four phases all depend on.

- Replace today's "scheduler workbench" entry with a real **Projects Home** at `/scheduler` (current single-schedule view moves to `/scheduler/$projectId`).
- Project record gets first-class fields: `client`, `owner_user_id` (already exists), `project_number`, `status` (Planning / Active / On Hold / Closed), `tags`, `cover_color`. Migration adds the missing columns.
- Add a `project_members` table so a project can have multiple collaborators with roles (`owner`, `scheduler`, `viewer`). RLS via `has_role` + member check. Lays groundwork for later multi-tenant without forcing it now.
- Introduce a `useProject(projectId)` hook + project-scoped layout route `/scheduler/$projectId` with `<Outlet/>` and a left rail (Schedule, Resources, Reports, Layouts, Settings). Every phase below renders into this layout.

## Phase 1 — Projects Home (the front door)

What "I open the app and see all my jobs" feels like.

- `/scheduler` — searchable, filterable list grouped by owner / client / status. Each card shows: name, client, % complete (weighted), data date, finish date, baseline finish, finish variance (slip days), # critical activities, last update.
- Group-by chips (Owner, Client, Status, Tag). Sort by finish, slip, % complete, last touched.
- "New project" flow: name, client, project start, calendar template, optional XER import (existing importer), optional duplicate-from-existing.
- Bulk: archive, set status, assign owner.
- Portfolio strip at the top: total BAC, total EAC, projects at risk (SPI/CPI < 0.95), critical-activity concentration. Reuses the math already in `scheduler-portfolio.tsx`, which then becomes the default home rather than a side route.

## Phase 2 — Schedule authoring depth (real P6 backbone)

The workbench gets the structural muscle a scheduler actually needs.

- **WBS as first-class tree**: `wbs_nodes` table (id, project_id, parent_id, code, name, sort). Activities belong to a WBS node, not a free-text `wbs` string. Tree editor in the left column of the workbench: drag to reparent, inline rename, auto-renumbering (1.1, 1.1.1).
- **Activity codes**: `activity_code_types` (Phase, Area, Responsibility, Trade, Cost Code, custom) and `activity_code_values`, plus a join table on tasks. Multi-value per activity.
- **Layouts**: a "layout" = visible columns, column widths, group-by (WBS or any code), sort, filter, bar style rules, timescale. Saved per user per project, plus shared project layouts. Layout switcher in workbench header.
- **CpmGrid upgrades**:
  - Sticky WBS bands that summarize child rollup (earliest start, latest finish, % complete weighted, total float of driving child).
  - Column chooser (Act ID, Name, OD, RD, AD, Start, Finish, BL Start, BL Finish, Var Finish, TF, FF, %, Resource, Trade, Cost Code, BAC, EV, …).
  - Relationship lines on the Gantt (FS / SS / FF / SF) with hover highlight of the **driving** path into the selected activity.
  - Selected-activity inspector panel on the right: details, predecessors/successors editor, constraints, codes, resources, notes.
  - "What's driving finish?" cue — one-click highlight of the longest path, even when it's not the same as zero-float critical path.
- **Constraints**: Start On/After, Finish On/Before, Mandatory Start/Finish, As Late As Possible. Engine honors them in the forward/backward pass (engine already supports `startNoEarlierThan` — extend).
- **Calendars**: multiple named calendars per project (Standard 5-day, 6-day, 7-day, Site-Specific). Per-activity calendar assignment. Holidays editor already exists — promote to project-level + per-calendar.

## Phase 3 — Resources, cost loading, histograms

This is where the schedule becomes a real construction model, not a Gantt toy.

- `resources` table per project: name, type (Labor / Equipment / Material / Subcontract), unit, default rate, max units/day.
- `task_resource_assignments`: resource_id, task_id, units/day, lag, planned cost (rolled into BAC), actual to date.
- **Resource histogram** below the Gantt (toggleable): stacked bars per day/week, over-allocation in red, max-units line.
- **S-curves**: planned vs actual (cost and labor hours) on the project dashboard.
- **Cash flow report**: monthly projected billings vs costs, exportable.
- Leveling-lite v1: a "smooth resource" action that pushes non-critical activities within their float to flatten peaks. Full leveling is a later pass.

## Phase 4 — Output: modern default + P6-style layout designer

Both, as you asked. Same render pipeline, two skins.

- **Modern default PDF**: today's report styling, polished. One-click "Print Schedule" gives a contractor something they can hand to an owner without thinking.
- **Layout Designer** (`/scheduler/$projectId/layouts/$layoutId/design`):
  - Editable **header band** and **footer band**, independent heights (drag the divider).
  - Drop zones for: logo image, free text blocks, project info tokens (`{{project.name}}`, `{{project.number}}`, `{{client}}`, `{{revision}}`, `{{issued_for}}`, `{{data_date}}`, `{{page}}` / `{{pages}}`), legend, signature block.
  - Per-block: font family (curated set), size, weight, color, alignment.
  - Title block presets (AIA-ish, modern minimal, brand-forward).
  - Revision history table on the layout (Rev, Date, Description, By).
  - Bar style rules: by critical / by WBS / by code value / by % complete. Saved with the layout.
  - Output formats: tabular Gantt (landscape), activity table only, look-ahead (3/6-week), critical path only, resource histogram, S-curve.
- Renders to a print-CSS HTML view (already the pattern in `reports.ts`) so "Print → Save as PDF" is the path; no server rendering needed in v1.
- Layouts are objects in DB (`schedule_layouts` with `header_blocks jsonb`, `footer_blocks jsonb`, `columns jsonb`, `bar_rules jsonb`, `page jsonb`), so they survive across updates and can be shared.

## Phase 5 — Modern feel layer (woven into Phases 2–4, not a separate phase you wait for)

This is the "Apple/Perplexity" register applied across the workbench as we build it:

- Sticky, intelligent column headers; smooth scroll-sync between table and Gantt; momentum on trackpad.
- Command palette (`⌘K`): jump to project, jump to activity by ID/name, run "show critical path", "go to data date", "open layout".
- Contextual "what changed since last update" strip on top of the workbench (slip days, new critical activities, completed activities).
- Subtle motion: bar move/resize tweens, WBS expand/collapse, inspector slide-in. Framer Motion, restrained.
- **Ask Marshall** as a side panel that knows the open project (read-only): "what's driving my finish?", "summarize this week's progress", "draft a delay-notice narrative from this slip". Not a chatbot takeover — a panel.
- Responsive: below ~1024px the workbench collapses to tabs (Table / Gantt / Inspector). Mobile keeps the existing `/scheduler-field` updater.

## Phase 6 — Polish + readiness for productization later

Done in the background, doesn't block earlier phases.

- Per-project audit log (who changed what, when) — needed for owner-facing schedules.
- Baseline manager UI upgrade: name, set-as-current, compare two baselines side-by-side.
- Export: XER export (round-trip), CSV, Excel.
- Telemetry hooks (anonymous) so we can see what real users do before opening it to the public.
- Feature flag scaffolding (`is_public_tier`, `is_circle_tier`) so the eventual paid/free split is a flip, not a rewrite.

## Build order (how each phase feeds the next)

```text
Phase 0  Foundations (route shell + project model + members)
   │
   ▼
Phase 1  Projects Home (front door — depends on 0)
   │
   ▼
Phase 2  Authoring depth (WBS + codes + layouts + inspector + relationships)
   │           │
   │           └── Phase 5 motion/polish woven in continuously
   ▼
Phase 3  Resources + histograms + S-curves + cash flow
   │
   ▼
Phase 4  Output: modern default + layout designer (reuses columns/bar rules from 2, resource bars from 3)
   │
   ▼
Phase 6  Audit log, baseline compare, exports, flags for future public tier
```

## Technical notes (for the implementer, skip if you're not technical)

- All new tables under RLS keyed off `schedules.user_id` OR membership in `project_members`. Reuse the existing `has_role(admin)` pattern.
- Engine (`src/lib/scheduler/engine.ts`) stays the source of truth for CPM. Extend it for: multiple calendars per project, full constraint set, longest-path detection (separate from zero-float critical), driving-path traversal for the inspector.
- Workbench routes:
  - `/scheduler` → Projects Home (replaces current)
  - `/scheduler/$projectId` → layout with left rail + `<Outlet/>`
  - `/scheduler/$projectId/schedule` → split table+Gantt workbench (today's `CpmGrid`, refined)
  - `/scheduler/$projectId/resources`, `/reports`, `/layouts`, `/baselines`, `/settings`
  - `/scheduler/$projectId/layouts/$layoutId/design` → layout designer
- Persistence stays in `persistence.functions.ts` pattern (`createServerFn` + `requireSupabaseAuth`). New server fns: `listProjects`, `createProject`, `updateProjectMeta`, `listLayouts`, `saveLayout`, `listResources`, `saveResourceAssignment`, etc.
- Existing routes kept and re-pointed: `scheduler-field`, `scheduler-portfolio` (becomes the home), `scheduler-preview` (stays as the playground/demo).
- No new npm deps required for Phases 0–2. Phase 3 histograms reuse `recharts` (already in tree). Phase 4 stays HTML-print-to-PDF — no headless-browser dependency, which would not run on the Worker runtime anyway.

## What I'd build first if you approve

Phase 0 + Phase 1 in one pass. That gives you a real Projects Home, the project-scoped layout shell, and the migration that lets every later phase plug in. The current workbench keeps working at `/scheduler/$projectId/schedule` while we build depth into it in Phase 2.
