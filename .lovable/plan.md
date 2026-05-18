# Operator's Workbench — /tools redesign

Turn `/tools` from a directory grid into a dedicated tool space: a full-bleed split-screen stage that loads a tool by default and lets the operator switch tools through a floating overlay picker. Same tools, same logic — only the framing and entry point change.

## What changes for the user

- Land on `/tools` → app sidebar auto-collapses (re-openable), the page becomes a full-width "stage" with `SOP Priority Builder` already loaded.
- Header strip across the top: page title **Operator's Workbench**, current tool name, and a **Switch Tool** chip that opens a command-palette overlay listing every tool grouped by section ("Make more money", etc.) with status dots.
- Below the header: the existing tool UI, but laid out as a true two-pane stage — **inputs left, compute + finding right** — instead of stacked. Same visual language as the current drawer, just always-on.
- On a fresh visit, the right pane shows the ALP Engine idle state ("Ready to run · fill the inputs to compute"); after a run it shows the compute stream and the finding card, exactly like today.
- Last-used tool is remembered (localStorage) and loaded next time; first-time users get SOP Priority Builder.

## Layout

```text
┌──────────────────────────────────────────────────────────────────┐
│  OPERATOR'S WORKBENCH · SOP Priority Builder       [Switch tool] │
├────────────────────────────┬─────────────────────────────────────┤
│                            │                                     │
│   INPUTS                   │   COMPUTE  →  FINDING               │
│   (existing tool form)     │   (ComputeStream + result card)     │
│                            │                                     │
└────────────────────────────┴─────────────────────────────────────┘
```

Mobile/narrow: panes stack (inputs on top, compute below), same as today.

## Switch Tool overlay

- Trigger: chip in the workbench header, or `⌘K` / `Ctrl+K`.
- Dialog (shadcn `Command` palette) lists tools grouped by `TOOL_GROUPS` with status dot (Live / Ready / Soon). Non-live tools are visible but disabled with a "Coming next" badge.
- Selecting a tool swaps the stage content with a brief fade; URL updates to `/tools?t=<tool-id>` so the choice is shareable and survives refresh.

## Tools page IS the tool space

The current directory grid goes away. Discovery moves into the overlay picker, which is faster to scan than the grid was and keeps the operator "inside" the workspace. The Company Vault link moves into the workbench header as a small secondary action.

## Files

- `src/routes/tools.tsx` — rewrite `ToolsLayout` / `ToolsDirectory`. New components: `WorkbenchHeader`, `WorkbenchStage`, `SwitchToolDialog`. Reads `?t=<id>` from the URL, falls back to `localStorage("alp.cc.workbench.last")`, then `"sop-priority"`. Persists choice on change. Auto-collapses the app sidebar on mount via `useAppSidebar().toggle` (only if currently expanded; restores nothing on unmount — user can re-open manually, matching the "user can re-open" answer).
- `src/components/portal/tools/*` — each existing tool component (`sop-priority-tool`, `contract-readiness-tool`, `margin-leak-tool`, `estimate-throughput-tool`) gets a lightweight `variant: "stage" | "drawer"` prop. In `stage` mode the outer `max-w-[1400px] mx-auto px-6 py-8` chrome is dropped and the internal layout switches from stacked to a `grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-8` (inputs / compute). No business logic touched — only outer wrapper + grid classes.
- `src/components/portal/tool-drawer.tsx` — keep as-is for tools triggered from other surfaces (signal tiles, Today's Move). Drawer continues to render tools in `drawer` variant. The `/tools` route stops using the drawer and renders the stage variant directly.
- `src/lib/command-tools.ts` — no change.

## Out of scope

- Tool internals (inputs, AI calls, compute steps, vault writes) — untouched.
- Routing for individual tool pages like `/tools/growth-constraint` and `/tools/owner-dependency` — those keep working; the overlay picker links to them for tools without a drawer/stage variant.
- Sidebar component itself — only its collapsed state is nudged.
- Renaming the nav item; the sidebar entry stays "Tools" so it's still scannable. The "Operator's Workbench" name lives on the page itself.

## Technical notes

- `useAppSidebar()` already exposes `{ collapsed, toggle }`. On `/tools` mount, if `!collapsed`, call `toggle()` once. Do not auto-restore on unmount — the user's manual choice during the session wins. Persisted collapsed state in localStorage means returning to other routes keeps whatever the user last set.
- `?t=<tool-id>` parsed with `useSearch` from TanStack Router; validate against `COMMAND_TOOLS` ids, fall back gracefully.
- Overlay picker uses existing `components/ui/command.tsx` + `dialog.tsx`. Keyboard shortcut wired with a single `useEffect` keydown listener.
- Empty/idle right pane: reuse the visual idiom from `compute-stream.tsx` (label-mono caption + thin rule) — no new design tokens.
