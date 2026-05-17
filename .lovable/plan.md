# Command Center v3 — Portal Shell + Cinematic Home

## The shift

Stop feeling like a marketing site with pages. Start feeling like a *portal you log into*: persistent left rail, slim chrome, the work area gets the screen. Aesthetic stays editorial / warm-paper / ink — but tighter, more bespoke, more "under the hood."

## 1. Shell — collapsible left nav (the portal frame)

Replace the top bar with a left rail using `shadcn/ui` Sidebar (`collapsible="icon"`).

```text
┌──┬────────────────────────────────────────────────┐
│ ◐│  · CONTRACTOR CIRCLE · 001 ·    M ▾  ⌘K       │  ← slim top strip
│  ├────────────────────────────────────────────────┤
│ ⌂│                                                │
│ ▶│                                                │
│ ⚙│              workspace canvas                  │
│ ▤│                                                │
│ ⌬│                                                │
│ ◫│                                                │
│ ✦│                                                │
│ ⊙│                                                │
└──┴────────────────────────────────────────────────┘
expanded: 248px   collapsed: 56px (icons only, tooltips on hover)
```

- Rail items grouped: **Daily** (Home, Calls, Community) · **Build** (Templates, Field) · **Command** (Tools, AOS, Vault) · **Program** (Intensive, Account).
- Footer of rail: tiny status row — next session countdown + signal dot.
- Top strip is minimal: workspace name, member chip, ⌘K command palette stub.
- Persist collapsed state in localStorage.

## 2. Home — cinematic command surface

Less "landing page," more "mission control on login."

- **Greeting line** computed client-only (fix the SSR hydration bug — render greeting after mount so server/client agree).
- **Hero band**: a quiet animated field (subtle grid + slow drifting gradient, GPU-cheap CSS, no Three.js). Layered with the next-session block on top in ink panel.
- Underneath, a single horizontal **action strip** of small chips: Join Zoom · Add to Calendar · Submit Topic · Open AOS · Run a Tool · Open Vault. Small, dense, ChatGPT-toolbar feel.
- Below that, a 3-column **live tiles** row: *Next Session* · *Latest Replay* · *Your Vault* (count of saved packets + most recent title). Pulls real local data.
- No big marketing cards. Everything compact, monospace labels, generous negative space.

## 3. Tools — AI-chat-style runs

Refactor the Growth Constraint tool (and set the pattern for future tools):

- Two-pane: left = inputs (stepper / inline form), right = streaming "computation" panel.
- On submit, fake a short compute sequence: lines stream in (`> normalizing revenue inputs…`, `> resolving constraint signature…`, `> writing packet…`), then the **packet** materializes in place with a typewriter reveal on headings.
- "Save to Vault" + "Print" + "Discuss in next call" actions at the bottom.
- Same shell will host Owner Dependency and future tools.

## 4. Vault — the dashboard payoff

Promote Vault from list to **dashboard**:
- Top: counters (packets saved, by tool, last activity).
- Saved packets as a sortable, filterable table.
- Stub spot reserved for "AOS signal" tiles (so when AOS data lands, it slots in).

## 5. Visual system tightening

- Tighten the cream → add a second deeper paper tone for rail bg; ink panel stays the focal black.
- Add `--signal` pulse animation utility.
- Add a `.grid-field` background utility (CSS dot grid + radial mask) for hero ambience.
- Add `.compute-line` mono style for streaming text.
- Keep Fraunces (display) + Inter (body) + JetBrains Mono (labels).

## 6. Bug fix bundled in

Hydration mismatch on `greeting()` (server renders "afternoon", client "morning"). Move greeting + date string into `useEffect` / `useState` so they render after mount.

## Files to add / change

- `src/components/portal/app-sidebar.tsx` (new) — collapsible rail
- `src/components/portal/top-strip.tsx` (new) — slim header bar
- `src/components/portal/grid-field.tsx` (new) — animated hero bg
- `src/components/portal/compute-stream.tsx` (new) — fake AI streaming panel
- `src/routes/__root.tsx` — swap top bar for `SidebarProvider` + rail + top strip
- `src/routes/index.tsx` — cinematic home, fix hydration
- `src/routes/tools.growth-constraint.tsx` — two-pane AI run UI
- `src/routes/vault.tsx` — dashboard layout
- `src/styles.css` — new tokens, grid-field, compute-line, signal pulse
- `src/lib/program.ts` — keep, no schema change

## Out of scope (this pass)

- ⌘K palette (placeholder button only)
- Real AOS data integration (slot reserved)
- Refactoring other tools beyond Growth Constraint (Owner Dependency next pass)
- Auth / Stripe / Discord APIs

Approve and I'll build it.
