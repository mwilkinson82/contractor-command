# Scheduler Engineering Hardening Pass

No visual restyling. Freeze current layout. Make it behave correctly.

## Scope (8 areas)

### 1. Table / Gantt sync
- Audit `CpmGrid` + Gantt panel in `src/routes/scheduler.$projectId.tsx` for the split-pane scroll wiring.
- Ensure a single vertical scroll source drives both panes (shared ref + `onScroll` → mirror `scrollTop`).
- Row heights: confirm `ROW_H` / `GROUP_H` / `HEADER_H` constants are identical between table rows and Gantt rows (currently `GanttTimeline.tsx` uses `ROW_H=26, GROUP_H=22` while `CpmGrid` uses `22/20/38` — fix the mismatch).
- Horizontal: Gantt date header and bar body must share the same horizontal scroll container.

### 2. Fit / zoom
- Verify `Fit` recomputes `dayPx` from current container width and resets scroll to 0.
- Month / Week / Day presets set `dayPx` deterministically (e.g. 4 / 14 / 28) and mark `zoomUserSet=true`.
- On first mount with sample data, auto-Fit runs once.
- Header ticks, bars, milestones, dep lines all driven by the same `dayPx` and `LABEL_W`.

### 3. Selection + inspector
- Confirm clicking a row in either pane sets `selectedId` and the inspector renders activity detail.
- Inspector activity view: ID, name, status (from %), ES/EF dates, duration, TF, predecessors/successors (look up via `result.dependencies`), resource, codes, calendar, notes.
- Empty state already implemented (`ScheduleContextSummary`) — verify it shows project finish, critical count, near-critical list, data date.

### 4. Baseline / data date / update
- `BaselinesPanel`: selection should persist via existing `schedule_baselines` table; reload restores active baseline.
- Data date persists in `schedules.data_date`; verify save on change.
- "Reschedule From Data Date" calls `rescheduleFromDataDate` then persists tasks atomically; on failure, roll back UI state.
- After reschedule, recompute CPM and re-render — no stale finish/float.

### 5. Sample schedule persistence
- Ensure `createFromSample` writes to `schedules` + `schedule_tasks` + `schedule_dependencies` in one transaction-equivalent flow.
- Guard against duplicate creation: check if schedule already has tasks before seeding.
- Reload restores tasks via existing persistence server fns.

### 6. Calendar logic
- Every schedule must have exactly one `is_default=true` row in `schedule_calendars`.
- Add idempotent ensure-default helper called on schedule load.
- Fix RLS: confirm `members manage schedule calendars` policy works; the `is_schedule_member` function exists and is correct.
- Prevent duplicate creation: dedupe in `CalendarsPanel` create handler.

### 7. Security / RLS / auth
- Confirm all scheduler server fns use `requireSupabaseAuth`.
- Verify CSRF middleware (per prior Codex notes) — locate and audit.
- Spot-check RLS: `schedules`, `schedule_tasks`, `schedule_dependencies`, `schedule_baselines`, `schedule_calendars`, `wbs_nodes`, `activity_code_*` all scope to `auth.uid()` via owner or `is_schedule_member`. Already in place per schema.
- No cross-user reads: verify server fns filter by `schedule_id` and rely on RLS.

### 8. Lint / build / cleanup
- Run lint + typecheck; fix all scheduler-scope errors.
- Remove dead code: stale empty-state shells, unused imports in `scheduler.$projectId.tsx`, orphaned components from prior iterations.
- Stabilize types: ensure `ScheduledTask`, `ScheduleResult`, persistence row types match DB columns.
- Remove duplicate state / refs.

## Approach

Sequential, area by area. After each area I'll verify with targeted reads + build/lint. No new features, no visual changes, no new components unless replacing a duplicate.

## Out of scope
- Visual styling, palette, typography, spacing
- New features (DCMA expansion, new reports, etc.)
- Mockup chasing

After this pass: one final subtle visual polish pass.
