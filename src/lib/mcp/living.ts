// 0.8.9: cost-loaded CPM activity handoff, tie-to-contract guard, owner-furnished exclusion and living reports.
import { DRAFT_NOT_OFFICIAL } from "./record-copy";
// Pure logic only (no database); the tools live in tools/living-tools.ts. Athena hands the saved values; the host
// draws them and never recomputes, rebuilds or guesses them.
import { money } from "./sov";
import { ALERT_COLOR } from "./alert-color";
import { addCountedDays, addDays, federalHolidays } from "./deadlines";

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
export type BillingMonth = { month: string; amount: number; kind: "actual" | "forecast" };
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
  billing?: { billed_to_date?: number | null; months?: BillingMonth[] };
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
 * Dollars up to `billed` are actual; the rest is forecast. Returns null when the activities
 * do not tie, or a dated value cannot be placed.
 */
export function draftBillingFromSchedule(
  activities: Activity[],
  contract: number,
  billed: number,
  holidays?: string[] | null,
): { billed_to_date: number; months: BillingMonth[] } | null {
  if (
    !activities.length ||
    !Number.isFinite(contract) ||
    contract < 0 ||
    !Number.isFinite(billed) ||
    billed < 0
  )
    return null;
  if (cents(billed) > cents(contract)) return null;
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
  const billedCents = cents(billed);
  let leftActual = billedCents;
  const months: BillingMonth[] = [];
  for (const [month, amount] of [...monthCents.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (leftActual <= 0) {
      months.push({ month, amount: fromCents(amount), kind: "forecast" });
      continue;
    }
    if (amount <= leftActual) {
      months.push({ month, amount: fromCents(amount), kind: "actual" });
      leftActual -= amount;
      continue;
    }
    months.push({ month, amount: fromCents(leftActual), kind: "actual" });
    months.push({ month, amount: fromCents(amount - leftActual), kind: "forecast" });
    leftActual = 0;
  }
  return { billed_to_date: fromCents(billedCents), months };
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
    `${a.pct_complete ?? 0}% complete`,
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

/** v0.8.10: full Gantt spec, sent right after the Tie line so every host draws the same view. Blue and gray only, except the delay callout (DELAY_CALLOUT_COLOR). */
export const CPM_GANTT_SPEC: string[] = [
  "REQUIRED VIEW: When the user asks to see, show, draw or update the schedule, build ONE styled Gantt as an artifact or canvas, never a plain list or a default chart. Spec:",
  "1. Header: the job name and version, the data date, then the Count check line and the Tie line word for word, then \"Contract completion: <date>\".",
  "2. Layout: a white background, the activity table on the left (ID, Name, Dur WD, Start, Finish, Float, $), and a timeline on the right with month columns and week ticks.",
  "3. Bars: each bar starts at the activity's Start date and ends at its Finish date, both inclusive. Never stretch a bar to the chart edge or the contract completion line. Critical activities (float 0) are solid blue #1E5FED with no tail. Use #1E5FED, the Athena mark; don't use #2563EB. Non-critical activities are gray #9CA3AF, followed by a light-gray float tail that starts the day after Finish and is exactly Float working days long. Milestones (0 WD) are diamonds with no bar. Owner-furnished activities are outlined gray bars from Start to Finish.",
  "4. Logic: thin predecessor connector lines, and the critical path highlighted end to end.",
  "5. Today line: a dashed vertical line at the data date (or today if the data date is Needed), labeled.",
  "6. Contract completion: a dashed vertical line labeled with the saved date.",
  `7. Delay fragnets (only when a delay result exists): a hatched bar labeled \"Fragnet\", plus a ${DELAY_CALLOUT_COLOR} callout reading \"Delay: +X WD (Y CD)\", always both units: X = the fragnet duration in working days on the job calendar, Y = calendar days from the fragnet start to its finish, counting both days (e.g. 15 WD Nov 27 to Dec 17 = \"Delay: +15 WD (21 CD)\"), taken from the saved activities and delay result. Draw baseline ghost bars only for activities whose saved baseline Start/Finish appears in the data; if no baseline dates are given, draw none.`,
  "8. Legend under the chart: Critical, Non-critical, Float, Milestone, Owner-furnished, Fragnet, Today.",
  `9. Order rows by start date, keep IDs exactly as given and show all activities. All other colors are blue and gray only; ordinary callouts use navy text with a blue #1E5FED line; red callouts are only for delays, risks and overdue items. No technical notes; one caveat line at most.`,
];


/** 0.8.12: viewing never touches the shared master. */
export const LIVING_VIEW_RULE =
  "REQUIRED: When the user only asks to see it (e.g. \"pull up the schedule\"), build a NEW private view or artifact from this data. Never update, overwrite or replace the saved shared master or an existing shared artifact unless the user explicitly asks to update or save it, and confirm with them first.";
export const LIVING_REQUIRED_TOP = [
  LIVING_VIEW_RULE,
  `REQUIRED: This is the saved master copy. When the user asks to update it: change only what moved, keep the layout, show the version, Last updated and "What changed since last version" line, and mark it "${DRAFT_NOT_OFFICIAL}" until the PM approves.`,
  "REQUIRED: Save a new version only after the PM says yes to this exact update. The forecast total must equal the contract to the cent and every activity must stay; Athena refuses the save otherwise.",
].join("\n");

export const LIVING_SAVE_ASK = "Save this as the new version?";
