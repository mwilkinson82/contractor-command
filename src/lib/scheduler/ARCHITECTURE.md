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

---

## 15. Phase 1.5 status — resource / assignment foundation

Phase 1.5 introduces the data-model shape required for future P6/XER
resource fidelity without pretending leveling, resource calendars, or
rate-book pricing are implemented.

### What landed

- **First-class engine types** (`engine2/types.ts`):
  - `Resource` (`labor | nonlabor | material`), `Role`, with optional
    `HierarchicalPath` (root → self) and optional `defaultRoleId`.
  - `ResourceAssignment` with budgeted/actual/remaining units,
    optional `unitsPerTime`, optional cost triplet, and placeholder
    fields for `rateSource`, `rateType`, `curveId`, and
    `manualFuturePeriod` (none of which the engine consumes yet).
  - `ExpenseAssignment` (lightweight cost-only assignment with
    `accrualType` placeholder).
  - `ActivityAssignmentSummary` rollup attached to each
    `EngineActivityResult.assignmentSummary` when assignments exist.
- **Pure assignment-math helpers** (`engine2/assignments.ts`):
  - `assignmentAtCompletionUnits`, `assignmentRemainingUnits`,
    `assignmentUnitsPercentComplete`, `assignmentAtCompletionCost`.
  - `rollupActivityAssignments` (returns `undefined` when none).
  - `validateAssignments` returns diagnostic-shaped records.
- **CpmInput extensions**: optional `resources`, `roles`,
  `assignments`, `expenseAssignments`. All default to empty arrays;
  legacy callers are unaffected.
- **Units Percent Complete foundation**:
  - If `percentCompleteType === "units"` AND the activity has
    assignments, `reportedPercentComplete` is derived from the
    rolled-up `actualUnits / atCompletionUnits`.
  - If `percentCompleteType === "units"` AND no assignments exist,
    the engine falls back to the authored `unitsPercentComplete` value
    AND emits `units_percent_without_assignments`. PRG-8 (which uses
    the authored stub) remains green.
  - Physical % and Duration % behavior from Phase 1.3 is unchanged.
- **Resource calendar references**: validated structurally
  (`missing_resource_calendar` when the calendar id is unknown). They
  do NOT yet drive CPM date math — see "limitations" below.

### Diagnostics added

- `units_percent_without_assignments` (info)
- `missing_resource` (warn) — assignment references unknown resource id
- `missing_resource_calendar` (warn) — resource references unknown calendar
- `assignment_units_inconsistent` (warn) — negative units, or
  actual > at-completion
- `resource_calendar_deferred` (info, once per run) — reminder that
  resource calendars are wired but not yet authoritative for CPM
- `assignment_unknown_activity` (warn) — assignment references missing
  activity

### Acceptance / unit tests

- New file: `src/lib/scheduler/__tests__/resource-assignments.spec.ts`
  - assignment-math helpers (single + multi)
  - units% derivation from assignments
  - `units_percent_without_assignments` fallback
  - `missing_resource`, `missing_resource_calendar`,
    `resource_calendar_deferred`, `assignment_units_inconsistent`
  - **guardrail test** asserting that a 24/7 resource calendar does
    NOT compress a Mon-Fri activity's duration (activity calendar
    still governs).
- P6 acceptance promotions: **none**. Active total stays at **10 of
  20**; leveling tests (LVL-13..16) remain `.todo()` and XER tests
  (XER-17..20) remain `.todo()`. PRG-8 unchanged.

### Engine version

- `ENGINE2_VERSION` = `0.5.0-phase1.5`.

### Known limitations after Phase 1.5

- **Resource calendars do not drive CPM dates.** Activity calendar
  remains authoritative. Switching to resource-calendar-driven dates
  is intentionally deferred — it interacts with leveling and the
  duration-type / units-per-time recompute loop and should land
  alongside Phase 1.6/1.7.
- **No duration-type recompute.** `EngineActivity.durationType` is
  preserved but the engine does not yet enforce the P6 duration-type
  invariants (e.g. fixed-units recomputing duration when units/time
  changes).
- **No rate-book pricing.** `rateSource`/`rateType` are stored, never
  consumed. Cost rollups use authored cost fields verbatim.
- **No curve spread.** `curveId` is stored, never consumed. All
  rollups are aggregate.
- **No manual future-period reconciliation.** `manualFuturePeriod`
  marker is preserved structurally.
- **No leveling.** LVL-13..16 still `.todo()`.
- **Adapter and dual-engine harness still deferred.** UI continues to
  run on the legacy engine; feature flag still defaults to `"legacy"`.

### Phase 1.6 entry criteria

1. `Schedule → CpmInput` adapter and dual-engine assertion harness
   (originally Phase 1.5 entry criterion #1).
2. Out-of-sequence progress rule selector (PRG-10).
3. First leveling pass behind a sub-flag, leaving Phase 1.5 resource
   structures untouched.








## 16. Phase 1.6 status — resource leveling foundation

Deterministic, narrow leveling pass on top of CPM. CPM dates on
`EngineResult.activities` are NEVER mutated; leveled dates live
exclusively on `EngineResult.leveling`.

### What landed

- **New module** `engine2/leveling.ts` with `levelResources(input)`.
  Triggered automatically when `CpmInput.leveling.enabled === true`.
- **Types** (`engine2/types.ts`):
  - `LevelingOptions` (enabled, selectedResourceIds,
    preserveScheduledEarlyAndLateDates, maxDelayWorkdays).
  - `ResourceOverallocation` / `ResourceDayDemand` (per-day demand vs.
    capacity).
  - `LevelingEntry` (cpm dates, leveled dates, delay, causing
    resources, priorityReason).
  - `LevelingAnalysis` (options echo, considered ids,
    overallocationsBefore/After, entries, structured warnings).
  - `EngineActivity.levelingPriority` (P6 convention: lower = higher
    priority).
  - `Resource.maxUnitsPerDay` (undefined = unlimited).
- **Algorithm**: whole-day, uniform-spread demand
  (atCompletionUnits / numWorkdays); sort eligible activities by
  `(levelingPriority asc, cpmEarlyStart asc, id asc)`; push each
  forward one workday at a time on its own calendar until no
  considered resource exceeds capacity. Completed / in-progress
  activities are pinned (consume capacity, never moved).
- **Selected vs. all-resource leveling**: `selectedResourceIds`
  filters which resources can trigger moves; non-selected
  overallocations are silently ignored (LVL-15 behavior).
- **Engine version**: `ENGINE2_VERSION = "0.6.0-phase1.6"`.

### Diagnostics / warnings (always emitted on a leveling run)

- `leveling_whole_day_only` (info)
- `leveling_successors_not_reflowed` (info)
- `leveling_preserve_dates_deferred` (warn — only when option set)
- `leveling_no_capacity_defined` (warn — empty considered set)
- `leveling_max_delay_reached` (warn — per offending activity)

### Acceptance tests now active

- **LVL-13** — overallocations detected before, resolved after, lower-
  priority B delayed by A's duration.
- **LVL-15** — selected-resource leveling on R1 leaves R2-driven
  conflicts alone; no moves.
- **LVL-16** — entries carry cpm/leveled dates, delay, causing
  resource, `priority=N` reason; options echoed; warnings present.

Active total: **13 of 20**. LVL-14 remains `.todo()` (preserve
scheduled early/late dates is deferred, not silently faked).

### Known limitations after Phase 1.6 (intentional)

- **Successors are not re-driven** after a move. Callers needing
  post-leveling logic must re-run CPM with leveled dates as
  constraints. Warned in every run.
- **Preserve-scheduled-early-and-late-dates** option is echoed but
  does not block moves. Warned when set.
- **Whole-day granularity only.** No shift/hour-level leveling.
- **Uniform per-day spread.** No curve-aware spread, no
  units-per-time enforcement, no manual future-period reconciliation.
- **Activity calendar still governs demand windows.** Resource
  calendars validated structurally only (Phase 1.5 stance unchanged).
- **No cost recalculation** post-leveling. LVL-16's "post-level cost
  recalculation when enabled" clause is partially satisfied: the log
  exists and explains moves; cost rollups remain the Phase 1.5
  authored values.
- **No project-level priority placeholder** beyond
  `levelingPriority`. Multi-project leveling is deferred.
- **UI untouched.** Feature flag still defaults to `"legacy"`; the
  legacy engine and the existing Gantt are unchanged.

### Phase 1.7 entry criteria

1. `Schedule → CpmInput` adapter + dual-engine parity harness.
2. Successor re-flow after leveling (re-run CPM with leveled starts
   as SNET constraints, or integrated iteration).
3. LVL-14: implement preserve-scheduled-early-and-late-dates.
4. PRG-10: out-of-sequence progress rule selector.

---

## 17. Phase 1.7 — XER hardening (engine2)

Status: **complete**. Engine version marker: `ENGINE2_XER_IMPORT_VERSION = "0.7.0-phase1.7"`.

This pass adds a higher-fidelity XER importer for engine2 alongside the
legacy `src/lib/scheduler/xer.ts` (which still powers the production UI
`XerImportButton` and the legacy engine). The legacy importer is
**untouched**; the new importer lives at `src/lib/scheduler/engine2/xer-import.ts`
and is opt-in.

### Public surface

- `importXerForEngine2(text, options?) → XerEngine2ImportResult`
- `parseXerTables(text) → Map<TableName, Row[]>` (generic block parser
  exposed for future reconciliation / export work)
- `XerCalendarRaw`, `XerRawPreservation`, `XerEngine2ImportResult`,
  `XerEngine2ImportOptions` types

### What is now preserved / mapped

- **Project header** — `proj_short_name` / `proj_name`,
  `plan_start_date`, and `last_recalc_date` → `dataDate` (Instant).
- **Calendars** — `CALENDAR.clndr_id/name/type/day_hr_cnt`. Work-day
  flags and explicit holiday dates are extracted from `clndr_data` where
  the canonical P6 pattern matches; everything else is preserved on
  `XerCalendarRaw.raw`.
- **Activities (TASK)** — calendar reference, `task_type`,
  `duration_type`, `complete_pct_type`, original/remaining duration in
  working minutes, `act_start_date`, `act_end_date`,
  `phys_complete_pct`, and up to two constraints (`cstr_type[2]` /
  `cstr_date[2]`).
- **Constraints** — `CS_MSO/MSOA/MSOB → snet/snlt`, `CS_MEOA/MEOB → fnet/fnlt`,
  `CS_MANDSTART/MANDFIN → mso/mfo`, `CS_ALAP → alap`. Anything else is
  reported via `unsupported_constraint_type` and counted in
  `stats.constraintsUnsupported`.
- **Activity / duration / percent-complete types** — mapped into engine2
  enums; unrecognized values fall back to safe defaults and emit
  `unsupported_activity_type_behavior` /
  `unsupported_duration_type_behavior` /
  `unsupported_percent_complete_type_behavior` diagnostics.
- **Resources (RSRC), roles (ROLES), assignments (TASKRSRC)** —
  imported as first-class `Resource` / `Role` / `ResourceAssignment`
  records, including budgeted/actual/remaining units and cost where
  parseable.
- **External relationships** — `TASKPRED` rows whose
  `pred_task_id` / `task_id` reference activities outside this XER are
  preserved on `raw.taskpred` and reported via
  `external_relationship_preserved_raw` rather than silently dropped.
- **Raw preservation** — every interpreted table's rows are echoed onto
  `result.raw.*`, and the names of any other tables encountered are
  collected on `raw.otherTableNames` for downstream reconciliation /
  export work.

### Diagnostics introduced

`unsupported_calendar_shift`, `unsupported_calendar_hours_per_day`,
`unsupported_constraint_type`, `unsupported_activity_type_behavior`,
`unsupported_duration_type_behavior`,
`unsupported_percent_complete_type_behavior`,
`missing_calendar_reference`, `missing_resource_reference`,
`external_relationship_preserved_raw`, `baseline_not_in_xer`.

`baseline_not_in_xer` is always emitted — engine2 never fabricates a
baseline from XER content.

### Tests now active

Focused parser/importer coverage in
`src/lib/scheduler/__tests__/xer-import.spec.ts` (10 tests): project
header + calendar identity, supported-constraint mapping, unsupported-
constraint diagnostics, actuals mapping, activity/duration/percent-complete
type mapping, resources/roles/assignments, external-relationship
preservation, baseline diagnostic, raw-row preservation, and generic
`parseXerTables` access.

### P6 acceptance status (unchanged headline counts)

XER-17, XER-18, XER-19, XER-20 remain `.todo()`. Phase 1.7 does NOT
claim multi-project relationship execution, ignore-external-relationships
scheduling behavior, or any Update / Replace / Add-Into import-action
semantics. The foundation (raw preservation + diagnostics) is now in
place so those tests can be honestly promoted in a later pass.

Active acceptance total: **13 of 20** (unchanged from Phase 1.6).
Overall scheduler test count: **48 passing, 7 todo** across 4 files.

### Known limitations after Phase 1.7 (intentional)

- **Calendar shifts / hours-per-day variation** parsed but not executed
  by `WorkClock`. Whole-day work-day flags + holidays only.
- **Constraint mapping is conservative.** `CS_MSO` ("Start On") is
  routed to `snet` rather than a separate "start-on" type; the raw
  `cstr_type` is preserved on the underlying TASK row.
- **Duration-type behavior is not differentiated yet.** The enum is
  stored, but engine2 still treats every activity as fixed-duration.
- **Percent-complete-type does not yet drive resource-unit derivation
  for `units`.** Phase 1.5's structural stub still applies.
- **No XER export, no Update/Replace/Add-Into import strategies.**
- **No automatic leveling from XER import.** Resources/assignments are
  stored; leveling is opt-in via `CpmInput.leveling.enabled`.
- **UI untouched.** `XerImportButton` still calls the legacy
  `importXer`. Feature flag still defaults to `"legacy"`.

### Phase 1.8 entry criteria

1. `XerEngine2ImportResult → CpmInput` adapter + dual-engine parity
   harness on real XER fixtures.
2. Promote XER-19 (no fabricated baselines) to an active acceptance test.
3. XER-17: multi-project relationship execution when both projects are
   present in the import.
4. XER-18: ignore-external-relationships scheduling option.

---

## 18. Phase 1.8 — XER reconciliation harness

Status: **complete**. No engine-version bump (calculation logic
unchanged from Phase 1.6). New harness lives entirely in
`src/lib/scheduler/engine2/xer-pipeline.ts` +
`src/lib/scheduler/engine2/reconciliation.ts`, plus fixtures and
pipeline tests under `__tests__/fixtures/xer-fixtures.ts` and
`__tests__/xer-pipeline.spec.ts`. The legacy engine, the production
`XerImportButton`, and the `VITE_SCHEDULER_ENGINE` flag are
untouched.

### Public surface added

- `xerToCpmInput(importResult, options?) → { cpmInput, synthesizedCalendarIds, diagnostics }`
  - Builds a `WorkClock` per imported calendar (whole-day, work-day
    bitmask + holidays + hours-per-day), synthesizes Mon-Fri 8h
    fallbacks for any referenced-but-undefined calendar id (emitting
    a `calendar_synthesized` diagnostic), derives `projectStart`
    from `dataDate` / earliest actual / earliest constraint / a
    deterministic fallback, and forwards `resources` / `roles` /
    `assignments` when present.
- `reconcileSchedule(input) → ReconciliationReport`
  - Classifies every finding into one of four buckets: `match`,
    `acceptable-known-limitation`, `mismatch`,
    `unsupported-preserved-only`.
  - Maps Phase 1.7 diagnostic codes to buckets via a curated default
    set; callers may extend `acceptableLimitationCodes`.
  - Compares optional `expectedActivities` (earlyStart, earlyFinish,
    isCritical, totalFloatMinutes) against engine2 output with a
    configurable `toleranceMinutes`.
  - Always emits a `baseline:not-provided` entry as
    acceptable-known-limitation unless a baseline was supplied —
    enforcing the "engine2 never fabricates baselines from XER" rule.

### Fixtures (`__tests__/fixtures/xer-fixtures.ts`)

10 minimal hand-written XER blocks covering simple FS chain, parallel
paths, mixed calendars, supported constraint (`CS_MSOA → snet`),
actuals/progress, resources/roles/assignments, external (cross-
project) relationship, baseline absence, unsupported constraint type,
and non-standard hours-per-day calendar.

### Acceptance tests now active

- **XER-19** — XER import does not fabricate baselines from absent
  baseline data. Importer always emits `baseline_not_in_xer`; pipeline
  output has no `baselines`; engine result's
  `runRecord.optionsSnapshot.baselinesProvided` is `false` and no
  activity has a synthesized `baselineVariance`.

Active acceptance total: **14 of 20**. XER-17, XER-18, XER-20 remain
`.todo()` — multi-project relationship execution, ignore-external-
relationships scheduling option, and Update / Replace / Add-Into
import-action behaviors are still out of scope.

### Test counts

`bunx vitest run src/lib/scheduler`: **67 passing, 6 todo** across
5 files (added: `xer-pipeline.spec.ts` with 18 tests covering all 10
fixtures, reconciliation classification, XER-19 path, and explicit
diagnostic-code coverage).

### Known limitations after Phase 1.8 (intentional)

- **No execution of preserved external relationships.** They are
  reported via `unsupported-preserved-only` reconciliation entries
  and remain on `importResult.raw.taskpred`; engine2 does not wire
  them into the graph until XER-17 / XER-18 are honestly implemented.
- **Calendar synthesis is conservative.** Referenced-but-undefined
  calendar ids fall back to Mon-Fri 8h. Diagnosed, not silent.
- **No real .xer file fixtures yet.** All fixtures are inline
  representative blocks. Real fixture ingestion is deferred to avoid
  bloating the repo before the dual-engine parity harness lands.
- **Reconciliation does not yet drive the UI.** The harness is a
  pure-function module consumed by tests only; surfacing it in the
  UI is out of scope for Phase 1.8.

### Phase 1.9 entry criteria

1. Dual-engine parity harness (legacy ↔ engine2) on shared fixtures.
2. Promote XER-17 / XER-18 when external relationship execution +
   ignore-external option are implemented.
3. Start surfacing `ReconciliationReport` in a developer-only diagnostic
   view (still behind the legacy flag).

---

## §19 — Phase 1.9: interproject & external relationship semantics

Status: **shipped** at `ENGINE2_XER_IMPORT_VERSION = "0.9.0-phase1.9"`.
Legacy engine untouched. Feature flag remains defaulted to legacy. UI
unchanged.

### Scope delivered

1. **Multi-project XER parsing.** `XerEngine2ImportResult.projects: XerProject[]`
   now lists every PROJECT row. Each TASK row's `proj_id` is preserved
   and surfaced via `activityProjectIds`.
2. **Interproject relationships (both projects present).** Wired into
   engine2's graph normally AND captured in
   `interprojectRelationships: InterprojectRelationshipRecord[]` with
   `predProjectId / succProjectId / predActivityId / succActivityId /
   predTaskXerId / succTaskXerId / type / lagMinutes / raw`. Diagnostic
   `interproject_relationship_mapped` emitted per link.
3. **External relationships (referenced project/activity absent).**
   Preserved with full identity in
   `externalRelationships: ExternalRelationshipRecord[]`. Diagnostics:
   `external_relationship_preserved_raw` (back-compat),
   `external_relationship_preserved` (with project identity),
   `external_project_missing` (per missing project, warn).
4. **`ignoreExternalRelationships` pipeline option.**
   - `true`  → per-external `external_relationship_ignored_by_option`
     (info); calculation proceeds; reconciliation classifies as
     `acceptable-known-limitation`.
   - `false` (default) → per-external
     `external_relationship_requires_imported_project` (error);
     calculation still proceeds (engine graph never contained the
     link); reconciliation classifies as `mismatch`.
   - Pipeline result exposes `externalRelationshipsIgnored` and
     `externalRelationshipsPreservedCount`.
5. **Reconciliation update.** New codes classified:
   acceptable: `external_relationship_preserved`,
   `external_relationship_ignored_by_option`,
   `interproject_relationship_mapped`. Unsupported-preserved-only:
   `external_project_missing`, `interproject_relationship_unresolved`.
   Mismatch: `external_relationship_requires_imported_project`.
   `ReconciliationInput.externalRelationshipsIgnored` drives the
   `relationships:external` summary entry.
6. **Acceptance tests promoted.** XER-17 and XER-18 now active. XER-20
   remains `todo` (update / replace / add-into import workflows are out
   of scope for this pass).

### Honest limitations (still deferred)

- External relationships are **never executed** by engine2 — even with
  `ignoreExternalRelationships: true`, the option only declares the
  gap acceptable; it does not derive external activity dates.
- No support yet for external activity date injection from a
  companion project file.
- Interproject calendar reconciliation is not performed; each activity
  still uses the calendar named on its own TASK row.
- Update / Replace / Add-Into import strategies remain unimplemented.
- XER export still out of scope.

### Phase 1.10 entry criteria

1. External activity date injection (so `ignoreExternalRelationships`
   has a way to consume real predecessor finish dates).
2. XER-20: Update / Replace / Add-Into import workflows with
   delete-unreferenced toggles.
3. Begin surfacing multi-project structure + reconciliation report in
   a developer-only diagnostic view (still behind the legacy flag).

---

## §20 — Phase 2.0: XER import action semantics

Status: **shipped** at
`ENGINE2_XER_IMPORT_ACTIONS_VERSION = "0.10.0-phase2.0"`. Legacy engine
untouched. Feature flag remains defaulted to legacy. UI unchanged.

### Scope delivered

1. **Action model.** New module `engine2/xer-import-actions.ts` exposes
   four explicit `XerImportAction` values: `create-new-project`,
   `update-existing-project`, `replace-existing-project`,
   `add-into-existing-project`.
2. **Identity model.**
   - Activities matched by `EngineActivity.id` (XER `task_code`,
     de-duplicated by importer) scoped via
     `XerEngine2ImportResult.activityProjectIds[projectId]`.
   - Relationships matched by `${from}|${to}|${type}` tuple.
   - Assignments matched by `ResourceAssignment.id` (XER `taskrsrc_id`).
3. **Update Existing.** Matches by identity, updates changed fields,
   preserves untouched records unless delete-unreferenced is enabled
   per category. Emits per-record `update / create / preserve / delete`
   entries.
4. **Replace Existing.** Removes the entire prior scope for the target
   project (activities, relationships, assignments, interproject and
   external records) and rebuilds from the incoming XER. No orphan
   `activityProjectIds` mappings remain.
5. **Add Into Existing.** Merges new activities/relationships/assignments
   into the existing project. Detects collisions and emits diagnostics:
   `activity_id_collision`, `assignment_id_collision`,
   `relationship_endpoint_missing`. Existing record wins; incoming is
   preserved-only.
6. **Delete-unreferenced options.** Supported per category for
   `activities`, `relationships`, `assignments`. Unsupported categories
   (`calendars`, `resources`, `roles`) are honored as a request but
   surface `delete_unreferenced_category_unsupported` (warn) rather
   than being silently ignored. Activity deletion cascades to drop
   orphan relationships and assignments whose endpoints are gone.
7. **Plan / dry-run.** `planImportAction` returns an `ImportPlan` with
   per-record entries, `summary { create/update/delete/preserve/
   warnings/errors }`, `criticalErrors`, `unsupportedPreservedOnly`,
   and a `transactional: boolean` flag.
8. **Transactional safety.** `applyImportAction` clones the existing
   state, performs the merge in memory, and either returns the new
   state or — if `plan.criticalErrors.length > 0` — returns the
   original `existing` reference untouched plus an
   `import_action_aborted` (error) diagnostic. The dry-run plan never
   mutates input.
9. **Critical-error codes.** `import_collision_project_id` (create
   into existing id), `import_target_project_missing` (update/replace/
   add-into without a matching existing project),
   `import_target_project_missing_in_incoming` (incoming XER lacks the
   chosen project).
10. **Acceptance tests.** XER-20 promoted to active. New unit suite
    `xer-import-actions.spec.ts` (11 tests) exercises every action,
    delete-unreferenced for all three supported categories, the
    unsupported-category diagnostic path, collision diagnostics, and
    plan/apply transactional safety.

### Honest limitations (still deferred)

- Delete-unreferenced for calendars/resources/roles is **not**
  implemented; the option is preserved and a warn diagnostic is
  emitted so callers know it was honored as a request only.
- Add-into across mismatched source/target project ids merges from the
  first incoming project; multi-project add-into is not addressed.
- No UI wiring yet. Action selection, dry-run preview, and confirm/abort
  controls are intentionally out of scope for this pass — the engine
  must be able to say "we understand how an XER import should modify
  an existing project graph" before users see toggles.
- Persistence transactionality: `applyImportAction` is in-memory only,
  so `plan.transactional` is always true. When this is wired to durable
  storage, that layer must either honor the same in-memory snapshot
  pattern or set `transactional: false` and emit a
  `partial_commit_risk` diagnostic.
- XER export still out of scope.

### Phase 2.1 entry criteria (carried forward)

1. External activity date injection (still pending from Phase 1.10
   carry-over).
2. Wire `planImportAction` + `applyImportAction` into a developer-only
   diagnostic view (still behind the legacy flag) so reviewers can see
   the dry-run plan before any future UI exposure.
3. Begin XER export scaffolding now that the engine can faithfully
   round-trip identity through the action layer.

## §21 — Phase 2.1: calendar exception subsystem (landed)

Version `0.11.0-phase2.1`. Engine2 calendars now honor explicit
working / non-working exceptions and per-day shift windows in addition
to the existing whole-day workdays + holidays. CAL-5 is promoted from
`.todo()` to an active acceptance test.

### What landed

- New factory `createExceptionWorkClock(opts)` in
  `engine2/work-clock-exceptions.ts`. Conforms to the same `WorkClock`
  interface as `createWholeDayWorkClock`, so no downstream engine code
  needed to change.
- Per-day "day shape" resolver: each UTC day-start resolves to a list of
  `WorkWindow` `[startMinuteOfDay, endMinuteOfDay)`. Base pattern is a
  single `[0, hoursPerDay*60)` window driven by the `workDays` bitmask.
  Holidays and explicit `non-working` exceptions resolve to `[]`. An
  explicit `working` exception with `windows` overrides the base pattern
  for that day only and supports split shifts (morning + afternoon with
  a lunch gap).
- `isWorking`, `nextWorkInstant`, `prevWorkInstant`, `addWork` (forward
  and backward) and `diffWork` all iterate via the resolver, so
  neighboring days are never touched by an exception.
- Overlapping or out-of-range exception windows are clamped and merged;
  a `calendar_exception_conflict` info diagnostic is emitted.
- Each applied exception emits a `calendar_exception_applied` info
  diagnostic (collected via an optional `diagnostics` sink on the
  factory).
- XER importer additionally emits `calendar_shift_preserved_only` when
  a calendar row carries shift definitions that the default whole-day
  WorkClock cannot execute, making the preservation explicit in the
  reconciliation report.
- Reconciliation accepts the new codes
  (`calendar_exception_applied`, `calendar_exception_conflict`,
  `calendar_shift_preserved_only`) and the alias
  `calendar_reference_missing` (kept alongside the existing
  `missing_calendar_reference` for back-compat).

### Diagnostic codes (Phase 2.1)

Constants live in `CALENDAR_DIAGNOSTIC_CODES`:

- `calendar_exception_applied` — info; one per honored exception.
- `calendar_exception_conflict` — info; emitted when windows overlap
  or fall outside `[0, 1440)`. Result is normalized, never dropped
  silently.
- `calendar_reference_missing` — alias for the existing
  `missing_calendar_reference`. Same semantics; either code is
  classified as `unsupported-preserved-only`.
- `calendar_shift_preserved_only` — info; XER row carried shift
  definitions; preserved on the raw row, not executed by the default
  whole-day WorkClock.
- `unsupported_calendar_shift` — info; pre-existing; XER shifts.
- `unsupported_calendar_hours_per_day` — info; pre-existing.

### CAL-5 status (active)

`CAL-5: holiday and shift exceptions alter working-time addition
without corrupting neighboring work shifts.` is now an executable
test. It uses `createExceptionWorkClock` directly (the XER pipeline
still maps to the whole-day clock — see limitations below) and
asserts:

- Adding 5 workdays from Mon-06 across a Tue holiday + a Sat split
  shift lands at end-of-second-shift on Saturday, not on the
  clean-calendar Friday.
- Adding 4h + 1 min from Sat 08:00 jumps the lunch gap to 13:01, never
  to 12:01.
- Backward addition across the holiday is the inverse of forward.
- `diffWork` on the Saturday returns 480 min (two 4h shifts, lunch hour
  excluded).
- Neighboring days (Mon, Thu, Fri) remain on the standard 8h window.

### Known limitations (Phase 2.1)

- **XER pipeline still uses `createWholeDayWorkClock`** (via
  `xer-pipeline.ts`). Shift exceptions parsed out of `clndr_data` are
  not yet routed through `createExceptionWorkClock`; they are preserved
  raw and flagged with `calendar_shift_preserved_only`. Promoting that
  routing is a follow-up pass — the XER `clndr_data` parser needs to
  emit structured exceptions before the pipeline can consume them.
- **No inheritance chains.** P6 supports a Global → Project → Resource
  inheritance stack. `createExceptionWorkClock` accepts a flat list of
  exceptions only. Composition is deferred.
- **No per-week patterns.** Only per-day overrides are supported.
- **No timezone shifting.** All math is UTC. Display-level local-time
  conversion is a UI concern.
- **Resource-vs-activity calendar precedence** is unchanged from Phase
  1.5: activity calendar still governs CPM math; resource calendar
  influence on dates remains deferred.

### Acceptance tally after Phase 2.1

Active: 9 of 20 (CPM-1, CPM-2, CPM-3, CAL-4, CAL-5, CON-6, CON-7,
PRG-8, PRG-9). The remaining 11 stay `.todo()`.

### Phase 2.2 entry criteria

1. Route XER `clndr_data` exceptions into `createExceptionWorkClock` so
   imported P6 calendars actually execute their shifts.
2. Add calendar inheritance composition (Global → Project → Resource).
3. Begin XER export scaffolding (still gated by Phase 2.1's
   round-trip-identity requirement).



---

## 22. Phase 2.2 — Out-of-sequence progress handling

Engine version: `0.11.0-phase2.2`.

### Scope

Implements deterministic out-of-sequence (OOS) progress detection and a
progress-rule selector that controls how the forward pass handles
actuals that violate relationship logic.

### Detection

For every relationship whose successor has reached the relevant
actual milestone (start for FS/SS, finish for FF/SF) but whose
predecessor has not, the engine emits:

- `out_of_sequence_progress_detected` (warn) — one per violating link
- `relationship_logic_violated_by_actuals` (warn) — link-specific
- `predecessor_incomplete_successor_started` (warn) — if successor is
  in-progress
- `predecessor_incomplete_successor_completed` (warn) — if successor is
  already complete

Diagnostics are emitted regardless of the selected rule so violations
are never hidden.

### Progress rule selector

`CpmInput.progress.outOfSequenceRule`:

- `"retained-logic"` (default) — successor's remaining work must
  respect predecessor logic; emits `retained_logic_applied`.
- `"progress-override"` — broken link is ignored for remaining work;
  successor projects from data date; emits `progress_override_applied`.
- `"actual-dates"` — **DEFERRED**. Emits `out_of_sequence_rule_deferred`
  (warn) and falls back to retained-logic.

Actuals (`actualStart`, `actualFinish`) are always preserved verbatim;
the rule only governs how the remaining-work projection is anchored.

### PRG-10 status (active)

`PRG-10: out-of-sequence updates shall follow the selected progress
rule and generate repeatable schedule outcomes.` is now executable.
The test asserts:

- Retained-logic holds B's remaining work until A's projected EF.
- Progress-override projects B's remaining work from the data date.
- Both rules emit the violation diagnostics + their rule diagnostic.
- "actual-dates" emits the deferral warning and falls back.
- Identical inputs produce identical outputs (repeatability).

### Known limitations (Phase 2.2)

- **"actual-dates" rule is not implemented.** Falls back to
  retained-logic with a warn diagnostic.
- **OOS for completed successors** emits the diagnostic but does not
  recompute anything — actuals are pinned regardless of rule, by design.
- **Per-link rule override** is not exposed. The rule is project-wide.
- **Retained-logic propagation** uses `requiredSuccStart` on each
  violating predecessor; complex multi-link interactions resolve via
  the standard forward-pass `max` aggregation.
- **No P6 "Progress Override + Out-of-Sequence Logic" hybrid.** The
  selector is binary (plus deferred third).

### Acceptance tally after Phase 2.2

Active: 10 of 20 (CPM-1, CPM-2, CPM-3, CAL-4, CAL-5, CON-6, CON-7,
PRG-8, PRG-9, PRG-10). The remaining 10 stay `.todo()`.

### Phase 2.3 candidates

1. ALAP successor re-flow.
2. Per-activity calendar precedence (resource vs activity).
3. Route XER `clndr_data` into `createExceptionWorkClock`.
4. Begin XER export scaffolding.

---

## 23. Phase 2.3 — Preserve scheduled early/late dates (leveling)

Engine version: `0.12.0-phase2.3`.

### Scope

Promotes the Phase 1.6 deferred `preserveScheduledEarlyAndLateDates`
option from a parsed-but-ignored flag to an **enforced** rule on the
leveling pass. When enabled, leveling will not delay an activity past
its CPM `lateStart`; conflicts that cannot be resolved within the
preserved window are left unresolved and reported.

CPM dates on `EngineResult.activities` are never mutated by leveling.
Leveled dates remain isolated to `EngineResult.leveling.entries`.

### Behavior

For each eligible (movable) activity under the leveling sort order:

1. Try to place the activity at its CPM `earlyStart`.
2. While placement does not fit, push by one workday under the activity
   calendar.
3. **Phase 2.3** — if the next push would cross `cpmLateStart` and
   `preserveScheduledEarlyAndLateDates` is true, stop. The activity is
   left at the last accepted start (which may still be its CPM
   `earlyStart` if no delay fit at all). Its demand is still committed
   to the ledger so the residual overallocation is honestly reported.

### Leveling entry fields (Phase 2.3 additions)

`LevelingEntry` now carries the late-date window and an explicit rule
outcome:

- `cpmLateStart`, `cpmLateFinish` — CPM late window snapshot
- `attemptedLeveledStart`, `attemptedLeveledFinish` — the placement
  before the preserve-dates cap clipped it (equal to leveled* on
  success)
- `preserveDatesOutcome`:
  - `"satisfied"` — preserve rule enabled; move fit within window
  - `"limited"`   — preserve rule enabled; leveler stopped at late-start
                    before fully resolving the conflict
  - `"blocked"`   — preserve rule enabled; no move possible (zero float
                    or already at late-start); activity left at CPM
                    early-start with unresolved overallocation
  - `"n/a"`       — preserve rule disabled

`priorityReason` is extended to describe the preserve outcome in plain
text.

### Diagnostics

Phase 2.3 adds the following codes to `LevelingAnalysis.warnings`:

- `leveling_preserve_dates_applied` (info) — emitted once per run when
  the option is enabled.
- `leveling_preserve_dates_blocked_move` (warn) — per activity that
  could not move at all under the preserve window.
- `leveling_move_limited_by_late_date` (warn) — per activity capped at
  late-start before its conflict was resolved.
- `leveling_overallocation_unresolved` (warn) — per residual overallocated
  resource-day after preserve-dates leveling, plus a per-activity variant
  when applicable.
- `leveling_activity_outside_preserved_window` (warn) — emitted when an
  activity has negative float (`lateStart < earlyStart`) and preserve
  is enabled.
- `leveling_preserve_dates_window_missing` (info) — emitted when an
  activity has zero float (`lateStart === earlyStart`) and preserve is
  enabled.

The Phase 1.6 `leveling_preserve_dates_deferred` warning is **removed**.

### LVL-14 status (active)

`LVL-14: preserve-scheduled-early-and-late-dates mode shall materially
constrain how far leveling may move activities.` is now executable. The
test asserts that under identical inputs:

- Without preserve, the lower-priority activity is delayed the full
  required amount and all overallocations are resolved.
- With preserve, the same activity is delayed at most by its CPM float;
  residual overallocations remain and are reported.
- The required diagnostics (`leveling_preserve_dates_applied`,
  `leveling_move_limited_by_late_date`,
  `leveling_overallocation_unresolved`) are emitted.
- The deferred warning is gone.
- Re-running with identical inputs produces identical leveled dates.

### Known limitations (Phase 2.3)

- **No float-borrowing across links.** The window is the activity's own
  CPM `[earlyStart, lateStart]`; the leveler does not negotiate with
  successors to recover additional float.
- **No re-leveling after a blocked activity.** When a higher-priority
  activity is blocked, lower-priority activities do not retry against
  the now-known residual.
- **Whole-day granularity** is unchanged from Phase 1.6.
- **No successor re-flow.** Leveling still does not re-drive CPM dates
  for successors of moved activities (`leveling_successors_not_reflowed`
  still emitted).
- **No XER round-trip** of the preserve-dates option yet — it is an
  engine input only.

### Acceptance tally after Phase 2.3

Active: 11 of 20 (CPM-1, CPM-2, CPM-3, CAL-4, CAL-5, CON-6, CON-7,
PRG-8, PRG-9, PRG-10, LVL-13, LVL-14, LVL-15, LVL-16 minus the four
remaining `.todo()` items). All 95 tests in the scheduler suite are
green; no `.todo()` entries remain in `p6-acceptance.spec.ts` for the
Phase 1–2.3 scope.

### Phase 2.4 candidates

1. Re-leveling pass after preserve-dates blocks (priority recovery).
2. Successor re-flow after leveling moves.
3. ALAP propagation through successors.
4. Route XER `clndr_data` exceptions into `createExceptionWorkClock`.

---

## 24. Phase 2.4 — Internal engine2 integration & side-by-side comparison

### Goal

First **safe** integration pass. Make engine2 runnable inside the production
scheduler module behind an internal flag, and prove on real data that it
can run beside the legacy engine without destabilizing the product.

This pass is NOT a switch-over:

- Legacy `calculateSchedule` is the authoritative output everywhere.
- Engine2 is opt-in via an explicit env flag.
- Default user-facing behavior is unchanged.

### Internal entry point

`src/lib/scheduler/compare.ts` exports
`calculateScheduleWithEngine2Comparison(schedule, options)`:

- When the comparison flag is **off** (default), behaves exactly like
  `calculateSchedule` and returns `{ result }`.
- When the flag is **on**, runs both engines and returns
  `{ result, engine2Comparison }`. Legacy `result` is the same value
  `calculateSchedule` would have returned.
- If engine2 throws for any reason, the legacy result is still returned
  and the error is attached as `engine2Error`. Comparison must never
  destabilize the legacy path.

This module is intentionally NOT re-exported from
`src/lib/scheduler/index.ts`. Callers that want comparison must import
`@/lib/scheduler/compare` explicitly.

### Feature flag

`isEngine2ComparisonEnabled()` (in `engine2/feature-flag.ts`) resolves:

1. `import.meta.env.VITE_SCHEDULER_ENGINE2_COMPARE`
2. `process.env.SCHEDULER_ENGINE2_COMPARE`
3. Default: **off**.

The existing `getSchedulerEngine()` flag (legacy / engine2) is unchanged
and still defaults to legacy.

### Legacy → engine2 bridge

`engine2/legacy-bridge.ts` exports `bridgeLegacyScheduleToEngine2(schedule)`.

Conversion rules:

- `projectStartDate` (ISO) → `projectStart` (UTC midnight Instant).
- `dataDate` (ISO, optional) → `dataDate` Instant. Falls back to project
  start when absent.
- Legacy `workDays` bitmask (bit0=Mon … bit6=Sun) → engine2 bitmask
  (bit0=Sun … bit6=Sat) via `convertWorkDaysMask`.
- Durations: legacy working days × 8h × 60 minutes. Whole-day calendar.
- Lags: legacy working days × 8h × 60 minutes,
  `lagCalendarBasis = "project"`.
- Constraints: only `startNoEarlierThan` is mapped (→ `snet`).
- Per-activity calendars are preserved by id; the whole-day shape is
  re-used. Exception calendars are NOT synthesized in this bridge.
- Resources, assignments, baselines, actuals are NOT bridged.

The bridge emits `conversionNotes` that flow into the comparison report's
`knownLimitations`.

### Comparison harness

`engine2/comparison.ts` exports `compareEnginesOnSchedule(schedule, opts)`.

It compares per activity:

- early/late start and finish (as ISO date strings)
- total float, free float
- critical flag
- driving link `isDriving`

Plus run-level signals:

- activity / relationship counts on each side
- engine2 diagnostics count
- a `runRecord` with per-engine elapsed time

Differences are bucketed into `ComparisonDifferenceCategory`:

`early_start_date | early_finish_date | late_start_date | late_finish_date |
 total_float | free_float | critical_flag | driving_link |
 missing_in_engine2 | missing_in_legacy | known_limitation |
 engine2_only_diagnostic`

`countsByCategory` rolls those up for at-a-glance triage. When
`treatFloatAsLimitation: true`, float deltas are routed to
`known_limitation` instead of `total_float` / `free_float` because the
legacy engine reports float in **calendar days** while engine2 reports it
in **working minutes** — the basis mismatch is structural, not a bug.

`formatComparisonReport(report)` returns a single-string dev-console
summary suitable for test logs / internal debug panels.

### Demo schedule validation

The harness is exercised against the Commercial Fit-Out sample
(`commercialFitOutSample()`) in
`__tests__/engine2-comparison.spec.ts`. The test asserts:

- both engines produce a result for every activity (no
  `missing_in_engine2` / `missing_in_legacy` for an honestly bridged
  schedule)
- the report carries at least one known limitation
- the pretty-printer includes the engine2 version string
- running the harness twice produces a legacy result byte-for-byte equal
  to a direct `calculateSchedule` call

Date / float / critical-flag deltas are **expected** and surface in the
report. They are categorized so a reviewer can see *why* engine2 differs
on this dataset (calendar-day vs working-minute float, no actuals
modeling, no successor re-flow, etc.) before any production cut-over.

### XER pipeline routing plan

Full XER round-trip into the production scheduler is **not** wired in
this phase. The plan to reach it incrementally:

1. **XER → engine2 import** (already exists, Phase 1.7–2.0): parsed XER
   feeds `xerToEngineInputs` and `applyXerImportAction`.
2. **Exception-aware WorkClock routing** (Phase 2.2 candidate, not done):
   route parsed `clndr_data` shifts/exceptions into
   `createExceptionWorkClock` instead of the whole-day fallback.
3. **engine2 calculation** (Phase 1.1+ done): `calculateCpm` runs against
   the routed input.
4. **Reconciliation** (Phase 1.8–1.9 done): structured diagnostics
   classify preserved / unsupported / divergent semantics.
5. **UI surface** (NOT done): present the reconciliation report in the
   importer drawer and let the user choose to commit engine2 output
   instead of the legacy mapped output.

For Phase 2.4, the only safe internal-only path added is the comparison
harness above; no new XER UI is wired.

### Regression posture

- All 100 scheduler tests green (95 prior + 5 new for the bridge,
  harness, and feature flag).
- Legacy UI behavior unchanged by default.
- `getSchedulerEngine()` still defaults to `"legacy"`.
- `isEngine2ComparisonEnabled()` defaults to `false`.
- Build/typecheck pass.

### Known limitations (Phase 2.4)

- **Bridge is whole-day only.** Exception calendars, multi-shift
  windows, and per-resource calendars are NOT synthesized.
- **No actuals bridged.** Legacy `percentComplete` is preserved as a
  metadata field but does not produce `actualStart` / `actualFinish`,
  so engine2 sees every legacy activity as "not started".
- **Float unit basis differs.** Legacy float is calendar days; engine2
  float is working minutes. The harness explicitly buckets this as a
  limitation under `treatFloatAsLimitation`.
- **Driving-link slack differs.** Legacy slack uses the project-default
  calendar; engine2 uses the successor's calendar. Both are valid;
  results may diverge on activities with non-default calendars.
- **No UI yet.** The comparison report is dev/test-only output.
- **No engine2 production path.** Flipping `getSchedulerEngine()` to
  `"engine2"` still does not change rendered UI; the UI consumes
  `ScheduleResult` from the legacy engine.

### Phase 2.5 candidates

1. Wire the comparison report into an internal-only debug panel so PMs
   can see engine2 deltas on real schedules without reading test logs.
2. Bridge legacy `percentComplete` to engine2 actuals using a
   linear-time-elapsed approximation (clearly tagged as approximate).
3. Route XER `clndr_data` exceptions into `createExceptionWorkClock` and
   reconnect the XER import pipeline to the bridge so a single
   end-to-end test can run XER → engine2 → comparison.
4. Begin matching float units between engines (project-wide decision:
   keep legacy or migrate to working-minute basis).


---

## 25. Phase 2.5 — Actionable comparison + exception-aware bridge plan

Phase 2.5 makes the engine2 comparison harness useful for internal
development without changing what end users see. Three deliverables:

1. A tighter, classified difference surface on `ComparisonReport`.
2. A developer-only emission path gated by the same comparison flag.
3. A documented internal plan (and dev-only opt-in) for routing the
   legacy bridge through the exception-aware WorkClock.

Legacy engine, default UI behavior, and feature-flag defaults are
unchanged.

### Tighter difference classification

`ComparisonDifferenceCategory` now includes:

`calendar_model_difference | lag_basis_difference |
 constraint_behavior_difference | progress_behavior_difference |
 missing_legacy_field | legacy_missing_engine2_field`

in addition to the Phase 2.4 categories. Engine2-only diagnostics are
mapped into these buckets by inspecting their `code` (e.g. anything
starting with `calendar_` lands in `calendar_model_difference`; OOS /
actuals codes land in `progress_behavior_difference`).

Every `ComparisonDifference` now carries a `classification`:

`expected-bridge-limitation | known-engine-limitation | investigate`

with the following defaults:

| Category | Classification |
|---|---|
| `known_limitation`, `calendar_model_difference`, `lag_basis_difference`, `constraint_behavior_difference`, `missing_legacy_field`, `legacy_missing_engine2_field` | expected-bridge-limitation |
| `total_float`, `free_float`, `progress_behavior_difference`, `engine2_only_diagnostic` | known-engine-limitation |
| date deltas, `critical_flag`, `driving_link`, `missing_in_*` | known-engine-limitation when the bridge has a documented reason (e.g. legacy has no actuals modeling), else investigate |

Reports also carry a `verdict`:

- `clean` — zero differences,
- `expected-differences` — differences exist but none are classified as
  `investigate`,
- `investigate` — at least one difference is classified as `investigate`.

The report adds rollup counters: `dateMismatches`, `floatMismatches`,
`criticalFlagMismatches`, `knownLimitationDifferences`,
`engine2OnlyDiagnostics`, and `countsByClassification`. The pretty-printer
includes the verdict and per-classification counts.

### Developer-only emission path

`calculateScheduleWithEngine2Comparison` (in
`src/lib/scheduler/compare.ts`) now accepts:

- `forceComparison?: boolean` — bypass the env flag (tests / debug UI),
- `forceExceptionAwareCalendars?: boolean` — bypass the exception flag,
- `devReportSink?: (text, report) => void` — overrides where the
  formatted report goes. Default sink is `console.info`.

When the comparison flag is **off**, the sink is never called and no
report is attached — the function returns the legacy result only.

When the comparison flag is **on**:

- the legacy result is returned unchanged,
- the structured report is attached on `engine2Comparison`,
- the formatted report is passed to the dev sink,
- if engine2 threw, the legacy result is still returned and
  `engine2Error` carries the message.

This output path is intentionally invisible to normal users: there is no
UI surface in this phase, and the env flag defaults to off in production.

### Commercial Fit-Out baseline

`__tests__/engine2-comparison.spec.ts` pins:

- the report is deterministic across runs (`countsByCategory` and
  `countsByClassification` are stable),
- every difference is classified (no diff with `classification`
  undefined),
- the verdict is one of the three known values,
- the schedule is not mutated by the harness,
- legacy output is byte-for-byte unchanged whether the harness runs or
  not,
- an engine2 error (forced by stripping `projectStartDate`) does not
  alter the legacy result and surfaces as `engine2Error`,
- `forceExceptionAwareCalendars` flips
  `runRecord.useExceptionAwareCalendars` to true without affecting
  legacy output.

### Exception-aware bridge routing plan

`bridgeLegacyScheduleToEngine2(schedule, { useExceptionAwareCalendars })`
is the single internal switch. Default is `false` (whole-day). When
`true`, every bridged calendar is constructed via
`createExceptionWorkClock` instead of `createWholeDayWorkClock`.

Today this is effectively a no-op behavioral change because legacy
schedules carry only weekday-mask + holidays — the exception clock
accepts both. The path exists so that:

- we can validate the exception clock against real schedules with no
  date deltas before any new exception data is bridged,
- a future pass can synthesize XER `clndr_data` shifts/exceptions
  directly into the exception clock from the legacy import side,
- the dev flag (`VITE_SCHEDULER_ENGINE2_EXCEPTION_CLOCK`) lets internal
  testers flip it without code changes.

Decision matrix for which clock to use:

| Source of calendar data | Clock |
|---|---|
| Legacy `Schedule.calendar` (weekday mask + holidays only) | Whole-day (default), exception-aware also valid |
| Named legacy `NamedCalendar[]` (same shape) | Whole-day (default), exception-aware also valid |
| XER `clndr_data` with shift / exception windows | Exception-aware **required** once bridged |
| Mixed: some calendars carry exceptions, others do not | Exception-aware for the whole project (mixed clocks would split float math across engines) |

### Guardrails (Phase 2.5)

The comparison path is verified to:

- never mutate the input `Schedule` (snapshot test),
- never alter legacy output (byte-for-byte test),
- never block the user (engine2 errors are swallowed into the report),
- never leak the dev report into the production UI (no UI surface,
  flag defaulted off, sink is opt-in),
- never make engine2 authoritative (the function returns
  `result: ScheduleResult` from the legacy engine, full stop).

### Regression posture

- 109 scheduler tests green (100 prior + 9 new for verdict /
  classification / dev sink / engine2-error tolerance / exception
  routing).
- Legacy engine untouched.
- `getSchedulerEngine()` defaults to `"legacy"`.
- `isEngine2ComparisonEnabled()` defaults to `false`.
- `isEngine2ExceptionClockEnabled()` defaults to `false`.
- Build / typecheck pass.

### Known limitations (Phase 2.5)

- **No UI surface.** The dev report is still console-only by default.
  An internal debug panel can opt in by passing its own `devReportSink`.
- **Exception data not yet bridged from XER.** The exception-clock
  routing exists, but legacy schedules don't carry shift/exception
  data, so flipping the flag does not yet produce different math on
  real data.
- **Date deltas not auto-classified as `investigate`.** Until
  successor re-flow and actuals modeling land, all date deltas are
  classified as `known-engine-limitation`. This is honest — every
  current delta has a documented structural cause — but means the
  verdict will rarely be `investigate` on the demo schedule. The
  verdict path is still exercised by the unit tests.
- **No engine2 production path.** Flipping `getSchedulerEngine()` to
  `"engine2"` still does not change rendered UI.

### Phase 2.6 candidates

1. Bridge legacy `percentComplete` to engine2 actuals (linear
   approximation) and reclassify the resulting reduced date deltas.
2. Implement successor re-flow after leveling so leveled engine2
   downstream dates can be compared to legacy.
3. Wire XER `clndr_data` shifts/exceptions into the bridge and turn on
   the exception-aware clock by default once parity is observable.
4. Add an internal debug route (gated by admin role) that runs the
   comparison harness against the active project and shows the
   formatted report — still invisible to normal users.

---

## 26. Phase 2.6 — comparison stability across realistic fixtures

Phase 2.5 proved the comparison harness can run safely. Phase 2.6's job is
to make the *reports it produces* boring, classified, and actionable across
more than just the Commercial Fit-Out demo. The goal is to remove every
"mystery" mismatch before engine2 is allowed anywhere near production.

### What landed

- **Fixture set.** `src/lib/scheduler/__tests__/fixtures/comparison-fixtures.ts`
  ships eleven small, intent-tagged schedules — FS chain, parallel paths,
  mixed FS/SS/FF, SNET constraint, in-progress, completed-only,
  out-of-sequence, resource-loaded, leveling candidate, calendar
  exception (holiday), 7-day calendar. The Commercial Fit-Out sample
  remains the twelfth realistic case via the existing suite.
- **Wider category vocabulary.** `ComparisonDifferenceCategory` gained
  `leveling_behavior_difference`, `baseline_behavior_difference`,
  `precision_rounding_difference`, `known_unsupported_behavior`, and
  `missing_engine2_field`. The diagnostic categorizer routes
  `leveling_*` / `overallocation_*` codes, `baseline_*` codes, and
  rounding/precision codes into these buckets.
- **Actionable rows.** Every `ComparisonDifference` now carries
  `likelyCause` and `recommendedAction`. Defaults come from
  `defaultActionableContext(category)`; callers may override.
- **Top-differences slice.** Reports include a 10-row
  `topDifferences` slice sorted investigate → known-engine-limitation →
  expected-bridge-limitation so a developer sees the most important rows
  first.
- **Formatter upgrade.** `formatComparisonReport` now prints the top
  differences with their classification, legacy/engine2 values, likely
  cause, and recommended action.
- **Bridge-error resilience.** `compareEnginesOnSchedule` now catches
  bridge errors (e.g. missing `projectStartDate`) the same way it
  catches engine2 errors — the report carries `engine2Error` and the
  legacy result is still returned. Tests assert this against an
  intentionally broken schedule.
- **Exception-aware routing parity.** Every fixture is exercised under
  both whole-day and exception-aware clocks. The exception path is
  still opt-in (`VITE_SCHEDULER_ENGINE2_EXCEPTION_CLOCK` /
  `useExceptionAwareCalendars`), still produces no date drift on
  legacy-shaped calendars, and now leaves an explicit known-limitation
  note on every report so future drift cannot go silent.

### Verdict policy

Until successor re-flow and actual-date bridging land, every date /
float / critical-flag delta has a documented structural cause, so the
default classification is `known-engine-limitation`, never
`investigate`. Fixture tests therefore assert verdicts collapse to
`clean | expected-differences`. The `investigate` lane is wired and
tested via the ranking test, but is intentionally empty in practice.

### Guardrails (Phase 2.6)

The comparison path is verified to:

- never mutate the input `Schedule` (snapshot test per fixture),
- never alter legacy output (byte-for-byte test per fixture),
- never block the user (bridge AND engine2 errors are swallowed into
  the report),
- never leak the dev report into the production UI (no UI surface,
  flag defaulted off, sink is opt-in),
- never make engine2 authoritative.

### Regression posture

- 144 scheduler tests green (109 prior + 35 new across the fixture
  suite and the bridge-error / top-differences ranking tests).
- Legacy engine untouched.
- `getSchedulerEngine()` defaults to `"legacy"`.
- `isEngine2ComparisonEnabled()` defaults to `false`.
- `isEngine2ExceptionClockEnabled()` defaults to `false`.
- Build / typecheck pass.
- Engine2 version bumped to `0.13.0-phase2.6`.

### Known limitations (Phase 2.6)

- **No `investigate` verdicts yet.** Date deltas are honestly all
  structural until actuals bridging lands; the verdict surface exists
  but is exercised only by the ranking test.
- **Baseline / leveling buckets are diagnostic-driven.** Until engine2
  emits richer baseline/leveling diagnostics, those category counts
  will frequently be zero. They exist so future signal lands in the
  right bucket, not a generic one.
- **Fixtures are deliberately small.** Real customer schedules are
  larger and may surface new categories; when they do, add the
  fixture, classify the delta, and update this section.
- **No engine2 production path.** Flipping `getSchedulerEngine()` to
  `"engine2"` still does not change rendered UI.

### Phase 2.7 candidates

1. Bridge legacy `percentComplete` to engine2 `actualStart` /
   `actualFinish` (linear approximation against the data date) and
   reclassify the resulting reduced date deltas.
2. Add a "leveled-engine2 vs leveled-engine2" comparison axis once
   successor re-flow is wired, so leveling-behavior diffs become
   meaningful.
3. Wire XER `clndr_data` shifts/exceptions into the bridge, then turn
   `useExceptionAwareCalendars` on by default once the fixture suite
   stays `clean | expected-differences`.
4. Add an admin-gated internal debug route that runs the harness
   against the active project and shows the formatted report — still
   invisible to normal users.

## §27 — Phase 2.7: internal debug viewer

Phase 2.7 adds an internal-only Engine2 comparison report viewer. It is
observability, not behavior. The legacy engine remains authoritative,
engine2 is still opt-in, and the production UI is unchanged for normal
users.

### Surface

- `src/lib/scheduler/engine2/debug-viewer.ts`
  - `shouldShowEngine2DebugViewer({comparisonEnabled, devMode, explicitlyDisabled?})`
    — the single source of truth for visibility. Returns `true` ONLY
    when both flags are on (and no explicit override hides it).
  - `resolveDebugViewerVisibility()` — reads
    `isEngine2ComparisonEnabled()` and `import.meta.env.DEV` at runtime
    so the React drawer does not have to wire flags manually.
  - `buildComparisonViewModel(report)` — pure projection of a
    `ComparisonReport` into a render-ready view-model (header stats,
    classification & category summaries, ranked + full difference
    rows with severity, diagnostics, pre-formatted report). Same input
    → same output.
  - `viewModelToJsonBlob(vm)` — JSON export for download/copy.
- `src/components/scheduler/Engine2DebugDrawer.tsx`
  - React drawer using the existing `Sheet` primitive. Returns `null`
    when `resolveDebugViewerVisibility()` is false, so a production
    build with default flags renders nothing — no trigger button, no
    DOM, no overlay. Trigger is a small fixed pill in the bottom-right
    corner; clearly not a normal product control.
  - Copy-to-clipboard, JSON download, and console log export paths.

### Guardrails

- The drawer never imports the scheduler engine directly. It receives a
  `ComparisonReport` prop produced by
  `calculateScheduleWithEngine2Comparison`, so the legacy path remains
  authoritative even if the drawer is mounted.
- The view-model is built from the report only — it never mutates the
  schedule or the report.
- `engine2Error` flows from the report to a dedicated visible field;
  bridge / engine2 failures never block the main scheduler view.
- Default-off in production: `isEngine2ComparisonEnabled()` is `false`
  and `import.meta.env.DEV` is `false`, so the drawer is a no-op.

### Tests

`src/lib/scheduler/__tests__/engine2-debug-viewer.spec.ts` covers:

- Visibility matrix (both off / only comparison / only dev / both on /
  explicit-disable override).
- Deterministic view-model fields (verdict, counts, classification &
  category summaries, top + all difference rows).
- Engine2 errors surface on the view-model and in the formatted report
  without breaking it.
- `calculateScheduleWithEngine2Comparison` returns the same legacy
  output with the comparison off vs. forced on; schedule input is
  never mutated.

### Regression posture

- Tests: 147 scheduler tests green (144 prior + 3 new suites in the
  debug-viewer spec).
- Legacy engine untouched.
- `getSchedulerEngine()` defaults to `"legacy"`.
- `isEngine2ComparisonEnabled()` defaults to `false`.
- `isEngine2ExceptionClockEnabled()` defaults to `false`.
- Drawer is invisible in production builds.

### Known limitations (Phase 2.7)

- The drawer is wired into `SchedulerRoughView` only when a caller
  passes a report prop. The default scheduler view does NOT yet run
  the comparison harness on every render — Phase 2.8 will add an
  opt-in dev hook that runs `calculateScheduleWithEngine2Comparison`
  for the active project and pipes the report into this drawer.
- No P6 parity claim. Engine2 remains observational.

## §28 — Phase 2.8: shadow mode + evidence log

Phase 2.8 adds a flag-gated shadow runner that exercises the engine2
comparison harness across a batch of real-shaped schedules (Commercial
Fit-Out demo, manual fixtures from §26, schedules with constraints /
progress / resources / baselines) and aggregates the results into a
deterministic **evidence log**. Legacy remains authoritative.

### Surface

- `src/lib/scheduler/engine2/shadow.ts`
  - `runShadowComparisons(inputs, opts)` — runs one comparison per
    (schedule × calendarMode). Default mode is `whole-day`. Returns an
    inert `ran: false` result when the shadow flag is off and `force`
    is not set.
  - `runDualCalendarShadow(inputs, opts)` — convenience that runs both
    `whole-day` and `exception-aware` modes side-by-side so we can
    detect whether exception-aware routing introduces only explainable
    differences.
  - `isBoringReport(report)` / `summarizeBoringness(report)` — the
    centralized **boring-report bar**.
  - `exportEvidenceLogToJson(log)` / `exportEvidenceLogToCsv(log)` —
    deterministic exports for dev review.
  - `isEngine2ShadowEnabled()` — env-gated; requires
    `VITE_SCHEDULER_ENGINE2_SHADOW=1` **and** the comparison flag.

### Evidence log entry shape

Each entry captures: `scheduleId`, `scheduleName`, optional `intent`,
ISO `timestamp`, `legacyEngineVersion`, `engine2Version`, `calendarMode`,
`verdict`, `mismatchCount`, `exactDateMatches`, `classificationCounts`,
`topDifferenceCategories`, `useExceptionAwareCalendars`, optional
`engine2Error`, and a `boring` boolean.

### Boring-report definition

A report is "boring" (no developer action needed) when ALL of:

1. No bridge or engine2 error.
2. No `investigate`-classified differences.
3. Verdict is `clean` or `expected-differences`.

This is the single bar engine2 must clear across the shadow batch
before promotion is considered.

### Exception-aware calendar shadow test

`runDualCalendarShadow` is the internal-only path that runs legacy vs
engine2-whole-day AND legacy vs engine2-exception-aware in the same
batch. It does NOT change defaults. Goal: confirm exception-aware
routing produces only differences that map to known calendar buckets.

### Guardrails

- Shadow mode is off by default. Default flags → `runShadowComparisons`
  returns `{ ran: false, log: { entries: [] } }`.
- Shadow runs never mutate the source schedule or the legacy result
  (tested via snapshot equality before/after).
- Engine2 / bridge errors are captured per entry; the run never throws.
- Exports are pure projections of the log.
- The Phase 2.7 debug drawer still renders only when both comparison
  AND dev-mode flags are on, so production users never see the drawer
  or any shadow output.

### Tests

`src/lib/scheduler/__tests__/engine2-shadow.spec.ts` (15 tests) covers:
flag gating, no-op default, legacy invariance, schedule immutability,
dual-clock opt-in, boring detector edge cases, deterministic JSON/CSV
export, and a Commercial Fit-Out shadow run that asserts no engine2
error and a non-`investigate` verdict.

### Status

- Engine2 version bumped to `0.13.0-phase2.8`.
- 168 tests pass (was 153, +15).
- Legacy engine untouched. UI unchanged. All flags default off.
- No P6 parity claim. Engine2 remains observational.

### Known limitations (Phase 2.8)

- The shadow batch is assembled by callers (typically tests or a
  future internal dev page). Production code paths do not call
  `runShadowComparisons` anywhere.
- Evidence-log persistence is in-memory only; export to JSON/CSV is
  the persistence story for now. A later phase can persist runs to
  storage if shadow comparisons start being run continuously.
- Exception-aware shadow comparisons still depend on the bridge's
  current exception-data fidelity (§25); meaningful differences will
  only appear once richer calendar exceptions are bridged.

## §29 — Phase 2.9 · Shadow evidence review & mismatch burn-down

Phase 2.9 turns the Phase 2.8 evidence log into an engineering review
surface. Lives in `src/lib/scheduler/engine2/burndown.ts`.

### Surface

- `summarizeEvidenceLog(log)` — deterministic aggregate (totals, verdict
  counts, engine2 vs bridge errors, whole-day vs exception-aware run
  counts, per-schedule exception-clock deltas, recurring categories).
- `buildMismatchBurnDown(log)` — grouped per-category rows with
  classification, severity (high/medium/low), origin (bridge /
  legacy-limitation / engine2 / known-limitation), likely cause,
  recommended action, `impactsDates`, `affectsRealSchedules`,
  `blocksPromotion`. Ranked by `rankBurnDown`.
- `rankBurnDown(rows)` — deterministic order:
  classification → severity → impactsDates → affectsRealSchedules →
  count desc → category name asc.
- `evaluatePromotionReadiness(log)` — formalized criteria for moving
  engine2 from shadow-only → internal selectable mode (see below).
- `formatEvidenceReview(log)` — text projection for PRs / chat.

### Promotion-readiness criteria (boring-report bar)

Engine2 is NOT promoted unless ALL pass on the latest evidence log:

1. Zero engine2 thrown errors.
2. Zero bridge errors.
3. Every recurring category has a documented classification + origin.
4. No `investigate` verdicts on the demo schedule (`commercial-fit-out`).
5. Burn-down has zero `investigate`-classified categories.
6. Commercial Fit-Out has no errors and no investigate verdict.
7. Exception-aware clock runs have no investigate verdicts.

Failing any criterion is a blocker, surfaced via
`PromotionReadiness.blockers[]`.

### Guardrails

- Pure projection over `EvidenceLog`. Never mutates the log, schedules,
  legacy results, or flags. Verified by tests.
- Never throws — empty / malformed logs return zeroed reports.
- Does NOT touch `isEngine2ShadowEnabled()` / comparison flags.
- No UI surface in this phase — burn-down is consumed by tests and
  (eventually) the existing dev-only debug drawer.

### Tests

`src/lib/scheduler/__tests__/engine2-burndown.spec.ts` covers:
empty-log safety, summary determinism, verdict/error/EA-clock
aggregation, category grouping, stable ranking, blocker detection
(engine2 error, bridge error, CFO investigate, EA-clock investigate),
ready-state on a clean log, and that running burn-down on a real
shadow log does not change legacy `calculateSchedule` output.

### Status

- Engine2 version bumped to `0.13.0-phase2.9`.
- Legacy engine untouched. UI unchanged. All flags default off.
- No P6 parity claim. Engine2 remains observational.

### Known limitations (Phase 2.9)

- The evidence log carries per-category counts but not per-id diffs, so
  `topRecurringIds` is currently empty. Closing this requires extending
  `EvidenceLogEntry` with sampled difference ids, which is deferred to
  a later phase that demonstrably needs it.
- `bridgeErrorCount` is heuristic (regex on the error message). The
  evidence log does not yet carry an explicit error origin field.
- Promotion readiness reads only the in-memory log it's given; there is
  still no persisted shadow-run history.

---

## §30. Phase 3.0 — Internal Engine2 selectable mode

Phase 3.0 introduces an internal-only engine selector that lets dev/internal
callers pick between three modes, protected by the boring-bar from §29 and
always falling back to legacy when anything goes wrong.

### Modes

- **`legacy-only`** — the default. Only `calculateSchedule` runs. This is
  what every normal user gets in production. No engine2 work happens.
- **`comparison`** — legacy is authoritative; engine2 runs alongside via
  `compareEnginesOnSchedule` so a `ComparisonReport` is produced for
  internal observability.
- **`engine2-internal`** — engine2 is the *selected* engine for the
  internal caller. The legacy result is still returned as the public
  `result` payload (schedule shape stability), but provenance records
  `engineUsed === "engine2"` and the comparison report is attached.

### Promotion-readiness gate

`engine2-internal` is gated by `evaluatePromotionReadiness` (§29). If
the boring-bar fails, `resolveEngineMode` downgrades the request to
`comparison` and records the blockers as `fallbackReason`. Tests and
internal tooling may pass `forcePastReadinessGate: true` to bypass the
gate; normal callers cannot.

### Provenance

Every selection emits `EngineSelectionProvenance` carrying:

- `requestedMode` / `effectiveMode`
- `engineUsed` (`legacy` | `engine2`)
- `legacyEngineVersion` / `engine2Version` (= `ENGINE2_VERSION`)
- `fallbackUsed` + `fallbackReason`
- `comparisonVerdict`, `diagnosticsCount`
- `readinessReady`, `readinessBlockers`
- `selectedAt`

`formatProvenance(p)` renders a deterministic text block for PRs and the
debug drawer.

### Safety guarantees

- Legacy `ScheduleResult` is returned in **every** mode — Phase 3.0 does
  not (yet) project engine2 output back into the legacy shape.
- Engine2 throwing flips `fallbackUsed = true` and `engineUsed = "legacy"`
  with the error string on `fallbackReason`.
- The selector module never mutates the schedule, the legacy result, the
  comparison report, or any feature flag.
- Selector UI (`isInternalEngineSelectorUiEnabled`) requires BOTH a
  dev/internal flag AND `import.meta.env.DEV`. Normal users in
  production cannot see or invoke it.

### Flags

- `VITE_SCHEDULER_ENGINE_MODE` / `SCHEDULER_ENGINE_MODE` (`legacy-only` |
  `comparison` | `engine2-internal`). Defaults to `legacy-only`.
- `VITE_SCHEDULER_ENGINE_SELECTOR_UI` / `SCHEDULER_ENGINE_SELECTOR_UI`
  for the debug-drawer extension. Off by default.
- `VITE_SCHEDULER_ENGINE2_COMPARE` (from §24) still works for
  back-compat: when set without an explicit `ENGINE_MODE`, mode resolves
  to `comparison`.

### Tests

`src/lib/scheduler/__tests__/engine2-selector.spec.ts` (18 tests) covers:
default mode, selector-UI visibility matrix, readiness-gate downgrade,
force-past gate, legacy-only / comparison / engine2-internal execution,
engine2 error → legacy fallback, provenance fields, schedule
non-mutation, and that the selector neither flips flags nor logs.

### Status

- Engine2 version bumped to `0.13.0-phase3.0`.
- 202 tests green (184 baseline + 18 selector).
- Legacy engine untouched. Default mode `legacy-only`. No P6 parity claim.
- Engine2 is selectable internally; it is **not** the public default and
  is **not** authoritative for the public `ScheduleResult`.

### Known limitations (Phase 3.0)

- `engine2-internal` mode still returns the legacy `ScheduleResult` as
  the public payload. Projecting an engine2 `EngineResult` back into the
  legacy schedule shape (so internal consumers can see engine2's dates
  on tasks) is deferred to a later phase; doing it earlier risks
  corrupting the schedule state surface that the rest of the app
  depends on.
- The readiness gate operates on whatever `EvidenceLog` the caller
  passes in. Persisted/server-side evidence is still out of scope.
- No UI selector is wired into the debug drawer yet — only the
  visibility helper and the underlying selector API ship in this phase.

## §31. Phase 3.1 — Engine Selector Safety Audit

Phase 3.1 hardens the Phase 3.0 selector with a per-schedule eligibility
check that runs **before** the boring-bar gate. The boring-bar (§29)
judges the *evidence log* across many runs; eligibility judges *this
schedule's shape*, because some Schedule features are known to be
unsupported (or only partially supported) by engine2's current bridge.

### Boring-bar gate (recap)

`engine2-internal` requires ALL seven readiness criteria from §29:

1. Zero engine2 thrown errors across the evidence log.
2. Zero bridge errors across the evidence log.
3. Every recurring difference category has a documented origin.
4. No `investigate` verdicts on the demo schedule (`commercial-fit-out`).
5. Burn-down has no `investigate`-classified categories.
6. Commercial Fit-Out report is clean or `expected-differences` — never
   errored, never `investigate`.
7. Exception-aware clock differences are classified (no `investigate`).

`forcePastReadinessGate: true` bypasses the boring-bar for tests and
internal tooling — it does **not** bypass eligibility.

### Schedule eligibility gate (new)

`evaluateScheduleEligibility(schedule)` (in
`src/lib/scheduler/engine2/schedule-eligibility.ts`) inspects the
Schedule and returns blockers + warnings. Any blocker forces
`engine2-internal` → `comparison`, with the reason recorded in
`provenance.fallbackReason` and the list captured in
`provenance.eligibilityBlockers`.

| Feature | Severity | Why |
|---|---|---|
| zero tasks | blocker | nothing to compute |
| `percentComplete` in (0,100) | blocker | engine2 expects actualStart/Finish; the bridge does not project percent-complete into actuals yet |
| `percentComplete === 100` (without bridged actuals) | blocker | same reason — completed activities need bridged actuals |
| task `calendarId` not equal to default calendar id | blocker | per-activity calendar math is partial-only in engine2 |
| more than one `NamedCalendar` defined | blocker | importers may route through non-default calendars implicitly |
| `workDays !== 31` AND holidays present | warning | irregular weeks are fragile but engine2 can still calculate |
| `resourceName` or `resourceUnitsPerDay` present | warning | engine2 levels and legacy does not; surfaces as expected differences only |

The audit list also records explicit PASSING checks for features the
current Schedule shape cannot express (unsupported constraint types
beyond SNET, unsupported percent-complete types, unsupported duration
types, leveling requirements, external/interproject relationships,
baseline comparison, unsupported XER semantics). These remain
importer-owned: when an XER import detects them upstream, it must
inject equivalent blockers via the bridge in a later phase.

### Provenance contract (expanded)

`EngineSelectionProvenance` now carries every field required by the
audit:

- `requestedMode` / `effectiveMode`
- `engineUsed` (`legacy` | `engine2`)
- `legacyEngineVersion`, `engine2Version` (= `ENGINE2_VERSION`)
- `fallbackUsed` + `fallbackReason`
- `comparisonVerdict`, `diagnosticsCount`
- `readinessReady`, `readinessBlockers` (boring-bar gate)
- `scheduleEligible`, `eligibilityBlockers`, `eligibilityWarnings` (new)
- `gateDecision` — single-string summary, e.g.
  `req=engine2-internal eff=comparison readiness=pass eligibility=fail`
- `warnings` — non-fatal warnings the selector wants to surface
- `legacyAuthoritative` — always `true` in Phase 3.0/3.1
- `selectedAt` — ISO timestamp

`formatProvenance(p)` renders boring-bar blockers, eligibility blockers,
and eligibility warnings as separate sections.

### Failure-behavior guarantees

- If engine2 throws, the selector catches the error, sets
  `fallbackUsed = true`, `engineUsed = "legacy"`, and records the
  message on `provenance.fallbackReason`.
- The public `result` field is the legacy `ScheduleResult` in every mode
  and in every failure path. No partial engine2 output can leak into
  authoritative state.
- The selector never mutates the schedule, the legacy result, the
  comparison report, or any feature flag.

### Tests

- `engine2-selector-safety.spec.ts` (22 tests) — eligibility evaluator,
  per-feature blockers (in-progress, completed, per-activity calendars,
  multiple calendars, empty schedules), resource-loaded warning,
  `forcePastReadinessGate` does NOT bypass eligibility, provenance
  contract, `gateDecision` encoding, and failure-behavior guarantees.
- `engine2-selector.spec.ts` (19 tests) — updated to reflect that the
  Commercial Fit-Out sample (which carries progress + resources) now
  downgrades to `comparison` via the eligibility gate even when the
  boring-bar is force-bypassed.

### Status

- Engine2 version bumped to `0.13.0-phase3.1`.
- 225 tests green (202 baseline + 23 selector-safety).
- Legacy engine untouched. Default mode still `legacy-only`.
- No P6 parity claim.
- No public UI changes.
- The boring-bar is NOT broadened in this phase; instead a narrower
  per-schedule safety check was added on top of it.

### Known limitations (Phase 3.1)

- Eligibility runs only over the in-memory `Schedule` shape. Features
  that arrive via XER import metadata (true unsupported constraints,
  external relationships, baselines, percent-complete types, duration
  types, leveling requirements) are surfaced as explicit
  importer-owned PASSING checks; the importer is responsible for
  injecting equivalent blockers when it detects them.
- The completed-with-actuals check is conservative — once the bridge
  projects percent-complete into actualStart/actualFinish, this check
  must be loosened in step with the bridge change.
- `legacyAuthoritative` is always `true` today because the selector
  never returns engine2 output as the public `result`. The field is
  in the provenance shape so future phases can flip it deliberately.

## 32. Phase 3.1.1 — Repo cleanliness pass (no feature changes)

This pass is a blocker cleanup, not a feature pass. It resolves three
real issues that surfaced from a clean checkout and clarifies the
engine2 selector's production status. No engine2 behavior changes; no
UI changes; no broadening of selection.

### 32.1 Package manager

- npm remains supported. `package-lock.json` was regenerated so that
  `npm install` pulls in `vitest@^4.1.7` and the rest of the dev
  dependencies that had only been recorded in `bun.lock`.
- Verified clean-install commands:
  - `npm install` — succeeds, installs vitest.
  - `npm run test` — 225 tests pass (14 files).
  - `npx tsc --noEmit` — no vitest / scheduler / test-file errors.
    (Pre-existing TanStack-router `search`-param errors on `/login` and
    `/upgrade` Links remain; unrelated to this pass.)
  - `npm run build` — performed by the harness on every change; no
    new build failures introduced.

### 32.2 RLS helper grant restored

- A prior hardening migration (`20260522230640_harden_scheduler_schema.sql`)
  revoked `EXECUTE` on `public.is_schedule_member(uuid, uuid)` from
  `authenticated`. Multiple RLS policies on `schedule_baselines`,
  `schedule_calendars`, `activity_code_types`, `activity_code_values`,
  `task_activity_codes`, `wbs_nodes`, and `schedule_members` call this
  helper from `USING` / `WITH CHECK`. Without `EXECUTE` granted to the
  caller's role, those policies effectively deny all access for
  legitimate signed-in users on a fresh deploy.
- New migration explicitly:
  - `REVOKE ALL ... FROM PUBLIC, anon` on `is_schedule_member`.
  - `GRANT EXECUTE ... TO authenticated, service_role`.
- The function is `SECURITY DEFINER`, `STABLE`, and performs a single
  bounded membership lookup, so granting `EXECUTE` to `authenticated`
  is safe and the policies above evaluate as intended. `anon` cannot
  execute it and the policies therefore still reject unauthenticated
  callers.

### 32.3 `replace_schedule_graph` calendar integrity guard

- The `SECURITY DEFINER` RPC now validates that every task's
  `calendar_id` is either `NULL` or refers to a `schedule_calendars`
  row whose `schedule_id` matches the `_schedule_id` argument.
- A single foreign calendar reference raises
  `Task calendar_id <uuid> does not belong to schedule <uuid>`
  (`SQLSTATE 23503`) before any `DELETE` / `INSERT` runs, so the
  existing schedule graph is preserved by the transaction's automatic
  rollback.
- Verified manually against live data (two real schedules owned by the
  same user): foreign calendar rejected, owning schedule's tasks
  unchanged after the rejected call, `NULL` calendars accepted, and
  same-schedule calendars accepted.

### 32.4 Engine2 selector — production status (honest)

- The engine2 selector (`runScheduleWithSelectedEngine` in
  `engine2/engine-selector.ts`) exists as library + test
  infrastructure only. It is NOT called from any user-facing route.
- The production scheduler UI continues to call legacy
  `calculateSchedule` directly:
  - `src/routes/scheduler.tsx`
  - `src/routes/scheduler.$projectId.tsx`
  - `src/routes/scheduler-field.tsx`
  - `src/routes/scheduler-portfolio.tsx`
- Legacy remains authoritative for every user-visible schedule view.
- engine2 comparison / shadow / debug surfaces remain flag-gated and
  dev-only; none of them mutate authoritative schedule output.
- No P6 parity claim. Engine2 is not wired into the user-visible
  schedule route, and this pass does not change that.

## §33 — Phase 3.2: Importer-Owned Capability Metadata

### Purpose

Capability metadata replaces the previous stubbed PASSING eligibility
checks with real PASS / BLOCK / UNKNOWN verdicts derived from what the
XER importer actually observed. The engine2 selector consults this
metadata before promoting a schedule into engine2, so unsupported
P6 features force a clean fallback to legacy instead of silently
producing a wrong answer.

### How XER import derives metadata

`src/lib/scheduler/engine2/capability-metadata.ts` inspects importer
diagnostics and emits a verdict per tracked feature:

- `external-relationships` — predecessors/successors pointing at
  activities outside the imported project.
- `unsupported-constraints` — P6 constraint types engine2 cannot yet
  honor (e.g. expected finish, mandatory dates beyond SNET/FNLT).
- `resource-loaded-imported` — XER contained resource assignments or
  resource-driven durations.
- `unknown-xer-semantics` — importer encountered fields/rows it could
  parse structurally but not interpret semantically.

The aggregated payload is persisted on the `Schedule` object as the
additive `engine2Capabilities` field (JSON-serializable so it crosses
TanStack server-function boundaries unchanged).

### PASS / BLOCK / UNKNOWN behavior

- **PASS** — feature absent or fully supported. Does not block
  engine2.
- **BLOCK** — feature present and known-unsupported. Selector returns
  legacy; provenance records the blocking feature.
- **UNKNOWN** — importer saw something it could not classify.
  Conservatively treated as BLOCK by the selector.

### Why UNKNOWN blocks engine2 promotion

The boring-bar requires that engine2 only run on schedules it can
provably calculate correctly. UNKNOWN means we have no evidence either
way, which is not the same as evidence of safety. Promoting on UNKNOWN
would mean shipping silent wrong answers the first time a new XER
dialect appears in the wild. Falling back to legacy is the only
defensible default until the unknown is classified into PASS or BLOCK.

### Why in-app schedules default to PASS

Schedules authored inside the app go through our own builder, which
only emits relationships, constraints, and calendar semantics engine2
already supports. There is no importer surface to disagree with, so
the absence of `engine2Capabilities` is treated as PASS across all
tracked features. If we later add an in-app feature engine2 does not
support, the corresponding capability will be flipped to BLOCK at the
source rather than relying on importer diagnostics.

### Scope guarantees

- **Additive only.** No DB schema migration. `engine2Capabilities` is
  attached in memory on the `Schedule` object and serialized as part
  of existing scheduler payloads.
- **Legacy remains authoritative.** Production routes
  (`src/routes/scheduler*`) continue to call `calculateSchedule`
  directly. Engine2 is not wired into the user-visible schedule
  route in this phase.
- **Feature flags unchanged.** Engine2 remains internal/flagged; the
  boring-bar and legacy fallback are unchanged.
- **Tests.** 244 scheduler tests pass, including the new 19-test
  `engine2-capability-metadata.spec.ts` covering derivation and
  negative selector behavior (imported unsupported features force
  legacy fallback).
