// 0.8.9: cost-loaded CPM activity handoff, tie-to-contract guard, owner-furnished exclusion and living reports.
// Pure logic only (no database); the tools live in tools/living-tools.ts. Athena hands the saved values; the host
// draws them and never recomputes, rebuilds or guesses them.
import { money } from "./sov";
import { ALERT_COLOR } from "./alert-color";
import { addCountedDays, addDays, federalHolidays, todayIn } from "./deadlines";
import { asReportNumber, formatReportNumber, isIdentifierKey, isMoneyKey, isPercentKey } from "../report-format";
import { iorHoldSummary, isContingencyHoldTotal, isExposureHoldTotal } from "../ior-hold-summary";

export const LIVING_REPORT_TYPES = ["cpm", "billing_forecast", "ior", "dashboard"] as const;
export type LivingReportType = (typeof LIVING_REPORT_TYPES)[number];
export const LIVING_LABEL: Record<LivingReportType, string> = {
  cpm: "Cost-loaded CPM",
  billing_forecast: "Billing forecast",
  ior: "IOR",
  dashboard: "PM dashboard",
};
/** Reports whose dollars must tie to the contract to the cent before a save. */
export const TIED_TYPES: readonly LivingReportType[] = ["cpm", "billing_forecast"];

export type Logic = { id: string; type?: "FS" | "SS" | "FF" | "SF"; lag?: number };
export type Activity = {
  id: string;
  name: string;
  duration: number | null;
  start: string | null;
  finish: string | null;
  predecessors: Logic[];
  total_float: number | null;
  critical: boolean | null;
  pct_complete: number | null;
  value: number | null;
  sov_line: string | null;
  cost_code: string | null;
  owner_furnished?: boolean;
};
export type BillingMonth = { month: string; amount: number; kind: "actual" | "forecast" | "unverified" };
// 0.8.10: the scheduling term is "fragnet" (delay fragnet), never "fragment". Legacy saved keys are still read.
export type Tia = {
  fragnet?: string;
  prior_completion: string;
  updated_completion: string;
  fragnet_only_completion?: string | null;
  /** job calendar holidays (ISO dates); default US federal */ holidays?: string[] | null;
  /** legacy */ fragment?: string;
  /** legacy */ fragment_only_completion?: string | null;
};
export type LivingData = {
  activities?: Activity[];
  billing?: { billed_to_date?: number | null; unverified_billed_to_date?: number | null; unverified_payments_received?: number | null; earned_from_dailies?: number | null; earned_from_schedule?: number | null; payments_received?: number | null; months?: BillingMonth[] };
  tia?: Tia | null;
  [k: string]: unknown;
};

export const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

// ---------- owner-furnished ----------
/** Owner-furnished work is schedule-only: $0 in contractor billing. An explicit flag wins; the name is the fallback
 * (the 2701 baseline had no flag, so its switchgear delivery was cost-loaded as ALP work). */
export const OWNER_FURNISHED_RE =
  /\b(owner[- ]furnished|furnished by (?:the )?owner|OFCI|OFOI|OFE)\b/i;
export const isOwnerFurnished = (a: Pick<Activity, "name" | "owner_furnished">) =>
  a.owner_furnished === true || (a.owner_furnished !== false && OWNER_FURNISHED_RE.test(a.name));
export const billableValue = (a: Activity) => (isOwnerFurnished(a) ? 0 : (a.value ?? 0));
export const ownerFurnishedWithValue = (acts: Activity[]) =>
  acts.filter((a) => isOwnerFurnished(a) && (a.value ?? 0) !== 0);

// ---------- count check ----------
export type CountCheck = {
  total: number;
  dated: number;
  valued: number;
  expected: number;
  complete: boolean;
  missing: string[];
  line: string;
};
/** "39 of 39 activities dated, $1,400,000.00 allocated." expected = the saved count (prior version) when there is one. */
export function countCheck(acts: Activity[], expected = acts.length): CountCheck {
  const isDated = (a: Activity) => !!a.start && !!a.finish;
  const dated = acts.filter(isDated).length;
  const valued = acts.filter((a) => typeof a.value === "number").length;
  const missing = acts.filter((a) => !isDated(a)).map((a) => a.id);
  const allocated = acts.reduce((s, a) => s + cents(billableValue(a)), 0);
  const complete = dated === expected && acts.length === expected;
  return {
    total: acts.length,
    dated,
    valued,
    expected,
    complete,
    missing,
    line: `${dated} of ${expected} activities dated, ${money(fromCents(allocated))} allocated.`,
  };
}

// ---------- tie to contract ----------
export type Tie = {
  ties: boolean;
  forecast: number;
  contract: number | null;
  off_by: number | null;
  line: string;
};
/** Forecast total must equal the contract to the cent. When it doesn't: "Doesn't tie: off by $X", never an over-contract chart. */
export function tieCheck(forecast: number, contract: number | null): Tie {
  if (contract === null || !Number.isFinite(contract))
    return {
      ties: false,
      forecast,
      contract: null,
      off_by: null,
      line: `Doesn't tie: contract value Needed (forecast ${money(forecast)}).`,
    };
  const d = cents(forecast) - cents(contract);
  if (d === 0)
    return {
      ties: true,
      forecast,
      contract,
      off_by: 0,
      line: `Forecast total ${money(forecast)} = contract ${money(contract)}`,
    };
  return {
    ties: false,
    forecast,
    contract,
    off_by: fromCents(d),
    line: `Doesn't tie: off by ${money(Math.abs(fromCents(d)))} (${d > 0 ? "over" : "under"} the contract; forecast ${money(forecast)}, contract ${money(contract)}).`,
  };
}

export const costLoadTotal = (acts: Activity[]) =>
  fromCents(acts.reduce((s, a) => s + cents(billableValue(a)), 0));
/** Earned to date from % complete on billable work only. */
export const earnedToDate = (acts: Activity[]) =>
  fromCents(
    acts.reduce(
      (s, a) =>
        s +
        Math.round(
          (cents(billableValue(a)) * Math.min(100, Math.max(0, a.pct_complete ?? 0))) / 100,
        ),
      0,
    ),
  );
/** Remaining forecast = contract − max(billed, earned). Earned progress is never added on top of the old spread. */
export const remainingForecast = (contract: number, billed: number, earned: number) =>
  fromCents(cents(contract) - Math.max(cents(billed), cents(earned)));
export const forecastTotal = (b: LivingData["billing"]) =>
  fromCents((b?.months ?? []).reduce((s, m) => s + cents(m.amount), 0));

export type RetainageBand = { rate: number; throughPct: number | null };

/** "10% through 50% completion; 5% thereafter" → two bands. One percent → a flat rate. */
export function retainageBands(term: unknown): RetainageBand[] | null {
  if (typeof term !== "string") return null;
  const text = term.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const step = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:through|until|to)\s*(\d+(?:\.\d+)?)\s*%/i);
  const afterLead = text.match(/(?:thereafter|then|after(?:wards)?)\s*(\d+(?:\.\d+)?)\s*%/i);
  const afterTrail = text.match(/(\d+(?:\.\d+)?)\s*%\s*thereafter/i);
  const after = afterLead ? Number(afterLead[1]) : afterTrail ? Number(afterTrail[1]) : null;
  if (step && after != null && Number.isFinite(after)) {
    const rate = Number(step[1]);
    const through = Number(step[2]);
    if (rate >= 0 && after >= 0 && through > 0 && through <= 100)
      return [
        { rate, throughPct: through },
        { rate: after, throughPct: null },
      ];
  }
  const only = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!only) return null;
  const rate = Number(only[1]);
  return rate >= 0 ? [{ rate, throughPct: null }] : null;
}

const rateText = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

/** Retainage held on each band. The rate applies to the work in that band, then the next rate. */
export function retainageStepDownLines(term: unknown, contract: number): string[] | null {
  const bands = retainageBands(term);
  if (!bands || !Number.isFinite(contract) || contract < 0) return null;
  const total = cents(contract);
  if (bands.length === 1) {
    const held = Math.round((total * bands[0].rate) / 100);
    return [`${rateText(bands[0].rate)}% through completion, held ${money(fromCents(held))}.`];
  }
  const [first, second] = bands;
  const through = first.throughPct ?? 100;
  const band = Math.round((total * through) / 100);
  const rest = total - band;
  const heldFirst = Math.round((band * first.rate) / 100);
  const heldRest = Math.round((rest * second.rate) / 100);
  return [
    `${rateText(first.rate)}% through ${rateText(through)}% complete (${money(fromCents(band))}), held ${money(fromCents(heldFirst))}.`,
    `${rateText(second.rate)}% thereafter (${money(fromCents(rest))}), held ${money(fromCents(heldRest))}.`,
    `Retainage at completion ${money(fromCents(heldFirst + heldRest))}.`,
  ];
}

function holidaySet(activities: Activity[], holidays?: string[] | null): Set<string> {
  if (holidays) return new Set(holidays);
  const years = new Set<number>();
  for (const a of activities) {
    for (const raw of [a.start, a.finish]) {
      if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) years.add(+raw.slice(0, 4));
    }
  }
  return new Set([...years].flatMap(federalHolidays));
}

function workingDays(start: string, finish: string, holidays: Set<string>): string[] {
  const a = start.slice(0, 10);
  const b = finish.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b < a) return [];
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6 && !holidays.has(d)) out.push(d);
  }
  return out;
}

/**
 * Spread cost-loaded activities over their working months so the months sum to the contract.
 * All rows are planned; a total does not establish actual monthly invoices. Returns null when the activities
 * do not tie, or a dated value cannot be placed.
 */
export function draftBillingFromSchedule(
  activities: Activity[],
  contract: number,
  billed: number | null,
  holidays?: string[] | null,
): { billed_to_date: null; months: BillingMonth[] } | null {
  if (
    !activities.length ||
    !Number.isFinite(contract) ||
    contract < 0 ||
    (billed !== null && (!Number.isFinite(billed) || billed < 0))
  )
    return null;
  if (billed !== null && cents(billed) > cents(contract)) return null;
  if (cents(costLoadTotal(activities)) !== cents(contract)) return null;
  const off = holidaySet(activities, holidays);
  const monthCents = new Map<string, number>();
  for (const activity of activities) {
    const value = cents(billableValue(activity));
    if (value === 0) continue;
    const start = activity.start?.slice(0, 10);
    const finish = activity.finish?.slice(0, 10);
    if (!start || !finish) return null;
    const days = workingDays(start, finish, off);
    if (!days.length) return null;
    const base = Math.floor(value / days.length);
    let extra = value - base * days.length;
    for (const day of days) {
      const add = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      const month = day.slice(0, 7);
      monthCents.set(month, (monthCents.get(month) ?? 0) + add);
    }
  }
  let placed = 0;
  for (const amount of monthCents.values()) placed += amount;
  if (placed !== cents(contract)) return null;
  // Schedule allocations cannot establish when any invoice was issued or paid.
  // Even a supplied total is not a dated billing record and must not be spread as actual.
  const months: BillingMonth[] = [...monthCents.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount: fromCents(amount), kind: "forecast" }));
  return { billed_to_date: null, months };
}

// ---------- TIA ----------
const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const calendarDays = (from: string, to: string) =>
  Math.round((day(to) - day(from)) / 86_400_000);
const short = (s: string) =>
  new Date(day(s)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
export type TiaResult = {
  fragnet: string;
  prior_completion: string;
  updated_completion: string;
  impact_cd: number;
  impact_wd: number;
  completion_delay: string;
  fragnet_only_cd: number | null;
  math: string;
  statement: string;
};
/** Computed server-side from the saved dates; never typed in by the host. */
export function tiaResult(t: Tia | null | undefined): TiaResult | null {
  if (!t?.prior_completion || !t.updated_completion) return null;
  const impact = calendarDays(t.prior_completion, t.updated_completion);
  const fragnet = t.fragnet ?? t.fragment ?? "";
  const only = t.fragnet_only_completion ?? t.fragment_only_completion ?? null;
  const frag = only ? calendarDays(only, t.updated_completion) : null;
  // 0.8.12: both units. The delay window is the day after the prior completion through the updated completion,
  // counted inclusively like delayCallout (CD), and in working days on the job calendar (WD).
  const wd =
    impact > 0
      ? jobWorkingDays(
          addDays(t.prior_completion.slice(0, 10), 1),
          t.updated_completion.slice(0, 10),
          t.holidays,
        )
      : 0;
  const completion_delay =
    impact > 0
      ? completionDelayLine(
          wd,
          addDays(t.prior_completion.slice(0, 10), 1),
          t.updated_completion.slice(0, 10),
        )
      : "Completion delay: +0 WD (0 CD)";
  const math = `Updated completion ${short(t.updated_completion)} − prior completion ${short(t.prior_completion)}.${frag !== null ? ` Fragnet-only impact: ${short(t.updated_completion)} − ${short(only!)} = ${frag} CD.` : ""}`;
  const statement = impact > 0 ? `${completion_delay}.` : `${completion_delay}: float absorbed it.`;
  return {
    fragnet,
    prior_completion: t.prior_completion,
    updated_completion: t.updated_completion,
    impact_cd: impact,
    impact_wd: wd,
    completion_delay,
    fragnet_only_cd: frag,
    math,
    statement,
  };
}

/** 0.8.12: delay callout, always both units. CD = start to finish inclusive (Nov 27 to Dec 17 = 21). */
export function inclusiveCalendarDays(start: string, finish: string): number {
  const a = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const b = Date.UTC(+finish.slice(0, 4), +finish.slice(5, 7) - 1, +finish.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}
export function delayCallout(workingDays: number, start: string, finish: string): string {
  return `Delay: +${workingDays} WD (${inclusiveCalendarDays(start, finish)} CD)`;
}
/** Same counting as delayCallout, labeled for the completion-to-completion result. */
export function completionDelayLine(workingDays: number, start: string, finish: string): string {
  return delayCallout(workingDays, start, finish).replace(/^Delay:/, "Completion delay:");
}
/** Working days (Mon–Fri, excluding the job's holidays; US federal holidays when none are saved), start to finish inclusive. */
export function jobWorkingDays(start: string, finish: string, holidays?: string[] | null): number {
  if (finish < start) return 0;
  const years = new Set<number>();
  for (let y = +start.slice(0, 4); y <= +finish.slice(0, 4); y++) years.add(y);
  const hol = new Set(holidays ?? [...years].flatMap(federalHolidays));
  let n = 0;
  for (let d = start; d <= finish; d = addDays(d, 1)) {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6 && !hol.has(d)) n++;
  }
  return n;
}

// ---------- save checks ----------
export type SaveCheck = {
  ok: boolean;
  problems: string[];
  tie: Tie | null;
  count: CountCheck | null;
  forecast_total: number | null;
};
/** Refuse a save that drops activities, loses its count, or doesn't tie to the contract to the cent. */
export function checkSave(
  type: LivingReportType,
  next: LivingData,
  prev: LivingData | null,
  contract: number | null,
): SaveCheck {
  const problems: string[] = [];
  const acts = next.activities ?? [];
  const prevActs = prev?.activities ?? [];
  const ids = new Set(acts.map((a) => a.id));
  const dropped = prevActs.filter((a) => !ids.has(a.id)).map((a) => a.id);
  if (dropped.length)
    problems.push(
      `This update drops ${dropped.length} activit${dropped.length === 1 ? "y" : "ies"} (${dropped.join(", ")}). Keep every activity; mark finished work 100% instead.`,
    );
  const dup = acts.map((a) => a.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dup.length) problems.push(`Activity IDs repeat: ${[...new Set(dup)].join(", ")}.`);
  let count: CountCheck | null = null;
  if (type === "cpm" || acts.length) {
    count = countCheck(acts, Math.max(acts.length, prevActs.length));
    if (!acts.length) problems.push("No activities were given. Send the full activity list.");
    else if (!count.complete)
      problems.push(`Only ${count.line} Missing dates: ${count.missing.join(", ")}.`);
  }
  let tie: Tie | null = null;
  let ft: number | null = null;
  if (TIED_TYPES.includes(type)) {
    ft = type === "cpm" ? costLoadTotal(acts) : forecastTotal(next.billing);
    tie = tieCheck(ft, contract);
    if (!tie.ties) problems.push(tie.line);
    const of = ownerFurnishedWithValue(acts);
    if (of.length && !tie.ties)
      problems.push(
        `Owner-furnished work is $0.00 in ALP billing: ${of.map((a) => `${a.id} ${a.name} (${money(a.value ?? 0)})`).join("; ")}. Move that value to ALP's own activities.`,
      );
  }
  return { ok: problems.length === 0, problems, tie, count, forecast_total: ft };
}

// ---------- views ----------
/** Supers see no dollars: the schedule only. */
export function stripMoney(d: LivingData): LivingData {
  const {
    billing: _b,
    ior: _i,
    kpis: _k,
    contract_total: _c,
    ...rest
  } = d as LivingData & { ior?: unknown; kpis?: unknown; contract_total?: unknown };
  void _b;
  void _i;
  void _k;
  void _c;
  return {
    ...rest,
    activities: (d.activities ?? []).map(({ value: _v, ...a }) => {
      void _v;
      return { ...a, value: null };
    }),
  };
}

const logicText = (ps: Logic[]) =>
  ps.length
    ? ps
        .map(
          (p) =>
            `${p.id}${p.type && p.type !== "FS" ? ` ${p.type}` : ""}${p.lag ? ` +${p.lag}` : ""}`,
        )
        .join(", ")
    : "none (open start)";

const isoDay = (s: string | null | undefined) =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

/** Holidays on the saved job calendar (tia.holidays, or data.calendar.holidays). Null: Monday–Friday only. */
export function reportCalendarHolidays(data: LivingData | null | undefined): string[] | null {
  if (!data) return null;
  const fromTia = data.tia?.holidays;
  if (Array.isArray(fromTia)) return fromTia;
  const cal = data.calendar;
  if (cal && typeof cal === "object" && Array.isArray((cal as { holidays?: unknown }).holidays))
    return (cal as { holidays: unknown[] }).holidays.filter((d): d is string => typeof d === "string");
  return null;
}

/** Bar is Start through Finish, inclusive. A positive float tail starts the next day and runs that many working days. */
export function ganttBarNote(
  a: Pick<Activity, "start" | "finish" | "total_float" | "critical">,
  holidays?: string[] | null,
): string {
  const start = isoDay(a.start);
  const finish = isoDay(a.finish);
  const bar = `bar ${start ?? "Needed"}→${finish ?? "Needed"}`;
  if (!start || !finish) return bar;
  const float = a.total_float;
  if (float == null) return `${bar}, float tail Needed`;
  if (float <= 0 || a.critical === true) return `${bar}, no float tail`;
  const tail = addCountedDays(finish, float, "working", new Set(holidays ?? []));
  return `${bar}, float tail to ${tail}`;
}

export function activityLine(a: Activity, showMoney: boolean, holidays?: string[] | null): string {
  const parts = [
    `${a.id} ${a.name}`,
    `${a.duration ?? "Needed"} WD`,
    `${a.start ?? "Needed"} → ${a.finish ?? "Needed"}`,
    ganttBarNote(a, holidays),
    `after ${logicText(a.predecessors)}`,
    `float ${a.total_float ?? "Needed"}${a.critical ? " (critical)" : ""}`,
    a.pct_complete == null ? "Progress Needed" : `${a.pct_complete}% complete`,
  ];
  if (showMoney)
    parts.push(
      isOwnerFurnished(a)
        ? "owner-furnished, $0.00 in ALP billing"
        : `${a.value === null ? "Needed" : money(a.value)}`,
      `SOV ${a.sov_line ?? "Needed"}`,
      `cost code ${a.cost_code ?? "Needed"}`,
    );
  return `- ${parts.join(" · ")}`;
}

export const CPM_REQUIRED_TOP = [
  "REQUIRED: When the user only asks to see the schedule (e.g. \"pull up the schedule\"), build a NEW private view or artifact. Never update, overwrite or replace the saved shared master or an existing shared artifact unless the user explicitly asks to update or save it, and confirm with them first.",
  "REQUIRED: Use this activity list exactly as given: every ID, date, duration, logic tie, float, $ value and SOV line. Do not recompute, re-sequence, rebuild it from an earlier chat, or guess any value. Anything marked Needed stays Needed.",
  "REQUIRED: Before drawing any CPM, billing forecast, drill-down, IOR or dashboard, show the count check line and the tie line below. If the count is short or it doesn't tie, say which activities are missing or the amount it's off by, and stop; never draw an over-contract total.",
  "REQUIRED: Owner-furnished activities are schedule-only: $0.00 in ALP billing. Use the one saved contract completion date and the delay result shown here; never type in your own.",
].join("\n");

/** Delay callout color: the shared alert color (alert-color.ts), so the Gantt and the server instructions never conflict. */
export const DELAY_CALLOUT_COLOR = ALERT_COLOR;

/** Presentation instructions for the host-rendered schedule, using only saved values. */
export const CPM_GANTT_SPEC: string[] = [
  "REQUIRED VIEW: When the user asks to see, show, draw or update the schedule, build ONE styled Gantt as an artifact or canvas, never a plain list or a default chart. Spec:",
  "1. Header: the job name and version, the data date, then the Count check line and the Tie line word for word, then \"Contract completion: <date>\".",
  "2. Layout: a white background, readable activity table on the left (ID, Name, Dur WD, Start, Finish, Float, $), and timeline on the right with month columns and week ticks. Display only existing WBS parent/child structure when supplied in saved data; otherwise keep the activities flat and do not invent groups.",
  "3. Bars: each bar starts at the activity's Start date and ends at its Finish date, both inclusive. Never stretch a bar to the chart edge or the contract completion line. Show the saved percent complete in blue #2563EB as the actual portion, and the remaining portion in green #16834A for noncritical or red #C12D2D for critical activities. At 0% the whole bar is remaining; at 100% it is blue. Split by the reported percentage, never by the data date. If progress or criticality is unknown, label it Needed and do not invent a color classification. Milestones (0 WD) are diamonds: blue when completed, otherwise red when critical or green when noncritical; completion takes precedence. Do not draw full-width gray background tracks. Preserve any saved baseline ghost bars, owner-furnished identification and float tails.",
  "4. Logic: thin predecessor connector lines, and the critical path highlighted end to end. Provide an on/off control for logic lines, initially on.",
  "5. Data date: a dashed vertical line at the saved data date; if Needed, show today and label it Today. The line does not determine reported progress.",
  "6. Contract completion: a dashed vertical line labeled with the saved date.",
  `7. Delay fragnets (only for an activity explicitly identified by a saved delay result): use red hatching on its remaining portion and label it with its saved activity name and duration. Include a ${DELAY_CALLOUT_COLOR} callout reading "Delay: +X WD (Y CD)", always both units when known: X = the fragnet duration in working days on the job calendar, Y = calendar days from the fragnet start to its finish, counting both days (e.g. 15 WD Nov 27 to Dec 17 = "Delay: +15 WD (21 CD)"). Do not infer hatching from activity names or IDs. Draw baseline ghost bars only for activities whose saved baseline Start/Finish appears in the data; if no baseline dates are given, draw none.`,
  "8. Legend under the chart: Actual progress, Remaining noncritical, Remaining critical, Float, Milestone, Owner-furnished, Delay fragnet, Data date or Today.",
  "9. Show all activities, preserve IDs and saved order within any existing WBS, and keep typography, labels and spacing readable. No technical notes; one caveat line at most.",
];


/** 0.8.12: viewing never touches the shared master. */
export const LIVING_VIEW_RULE =
  "REQUIRED: When the user only asks to see it (e.g. \"pull up the schedule\"), build a NEW private view or artifact from this data. Never update, overwrite or replace the saved shared master or an existing shared artifact unless the user explicitly asks to update or save it, and confirm with them first.";
export const LIVING_REQUIRED_TOP = [
  LIVING_VIEW_RULE,
  "REQUIRED: This is the saved master copy. When the user asks to update it: change only what moved, keep the layout, show the version, Last updated and \"What changed since last version\" line, and mark it \"Draft: not saved\" until the PM approves.",
  "REQUIRED: Save a new version only after the PM says yes to this exact update. The forecast total must equal the contract to the cent and every activity must stay; Athena refuses the save otherwise.",
].join("\n");

export const LIVING_SAVE_ASK = "Save this as the new version?";

/** Data dates are read in Manaus. A missing date is today there. A later date is refused. */
export const DATA_DATE_ZONE = "America/Manaus";
export const DATA_DATE_FUTURE_ERROR = "That data date is later than today. Nothing was saved.";

export function resolveDataDate(
  given: string | null | undefined,
  now = new Date(),
): { ok: true; dataDate: string } | { ok: false; error: string } {
  const today = todayIn(DATA_DATE_ZONE, now);
  const dataDate = (given ?? "").trim() || today;
  if (dataDate > today) return { ok: false, error: DATA_DATE_FUTURE_ERROR };
  return { ok: true, dataDate };
}

const IOR_HIDDEN = new Set(["audience", "source_cpm_version", "cpm_version", "allocation_status", "id"]);
const IOR_SKIP = new Set(["activities", "tia", "billing"]);
const IOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iorLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function iorScalar(key: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (isIdentifierKey(key) && (typeof value === "string" || typeof value === "number")) return String(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (isPercentKey(key)) return formatReportNumber(key, value);
    if (/amount|exposure|contract|profit|cost|revenue|fee|billed|paid|balance|value/i.test(key) && !/pct|percent/i.test(key)) return money(value);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || IOR_UUID.test(text)) return null;
    const numeric = asReportNumber(text);
    if (numeric != null && (isPercentKey(key) || isMoneyKey(key))) return formatReportNumber(key, numeric);
    return text;
  }
  return null;
}

function iorRecordLine(record: Record<string, unknown>): string {
  const bits: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (IOR_HIDDEN.has(key)) continue;
    const shown = iorScalar(key, value);
    if (shown) bits.push(`${iorLabel(key)}: ${shown}`);
  }
  return bits.join(" · ");
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Plain IOR reply for a host that prints tool text and does not draw the card. */
export function iorPlainReply(sc: Record<string, unknown> | null | undefined): string {
  const lines: string[] = [];
  const links = Array.isArray(sc?.board_links) ? sc.board_links : [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const row = link as { label?: unknown; href?: unknown };
    const label = textOf(row.label);
    const href = textOf(row.href);
    if (label && href) lines.push(`${label}: ${href}`);
  }
  const data = sc?.data && typeof sc.data === "object" && !Array.isArray(sc.data) ? (sc.data as Record<string, unknown>) : null;
  const sections = sc?.no_financials === true ? [] : iorSectionsText(data);
  if (sections.length) lines.push("", ...sections);
  if (typeof sc?.version === "number") {
    const who = textOf(sc.updated_by);
    const date = textOf(sc.data_date);
    lines.push("", `Version v${sc.version}${date ? ` · Data date ${date}` : ""}${who ? ` · ${who}` : ""}`);
  }
  const log = Array.isArray(sc?.change_log) ? sc.change_log.slice(0, 5) : [];
  lines.push("", "Change log (latest 5):");
  if (!log.length) lines.push("- None yet.");
  else {
    for (const item of log) {
      if (!item || typeof item !== "object") continue;
      const entry = item as { version?: unknown; at?: unknown; who?: unknown; what?: unknown; why?: unknown };
      const when = textOf(entry.at).slice(0, 10);
      const why = textOf(entry.why);
      lines.push(`- v${entry.version ?? ""} · ${when} · ${textOf(entry.who) || "member"} · ${textOf(entry.what)}${why ? ` (why: ${why})` : ""}`);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Readable IOR sections. Links, the version line, and the change log stay where the tool already prints them. */
export function iorSectionsText(data: Record<string, unknown> | null | undefined): string[] {
  if (!data) return [];
  const lines: string[] = [];
  const holds = iorHoldSummary(data);
  const summarized = (key: string) => !!holds && (isExposureHoldTotal(key) || (holds.contingencyCents != null && isContingencyHoldTotal(key)));
  const title = iorScalar("title", data.title);
  if (title) lines.push(title);
  const kpis = data.kpis;
  if (kpis && typeof kpis === "object" && !Array.isArray(kpis)) {
    const bits = Object.entries(kpis as Record<string, unknown>)
      .filter(([key]) => !IOR_HIDDEN.has(key) && !summarized(key))
      .map(([key, value]) => {
        const shown = iorScalar(key, value);
        return shown ? `${iorLabel(key)}: ${shown}` : "";
      })
      .filter(Boolean);
    if (bits.length) lines.push("Job health", ...bits.map((bit) => `- ${bit}`));
  }
  if (holds) {
    lines.push(`Listed E-holds: ${money(holds.exposureCents / 100)} · ${holds.count} listed`);
    if (holds.contingencyCents != null) lines.push(`C-holds: ${money(holds.contingencyCents / 100)}`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (key === "title" || key === "kpis" || IOR_HIDDEN.has(key) || IOR_SKIP.has(key) || summarized(key)) continue;
    if (Array.isArray(value)) {
      const rows = value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
      const scalars = value.filter((row): row is string | number => typeof row === "string" || typeof row === "number");
      if (!rows.length && !scalars.length) continue;
      lines.push(iorLabel(key));
      for (const row of scalars) lines.push(`- ${row}`);
      for (const row of rows) {
        const line = iorRecordLine(row);
        if (line) lines.push(`- ${line}`);
      }
      continue;
    }
    const shown = iorScalar(key, value);
    if (shown) {
      lines.push(`${iorLabel(key)}: ${shown}`);
      continue;
    }
    if (value && typeof value === "object") {
      const line = iorRecordLine(value as Record<string, unknown>);
      if (!line) continue;
      lines.push(iorLabel(key), `- ${line}`);
    }
  }
  return lines;
}
