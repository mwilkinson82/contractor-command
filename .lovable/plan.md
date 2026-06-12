## Short answer

Yes — making the scheduler its own Lovable project is a good idea, and it's **much easier than it looks** because of how it's already built. It's essentially a self-contained app sitting inside this portal.

## Why it's a good idea

- **Different audience / lifecycle.** The portal is AOS / Contractor Circle (members, vault, SOPs, calls). The scheduler is a Primavera-class CPM tool that stands on its own and could even be sold or trialed independently.
- **Different velocity.** Scheduler work is heavy (engine2, XER import, baselines, calendars, DCMA, dry-run, etc.). Splitting it stops scheduler churn from destabilizing the portal and vice versa.
- **Cleaner mental model.** Today the portal sidebar and top-strip already special-case `/scheduler*` routes — that's a signal it wants its own shell.
- **Future commercial optionality.** Aligns with your "some tools may go free as a funnel" thinking — a standalone scheduler can be gated, trialed, or SSO'd back into AOS later.

## Why it's not hard — the code is already isolated

I traced the coupling between the scheduler and the rest of this app. It's remarkably clean:

- **No scheduler file imports portal/auth/aos code.** Zero hits for `@/components/portal/*`, `@/hooks/use-auth|tier|company`, `@/lib/aos|vault|program|command-tools|tier-impersonation|growth-constraint|marshall-prompt`.
- **Nothing outside the scheduler imports scheduler code**, except 3 trivial cosmetic touches: `__root.tsx` lists `/scheduler-preview`, and `app-sidebar.tsx` / `top-strip.tsx` check `pathname.startsWith("/scheduler")` for layout adjustments.
- **DB schema is already namespaced**: `schedules`, `schedule_tasks`, `schedule_dependencies`, `schedule_baselines`, `schedule_calendars`, `schedule_members`, `wbs_nodes`, `task_activity_codes`. None are shared with portal features.

So the extraction is mostly copy + cleanup, not a refactor.

## What moves to the new project

```text
src/lib/scheduler/**                    (engine, engine2, persistence, intel, tests)
src/components/scheduler/**             (CpmGrid, panels, shell, XER import, etc.)
src/routes/scheduler.tsx
src/routes/scheduler.$projectId.tsx
src/routes/scheduler-portfolio.tsx
src/routes/scheduler-field.tsx
src/routes/scheduler-preview.tsx
src/styles/scheduler-tokens.css
docs/scheduler-port-notes.md            (already written for exactly this!)
docs/scheduler-roadmap-checkpoint.md
.lovable/scheduler-p6-gap-analysis.md
docs/schedule-intelligence-ai-spec.md
```

Plus the matching DB tables (recreate via migrations in the new project) and any auth/role conventions the new project needs.

## What stays here

Everything else: AOS pulse, vault, SOPs, calls, replays, handbook, admin, billing, etc. After extraction we delete the scheduler files from this project and drop the 3 small `/scheduler*` references in the chrome.

## Suggested approach

1. **Remix** this project into a new one named e.g. "ALP CPM Workbench".
2. In the new project, **strip out everything that isn't scheduler** (portal, vault, handbook, AOS, admin, etc.). Keep auth, layout shell, design tokens.
3. **Recreate the scheduler DB tables** as a single migration in the new project (schema is already documented in `src/integrations/supabase/types.ts`). Either start fresh or, if you want existing data, export/import the rows as CSV (Lovable Cloud only supports CSV export).
4. Make the new project's `/` route the scheduler home (currently `/scheduler` index).
5. In this project, **delete the scheduler files** and the 3 chrome references. Drop the scheduler tables in a migration once the new project is live.
6. Optional: add a link from this portal's sidebar that deep-links into the standalone scheduler.

## Effort estimate

- Remix + strip non-scheduler: ~1 short session.
- Re-create DB schema + RLS in new project: ~1 session (mostly mechanical from existing types).
- Data migration (if any existing schedules matter): depends on row counts; CSV in/out per table.
- Cleanup in this project: <30 min.

## Risks / things to decide before we start

1. **Existing schedule data** — is there real data in `schedules` etc. that has to come with us, or can the new project start empty?
2. **Auth model** — standalone login, or SSO/shared session with AOS later? (Affects whether new project reuses the same Supabase project or gets its own.)
3. **Domain** — own subdomain (e.g. `cpm.alpcontractorcircle.com`) vs path under AOS.
4. **Naming** — "CPM Workbench" is what the current header uses; confirm the product name for the standalone.

If you want, the next step is to answer those four and I'll lay out the concrete extraction plan (file list, migration SQL, and the cleanup PR for this project).
