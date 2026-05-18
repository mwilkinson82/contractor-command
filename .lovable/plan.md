## 1. Admin-only sidebar group

In `src/components/portal/app-sidebar.tsx`:
- Call `useIsAdmin()` inside `AppSidebar`.
- Append a new `Admin` group (rendered only when `isAdmin === true`) with:
  - **Topics** → `/admin/topics` (icon: `Inbox` or `ListChecks`)
  - **Library** → `/admin/library` (icon: `Library`) — already exists, useful to expose alongside
- Same `text-signal/75` group label styling as the other groups.
- Non-admins never see the group (RLS already blocks data; this just hides the UI entry).

## 2. Real Zoom link for the Contractor Circle

In `src/lib/program.ts`, update the **Biweekly Call** entry:
- `zoomUrl`: `https://us06web.zoom.us/j/83215167292?pwd=Mtt970HFCPStqSw62btyyta2Wxo0Pr.1`
- `zoomId`: `832 1516 7292`
- Add `passcode: "321266"` (extend `Session` type) and surface it on the Calls page next to the meeting ID.

Since the bi-weekly and bootcamp share the same Zoom (per your earlier note), also point the **Monthly Bootcamp** entry to the same `zoomUrl` / `zoomId` / `passcode`.

The biweekly anchor (`2026-05-24 17:00 ET`) already matches the Zoom invite — no date change needed.

## 3. Templates reorg

Categories are auto-derived from the `templates.category` column, so this is a pure data migration. New category set:

**AOS** (new — replaces "Operating System" + the four EOS items currently in "operations" + the two EOS items in "leadership"):
- Owner Dependency Scorecard *(was Operating System)*
- V/TO — Vision / Traction Organizer *(was Operating System)*
- Weekly Scorecard *(was Operating System)*
- ALP-EOS Command Center Blueprint *(was leadership)*
- Vision/Traction Organizer (VITO) — Complete Example *(was leadership)*
- ALP/EOS Operating System — Complete Playbook *(was operations)*
- ALP/EOS Scorecard *(was operations)*
- ALP/EOS Vision/Traction Organizer (V/TO) *(was operations)*
- ALP/EOS Weekly Scorecard — L10 Measurables & Quarterly Rocks *(was operations)*

**Finance** — add:
- Contractor Proposal Template *(was proposals)*

**Leadership** — keeps:
- Monthly Boot Camp — Building the Machine (April 2026)

**Operations** — keeps all remaining ops items (Client Onboarding, Punch List, SOPs, CPM, Daily Job Log, PM Systems, Roles & Responsibilities, Three Silos, Subcontractor SOPs, Project Manager Meeting, Construction Checklists).

The `proposals` category becomes empty and disappears from filters automatically.

### Migration SQL (single migration)

```sql
UPDATE public.templates SET category = 'AOS' WHERE id IN (
  '77a0c76c-c63c-45b0-a944-2852233d3568', -- Owner Dependency Scorecard
  'c2786dc3-0d08-4eb6-bc6c-03e5cc004233', -- V/TO
  '867c6bd0-88f3-4324-983c-d2e855f9a410', -- Weekly Scorecard
  'd2e46816-4419-4aca-979e-379d1af7b8a2', -- Command Center Blueprint
  '2e1c20af-d295-4e14-8b21-1b51b9acd828', -- VITO Complete Example
  '013aa7fb-67b2-4b11-8f14-8a4d9f0e317d', -- Operating System Playbook
  '71d7554b-c15e-4c91-92dc-4452e7cef776', -- Scorecard
  '5185a966-fe6f-4f25-a66f-11d5e51e6041', -- V/TO
  'c44ea27b-b83b-48a1-aa6d-472ed8e0cacf'  -- Weekly Scorecard L10
);
UPDATE public.templates SET category = 'finance'
  WHERE id = '378dcc9a-20fc-4503-8de3-2faacbc4f9fd'; -- Contractor Proposal
```

## Confirm before I build

1. New "AOS" group goes in the sidebar — fine to keep AOS *page* link in **Daily** (no change) and have a separate **AOS** templates category, right?
2. Should the Admin group include just **Topics**, or also **Library** (since `/admin/library` already exists)?
3. OK to display the Zoom passcode (`321266`) on the Calls page next to the meeting ID?