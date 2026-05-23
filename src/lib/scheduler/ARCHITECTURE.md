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

Please confirm or amend §1 ("absolute working-time instant model") before Phase 1 begins. Once ratified, the next pass (Phase 1.0) implements the `WorkClock` interface and the dual-engine assertion harness — no user-visible change.
