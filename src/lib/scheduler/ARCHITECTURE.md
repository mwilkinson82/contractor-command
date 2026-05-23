# Scheduler Engine — Internal Architecture

Status: **proposed** (pass #4 prep doc; ratify before Phase 1 begins).
Scope: the calculation core under `src/lib/scheduler/`. UI components and persistence layer are out of scope except where they consume engine outputs.
Anchor spec: `.lovable/scheduler-p6-gap-analysis.md` → Primavera P6-Class Scheduling Engine Specification.

---

## 1. The decision

> **Recommendation: adopt the absolute working-time instant model. Retire the offset-from-anchor model before Phase 1 features land.**

Internally, every schedulable moment is represented as an **absolute UTC instant** (epoch milliseconds). Calendars are queryable working-time functions over that instant axis. Offsets from project start become a *derived output* for the UI, not a primary data structure.

The rest of this doc explains why, what it costs, and what the engine surface looks like under that model.

---

## 2. The two options

### Option A — Offset-from-anchor (the model we have today)

- One project anchor (`projectStartDate`) is chosen.
- All activity ES/EF/LS/LF are stored as **integer calendar-day offsets** from that anchor.
- Durations are interpreted as working days of the activity's own calendar, converted on the fly to elapsed calendar-day offsets by walking the calendar forward from the activity's start offset.
- Lags are interpreted as working days of the project default calendar, converted similarly.
- Output dates are computed by adding the offset to the anchor.

This is what `src/lib/scheduler/engine.ts` does today. See `workingDaysToCalendarDays`, `lagCalendarOffset`, `successorEarlyStart` for the conversion sites.

### Option B — Absolute working-time instants

- Every ES/EF/LS/LF is an **absolute UTC instant** (epoch ms, ISO at the boundary).
- Calendars are first-class objects implementing a `WorkClock` interface (see §4). They answer: "starting at instant X, add N working minutes under calendar C — give me the resulting instant."
- Durations are stored in their native unit (working minutes, or working hours, or working days under a specified calendar) and resolved against the activity's calendar at calc time.
- Lags are stored with their own calendar basis (predecessor calendar / successor calendar / project default / 24-hour) — matching P6.
- Free float, total float, and slack are computed against the relevant calendar at each evaluation site.

---

## 3. Why absolute instants wins

A point-by-point against the spec's risk surface:

| Concern | Option A (offset) | Option B (instants) |
|---|---|---|
| **Mixed calendars** | Breaks. Once each task, each lag, and each constraint can carry its own calendar, "calendar-day offset from project start" is ambiguous — the same offset means a different wall-clock moment on a different calendar. Today's code papers over this by always converting through `projectStart`, which only works while one calendar dominates. | Works. The instant is unambiguous; calendars are just functions that take an instant and answer questions about it. |
| **Holidays** | Already supported (whole-day only). | Same support, plus partial-day exceptions become expressible because the unit of work is minutes, not days. |
| **Shifts (e.g. 10h Sat, 8h M–F, split-shift days)** | Cannot be expressed without redefining the meaning of "day". Every working-day count becomes calendar-dependent and the offset abstraction leaks. | Native. Shifts are just intervals of working time per day. Adding N working minutes walks those intervals. |
| **Hours-per-day conversion** | Currently a single import-time round-down (`hoursToDays(hours, 8)`). Any project with non-8h days is silently wrong. | No conversion needed. Duration stored as minutes; "8h/day" is purely a *display* preference. |
| **Lag calculations** | Lag is always against the project default calendar. P6 supports per-link calendar basis. We will get wrong lags on imported XER as soon as the project has more than one calendar. | Each `Dependency` carries `lagBasis: 'pred' \| 'succ' \| 'project' \| '24h'` and the WorkClock resolves accordingly. |
| **Free float under different calendars** | Today's `markFloat` uses `task.calendar` to compute successor slack — a known shortcut that produces the right answer when calendars match and silently wrong answers when they don't. | Free float is computed as `succ.earlyStart − (computed earliest succ start from this predecessor) under the relationship's calendar basis`. Correct by construction. |
| **Data date behavior** | Data date is an ISO string used only by `rescheduleFromDataDate` to mutate task durations. The engine itself has no concept of "do not schedule work before the data date". | Data date is an instant. Forward pass clamps every task's earliest start to `max(networkEarliest, dataDate)` for not-started activities, and respects actual start for in-progress activities. Required to match P6 progress recalc. |
| **Constraints** | Only SNET, applied as a calendar-day-offset floor. Adding SNLT/FNET/FNLT/MSO/MFO/ALAP/Expected-Finish in the offset model requires re-implementing each as an offset transformation, with per-constraint calendar caveats. | Each constraint is `{ type, instant, calendar }`. Forward and backward passes consult them uniformly: clamp early dates on the forward pass for SNET/MSO/Expected, clamp late dates on the backward pass for SNLT/FNLT/MFO/ALAP. |
| **Progress / actuals** | Single `percentComplete` field, no actual start/finish, no remaining duration distinct from original. Reschedule is a bulk mutation, not part of the calculation. | `actualStart`, `actualFinish`, `remainingDuration` are first-class instants/durations. Forward pass uses `actualStart` when present, schedules only the remaining work from `max(dataDate, actualStart + workDone)`. Required for out-of-sequence rules. |
| **Future resource leveling** | The leveling pass needs to ask: "is resource R overallocated at instant T?" and "if I move activity A forward by N working minutes of resource R's calendar, what is its new finish?" Both questions are awkward in an offset world because resource calendars are *different from* the project default. | Both questions are direct WorkClock calls. Resource calendars are just additional WorkClock instances. |
| **XER / P6 reconciliation** | High risk. P6 stores activities, lags, constraints, actuals, and resources all in absolute time with per-entity calendars. Round-tripping through an offset model means we re-derive an anchor on every export, lose lag-calendar fidelity, and accumulate drift on update-existing imports. | Low risk. XER's model maps almost 1:1 — its `target_start_date`, `act_start_date`, `cstr_date`, etc. are timestamps; its `CALENDAR` entries describe working-time. We read what's there and store what's there. |

The offset model was a reasonable shortcut for a single-calendar prototype. It will not survive contact with Phase 1 features (full constraint set, actuals, mixed calendars). Doing Phase 1 on top of it means doing Phase 1 twice.

---

## 4. The proposed engine surface

### 4.1 `WorkClock` interface (new public type)

```ts
export interface WorkClock {
  readonly id: string;
  readonly name: string;

  /** Is `instant` a working moment under this calendar? */
  isWorking(instant: number): boolean;

  /** Next working instant at or after `instant`. */
  nextWorkInstant(instant: number): number;

  /** Previous working instant at or before `instant`. */
  prevWorkInstant(instant: number): number;

  /** Add N working minutes (may be negative) to `instant`. */
  addWork(instant: number, minutes: number): number;

  /** Working minutes between a and b (signed: positive if b > a). */
  diffWork(a: number, b: number): number;

  /** Hours-per-day / week / month / year conversion constants for display. */
  readonly hoursPerDay: number;
  readonly hoursPerWeek: number;
  readonly hoursPerMonth: number;
  readonly hoursPerYear: number;
}
```

Concrete implementations live in `src/lib/scheduler/calendar/`. The simplest implementation (whole-day workdays + holiday list + fixed 8h/day) reproduces today's behavior and is the migration target for existing data.

### 4.2 Duration

```ts
export interface Duration {
  /** Native unit is working minutes. */
  minutes: number;
  /** The calendar this duration was authored against (for display/round-trip). */
  authoringCalendarId: string;
}
```

Durations are calendar-tagged at authoring so we can present "5d" consistently in the UI regardless of which activity displays it.

### 4.3 Activity

```ts
export interface EngineActivity {
  id: string;
  name: string;
  type: 'task' | 'resource' | 'loe' | 'milestone-start' | 'milestone-finish' | 'wbs-summary';
  durationType: 'fixed-dur-units' | 'fixed-dur-units-per-time' | 'fixed-units' | 'fixed-units-per-time';
  percentCompleteType: 'physical' | 'duration' | 'units';

  calendarId: string;

  originalDuration: Duration;
  remainingDuration: Duration;
  actualStart?: number; // instant
  actualFinish?: number; // instant

  constraints: Constraint[];          // 0..2 per P6 (primary + secondary)
  percentComplete?: number;           // for physical mode
  // … resource assignments, costs, curves etc. come later
}
```

### 4.4 Relationship

```ts
export interface EngineRelationship {
  id: string;
  from: string;
  to: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lag: Duration;
  lagCalendarBasis: 'predecessor' | 'successor' | 'project' | '24h';
}
```

### 4.5 Calculation result

```ts
export interface EngineResult {
  dataDate: number;
  activities: Array<{
    id: string;
    earlyStart: number; earlyFinish: number;
    lateStart: number;  lateFinish: number;
    totalFloatMinutes: number; freeFloatMinutes: number;
    isCritical: boolean;
    governingCause: 'logic' | 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo' | 'alap' |
                    'expected-finish' | 'data-date' | 'actual' | 'calendar' |
                    'leveling' | 'external';
    drivingPredecessorId?: string;
  }>;
  relationships: Array<{ id: string; isDriving: boolean; slackMinutes: number }>;
  criticalPath: string[];
  diagnostics: Array<{ severity: 'info' | 'warn' | 'error'; code: string; message: string; activityId?: string }>;
  runMeta: { startedAt: number; durationMs: number; optionsHash: string };
}
```

The output is in instants and minutes; converting to ISO/days is a presentation step.

---

## 5. What changes in the codebase

### 5.1 Replaced or rewritten
- `src/lib/scheduler/engine.ts` — rewritten around `WorkClock`. Topological sort, forward/backward pass, float marking all expressed in instants/minutes.
- `src/lib/scheduler/types.ts` — split into `engine-types.ts` (canonical engine model, the shapes in §4) and `legacy-types.ts` (the current `Task`/`Schedule` shapes, kept temporarily for storage + UI compatibility during migration).
- `src/lib/scheduler/progress.ts` — `rescheduleFromDataDate` becomes a thin wrapper that mutates `actualStart` / `remainingDuration` / `actualFinish` and lets the engine do the rest.

### 5.2 New
- `src/lib/scheduler/calendar/work-clock.ts` — interface + default whole-day implementation.
- `src/lib/scheduler/calendar/shift-clock.ts` — Phase 1.1: shift-aware implementation.
- `src/lib/scheduler/calendar/lag-basis.ts` — resolves lag calendar per relationship.
- `src/lib/scheduler/engine/forward-pass.ts`, `engine/backward-pass.ts`, `engine/float.ts` — split for clarity once the engine grows.
- `src/lib/scheduler/__tests__/p6-acceptance.spec.ts` — already created in pass #4.

### 5.3 Unchanged for now
- Storage shape (`schedule_tasks`, `schedule_dependencies`, `schedule_calendars`). Phase 1 keeps the existing columns and adds the new ones (`activity_type`, `duration_type`, `percent_complete_type`, `actual_start`, `actual_finish`, `remaining_duration_min`, `constraint_*`, `lag_basis`) in a single coordinated migration. The legacy columns stay until Phase 2.
- UI components. The engine result shape is backward-compatible enough that `CpmGrid` can keep rendering ISO dates while the new fields trickle in.

---

## 6. Migration strategy

Phase 1.0 is a pure refactor — no observable behavior change for single-calendar projects:

1. Land the `WorkClock` interface and the whole-day implementation. Wire `engine.ts` to call it instead of inlining the date math. Tests `CPM-1`, `CPM-2`, `CPM-3`, `CAL-4` go green.
2. Add the absolute-instant rewrite of the forward/backward pass behind a feature flag. Run both engines on every recalc; assert identical outputs on the existing sample schedule. Flip the flag when they agree across the test corpus.
3. Delete the offset-based engine.

Phase 1.1+ then adds shifts, full constraints, actuals, etc. on top of the new core — each landing with the corresponding acceptance test flipping from `.todo()` to `it()`.

---

## 7. Costs / risks of this choice

- **Migration is real work.** Storage gets new columns, the engine gets rewritten, and the UI's idea of "a date" gets formalized. Budget for it as the bulk of Phase 1.
- **Instant arithmetic on a JS Date is a sharp edge.** All engine math stays in `number` (epoch ms); we touch `Date` only at ISO boundaries. The acceptance tests should explicitly cover DST and year boundaries even though we are storing UTC.
- **The whole-day `WorkClock` must be exactly equivalent to today's behavior** on single-calendar projects. The Phase 1.0 dual-engine assertion is the safety net.
- **No regression on existing sample schedules.** We commit to that with a `.todo()`-free version of `CPM-1`/`CPM-2`/`CPM-3` plus a snapshot of the seeded Commercial Fit-Out result before the refactor.

---

## 8. What we are *not* deciding here

- Persistence schema details (covered in Phase 1's migration design).
- UI surfacing of new fields (Phase 7).
- Leveling algorithm choice (Phase 5 — priority-walk per P6, but the exact tie-break rules are a separate design doc).
- Resource curve representation (Phase 4).
- XER export format (Phase 6).

This doc only fixes the *internal time representation*, because every later decision depends on it.

---

## 9. Ratification

Status: **ratified**. Phase 1.0 has landed.

---

## 10. Phase 1.0 status (landed)

Phase 1.0 is a **foundation-only** pass. It introduces the engine2 module
under `src/lib/scheduler/engine2/` and a feature flag, with **zero
behavior change** in production. The legacy offset-based engine in
`src/lib/scheduler/engine.ts` remains the only engine wired to UI and
persistence.

### What Phase 1.0 implements

- `engine2/types.ts` — canonical engine model (Duration, EngineActivity,
  EngineRelationship, Constraint, EngineResult, GoverningCause). Pure
  types; no runtime code.
- `engine2/work-clock.ts` — `WorkClock` interface +
  `createWholeDayWorkClock` implementation supporting:
  - whole-day workdays via 7-bit bitmask
  - whole-day holiday list (UTC ISO YYYY-MM-DD)
  - fixed hours-per-day window starting at UTC 00:00
  - `isWorking`, `nextWorkInstant`, `prevWorkInstant`,
    `addWork` (forward & backward), `diffWork` (signed)
- `engine2/feature-flag.ts` — `getSchedulerEngine()` returning `"legacy"`
  by default; opt-in to `"engine2"` via `VITE_SCHEDULER_ENGINE` /
  `SCHEDULER_ENGINE` env.
- `src/lib/scheduler/__tests__/work-clock.spec.ts` — focused unit tests
  for the WorkClock primitives (weekends, holidays, day rollover, signed
  diffs, backward addition).

### What Phase 1.0 does NOT implement

- No engine2 forward/backward CPM pass yet.
- No `Schedule → EngineActivity[]` adapter yet.
- No dual-engine assertion harness yet.
- No shifts, no partial-day exceptions, no resource calendars.
- No new constraint handling beyond type definitions.
- The 20 P6 acceptance tests remain `.todo()` — they are NOT satisfied
  by Phase 1.0 and MUST NOT be flipped to `it()` until the engine2 CPM
  passes land in Phase 1.1+.

### Implementation notes / deviations from §4

- All working-time math is in whole **minutes** with bounded loops
  (`~50 years` upper bound) to guarantee termination on pathological
  calendars. `addWork` rejects non-integer minute counts at runtime.
- The whole-day work window is anchored at UTC 00:00 (not a configurable
  shift-start) because Phase 1.0 explicitly excludes shifts. The
  `prevWorkInstant` boundary uses `dayStart + window - 1min` so the
  returned instant remains inside the working window.
- `hoursPerWeek/Month/Year` on the whole-day clock are derived as
  `hoursPerDay * {5, 20, 250}`. The shift-aware clock in Phase 1.1 will
  compute these from actual working time.

### Next pass (Phase 1.1) entry criteria

1. Wire engine2's forward/backward CPM pass against `WorkClock`.
2. Add the dual-engine assertion harness: on every recalc of the
   existing demo schedule, run both engines and assert identical
   ES/EF/LS/LF/float/critical output.
3. Flip `CPM-1`, `CPM-2`, `CPM-3`, `CAL-4` from `.todo()` to `it()`
   as the new passes satisfy them.

---

## 11. Phase 1.1 status (landed)

Phase 1.1 lands the first working **CPM calculation in engine2** on top of
the Phase 1.0 WorkClock foundation. The legacy engine in
`src/lib/scheduler/engine.ts` remains the sole engine wired to the UI and
persistence; the feature flag still defaults to `"legacy"` in production.

### What Phase 1.1 implements

- `engine2/cpm.ts` — `calculateCpm(input: CpmInput): EngineResult`:
  - Topological sort with cycle detection.
  - Forward pass: per-activity `earlyStart` / `earlyFinish` using
    `WorkClock.addWork`, with successor-start snapping via
    `nextWorkInstant` under the successor's calendar.
  - Backward pass: per-activity `lateStart` / `lateFinish` from project
    finish, working back through each relationship.
  - FS, SS, FF, SF relationships with per-link lag in working minutes
    and four `lagCalendarBasis` modes (`predecessor`, `successor`,
    `project`, `24h`).
  - Per-activity calendar assignment (any `WorkClock` keyed by id).
  - SNET constraint clamping on the forward pass.
  - Total float and free float in working minutes of the activity's own
    calendar.
  - Critical marking via `totalFloatMinutes <= criticalFloatToleranceMinutes`
    (default tolerance = 0).
  - Per-relationship driving / slack reporting and `criticalPath`
    ordering.
  - Warning diagnostics for relationships referencing unknown activity
    ids.
- `engine2/work-clock.ts` — symmetry fix in the backward branch of
  `addWork` so that `addWork(addWork(t, +n), -n) === t` for
  working-aligned `t`, including across day-end boundaries (e.g.
  Fri 08:00). Forward and `diffWork` behaviour are unchanged.
- `engine2/index.ts` — re-exports `calculateCpm` and its types.

### Acceptance tests now active (it, not it.todo)

- **CPM-1** — simple FS chain on a single calendar: positions, total
  float, late/early equivalence, and critical-path order.
- **CPM-2** — two parallel paths of unequal duration: longer-path
  activities critical, shorter-path activity carries 2-workday total
  float.
- **CPM-3** — free-float (Oracle definition): `B.freeFloat = 3
  workdays` on the diamond fixture where C drives D.
- **CAL-4** — two activities of identical nominal duration on different
  calendars: Y finishes 3 calendar days later than X (one workday slip
  across a weekend) because of Y's Tuesday holiday.

The remaining 16 of the 20 P6 acceptance tests stay `.todo()`.

### Known limitations of engine2 after Phase 1.1

- **Calendars**: only whole-day workdays + whole-day holidays + fixed
  hours-per-day window anchored at UTC 00:00. No shifts, no partial-day
  exceptions, no per-resource calendars.
- **Constraints**: only `snet` is enforced on the forward pass. The
  other constraint types are accepted in the data model but ignored by
  the calculation (no diagnostic yet).
- **Progress / actuals**: `actualStart`, `actualFinish`, `dataDate`,
  and `percentComplete` are stored on `EngineActivity` but not consumed
  by the forward pass — Phase 1.1 schedules everything from
  `projectStart`.
- **Free float in mixed-calendar links**: link slack is measured in the
  successor's calendar minutes. Correct for single-calendar projects
  (which CPM-3 covers) and a defensible default for mixed-calendar
  links; a future pass may refine per `lagCalendarBasis`.
- **FF / SF boundary snapping**: when the required successor finish
  falls on a non-working instant of the successor's calendar, the
  required finish is snapped *up* before back-walking by duration.
  Conservative (never violates the link) but may overschedule by a
  partial day at boundaries.
- **Dual-engine assertion harness**: deferred to Phase 1.2.
- **No `Schedule → EngineActivity[]` adapter yet** — engine2 is not yet
  callable from the existing scheduler page.

### Phase 1.2 entry criteria (superseded — see §12 below)

1. ~~`Schedule → CpmInput` adapter~~ — deferred again, see §12.
2. ~~Dual-engine harness~~ — deferred again, see §12.
3. Activate additional acceptance tests as they become satisfiable.

---

## 12. Phase 1.2 status (landed)

Phase 1.2 expands engine2 from baseline CPM math toward real construction
schedule state handling. The user explicitly rescoped the originally-proposed
adapter and dual-engine harness out of this pass in favor of engine-internal
foundations (constraints, data date, actuals, diagnostics). The legacy
engine remains the sole engine wired to the UI; the feature flag still
defaults to `"legacy"`.

### What Phase 1.2 implements

- **Constraints** in `engine2/cpm.ts`:
  - `snet` — forward pass clamp on ES (already in 1.1, now with diagnostic).
  - `fnet` — forward pass clamp by back-solving from required EF.
  - `mso` — mandatory start pins ES (forward) and LS (backward).
  - `mfo` — mandatory finish pins EF (forward) and LF (backward).
  - `snlt` — backward pass clamp on LS (via LF = LS + duration).
  - `fnlt` — backward pass clamp on LF.
  - `alap` — pins early dates to late dates on the activity itself
    after the backward pass.
- **Data date behavior**:
  - Not-started activities cannot schedule before `input.dataDate` (snapped
    into their own calendar's working time).
  - In-progress activities (have `actualStart`, no `actualFinish`):
    `earlyStart = actualStart`; `earlyFinish = dataDate + remainingDuration`
    in the activity's calendar; `governingCause = "data-date"`.
  - Completed activities (have `actualFinish`): `earlyStart = actualStart`,
    `earlyFinish = actualFinish`, `lateStart/lateFinish` mirror them;
    `governingCause = "actual"`.
- **Diagnostics**: per-activity `EngineDiagnostic` entries emitted for each
  constraint that bound a date, plus `in-progress` and `actual-finish`
  notes. The driving predecessor (`drivingPredecessorId`) is already
  populated from 1.1.
- **Acceptance tests now active** (in addition to the 1.1 four):
  - **CON-6** — FNLT pulls late finish earlier, surfaces a diagnostic, and
    produces negative total float when there is insufficient slack.
  - **CON-7** — SNET-driven activity has `governingCause === "snet"` and an
    `info` diagnostic tagged with the activity id.
  - **PRG-9** — in-progress activity (actual start + remaining duration)
    projects EF from the data date; ES is preserved at the actual start.

The remaining 13 of the 20 P6 acceptance tests stay `.todo()`.

### Known limitations of engine2 after Phase 1.2

- **Percent complete**: only "Duration" mode is honored by the calculation
  (via `remainingDuration`). `Physical` and `Units` are accepted on the
  model but not interpreted. PRG-8 stays `.todo()`.
- **ALAP propagation**: ALAP pins the activity itself to its late dates,
  but does not re-run the forward pass for downstream successors. Adequate
  for terminal/near-terminal ALAP activities; a future pass should add a
  fixpoint iteration.
- **Out-of-sequence progress**: PRG-10 (retained logic / progress override
  / actual dates rule) is not implemented. The current behavior is
  effectively "retained logic" for in-progress activities, but only one
  rule, with no selector.
- **Expected-finish constraint**: accepted on the model, not honored.
- **Negative-float critical marking**: critical is still defined as
  `totalFloat <= tolerance` with default tolerance 0; constrained schedules
  can produce negative-float chains. This matches P6 behavior.
- **Adapter and dual-engine harness**: still deferred. Engine2 remains
  test-only; the production UI runs entirely on the legacy engine.
- **Activity / duration / percent-complete type fields**: stored on
  `EngineActivity`, used for shape only — no type-specific scheduling
  behavior beyond what Duration% implies through `remainingDuration`.

### Phase 1.3 entry criteria (superseded — see §13)

---

## 13. Phase 1.3 status (landed)

Phase 1.3 turns engine2's progress model into a real construction-update
foundation. Progress is no longer a single opaque percent: status,
durations, and percent-complete are now explicit, derived deterministically,
and structurally separated by `percentCompleteType`.

The user explicitly deferred the adapter, dual-engine harness, ALAP
re-flow, and PRG-10 out-of-sequence rules out of this pass. Legacy engine
is still the only engine wired to the UI; the feature flag still defaults
to `"legacy"`.

### What Phase 1.3 implements

- **Activity status** (`ActivityStatus = "not-started" | "in-progress" | "completed"`)
  is derived deterministically from `actualStart` / `actualFinish` and
  surfaced on `EngineActivityResult.status`.
- **Status consistency diagnostics** emitted at calc time:
  - `actualFinish` set without `actualStart` (warn).
  - `actualFinish` precedes `actualStart` (warn).
  - Completed activity with `remainingDuration > 0` (warn; engine treats
    remaining as 0 once `actualFinish` is set).
  - Not-started activity whose `remainingDuration !== originalDuration`
    (info — baseline drift).
  - Negative `originalDuration` or `remainingDuration` (warn).
  - `physicalPercentComplete` / `unitsPercentComplete` outside [0,100]
    (warn).
- **Percent-complete types** are structurally distinguished on the result:
  - `duration` → computed `durationPercentComplete` =
    `actual / (actual + remaining)` in working minutes of the activity's
    calendar; clamped to `[0,100]`; 100 for completed.
  - `physical` → independently authored `physicalPercentComplete` reported
    verbatim. Does NOT influence calculated dates in Phase 1.3.
  - `units` → independently authored `unitsPercentComplete` reported
    verbatim as a Phase 1.3 stub. NO resource-unit derivation yet.
  - `reportedPercentComplete` on the result is the value driven by the
    activity's `percentCompleteType` — the field UIs should read.
- **Duration fields formalized** on `EngineActivityResult`:
  - `actualDurationMinutes` (working minutes between `actualStart` and
    `dataDate` for in-progress, or `actualStart`→`actualFinish` for
    completed, in the activity's calendar).
  - `remainingDurationMinutes` (clamped to 0 for completed).
  - `atCompletionDurationMinutes` = actual + remaining.
  - `durationPercentComplete` always computed, independent of which
    percent-complete type is reported.
- **In-progress projection** refined:
  - `actualStart` preserved on `earlyStart` (never re-derived from logic).
  - Remaining work projected from `cal.nextWorkInstant(dataDate)` through
    WorkClock, never from project start.
  - Completed activities pin both early and late dates to actuals — no
    forward/backward recalculation, no float.
  - Not-started activities clamp to `max(projectStart, dataDate)` snapped
    into their own calendar's working time, then apply logic + constraints.
  - A new `data-date-shift` info diagnostic is emitted when the data date
    pushed a not-started activity's ES later than project start.
- **Duration-type field** (`fixed-dur-units`, `fixed-dur-units-per-time`,
  `fixed-units`, `fixed-units-per-time`) is on `EngineActivity` and
  carried through unchanged. **No type-specific recalculation behavior is
  implemented yet** — see deferred list. The shape exists so resource
  assignments (Phase 2+) can flip the locked variable per P6 rules without
  another type churn.

### Acceptance tests now active (in addition to 1.1/1.2)

- **PRG-8** — Three activities with identical base data but different
  `percentCompleteType` values produce three mutually distinct
  `reportedPercentComplete` values (Duration ≈ 55.5%, Physical = 25,
  Units = 80). Confirms types are structurally distinguished, not labels.

Active total: 8 of 20 (CPM-1, CPM-2, CPM-3, CAL-4, CON-6, CON-7, PRG-8,
PRG-9). The remaining 12 stay `.todo()`.

### Known limitations of engine2 after Phase 1.3

- **Physical % and Units %** are stored/reported but do NOT influence
  dates. The forward pass still projects in-progress work from
  `remainingDuration` regardless of which percent-complete type is
  authored. P6 also does not re-derive remaining duration from Physical%
  by default, so this matches default P6 behavior; Units%-driven
  remaining derivation depends on resource assignments which are out of
  scope until Phase 2.
- **Duration-type recalculation rules** (e.g. Fixed Duration & Units
  recomputing units-per-time when duration changes) are NOT implemented.
  The field is carried through but no recalculation logic acts on it.
  Deferred until resource assignments land.
- **At-completion duration** is the simple `actual + remaining` sum. No
  separate at-completion estimate vs. baseline-driven forecast.
- **Actual duration for in-progress** is computed as working minutes
  between `actualStart` and `dataDate` in the activity's calendar. This
  is the engine's projection, not an authored field. If the user
  authored an explicit actual duration that disagrees with
  (`dataDate − actualStart`), engine2 will currently use the projected
  value; an explicit `actualDuration` override field is deferred.
- **PRG-10** (out-of-sequence progress rule selector — retained logic /
  progress override / actual dates) still `.todo()`.
- **ALAP successor re-flow** still deferred.
- **Adapter and dual-engine harness** still deferred. Engine2 remains
  test-only; production UI runs entirely on the legacy engine.

### Phase 1.4 entry criteria (superseded — see §14)

---

## 14. Phase 1.4 status (landed)

Phase 1.4 makes engine2 *explainable*. The engine still does not own the
UI or the production schedule, but each result now carries enough trace,
ranking, baseline, and audit data to power an explainability surface.

### What Phase 1.4 implements

- **Driving trace** on `EngineActivityResult`:
  - `drivingPredecessors` / `drivingSuccessors`: arrays of `DrivingLink`
    (relationship id, other activity id, type, lag minutes, lag calendar
    basis, link slack) for every link with slack <= tolerance.
  - `governingCategory`: high-level grouping of `governingCause`
    (`logic | constraint | progress | calendar | leveling | external`).
  - `isOpenStart`, `isOpenFinish`, `hasNegativeFloat` flags.
- **Multiple float-path analysis** (`EngineResult.floatPaths`):
  - Opt-in via `floatPathCount > 0`; basis `total-float` (default) or
    `free-float`; endpoint = caller-supplied or latest-EF not-completed
    activity.
  - Walks backward via lowest-slack unused predecessor and consumes
    relationships across ranks. Each path carries rank, basis,
    governing `pathFloatMinutes`, and ordered steps with the
    relationship walked from the previous step.
- **Baseline comparison foundation**:
  - Independent `baselines: BaselineActivity[]` input (XER imports do
    NOT fabricate baselines).
  - Per-activity `baselineVariance` (working-minute + calendar-day,
    start + finish, positive = late). Missing baseline emits
    `baseline_missing` info diagnostic (only when baselines supplied).
- **Engine run record** (`EngineResult.runRecord`):
  - `startedAt`, `durationMs`, `engineVersion` (`ENGINE2_VERSION` =
    `0.4.0-phase1.4`), `dataDate`, activity/relationship counts,
    `diagnosticCounts` (info/warn/error), optional
    `changedActivityCount` (when `priorResult` supplied), and
    `optionsSnapshot` of calc inputs.
  - Legacy `runMeta` retained for back-compat.
- **Structured diagnostics added** (kebab-case codes from earlier
  phases retained to avoid breaking tests):
  - `negative_float` — `totalFloat < 0`.
  - `open_ended_activity` — info for one open side on non-completed
    activities; warn when *both* sides are open on a non-milestone.
  - `baseline_missing` — see above.

### Acceptance tests now active (in addition to 1.1/1.2/1.3)

- **PTH-11** — Diamond network: path 1 = critical chain A→C→D
  (pathFloat = 0); path 2 = B chain (pathFloat = 2 workdays).
- **PTH-12** — Selecting `M1` endpoint routes the path through B;
  default endpoint routes through C to `M2`. Selection actually
  changes the analysis.

Active total: **10 of 20**.

### Known limitations of engine2 after Phase 1.4

- **Float-path algorithm is foundation, not full P6 MFP parity**. It
  walks back via lowest-slack unused predecessor and consumes
  relationships. Correct for diamond / fan-in topologies and the
  PTH-11/12 fixtures, but does not reproduce every nuance of P6's MFP
  enumeration on contested schedules.
- **Free-float basis** is wired but not separately covered by an
  acceptance test.
- **Baseline variance** is vs. `earlyStart`/`earlyFinish` only — no
  late-date variance, no project-level rollup.
- **Changed-activity count** compares only the four CPM dates.
- **Open-ended diagnostics** do not exempt the project's intended start
  activity yet.
- **Diagnostic code naming** is mixed (kebab-case from earlier phases
  + new snake_case codes). A future pass should unify with an alias
  map.
- **PRG-10**, **ALAP successor re-flow**, **adapter**, and
  **dual-engine harness** all still deferred. UI still runs entirely
  on the legacy engine; feature flag still defaults to `"legacy"`.

### Phase 1.5 entry criteria (next pass)

1. `Schedule → CpmInput` adapter and dual-engine assertion harness.
2. ALAP successor re-flow.
3. Out-of-sequence progress rule selector and PRG-10 activation.
4. Optional: free-float-basis float-path acceptance test, and
   project-start exemption for `open_ended_activity` diagnostics.





