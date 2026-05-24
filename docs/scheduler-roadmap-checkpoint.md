# Scheduler Roadmap Checkpoint

Checkpoint after **Engine Phase 3.9** and **UI Phase 1.6** for the Baseline / AOS CPM Schedule product.

This document is a snapshot of where the scheduler product stands today. It does not change engine logic, UI, persistence, XER handling, dry-run, or scheduling behavior. Engine2 remains unwired.

---

## 1. Production Status

- **Legacy `calculateSchedule` remains authoritative.** All user-facing schedule output is produced by the legacy engine.
- **Production routes still call legacy directly.** No production code path is routed through engine2.
- **Engine2 is not wired into user-facing schedule output.** It is invoked only through internal/dry-run paths.
- Current production scheduler supports:
  - Create / Save / Reload
  - Fit / Month / Week / Day / Wide zoom
  - Inspector (resize / collapse / expand)
  - Focus mode
  - Schedule Intelligence drawer (Compact / Standard / Wide)

## 2. Engine2 Status

- **Internal only** — not user-visible, not authoritative.
- **Gated by eligibility checks** before any invocation.
- **Dry-run comparison** available against the legacy engine.
- **Persisted dry-run helper** available for capturing comparison runs.
- **Markdown / JSON dry-run report** available for review.
- **Finish-date normalization adapter** implemented so engine2 output can be compared apples-to-apples with legacy output.
- Engine2 **remains non-authoritative** under all conditions.

## 3. UI Status

- **Focus mode** implemented — compresses chrome to maximize schedule area.
- **Table / Gantt split** adjustable.
- **Inspector** adjustable, collapsible, and expandable.
- **Intelligence drawer** adjustable with **Compact / Standard / Wide** modes.
- **Static deterministic Schedule Intelligence** implemented — every statement is traceable to existing schedule data; no AI, no chat, no generated recommendations.
- **Activity inspector** improved into a **command-box foundation** (groundwork for a future command-style activity inspector).

## 4. Known Limitations

- **Engine2 is not production-authoritative.**
- **XER support is not P6-complete.**
- **Resources / leveling are not production-grade.**
- **AI / chat / schedule generation not implemented yet.**
- **Intelligence drawer is deterministic only** — no generative insight, no recommendations.
- **WorkClock still needs deeper expansion** to reach true P6-class engine behavior.

## 5. Recommended Next Phases

Work is split into three independent tracks.

### Track A — Product / UI

- **UI-1.7** — Activity command inspector depth
- **UI-1.8** — Schedule creation / import flow
- **UI-1.9** — Schedule Intelligence actionability

### Track B — AI

- **AI-1** — Intelligence chat drawer
- **AI-2** — Build CPM from activity list
- **AI-3** — Build CPM from schedule of values
- **AI-4** — Schedule review / recommendation assistant

### Track C — Engine

- **Phase 4.0** — WorkClock expansion
- **Phase 4.1** — Full constraint set
- **Phase 4.2** — Progress / data-date engine
- **Phase 4.3** — Baseline comparison
- **Phase 4.4** — XER metadata / import hardening
- **Phase 5** — Resources
- **Phase 6** — Leveling

---

## 6. Verification

This checkpoint is documentation-only — no source code changed.

Commands to run:

- `npm test`
- `npx tsc --noEmit --pretty false`
- `npm run build`
