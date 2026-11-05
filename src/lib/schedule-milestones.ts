// Project milestones a P6 scheduler expects on every CPM: a start milestone at
// mobilization (or project start) and a Substantial Completion finish milestone
// at the end of the network. Pure logic: the import adds them before its
// calculation, and schedule_workflow proposes them for a saved schedule.
import type { Activity, Logic } from "./mcp/living";

const MAX_LINKS = 20; // scheduleLogic: at most 20 predecessors per activity.
const START_IDS = ["MS-000", "MS-0000", "MS-START"];
const FINISH_IDS = ["MS-999", "MS-9999", "MS-FINISH"];
const MOBILIZE = /mobili[sz]/i;
const DEMOBILIZE = /de-?mobili[sz]/i;
const START_NAME =
  /mobili[sz]|notice to proceed|\bNTP\b|project start|start of (construction|work)/i;
const SUBSTANTIAL = /substantial(ly)?\s*complet/i;
const COMPLETE = /complet/i;

const isMilestone = (a: Activity) =>
  a.duration === 0 ||
  a.activity_type === "milestone-start" ||
  a.activity_type === "milestone-finish";
const day = (s: string) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const minDay = (days: (string | null | undefined)[]) =>
  days.filter((d): d is string => !!d).sort()[0] ?? null;
const maxDay = (days: (string | null | undefined)[]) =>
  days
    .filter((d): d is string => !!d)
    .sort()
    .reverse()[0] ?? null;
const label = (a: Activity) => `${a.id} ${a.name}`;
const list = (items: string[]) =>
  items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function freeId(candidates: string[], taken: Set<string>): string {
  for (const id of candidates) if (!taken.has(id)) return id;
  for (let n = 2; ; n++) {
    const id = `${candidates[0]}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** Successor lists, keyed by predecessor id. */
function successorsOf(activities: Activity[]): Map<string, string[]> {
  const out = new Map<string, string[]>(activities.map((a) => [a.id, []]));
  for (const a of activities) for (const p of a.predecessors) out.get(p.id)?.push(a.id);
  return out;
}

/** Whether the schedule already has its start and its finish milestone. */
export function projectMilestonesPresent(activities: Activity[]): {
  start: boolean;
  finish: boolean;
} {
  const succ = successorsOf(activities);
  const openStarts = activities.filter((a) => !a.predecessors.length);
  const openEnds = activities.filter((a) => !succ.get(a.id)?.length);
  const start =
    activities.some(
      (a) =>
        a.activity_type === "milestone-start" ||
        (isMilestone(a) && START_NAME.test(a.name) && !DEMOBILIZE.test(a.name)),
    ) ||
    (openStarts.length > 0 && openStarts.every(isMilestone));
  const finish =
    activities.some(
      (a) =>
        isMilestone(a) &&
        (SUBSTANTIAL.test(a.name) || (COMPLETE.test(a.name) && !succ.get(a.id)?.length)),
    ) ||
    (openEnds.length > 0 && openEnds.every(isMilestone));
  return { start, finish };
}

export type MilestoneResult = {
  activities: Activity[];
  /** One plain sentence per milestone added, or per milestone that could not be added. */
  added: string[];
  /** IDs of the milestones added, in the order they appear. */
  ids: string[];
};

/**
 * Adds the project start and Substantial Completion milestones when the schedule
 * has none. The start milestone ("Mobilization") is tied SS 0 to the activity that
 * names mobilization and takes that activity's start logic, so it sits at the
 * start of mobilization; with no such activity it is "Project Start", FS 0 to
 * every activity with no predecessors. Substantial Completion is tied FF 0 to
 * every activity with no successors, so it finishes when the last work does.
 * Progress carries: a started tie completes the start milestone at that actual
 * start, and finished last work completes Substantial Completion at its latest
 * actual finish. Existing logic is only added to, never removed.
 */
export function withProjectMilestones(
  input: Activity[],
  opts: { maxActivities?: number } = {},
): MilestoneResult {
  const max = opts.maxActivities ?? 400;
  const activities: Activity[] = input.map((a) => ({
    ...a,
    predecessors: a.predecessors.map((p) => ({ ...p })),
  }));
  const added: string[] = [];
  const ids: string[] = [];
  if (!activities.length) return { activities, added, ids };
  const present = projectMilestonesPresent(activities);
  const taken = new Set(activities.map((a) => a.id));
  const room = () => activities.length < max;
  let startMilestone: Activity | null = null;
  let finishMilestone: Activity | null = null;

  if (!present.start) {
    const mobilize = activities
      .filter((a) => !isMilestone(a) && MOBILIZE.test(a.name) && !DEMOBILIZE.test(a.name))
      .sort(
        (a, b) =>
          (a.actual_start ?? a.start ?? "9999").localeCompare(
            b.actual_start ?? b.start ?? "9999",
          ) || activities.indexOf(a) - activities.indexOf(b),
      )[0];
    const firsts = activities.filter((a) => !a.predecessors.length);
    const firstTasks = firsts.filter((a) => !isMilestone(a));
    const ties = mobilize ? [mobilize] : firstTasks.length ? firstTasks : firsts;
    if (!room())
      added.push(
        `No start milestone was added: the schedule is at Athena's ${max}-activity limit.`,
      );
    else if (mobilize && mobilize.predecessors.length >= MAX_LINKS)
      added.push(
        `No start milestone was added: ${label(mobilize)} already has ${MAX_LINKS} predecessors.`,
      );
    else if (ties.length) {
      const id = freeId(START_IDS, taken);
      taken.add(id);
      const startLogic: Logic[] = mobilize
        ? mobilize.predecessors
            .filter((p) => (p.type ?? "FS") === "FS" || p.type === "SS")
            .map((p) => ({ ...p }))
        : [];
      const actual = minDay(ties.map((a) => a.actual_start));
      const date = minDay(ties.map((a) => a.actual_start ?? a.start));
      const link: Logic = { id, type: mobilize ? "SS" : "FS", lag: 0 };
      for (const t of ties) t.predecessors.push({ ...link });
      startMilestone = {
        id,
        name: mobilize ? "Mobilization" : "Project Start",
        duration: 0,
        start: date,
        finish: date,
        predecessors: startLogic,
        total_float: null,
        critical: null,
        pct_complete: actual ? 100 : 0,
        value: null,
        sov_line: null,
        cost_code: null,
        wbs_id: ties[0].wbs_id ?? null,
        ...(ties[0].calendar_id ? { calendar_id: ties[0].calendar_id } : {}),
        activity_type: "milestone-start",
        ...(actual ? { actual_start: actual, actual_finish: actual, remaining_duration: 0 } : {}),
      };
      added.push(
        mobilize
          ? `Added start milestone ${id} Mobilization, tied SS 0 to ${label(mobilize)}${startLogic.length ? ` and driven by its predecessor${startLogic.length === 1 ? "" : "s"} ${list(startLogic.map((p) => p.id))}` : ""}${actual ? `; complete at its actual start, ${day(actual)}` : ""}.`
          : `Added start milestone ${id} Project Start, tied FS 0 to ${list(ties.map(label))}${actual ? `; complete at the first actual start, ${day(actual)}` : ""}.`,
      );
    }
  }

  if (!present.finish) {
    const succ = successorsOf(activities);
    const ends = activities.filter((a) => !succ.get(a.id)?.length);
    const ranked = [...ends].sort(
      (a, b) =>
        (b.actual_finish ?? b.finish ?? "").localeCompare(a.actual_finish ?? a.finish ?? "") ||
        activities.indexOf(a) - activities.indexOf(b),
    );
    const ties = ranked
      .slice(0, MAX_LINKS)
      .sort((a, b) => activities.indexOf(a) - activities.indexOf(b));
    if (activities.length + (startMilestone ? 1 : 0) >= max)
      added.push(
        `No Substantial Completion milestone was added: the schedule is at Athena's ${max}-activity limit.`,
      );
    else if (ties.length) {
      const id = freeId(FINISH_IDS, taken);
      taken.add(id);
      const done = ties.every((a) => !!a.actual_finish);
      const actual = done ? maxDay(ties.map((a) => a.actual_finish)) : null;
      const date = maxDay(ties.map((a) => a.actual_finish ?? a.finish));
      const last = [...ties].sort((a, b) =>
        (b.actual_finish ?? b.finish ?? "").localeCompare(a.actual_finish ?? a.finish ?? ""),
      )[0];
      finishMilestone = {
        id,
        name: "Substantial Completion",
        duration: 0,
        start: date,
        finish: date,
        predecessors: ties.map((a) => ({ id: a.id, type: "FF" as const, lag: 0 })),
        total_float: null,
        critical: null,
        pct_complete: actual ? 100 : 0,
        value: null,
        sov_line: null,
        cost_code: null,
        wbs_id: last.wbs_id ?? null,
        ...(last.calendar_id ? { calendar_id: last.calendar_id } : {}),
        activity_type: "milestone-finish",
        ...(actual ? { actual_start: actual, actual_finish: actual, remaining_duration: 0 } : {}),
      };
      added.push(
        `Added finish milestone ${id} Substantial Completion, tied FF 0 to ${list(ties.map(label))}${actual ? `; complete at the last actual finish, ${day(actual)}` : ""}.`,
      );
      if (ends.length > ties.length)
        added.push(
          `${ends.length - ties.length} more activities have no successor; Substantial Completion takes the ${MAX_LINKS} that finish latest. Tie the rest into the network.`,
        );
    }
  }

  if (startMilestone) {
    activities.unshift(startMilestone);
    ids.push(startMilestone.id);
  }
  if (finishMilestone) {
    activities.push(finishMilestone);
    ids.push(finishMilestone.id);
  }
  return { activities, added, ids };
}

/**
 * Re-dates the named milestones from the activities they tie to: a start
 * milestone at its earliest successor's start, a finish milestone at its
 * latest predecessor's finish. Used on the as-planned copy so a baseline's
 * milestones follow its own activity dates.
 */
export function alignMilestoneDates(activities: Activity[], ids: string[]): Activity[] {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const wanted = new Set(ids);
  return activities.map((a) => {
    if (!wanted.has(a.id)) return a;
    const date =
      a.activity_type === "milestone-start"
        ? minDay(
            activities.filter((s) => s.predecessors.some((p) => p.id === a.id)).map((s) => s.start),
          )
        : maxDay(a.predecessors.map((p) => byId.get(p.id)?.finish));
    return date ? { ...a, start: date, finish: date } : a;
  });
}

/**
 * For a saved schedule: the add_activities and predecessor updates a
 * schedule_request recalculate needs to add the missing milestones, or null
 * when the schedule already has both.
 */
export function projectMilestoneRequest(activities: Activity[]): {
  add_activities: Activity[];
  updates: { id: string; predecessors: Logic[] }[];
  notes: string[];
} | null {
  const result = withProjectMilestones(activities);
  if (!result.ids.length) return null;
  const before = new Map(activities.map((a) => [a.id, a]));
  const added = new Set(result.ids);
  return {
    add_activities: result.activities.filter((a) => added.has(a.id)),
    updates: result.activities
      .filter((a) => !added.has(a.id))
      .filter(
        (a) => JSON.stringify(a.predecessors) !== JSON.stringify(before.get(a.id)!.predecessors),
      )
      .map((a) => ({ id: a.id, predecessors: a.predecessors })),
    notes: result.added,
  };
}
