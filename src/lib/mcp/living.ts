// 0.8.9: cost-loaded CPM activity handoff, tie-to-contract guard, owner-furnished exclusion and living reports.
// Pure logic only (no database); the tools live in tools/living-tools.ts. Athena hands the saved values; the host
// draws them and never recomputes, rebuilds or guesses them.
import { money } from "./sov";
import { ALERT_COLOR } from "./alert-color";
import { addDays, federalHolidays } from "./deadlines";

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
export function activityLine(a: Activity, showMoney: boolean): string {
  const parts = [
    `${a.id} ${a.name}`,
    `${a.duration ?? "Needed"} WD`,
    `${a.start ?? "Needed"} → ${a.finish ?? "Needed"}`,
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
  'When the member only asks to see the schedule (e.g. "pull up the schedule"), build a NEW private view or artifact. Do not update the saved copy unless the member explicitly asks to update or save it, and confirm with them first.',
  "Use this activity list exactly as given. Do not recompute it or guess a value.",
  "Show the count check and the tie line. If the count is short or it does not tie, say what is missing or the amount it is off by, and stop.",
  "Use the saved contract completion date and the delay result shown here.",
].join("\n");

/** Delay callout color: the shared alert color (alert-color.ts), so the Gantt and the server instructions never conflict. */
export const DELAY_CALLOUT_COLOR = ALERT_COLOR;

/** v0.8.10: full Gantt spec, sent right after the Tie line so every host draws the same view. Blue and gray only, except the delay callout (DELAY_CALLOUT_COLOR). */
export const CPM_GANTT_SPEC: string[] = [
  "Show these activities as a schedule.",
  "Use the dates, logic, float, and amounts exactly as given.",
  "If the tie line does not match, show it and stop.",
];

/** 0.8.12: viewing never touches the shared master. */
export const LIVING_VIEW_RULE =
  'When the member only asks to see it (e.g. "pull up the schedule"), build a NEW private view or artifact from this data. Do not update the saved copy unless the user explicitly asks to update or save it, and confirm with them first.';
export const LIVING_REQUIRED_TOP = [
  LIVING_VIEW_RULE,
  "This is the saved copy. Change only what moved. Mark it draft until the PM says yes.",
  "Save a new version only after the PM says yes to this exact update.",
].join("\n");

export const LIVING_SAVE_ASK = "Save this as the new version?";
