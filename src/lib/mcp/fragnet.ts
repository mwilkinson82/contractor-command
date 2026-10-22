// Fragnet: insert one delay activity on the saved CPM and run a real forward and backward pass.
// Saved activities use inclusive start and finish dates (the first and last working day). The legacy
// scheduler engine stores an exclusive finish, so this pass stays on the inclusive dates and the
// Monday–Friday calendar already used for CPM holidays (deadlines.ts / living.ts).
import { addCountedDays, addDays, rollForward } from "./deadlines";
import { costLoadTotal, jobWorkingDays, reportCalendarHolidays, type Activity, type LivingData } from "./living";
import { shortDate } from "./styled-views";
import type { CardModel, CardRow } from "./cards/model";

export type LogicType = "FS" | "SS" | "FF" | "SF";
export type LogicLink = { id: string; type?: LogicType; lag?: number };

export type FragActivity = {
  id: string;
  name: string;
  duration: number | null;
  start: string | null;
  finish: string | null;
  predecessors: LogicLink[];
  total_float: number | null;
  critical: boolean | null;
  pct_complete: number | null;
  value: number | null;
  sov_line: string | null;
  cost_code: string | null;
  owner_furnished?: boolean;
  description?: string | null;
};

export class FragnetError extends Error {}

export type FragnetRequest = {
  description: string;
  duration: number;
  successors: string[];
  predecessor?: string | null;
};

export type MovedActivity = {
  id: string;
  name: string;
  added: boolean;
  oldStart: string | null;
  oldFinish: string | null;
  newStart: string;
  newFinish: string;
};

export type FragnetPlan = {
  delayId: string;
  predecessorId: string;
  successorIds: string[];
  holidays: string[];
  oldFinish: string;
  newFinish: string;
  impactWd: number;
  baseline: FragActivity[];
  activities: FragActivity[];
  delay: FragActivity;
  moved: MovedActivity[];
  criticalPath: string[];
  drivenIds: string[];
};

type Hol = Set<string>;
type Span = { start: string; finish: string };
type Node = {
  src: FragActivity;
  id: string;
  name: string;
  duration: number;
  savedStart: string | null;
  preds: LogicLink[];
  start: string;
  finish: string;
  lateStart: string;
  lateFinish: string;
  totalFloat: number;
  critical: boolean;
};

const day = (s: string) => s.slice(0, 10);
const logicType = (t: unknown): LogicType => (t === "SS" || t === "FF" || t === "SF" || t === "FS" ? t : "FS");

/** Monday–Friday, plus any holidays saved on the CPM. None saved means weekdays only. */
export function fragnetHolidays(data: LivingData | Record<string, unknown> | null | undefined): string[] {
  const saved = reportCalendarHolidays((data ?? null) as LivingData | null);
  return (saved ?? []).map(day).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

function isWorking(d: string, hol: Hol): boolean {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6 && !hol.has(d);
}

function prevWorking(d: string, hol: Hol): string {
  let x = addDays(d, -1);
  for (let i = 0; i < 370 && !isWorking(x, hol); i++) x = addDays(x, -1);
  return x;
}

/** Move `lag` working days. Positive skips forward and does not count `date`. Negative walks backward. */
function shift(date: string, lag: number, hol: Hol): string {
  if (lag === 0) return date;
  if (lag > 0) return addCountedDays(date, lag, "working", hol);
  let d = date;
  for (let i = 0; i < -lag; i++) d = prevWorking(d, hol);
  return d;
}

function span(start: string, duration: number, hol: Hol): Span {
  const s = rollForward(start, hol);
  if (duration <= 0) return { start: s, finish: s };
  return { start: s, finish: addCountedDays(s, duration - 1, "working", hol) };
}

function startBack(finish: string, duration: number, hol: Hol): string {
  const f = isWorking(finish, hol) ? finish : rollForward(finish, hol);
  if (duration <= 1) return f;
  let d = f;
  for (let i = 1; i < duration; i++) d = prevWorking(d, hol);
  return d;
}

function fromPred(link: LogicLink, pred: Span, duration: number, hol: Hol): Span {
  const type = link.type ?? "FS";
  const lag = link.lag ?? 0;
  if (type === "SS") return span(shift(pred.start, lag, hol), duration, hol);
  if (type === "FF") {
    const finish = shift(pred.finish, lag, hol);
    const f = isWorking(finish, hol) ? finish : rollForward(finish, hol);
    return { start: startBack(f, duration, hol), finish: f };
  }
  if (type === "SF") {
    const finish = shift(pred.start, lag, hol);
    const f = isWorking(finish, hol) ? finish : rollForward(finish, hol);
    return { start: startBack(f, duration, hol), finish: f };
  }
  return span(shift(pred.finish, 1 + lag, hol), duration, hol);
}

function lateFromSucc(link: LogicLink, succ: Span, duration: number, hol: Hol): Span {
  const type = link.type ?? "FS";
  const lag = link.lag ?? 0;
  if (type === "SS") return span(shift(succ.start, -lag, hol), duration, hol);
  if (type === "FF") {
    const finish = shift(succ.finish, -lag, hol);
    const f = isWorking(finish, hol) ? finish : rollForward(finish, hol);
    return { start: startBack(f, duration, hol), finish: f };
  }
  if (type === "SF") return span(shift(succ.finish, -lag, hol), duration, hol);
  const finish = shift(succ.start, -(1 + lag), hol);
  const f = isWorking(finish, hol) ? finish : rollForward(finish, hol);
  return { start: startBack(f, duration, hol), finish: f };
}

function floatWd(earlyFinish: string, lateFinish: string, holidays: string[]): number {
  if (earlyFinish === lateFinish) return 0;
  if (lateFinish > earlyFinish) return jobWorkingDays(addCountedDays(earlyFinish, 1, "working", new Set(holidays)), lateFinish, holidays);
  return -jobWorkingDays(addCountedDays(lateFinish, 1, "working", new Set(holidays)), earlyFinish, holidays);
}

export function finishImpactWd(oldFinish: string, newFinish: string, holidays: string[]): number {
  return floatWd(oldFinish, newFinish, holidays);
}

function durationOf(a: FragActivity, holidays: string[]): number {
  if (typeof a.duration === "number" && Number.isFinite(a.duration) && a.duration >= 0) return Math.round(a.duration);
  if (a.start && a.finish) return jobWorkingDays(day(a.start), day(a.finish), holidays);
  return 0;
}

function topo(ids: string[], edges: { from: string; to: string }[]): string[] {
  const inbound = new Map(ids.map((id) => [id, 0]));
  const out = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) {
    if (!inbound.has(e.from) || !inbound.has(e.to) || e.from === e.to) continue;
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    out.get(e.from)!.push(e.to);
  }
  const queue = ids.filter((id) => inbound.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const left = (inbound.get(next) ?? 1) - 1;
      inbound.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) throw new FragnetError("The schedule logic loops. Nothing was saved.");
  return order;
}

function readLink(raw: unknown): LogicLink | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  if (!id) return null;
  const lag = typeof o.lag === "number" && Number.isFinite(o.lag) ? Math.round(o.lag) : 0;
  return { id, type: logicType(o.type), lag };
}

/** Normalize one saved CPM row. Extra saved fields are kept. */
export function readFragActivity(raw: unknown): FragActivity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  if (!id) return null;
  const preds = Array.isArray(o.predecessors) ? o.predecessors.map(readLink).filter((p): p is LogicLink => !!p) : [];
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const start = text(o.start);
  const finish = text(o.finish);
  return {
    ...o,
    id,
    name: text(o.name) || text(o.description) || id,
    duration: num(o.duration),
    start: start ? day(start) : null,
    finish: finish ? day(finish) : null,
    predecessors: preds,
    total_float: num(o.total_float),
    critical: typeof o.critical === "boolean" ? o.critical : null,
    pct_complete: num(o.pct_complete),
    value: num(o.value),
    sov_line: text(o.sov_line),
    cost_code: text(o.cost_code),
    owner_furnished: o.owner_furnished === true ? true : o.owner_furnished === false ? false : undefined,
    description: text(o.description),
  } as FragActivity;
}

export function readFragActivities(raw: unknown): FragActivity[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readFragActivity).filter((a): a is FragActivity => !!a);
}

/**
 * Forward then backward pass. Saved start dates are a start-no-earlier-than floor, so a delay
 * can only push work later. Float is working days. Critical means total float of 0 or less.
 */
export function scheduleActivities(activities: FragActivity[], holidays: string[]): FragActivity[] {
  const hol: Hol = new Set(holidays);
  const list = activities.map((a) => ({ ...a, predecessors: a.predecessors.map((p) => ({ ...p })) }));
  const ids = list.map((a) => a.id);
  const known = new Set(ids);
  for (const a of list) {
    for (const p of a.predecessors) {
      if (!known.has(p.id)) throw new FragnetError(`Activity ${a.id} lists ${p.id}, and ${p.id} is not on this schedule. Nothing was saved.`);
    }
  }
  const order = topo(ids, list.flatMap((a) => a.predecessors.map((p) => ({ from: p.id, to: a.id }))));
  const nodes = new Map<string, Node>();
  for (const a of list) {
    nodes.set(a.id, {
      src: a,
      id: a.id,
      name: a.name,
      duration: durationOf(a, holidays),
      savedStart: a.start,
      preds: a.predecessors,
      start: a.start ?? "",
      finish: a.finish ?? "",
      lateStart: "",
      lateFinish: "",
      totalFloat: 0,
      critical: false,
    });
  }

  for (const id of order) {
    const n = nodes.get(id)!;
    let best: Span | null = n.savedStart ? span(n.savedStart, n.duration, hol) : null;
    for (const link of n.preds) {
      const pred = nodes.get(link.id)!;
      if (!pred.finish) throw new FragnetError(`Activity ${link.id} has no finish, so ${id} cannot be scheduled. Nothing was saved.`);
      const cand = fromPred(link, { start: pred.start, finish: pred.finish }, n.duration, hol);
      if (!best || cand.finish > best.finish || (cand.finish === best.finish && cand.start > best.start)) best = cand;
    }
    if (!best) throw new FragnetError(`Activity ${id} has no start date and no predecessor. Nothing was saved.`);
    n.start = best.start;
    n.finish = best.finish;
  }

  const projectFinish = [...nodes.values()].reduce((max, n) => (n.finish > max ? n.finish : max), "");
  const succs = new Map<string, { to: string; type?: LogicType; lag?: number }[]>();
  for (const n of nodes.values()) {
    for (const link of n.preds) {
      const list = succs.get(link.id) ?? [];
      list.push({ to: n.id, type: link.type, lag: link.lag });
      succs.set(link.id, list);
    }
  }
  for (const id of [...order].reverse()) {
    const n = nodes.get(id)!;
    let late = { start: startBack(projectFinish, n.duration, hol), finish: projectFinish };
    for (const link of succs.get(id) ?? []) {
      const succ = nodes.get(link.to)!;
      const cand = lateFromSucc(link, { start: succ.lateStart, finish: succ.lateFinish }, n.duration, hol);
      if (cand.finish < late.finish) late = cand;
    }
    n.lateStart = late.start;
    n.lateFinish = late.finish;
    n.totalFloat = floatWd(n.finish, n.lateFinish, holidays);
    n.critical = n.totalFloat <= 0;
  }

  return order.map((id) => {
    const n = nodes.get(id)!;
    return {
      ...n.src,
      duration: n.duration,
      start: n.start,
      finish: n.finish,
      total_float: n.totalFloat,
      critical: n.critical,
      predecessors: n.preds.map((p) => ({ ...p })),
    };
  });
}

/** Predecessor whose constraint lands on the scheduled start. A start-no-earlier-than pin leaves this empty. */
function drivingOf(scheduled: FragActivity[], holidays: string[]): Map<string, string | null> {
  const hol: Hol = new Set(holidays);
  const byId = new Map(scheduled.map((a) => [a.id, a]));
  const out = new Map<string, string | null>();
  for (const a of scheduled) {
    let match: string | null = null;
    for (const link of a.predecessors) {
      const pred = byId.get(link.id);
      if (!pred?.start || !pred.finish || !a.start) continue;
      const cand = fromPred(link, { start: pred.start, finish: pred.finish }, durationOf(a, holidays), hol);
      if (cand.start === a.start) match = link.id;
    }
    out.set(a.id, match);
  }
  return out;
}

/** Next D-number. D1060 on a job becomes D1070 when the successor is A1070 and that id is free. */
export function nextFragnetId(activities: { id: string }[], successors: string[]): string {
  const parsed = activities
    .map((a) => /^D(\d+)$/i.exec(a.id.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ n: Number(m[1]), width: m[1].length }));
  const width = Math.max(4, ...parsed.map((x) => x.width), 0);
  const taken = new Set(activities.map((a) => a.id.toUpperCase()));
  const step = parsed.length > 0 && parsed.every((x) => x.n % 10 === 0) ? 10 : 1;
  const max = parsed.reduce((m, x) => Math.max(m, x.n), 0);
  const succNums = successors
    .map((id) => /^[A-Za-z]+(\d+)$/.exec(id.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]));
  const preferred = succNums.length ? Math.max(...succNums) : 0;
  let n = max > 0 ? max + step : preferred > 0 ? preferred : 1000;
  const pad = (num: number) => `D${String(num).padStart(width, "0")}`;
  if (preferred > max && !taken.has(pad(preferred).toUpperCase())) n = preferred;
  let id = pad(n);
  while (taken.has(id.toUpperCase())) {
    n += step;
    id = pad(n);
  }
  return id;
}

function canon(activities: FragActivity[], id: string): FragActivity | null {
  const want = id.trim().toUpperCase();
  return activities.find((a) => a.id.toUpperCase() === want) ?? null;
}

function impliedStart(pred: FragActivity, link: LogicLink, duration: number, holidays: string[]): string {
  if (!pred.finish && !pred.start) return "";
  const spanPred = { start: pred.start ?? pred.finish!, finish: pred.finish ?? pred.start! };
  return fromPred(link, spanPred, duration, new Set(holidays)).start;
}

export function insertDelay(activities: FragActivity[], request: FragnetRequest, holidays: string[]): { activities: FragActivity[]; delayId: string; predecessorId: string; successorIds: string[] } {
  const description = request.description.trim();
  if (!description) throw new FragnetError("Say what the delay is. Nothing was saved.");
  if (!Number.isInteger(request.duration) || request.duration < 1) throw new FragnetError("Give the delay in whole working days. Nothing was saved.");
  if (!request.successors.length) throw new FragnetError("Name the activity the delay pushes. Nothing was saved.");

  const successors = request.successors.map((id) => {
    const found = canon(activities, id);
    if (!found) throw new FragnetError(`Activity ${id.trim()} is not on this schedule. Nothing was saved.`);
    return found;
  });
  const successorIds = [...new Set(successors.map((a) => a.id))];

  let predecessorId = "";
  const named = request.predecessor?.trim();
  if (named) {
    const found = canon(activities, named);
    if (!found) throw new FragnetError(`Activity ${named} is not on this schedule. Nothing was saved.`);
    predecessorId = found.id;
  } else {
    const drivers: string[] = [];
    for (const succ of successors) {
      let best: { id: string; start: string } | null = null;
      for (const link of succ.predecessors) {
        const pred = canon(activities, link.id);
        if (!pred) continue;
        const start = impliedStart(pred, link, durationOf(succ, holidays), holidays);
        if (!best || start > best.start) best = { id: pred.id, start };
      }
      if (!best) throw new FragnetError(`Name the activity that drives the delay on ${succ.id}. Nothing was saved.`);
      drivers.push(best.id);
    }
    const unique = [...new Set(drivers)];
    if (unique.length !== 1) throw new FragnetError(`These activities are driven by different predecessors (${unique.join(", ")}). Name the predecessor. Nothing was saved.`);
    predecessorId = unique[0];
  }

  const delayId = nextFragnetId(activities, successorIds);
  const next = activities.map((a) => ({ ...a, predecessors: a.predecessors.map((p) => ({ ...p })) }));
  for (const succId of successorIds) {
    const succ = next.find((a) => a.id === succId)!;
    succ.predecessors = [
      ...succ.predecessors.filter((p) => p.id.toUpperCase() !== predecessorId.toUpperCase()),
      { id: delayId, type: "FS" as const, lag: 0 },
    ];
  }
  const delay: FragActivity = {
    id: delayId,
    name: description.slice(0, 160),
    description: description.slice(0, 500),
    duration: request.duration,
    start: null,
    finish: null,
    predecessors: [{ id: predecessorId, type: "FS", lag: 0 }],
    total_float: null,
    critical: null,
    pct_complete: 0,
    value: 0,
    sov_line: null,
    cost_code: null,
    owner_furnished: false,
  };
  const at = next.findIndex((a) => successorIds.includes(a.id));
  next.splice(at < 0 ? next.length : at, 0, delay);
  return { activities: next, delayId, predecessorId, successorIds };
}

function projectFinish(activities: FragActivity[]): string {
  return activities.reduce((max, a) => ((a.finish ?? "") > max ? a.finish! : max), "");
}

function criticalPath(activities: FragActivity[], driving: Map<string, string | null>): string[] {
  const crit = activities.filter((a) => a.critical);
  const ids = new Set(crit.map((a) => a.id));
  const byStart = [...crit].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.id.localeCompare(b.id));
  const roots = byStart.filter((a) => {
    const d = driving.get(a.id);
    return !d || !ids.has(d);
  });
  const chain: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id) || !ids.has(id)) return;
    seen.add(id);
    chain.push(id);
    const next = activities
      .filter((a) => driving.get(a.id) === id && ids.has(a.id))
      .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.id.localeCompare(b.id));
    for (const n of next) walk(n.id);
  };
  for (const r of roots) walk(r.id);
  for (const a of byStart) if (!seen.has(a.id)) chain.push(a.id);
  return chain;
}

function drivenIds(delayId: string, driving: Map<string, string | null>): string[] {
  const set = new Set<string>([delayId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, pred] of driving) {
      if (pred && set.has(pred) && !set.has(id)) {
        set.add(id);
        changed = true;
      }
    }
  }
  return [...set];
}

export function buildFragnet(activities: FragActivity[], request: FragnetRequest, holidays: string[] = []): FragnetPlan {
  if (!activities.length) throw new FragnetError("No saved schedule on this job yet. Nothing was saved.");
  const baseline = scheduleActivities(activities, holidays);
  const inserted = insertDelay(activities, request, holidays);
  const impacted = scheduleActivities(inserted.activities, holidays);
  const byBase = new Map(baseline.map((a) => [a.id, a]));
  const driving = drivingOf(impacted, holidays);
  const delay = impacted.find((a) => a.id === inserted.delayId);
  if (!delay?.start || !delay.finish) throw new FragnetError("The fragnet could not be scheduled. Nothing was saved.");
  const moved: MovedActivity[] = [];
  for (const a of impacted) {
    const prev = byBase.get(a.id);
    if (!prev) {
      moved.push({ id: a.id, name: a.name, added: true, oldStart: null, oldFinish: null, newStart: a.start!, newFinish: a.finish! });
      continue;
    }
    if (prev.start !== a.start || prev.finish !== a.finish) {
      moved.push({ id: a.id, name: a.name, added: false, oldStart: prev.start, oldFinish: prev.finish, newStart: a.start!, newFinish: a.finish! });
    }
  }
  const oldFinish = projectFinish(baseline);
  const newFinish = projectFinish(impacted);
  return {
    delayId: inserted.delayId,
    predecessorId: inserted.predecessorId,
    successorIds: inserted.successorIds,
    holidays,
    oldFinish,
    newFinish,
    impactWd: finishImpactWd(oldFinish, newFinish, holidays),
    baseline,
    activities: impacted,
    delay,
    moved,
    criticalPath: criticalPath(impacted, driving),
    drivenIds: drivenIds(inserted.delayId, driving),
  };
}

const shown = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? shortDate(day(d)) : "Needed");
const wd = (n: number | null | undefined) => (n == null ? "Needed" : `${n} WD`);

function label(a: FragActivity): string {
  return a.name && a.name.toUpperCase() !== a.id.toUpperCase() ? `${a.id} ${a.name}` : a.id;
}

export function fragnetCard(plan: FragnetPlan, opts: { job: string; saved: boolean; version?: number | null }): CardModel {
  const driven = new Set(plan.drivenIds);
  const movedIds = new Set(plan.moved.map((m) => m.id));
  const byId = new Map(plan.activities.map((a) => [a.id, a]));
  const rows: CardRow[] = [...plan.activities]
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.id.localeCompare(b.id))
    .map((a) => {
      const change = a.id === plan.delayId ? "New" : movedIds.has(a.id) ? "Moved" : "Same";
      return {
        cells: [label(a), wd(a.duration), shown(a.start), shown(a.finish), wd(a.total_float), change],
        flag: driven.has(a.id) ? ("delay" as const) : null,
      };
    });
  const pathRows: CardRow[] = plan.criticalPath.map((id, i) => {
    const a = byId.get(id);
    return { cells: [`${i + 1}. ${a ? label(a) : id}`], flag: driven.has(id) ? ("delay" as const) : null };
  });
  const movedRows: CardRow[] = plan.moved.map((m) => {
    const line = m.added
      ? `${m.id} ${m.name} added, ${shown(m.newStart)} – ${shown(m.newFinish)}`
      : `${m.id} ${m.name}: ${shown(m.oldStart)} – ${shown(m.oldFinish)} moved to ${shown(m.newStart)} – ${shown(m.newFinish)}`;
    return { cells: [line], flag: driven.has(m.id) ? ("delay" as const) : null };
  });
  const succ = plan.successorIds.join(", ");
  const impact = plan.impactWd === 0 ? "0 working days. Float absorbed it." : `${plan.impactWd > 0 ? "+" : ""}${plan.impactWd} working days`;
  const alert = `${plan.delayId} ${plan.delay.name}. Completion impact ${impact}`;
  return {
    state: "result",
    title: opts.saved ? "Fragnet saved" : "Fragnet preview",
    show_state: false,
    job: opts.job,
    kpis: [
      { label: "Old finish", value: shown(plan.oldFinish) },
      { label: "New finish", value: shown(plan.newFinish), flag: plan.impactWd !== 0 ? "delay" : null },
      { label: "Completion impact", value: impact, flag: plan.impactWd !== 0 ? "delay" : null },
    ],
    sections: [
      {
        heading: "Logic",
        kind: "list",
        rows: [{ cells: [`${plan.delayId} is ${plan.delay.duration ?? 0} working days, finish to start from ${plan.predecessorId}, then finish to start into ${succ}.`], flag: "delay" }],
      },
      { heading: "Schedule", kind: "table", columns: ["Activity", "Dur", "Start", "Finish", "Float", "Change"], rows },
      { heading: "Critical path", kind: "list", rows: pathRows },
      { heading: "What moved", kind: "list", rows: movedRows.length ? movedRows : [{ cells: ["No activity dates moved."] }] },
    ],
    alerts: [{ level: "delay", text: alert }],
    ask: opts.saved ? null : { prompt: "Save this fragnet?" },
    next_move: opts.saved
      ? `Saved on the schedule${opts.version ? ` as version ${opts.version}` : ""}.`
      : "Say yes to save this fragnet. Nothing is saved yet.",
  };
}

/** Dollars the fragnet save must still tie. A new delay is $0.00, so the saved contract total stands. */
export function fragnetForecast(activities: FragActivity[]): number {
  return costLoadTotal(activities as Activity[]);
}

/** Host routing. Tool descriptions stay one sentence; this line tells the host which tool to call. */
export const FRAGNET_SERVER_RULE =
  " When someone asks to add a fragnet, insert a delay, run a time impact analysis, or preview a TIA, call fragnet_preview. Do not calculate the forward pass, the backward pass, float, or the critical path yourself. Pass the job number, the delay in the member's words, the duration in working days, and the affected activity ids. Pass the predecessor activity when they name one. Show the fragnet card as written. Nothing is saved on a preview. Ask whether to save it. Only after the member says yes, call fragnet_save with the same inputs and confirm true. Do not write the schedule or a delay event in the same reply as the request.";
