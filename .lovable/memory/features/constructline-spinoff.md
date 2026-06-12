---
name: ConstructLine spin-off
description: Plan and decisions for splitting the CPM scheduler out of the AOS portal into its own Lovable project, "ConstructLine CPM Schedule Software".
type: feature
---
The CPM scheduler is being extracted from the AOS portal into a standalone Lovable project.

**Product name**: ConstructLine CPM Schedule Software (NOT "CPM Workbench" — that was the old internal header).

**Decisions**:
- Migrate existing schedule data (currently near-empty: 2 schedules, 2 calendars, 1 wbs node, zero tasks/dependencies/baselines).
- Own login, own Lovable Cloud backend (separate from AOS).
- Lives at subdomain `cpm.alpcontractorcircle.com`.
- May share session with AOS later via SSO; not on day one.

**Migration bundle**: `/mnt/documents/constructline-export/` contains `schema-pgdump.sql`, per-table CSVs, and a README with the full extraction + cleanup plan.

**Coupling check (already done)**: scheduler is self-contained. No scheduler file imports portal/auth/aos code. Only 3 cosmetic references back into scheduler from this app: `src/routes/__root.tsx` (lists `/scheduler-preview`), `src/components/portal/app-sidebar.tsx`, and `src/components/portal/top-strip.tsx` (both gate layout on `pathname.startsWith("/scheduler")`).

**Tables to drop here after cutover**: schedules, schedule_tasks, schedule_dependencies, schedule_baselines, schedule_calendars, schedule_members, wbs_nodes, task_activity_codes, activity_code_types, activity_code_values. Plus helper functions `is_schedule_member`, `replace_schedule_graph`, `ensure_default_calendar`, and the `scheduler_dep_type` enum.

**Files to delete here after cutover**: `src/lib/scheduler/**`, `src/components/scheduler/**`, all `src/routes/scheduler*.tsx`, `src/styles/scheduler-tokens.css`. Then remove the 3 cosmetic references above.

Do NOT delete anything in this project until the new ConstructLine project is verified working end-to-end.
