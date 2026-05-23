# Scheduler vs. P6-Class Engine Spec — Gap Analysis

Anchor: *Primavera P6-Class Scheduling Engine Specification* (your attached doc).
Current implementation surveyed: `src/lib/scheduler/*` (engine.ts, xer.ts, progress.ts, calendars.functions.ts, persistence.functions.ts, types.ts) and DB tables `schedules, schedule_tasks, schedule_dependencies, schedule_calendars, schedule_baselines, schedule_members`.

Read this as: **what we have is a credible CPM workbench. It is not a P6-class engine yet.** Roughly 25% of the spec is real, 20% is partial/cosmetic, 55% is missing.

---

## A. Already implemented (real, working today)

| Spec area | Where | Notes |
|---|---|---|
| Activity entity (id, name, dur, wbs, %, cost, resource label, SNET, calendar ref) | `types.ts: Task` | Single flat field set, no activity *type* (task / milestone / WBS-summary / LOE). |
| Relationship entity with FS/SS/FF/SF + lag | `types.ts: Dependency`, `engine.ts` | All four types evaluated in forward + backward pass. |
| Forward / backward CPM passes, ES/EF/LS/LF, total float, free float, critical flag | `engine.ts: runForwardPass / runBackwardPass / markFloat` | Calendar-day offsets internally; lags in working days; topological sort with cycle detection. |
| Driving-relationship flag | `engine.ts: dependencySlack` → `ScheduledDependency.isDriving` | Per-dep, surfaced in result. |
| Per-activity calendar assignment that actually changes durations | `engine.ts` (uses `task.calendar`) | Calendar lookup → working-days math per activity. |
| Project default calendar (workdays bitmask + holidays) | `schedule_calendars` table, `setDefaultCalendar` | Mirrors to `schedules.work_days/holidays`. |
| Multiple named calendars stored per schedule, with default flag | `schedule_calendars` + RLS via `is_schedule_member` | Hardened in pass #2 (`ensure_default_calendar` membership-checked). |
| One constraint type: Start-No-Earlier-Than | `Task.startNoEarlierThan`, applied in forward pass `minStart` | Hard floor on early start only. |
| Data date field on schedule | `schedules.data_date` | Persisted; consumed by `rescheduleFromDataDate`. |
| Reschedule-from-data-date (simple progress override) | `progress.ts: rescheduleFromDataDate` | Completed→0, in-progress→remaining, not-started untouched. |
| Baseline storage (table exists, RLS via `is_schedule_member`) | `schedule_baselines` + pass #3 RLS fix | Snapshot is JSONB incl. calendarId. |
| Atomic graph replace (tasks + deps) | `replace_schedule_graph` RPC (pass #3) | Transactional; validates dep references. |
| XER parsing — minimum viable | `xer.ts: importXer` | Reads `PROJECT, PROJWBS, TASK, TASKPRED`. Tab-delimited, %T/%F/%R/%E. |
| WBS import (name + short, flattened into `task.wbs` string) | `xer.ts` | Lossy — WBS hierarchy collapsed to a label. |
| Activity import (id, name, target duration in hours → days, % complete) | `xer.ts` | Caps at 2000 tasks / 5000 deps. |
| Relationship import (PR_FS/SS/FF/SF + lag_hr_cnt) | `xer.ts` | Hours → days rounding. |
| CSV export of computed schedule | `csv-export.ts` | |
| HTML reports (critical / float / lookahead / full / gantt) | `reports.ts` | |
| Auth + RLS per-schedule isolation | `schedule_members`, `is_schedule_member`, hardened functions | Verified in pass #2/#3. |

---

## B. Partially implemented (label exists, semantics shallow)

| Spec area | What we have | What is missing |
|---|---|---|
| **Calendars** | Workdays bitmask + holiday dates. Per-activity assignment respected. | No work shifts / hours-per-day / hours-per-week conversion. No global vs project vs resource calendar hierarchy. No inheritance. Calendar object cannot express "10h on Sat, 8h M–F". Holiday math is whole-day only. |
| **Lag calendar basis** | Lag is computed against **project default** calendar. | Spec wants per-link calendar basis (or at least the option), and P6 itself supports predecessor/successor/24h lag calendars. |
| **Float / criticality** | Total float + free float computed. Critical = totalFloat ≤ tolerance. | No longest-path criticality option. No multi-calendar-aware float reconciliation. Free float uses successor's *earlyStart* via predecessor's calendar — works but not P6-accurate when calendars differ. |
| **Driving relationship trace** | `isDriving` boolean per dep. | No per-activity "driving predecessor" pointer surfaced to UI; no driven-successor view; no chain-back walk. |
| **Constraints** | SNET only. | Missing: SNLT, FNET, FNLT, MSO, MFO, AS-LATE-AS-POSSIBLE, Mandatory Start/Finish, Expected Finish. No diagnostics distinguishing logic-driven vs constraint-driven dates. |
| **Progress** | `percentComplete` single field; reschedule helper. | No actual start / actual finish. No remaining duration distinct from original. No physical/duration/units % complete modes. No out-of-sequence rule selector (retained logic vs progress override). No suspend/resume. |
| **Resources** | Free-text `resourceName` + `resourceUnitsPerDay`. | No resource entity, no role entity, no hierarchy, no rate, no cost source, no resource calendar, no curves, no budget vs remaining vs actual units, no overtime. Spec requires first-class Resource + Role + Assignment tables. |
| **Baselines** | Table + JSONB snapshot capture, RLS, manual "Pre-reschedule" snapshot. | No baseline assignment per project, no baseline comparison engine (BL ES/EF vs current), no schedule variance computation, no multi-baseline (project / primary / secondary / tertiary). |
| **XER import — projects** | One project per import, "create new only". | No Update / Replace / Add-Into existing project modes. No delete-unreferenced-on-update. No version-aware parsing. No multi-project XER. |
| **XER import — calendars** | Ignored. CALENDAR table not read at all. | This is a major fidelity gap: imported P6 dates will diverge because we substitute the project default. |
| **Diagnostics** | Engine returns `diagnostics: string[]` for normalization issues. | No structured per-activity cause codes (logic / constraint / calendar / progress / leveling). No run-record audit log. |
| **Determinism / explainability** | Pure-function engine is deterministic given identical inputs. | No versioned ScheduleRun record, no options snapshot, no warning/error list persisted. |

---

## C. Missing (not started)

These are required by the spec and have **no implementation today**:

1. **WBS as a real hierarchical entity** — currently a denormalized string field on each task. Spec requires WBS nodes with parent links, codes, summary roll-ups.
2. **Activity type field** — Task Dependent, Resource Dependent, Level of Effort, Start/Finish Milestone, WBS Summary. Affects duration semantics and scheduling rules.
3. **Duration type** — Fixed Duration & Units, Fixed Duration & Units/Time, Fixed Units, Fixed Units/Time. We have no concept; spec requires deterministic recalculation rules.
4. **Percent-complete-type** — Physical vs Duration vs Units, as *behaviorally distinct* modes, not labels.
5. **Multiple float-path analysis** — ranked critical paths beyond #1, basis selector (TF vs FF), targetable to a selected activity/milestone.
6. **Resource leveling** — overallocation detection + leveling pass + priority order + preserve-dates rule + leveling log + pre/post date storage.
7. **Resource calendars** distinct from project/activity calendars, with assignment-time conflict resolution.
8. **Resource curves** (front-loaded, back-loaded, bell, custom) on assignments.
9. **Expense assignments** (non-resource cost line items).
10. **Interproject / external relationships** — preservation flag, "Ignore relationships to/from other projects" option, external-date preservation.
11. **Baseline comparison engine** — variance fields, project-baseline assignment, BL fields on activity rows.
12. **XER Update / Replace / Add-Into / Delete-Unreferenced import modes.**
13. **XER calendar table parsing** (CALENDAR + work hours / exceptions).
14. **XER export** (round-trip) — currently import-only.
15. **Schedule run audit log** — per-run record with user, timestamp, options snapshot, leveling snapshot, data date, change counts, warnings/errors.
16. **Structured diagnostics service** — per-activity governing-cause codes (logic / constraint / calendar / progress / leveling / external).
17. **Working-time API** — deterministic `nextWorkInstant / prevWorkInstant / addWork / diffWork` exposed as a public surface for the UI to call (today the math is private to the engine).
18. **Acceptance test suite** — the 20 tests enumerated in §"Acceptance tests" do not exist. We have *no* automated CPM regression coverage.
19. **Partial-import / transactional XER commit awareness** — no per-table commit log, no rollback on partial failure.
20. **XER version selector** (Oracle’s export-version concept).

---

## D. High-risk / complex (call out before scoping)

Items where naive implementation will produce *wrong* numbers that look right — these need careful design before they ship:

| Risk | Why it's hard |
|---|---|
| **Multi-calendar CPM** | The current engine stores durations as elapsed calendar-day offsets from project start. Once each activity's lag, predecessor, and successor can each have a different calendar, the offset-from-anchor trick breaks down. The internal representation likely needs to move to **absolute working-time instants** (epoch ms or per-calendar minute counts) and re-derive offsets only at output. This is a foundational refactor, not an addition. |
| **Duration type + percent-complete-type interaction** | These are *deterministic recalculation rules* P6 schedulers rely on. Get them wrong and every edit to duration/units/units-per-time silently corrupts the schedule. Needs an explicit state machine and a unit-test matrix. |
| **Out-of-sequence progress** | Retained-logic vs progress-override vs actual-dates rules each produce different forward-pass behavior. Picking a default without making it configurable will burn working schedulers. |
| **Resource leveling** | NP-hard in general; P6 uses a deterministic priority-walk. We need to replicate the *algorithm*, not just call a solver, or results won't match imported schedules. Also needs pre/post snapshots so users can A/B. |
| **XER fidelity** | Every shortcut in xer.ts (rounded hours→days, ignored CALENDAR, ignored constraints, ignored actuals, ignored resources) means an imported P6 schedule recalculates to **different dates** than P6 produces. Users *will* notice. Until we parse calendars + constraints + actuals + duration types, "imported schedule" is a label, not a fact. |
| **Float math under mixed calendars** | Free float especially: P6 computes it against the successor's calendar at the relationship's calendar basis. Our current free-float uses the predecessor's calendar as a shortcut; it gives the right answer when calendars match and silently wrong answers when they don't. |
| **Backward-compatible storage migration** | Adding actual_start, actual_finish, remaining_duration, duration_type, percent_complete_type, activity_type, multiple constraint slots, resource tables, assignment tables, baseline assignment, run log — each is a migration with backfill. Plan as a single coordinated schema phase, not one ALTER per feature. |

---

## E. Recommended build sequence

Spec's own recommended order is sound; this is the same order, mapped to *our* current code with concrete milestones and an explicit "stop and verify" gate at each step.

### Phase 1 — Engine foundation (refactor, not feature)
**Goal:** make the engine able to express what P6 expresses, before adding features that need it.

1. **Working-time core** — introduce a `WorkClock` abstraction: `addWork(instant, minutes, calendar)`, `diffWork(a, b, calendar)`, `nextWorkInstant(instant, calendar)`. Move all engine date math through it. Calendars gain: hours-per-day, work shifts, weekly pattern, exceptions.
2. **Refactor engine to absolute instants** (epoch ms) internally; calendar-day offsets become a derived output only. Removes the "single project anchor" assumption.
3. **Activity types + duration types + %-complete types** added to `schedule_tasks` schema. Engine respects them. Editing rules implemented as a documented state machine.
4. **Full constraint set** (SNET, SNLT, FNET, FNLT, MSO, MFO, ALAP, expected finish). Each tagged with `governing_cause` when it overrides logic.
5. **Acceptance tests #1–#10** from the spec, as Vitest suite. **Do not advance until these pass.**

### Phase 2 — Progress & explainability
6. Actuals model (`actual_start`, `actual_finish`, `remaining_duration` separate from `original_duration`).
7. Out-of-sequence rule selector (retained logic / progress override / actual dates).
8. Suspend/resume.
9. Structured per-activity diagnostics (`governing_cause`: logic | snet | snlt | … | suspend | leveling | external).
10. Driving-predecessor / driven-successor surfaces in `ScheduleResult` consumable by the UI tracer.
11. Schedule-run audit log table (`schedule_runs`: timestamp, user, options snapshot, data date, change counts, warnings, errors).
12. Acceptance tests #6–#10 green.

### Phase 3 — Float paths & baselines
13. Multiple float-path analysis (rank N, basis = TF or FF, target = project end or activity).
14. Baseline assignment model (project / primary / secondary / tertiary) + variance computation (BL ES vs ES, BL EF vs EF, dur var, % complete var).
15. Acceptance tests #11–#12 green.

### Phase 4 — Resources
16. Resource + Role + ResourceCalendar tables (first-class, with hierarchy).
17. Assignment table (resource_id, role_id, budgeted/remaining/actual units & cost, units/time, curve_id, future-period buckets).
18. Resource curves library.
19. Cost recalculation on assignment edit / progress / leveling.
20. Overallocation detection (read-only).

### Phase 5 — Leveling
21. Leveling options model (priorities, preserve-dates flag, selected-resources mode, cross-project priority).
22. Deterministic priority-walk leveling pass + pre/post snapshot.
23. Leveling log writer.
24. Acceptance tests #13–#16 green.

### Phase 6 — XER interoperability hardening
25. Parse CALENDAR table (work shifts, exceptions, hours/day).
26. Parse TASK actuals, constraints, duration_type, complete_pct_type, suspend/resume.
27. Parse RSRC, RSRCRATE, TASKRSRC (resources + assignments).
28. Import modes: Create / Update / Replace / Add-Into. Delete-unreferenced toggle per category.
29. External-relationship preservation + "Ignore relationships to/from other projects" option.
30. Per-table partial-commit log + rollback markers.
31. XER export (round-trip).
32. Acceptance tests #17–#20 green.

### Phase 7 — UI surfacing (existing workbench gets new data, not new chrome)
Wire the new engine outputs into existing panels (`CpmGrid`, `DcmaPanel`, `BaselinesPanel`, `ResourcesPanel`). Visual polish pass happens *after* this.

---

## Minimum-parity definition (spec's bar, restated honestly)

The spec says: a release counts as "scheduling-engine competitive" only when an imported P6 schedule recalculates to *trustably matching* dates, floats, critical path, float-path ranking, and leveling outcomes.

Against that bar, we are roughly **end of Phase 0** today. Phases 1–4 are the minimum to claim "P6-class CPM workbench." Phases 5–6 are the minimum to claim "P6-class scheduling engine."

Estimate, with the existing one-track build pace:

- Phase 1 (foundation refactor + tests #1–10): **largest single phase**, do not under-scope.
- Phases 2–3: incremental on top of Phase 1.
- Phase 4: substantial — first time resources become a real domain model.
- Phase 5: tractable only after Phase 4.
- Phase 6: ongoing; CALENDAR + constraints + actuals parsing should land in Phase 1's tail, not Phase 6, because every other phase's tests are weaker without them.

---

## Recommendation for the *next* engineering pass (pass #4)

Do **not** start Phase 1 yet. First do the two things that make Phase 1 cheaper:

1. **Write the acceptance test harness** (Vitest) with the 20 spec tests as `.todo()` stubs. This converts the spec into executable scope and gives every later phase a green/red signal.
2. **Decide the internal time representation** (offset-from-anchor vs absolute working-time instants) and document it in `src/lib/scheduler/ARCHITECTURE.md`. Every Phase 1 task depends on this decision.

After those two, Phase 1.1 (WorkClock + calendar shape) is the first real engine change.
