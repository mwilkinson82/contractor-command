# CPM Scheduler Port Notes

## What moved

- `src/lib/scheduler/types.ts` defines plain TypeScript scheduler data models: `Task`, `Dependency`, `Schedule`, `ScheduledTask`, and `ScheduleResult`.
- `src/lib/scheduler/engine.ts` contains pure TypeScript CPM logic: task normalization, dependency normalization, cycle detection, forward pass, backward pass, total float, free float, driving relationship detection, and critical path output.
- `src/components/scheduler/SchedulerRoughView.tsx` is a throwaway React preview with sample data, a rough Gantt grid, and a rough network diagram.
- `src/routes/scheduler-preview.tsx` renders the preview route.

## Current npm dependencies

No new npm dependency is required for this extraction.

- The engine has no React, DB, router, auth, or Manus imports.
- The rough preview uses existing React/TanStack app infrastructure.
- The rough chart is simple HTML/SVG, not a Gantt library.
- `date-fns` is already installed in this app, but the engine does not need it yet.

Potential future dependencies, only if the production UX demands them:

- A real Gantt/timeline library if we want drag handles, dependency arrows, virtualization, and resizing handled by a maintained package.
- A graph/layout helper if the network diagram needs automatic dependency layout instead of a simple fixed SVG.
- A PDF/export package if schedule exports move into this app. `jspdf` is already installed.

## Manus pieces intentionally stripped

- Manus auth and Discord/member session handling.
- Manus tRPC router wiring.
- Manus portal shell, sidebar, scheduler toolbar, modals, and styling.
- Manus database helpers and Drizzle/MySQL table definitions.
- Manus storage/XER upload endpoints.
- Manus template seeding and member-specific access checks.

## Server-side pieces to plan in Lovable Cloud

These were real parts of the Manus scheduler and should be planned separately before production use:

- Schedule persistence: schedules, tasks, dependencies, WBS nodes, activity codes, baselines/updates, layouts, resources, cost accounts, assignments, annotations, calendars, and import jobs.
- Ownership and access rules: which users/companies can create, view, update, duplicate, delete, or export schedules.
- Schedule recalculation persistence: when an edited task/dependency should recalculate CPM and save computed dates/float.
- Baselines and updates: snapshots for baseline comparison, update numbering, target overlays, and slippage reports.
- Calendars: 5-day, 6-day, 7-day, holiday exceptions, weather days, and activity-specific calendars.
- P6/XER import: file upload, async parsing, job status, partial import cleanup, and large-file limits.
- PDF/report export: Gantt PDF, comparison report, critical path report, EVM/resource reports, branding, and print settings.
- Cost/resource loading: resources, cost accounts, budgeted units/costs, histograms, S-curves, and earned value metrics.
- Annotation persistence: text boxes, arrows, shaded windows, order, coordinates, and export inclusion.

## Suggested next schema discussion

Start with the smallest Lovable Cloud schema that supports a useful scheduler:

1. `schedules`
2. `schedule_tasks`
3. `schedule_dependencies`
4. `schedule_baselines`

Then add WBS, calendars, resources, annotations, imports, and reports once the core scheduler is stable.
