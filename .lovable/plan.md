# Workbench polish — three fixes

The goal: the moment someone lands on `/tools`, it should read as *a workbench with many tools, one currently loaded* — not as "the SOP Priority Builder page." Three targeted changes.

## 1. Make "Switch tool" the hero of the header

Today the chip is quiet gray and visually equal to the Vault link. It needs to be the most obvious thing in the header.

Changes in `WorkbenchHeader` (`src/routes/tools.tsx`):

- Promote the button to an **accent-colored pill** (signal/primary token, not neutral) with a left-side grid/dots icon and the active tool count, e.g.
  `▦  Switch tool  ·  7 tools  ⌘K`
- Make it taller (py-2), bolder weight, with a subtle glow/ring on hover so it reads as *the* primary action.
- Add a faint one-time pulse animation on first mount (sessionStorage flag) so first-time visitors notice it.
- Demote Vault to a ghost link on the far right — it stays reachable but stops competing.
- On the left, restructure the title block so the workbench identity wins (see fix 3).

## 2. Make the SOP rows visibly editable

Right now the default areas (Estimating new bids, Client communication, …) look like static labels. Users don't realize each row is a live, editable touchpoint.

Changes in `src/components/portal/tools/sop-priority-tool.tsx` (owner-mode area list only — no logic changes):

- Add a short framing line directly above the list:
  *"These are the touchpoints where you're still in the work. Edit, add, or remove any row — this list drives the ranking."*
- Render each area as a card with:
  - The name shown as an **inline editable input** with a visible pencil icon on the right and a dotted underline so it reads as a field, not a label.
  - Each numeric input (hours, blast, effort, frequency) gets a tiny label above it and a subtle bordered chip styling so they obviously look like inputs.
  - Hover state lifts the row slightly and reveals a trash icon.
- The existing "+ Add area" button gets promoted to a dashed full-width row at the bottom labeled **"+ Add another touchpoint you still own"** so the affordance to grow the list is unmissable.
- No changes to `calcSopPriority` or any scoring math.

## 3. Strengthen the Workbench identity over the tool name

Currently the header reads `Operator's Workbench / SOP Priority Builder` with both at similar weight, so it looks like the tool *is* the page.

Changes in `WorkbenchHeader`:

- Render a two-line stacked title on the left:
  - Line 1 (large, serif display): **Operator's Workbench**
  - Line 2 (small mono label): `NOW LOADED · BUILD THE MACHINE · SOP PRIORITY BUILDER`
- Add a one-line tagline under it that only shows on the bare `/tools` route (hidden on the child routes):
  *"Seven tools to run the business. One loaded — pick another anytime."*
- Add a thin horizontal **tool rail** directly under the header: small pills for each live tool grouped by section ("Make more money", "Protect margin and cash", "Build the machine", "Deliver better projects"), the active one filled, the others outlined. Clicking a pill loads that tool (same behavior as the picker). This makes the "many tools" reality visible without forcing the picker open.
- The Switch tool button still opens the full dialog for the complete browseable list.

## Technical notes

- All edits stay in `src/routes/tools.tsx` and `src/components/portal/tools/sop-priority-tool.tsx`.
- No new dependencies. Pulse animation = a single keyframe in `src/styles.css` or inline Tailwind `animate-` class.
- Colors come from existing semantic tokens (`--signal`, `--primary`, `--accent`) — no hardcoded values.
- Tool rail reuses `COMMAND_TOOLS` + `STAGE_TOOLS` already imported in `tools.tsx`; pills for non-stage tools navigate to their route just like the dialog's `pickTool`.
- The other three tools (`contract-readiness`, `estimate-throughput`, `margin-leak`) are not touched in this pass; fix 2's edit-affordance pattern can be propagated to them in a follow-up.

## Out of scope

- Renaming any tool, group, or nav item.
- Sidebar component changes.
- Tool scoring / business logic.
- Mobile-specific layout (desktop-first; current responsive behavior preserved).
