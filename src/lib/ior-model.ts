// Structured IOR: the gross profit forecast behind Athena's IOR page.
// Saved inside the IOR living report as data.ior_model. Every figure comes from what the PM saved;
// nothing is assumed. Money is whole cents internally so every line ties to the dollar.

export const IOR_MODEL_KEY = "ior_model";

export type IorPhase = "Early" | "Middle" | "Late";
export type IorHold = "E" | "C";
export type IorResponse = "eliminate" | "recover" | "offset" | "accept";
export type IorCategory =
  | "owner_decision"
  | "design_drift"
  | "trade_performance"
  | "procurement"
  | "schedule_compression"
  | "allowance_overrun"
  | "field_change"
  | "closeout_punch"
  | "other";

export type IorChangeOrder = {
  number: string;
  description: string;
  status: "Approved" | "Pending";
  contract_amount: number;
  cost_amount: number;
  /** Percent, 0 to 100. Approved change orders count at 100. */
  probability: number;
};

export type IorExposure = {
  title: string;
  short: string;
  category: IorCategory;
  response: IorResponse;
  hold: IorHold;
  dollar_risk: number;
  /** Percent, 0 to 100. */
  probability: number;
  owner: string | null;
  opened: string | null;
  next_review: string | null;
  next_move: string | null;
};

export type IorModel = {
  original_contract: number;
  /** Null when no cost budget is saved: margin cannot be read. */
  original_cost_budget: number | null;
  cost_growth: number;
  cost_growth_note: string | null;
  actual_cost_to_date: number;
  phase: IorPhase;
  percent_complete: number;
  baseline_completion: string | null;
  forecast_completion: string | null;
  last_forecast_completion: string | null;
  change_orders: IorChangeOrder[];
  exposures: IorExposure[];
  /** Set at read time when the finish dates come from the job's CPM, never saved. */
  schedule_source?: IorScheduleSource | null;
};

export type IorScheduleSource = {
  version: number | null;
  data_date: string | null;
  /** What the CPM forecast is measured against; "ior" when the CPM has no baseline or contract date. */
  against: "baseline" | "contract" | "ior";
  /** Working days late (+) or early (−) from the CPM; null when it isn't calculated. */
  work_days: number | null;
};

/** The CPM's forecast finish (see ior-schedule.ts cpmFinish). */
export type IorCpmFinish = {
  forecast: string;
  against: string | null;
  againstKind: "baseline" | "contract" | null;
  workDays: number | null;
  version: number | null;
  dataDate: string | null;
};

/**
 * The IOR reads its finish from the CPM when the job has one. The imported or saved
 * IOR dates stay only as the fallback for a job with no schedule.
 */
export function withCpmFinish(m: IorModel, f: IorCpmFinish | null | undefined): IorModel {
  if (!f) return m;
  return {
    ...m,
    forecast_completion: f.forecast,
    baseline_completion: f.against ?? m.baseline_completion,
    // The last IOR's forecast came from another source, so "moved since the last IOR" would mislead.
    last_forecast_completion: null,
    schedule_source: {
      version: f.version,
      data_date: f.dataDate,
      against: f.against ? (f.againstKind ?? "contract") : "ior",
      work_days: f.against ? f.workDays : null,
    },
  };
}

const CATEGORIES: IorCategory[] = ["owner_decision", "design_drift", "trade_performance", "procurement", "schedule_compression", "allowance_overrun", "field_change", "closeout_punch", "other"];
const RESPONSES: IorResponse[] = ["eliminate", "recover", "offset", "accept"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function num(v: unknown): number | null {
  if (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim())) v = Number(v);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, max = 300): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
function day(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
function pct(v: unknown): number | null {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
}

export type IorModelProblem = string;

/** Reads data.ior_model. Returns the model, or the problems that stop it from being read. */
export function readIorModel(data: unknown): { model: IorModel | null; problems: IorModelProblem[] } {
  const raw = isObj(data) ? data[IOR_MODEL_KEY] : undefined;
  if (raw === undefined || raw === null) return { model: null, problems: [] };
  const problems: string[] = [];
  if (!isObj(raw)) return { model: null, problems: ["ior_model must be an object."] };
  const contract = num(raw.original_contract);
  if (contract == null || contract <= 0) problems.push("ior_model.original_contract must be a positive amount.");
  const costRaw = raw.original_cost_budget;
  const cost = costRaw == null ? null : num(costRaw);
  if (costRaw != null && (cost == null || cost < 0)) problems.push("ior_model.original_cost_budget must be an amount, or null when no budget is saved.");
  const growth = raw.cost_growth == null ? 0 : num(raw.cost_growth);
  if (growth == null) problems.push("ior_model.cost_growth must be an amount (negative for savings).");
  const actual = raw.actual_cost_to_date == null ? 0 : num(raw.actual_cost_to_date);
  if (actual == null || actual < 0) problems.push("ior_model.actual_cost_to_date must be an amount.");
  const phase = raw.phase;
  if (phase !== "Early" && phase !== "Middle" && phase !== "Late") problems.push("ior_model.phase must be Early, Middle or Late.");
  const complete = raw.percent_complete == null ? 0 : pct(raw.percent_complete);
  if (complete == null) problems.push("ior_model.percent_complete must be 0 to 100.");
  const dates = ["baseline_completion", "forecast_completion", "last_forecast_completion"] as const;
  for (const k of dates) if (raw[k] != null && !day(raw[k])) problems.push(`ior_model.${k} must be a YYYY-MM-DD date.`);

  const cos: IorChangeOrder[] = [];
  if (raw.change_orders != null && !Array.isArray(raw.change_orders)) problems.push("ior_model.change_orders must be a list.");
  (Array.isArray(raw.change_orders) ? raw.change_orders : []).forEach((c, i) => {
    const at = `ior_model.change_orders[${i}]`;
    if (!isObj(c)) return void problems.push(`${at} must be an object.`);
    const status = c.status;
    if (status === "Denied" || status === "Void") return;
    if (status !== "Approved" && status !== "Pending") return void problems.push(`${at}.status must be Approved, Pending or Denied.`);
    const contractAmount = num(c.contract_amount);
    const costAmount = num(c.cost_amount);
    const probability = status === "Approved" ? 100 : pct(c.probability);
    if (contractAmount == null) problems.push(`${at}.contract_amount must be an amount.`);
    if (costAmount == null) problems.push(`${at}.cost_amount must be an amount; ask the PM for the cost side.`);
    if (probability == null) problems.push(`${at}.probability must be 0 to 100 for a pending change order.`);
    if (contractAmount == null || costAmount == null || probability == null) return;
    cos.push({ number: str(c.number, 40) ?? `CO ${i + 1}`, description: str(c.description) ?? "Change order", status, contract_amount: contractAmount, cost_amount: costAmount, probability });
  });

  const exposures: IorExposure[] = [];
  if (raw.exposures != null && !Array.isArray(raw.exposures)) problems.push("ior_model.exposures must be a list.");
  (Array.isArray(raw.exposures) ? raw.exposures : []).forEach((e, i) => {
    const at = `ior_model.exposures[${i}]`;
    if (!isObj(e)) return void problems.push(`${at} must be an object.`);
    // Closed risks drop off the IOR, as they do in Overwatch.
    if (typeof e.status === "string" && /^(recovered|eliminated|released|closed)$/i.test(e.status)) return;
    const title = str(e.title);
    const hold = e.hold === "E" || e.hold === "E-Hold" ? "E" : e.hold === "C" || e.hold === "C-Hold" ? "C" : null;
    const dollar = num(e.dollar_risk);
    const probability = pct(e.probability);
    const category = CATEGORIES.includes(e.category as IorCategory) ? (e.category as IorCategory) : e.category == null ? "other" : null;
    const response = RESPONSES.includes(e.response as IorResponse) ? (e.response as IorResponse) : null;
    if (!title) problems.push(`${at}.title is required.`);
    if (!hold) problems.push(`${at}.hold must be E or C.`);
    if (dollar == null || dollar < 0) problems.push(`${at}.dollar_risk must be an amount.`);
    if (probability == null) problems.push(`${at}.probability must be 0 to 100.`);
    if (!category) problems.push(`${at}.category is not one Athena knows.`);
    if (!response) problems.push(`${at}.response must be eliminate, recover, offset or accept.`);
    for (const k of ["opened", "next_review"] as const) if (e[k] != null && !day(e[k])) problems.push(`${at}.${k} must be a YYYY-MM-DD date.`);
    if (!title || !hold || dollar == null || dollar < 0 || probability == null || !category || !response) return;
    exposures.push({
      title,
      short: str(e.short, 60) ?? title.split(":")[0].slice(0, 60),
      category,
      response,
      hold,
      dollar_risk: dollar,
      probability,
      owner: str(e.owner, 80),
      opened: day(e.opened),
      next_review: day(e.next_review),
      next_move: str(e.next_move),
    });
  });

  if (problems.length) return { model: null, problems };
  return {
    model: {
      original_contract: contract!,
      original_cost_budget: cost == null || cost === 0 ? null : cost,
      cost_growth: growth!,
      cost_growth_note: str(raw.cost_growth_note),
      actual_cost_to_date: actual!,
      phase: phase as IorPhase,
      percent_complete: complete!,
      baseline_completion: day(raw.baseline_completion),
      forecast_completion: day(raw.forecast_completion),
      last_forecast_completion: day(raw.last_forecast_completion),
      change_orders: cos,
      exposures,
    },
    problems: [],
  };
}

const cents = (n: number) => Math.round(n * 100);
const weighted = (amount: number, probability: number) => Math.round((cents(amount) * probability) / 100);

/** Held amount for one exposure: dollar risk times probability, in cents. */
export function heldCents(e: IorExposure): number {
  return weighted(e.dollar_risk, e.probability);
}

/** All amounts in cents. Same arithmetic as Overwatch's IOR rollup. */
export type IorRollup = {
  costKnown: boolean;
  originalContract: number;
  originalCost: number;
  costGrowth: number;
  approvedContract: number;
  approvedCost: number;
  pendingContract: number;
  pendingCost: number;
  weightedPendingContract: number;
  weightedPendingCost: number;
  pendingCount: number;
  signedContract: number;
  forecastContract: number;
  baseCost: number;
  forecastCost: number;
  eHold: number;
  cHold: number;
  originalGP: number;
  signedGP: number;
  beforeHolds: number;
  indicatedGP: number;
  gap: number;
  originalPct: number;
  signedPct: number;
  indicatedPct: number;
  remainingCost: number;
  ePct: number;
  cPct: number;
  eTarget: number;
  cTarget: number;
};

const GUIDE: Record<IorPhase, [number, number]> = { Early: [4, 3], Middle: [3, 2.5], Late: [2, 1.5] };

export function iorRollup(m: IorModel): IorRollup {
  const approved = m.change_orders.filter((c) => c.status === "Approved");
  const pending = m.change_orders.filter((c) => c.status === "Pending");
  const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((t, r) => t + f(r), 0);
  const originalContract = cents(m.original_contract);
  const originalCost = cents(m.original_cost_budget ?? 0);
  const costGrowth = cents(m.cost_growth);
  const approvedContract = sum(approved, (c) => cents(c.contract_amount));
  const approvedCost = sum(approved, (c) => cents(c.cost_amount));
  const pendingContract = sum(pending, (c) => cents(c.contract_amount));
  const pendingCost = sum(pending, (c) => cents(c.cost_amount));
  const weightedPendingContract = sum(pending, (c) => weighted(c.contract_amount, c.probability));
  const weightedPendingCost = sum(pending, (c) => weighted(c.cost_amount, c.probability));
  const signedContract = originalContract + approvedContract;
  const forecastContract = signedContract + weightedPendingContract;
  const baseCost = originalCost + costGrowth;
  const forecastCost = baseCost + approvedCost + weightedPendingCost;
  const eHold = sum(m.exposures.filter((e) => e.hold === "E"), heldCents);
  const cHold = sum(m.exposures.filter((e) => e.hold === "C"), heldCents);
  const originalGP = originalContract - originalCost;
  const signedGP = originalGP + approvedContract - approvedCost;
  const beforeHolds = forecastContract - forecastCost;
  const indicatedGP = beforeHolds - eHold - cHold;
  const remainingCost = Math.max(0, forecastCost - cents(m.actual_cost_to_date));
  const [ePct, cPct] = GUIDE[m.phase];
  const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
  return {
    costKnown: m.original_cost_budget != null,
    originalContract,
    originalCost,
    costGrowth,
    approvedContract,
    approvedCost,
    pendingContract,
    pendingCost,
    weightedPendingContract,
    weightedPendingCost,
    pendingCount: pending.length,
    signedContract,
    forecastContract,
    baseCost,
    forecastCost,
    eHold,
    cHold,
    originalGP,
    signedGP,
    beforeHolds,
    indicatedGP,
    gap: indicatedGP - signedGP,
    originalPct: ratio(originalGP, originalContract),
    signedPct: ratio(signedGP, signedContract),
    indicatedPct: ratio(indicatedGP, forecastContract),
    remainingCost,
    ePct,
    cPct,
    eTarget: Math.round((remainingCost * ePct) / 100),
    cTarget: Math.round((remainingCost * cPct) / 100),
  };
}

export type IorFlag = { high: boolean; title: string; detail: string };

const SCHEDULE_LINKED: IorCategory[] = ["procurement", "owner_decision", "schedule_compression"];
export const isScheduleLinked = (e: IorExposure) => SCHEDULE_LINKED.includes(e.category);

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

const dollars = (c: number) => `${c < 0 ? "−" : ""}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;

/** Overwatch's warning rules, worded the way Athena says them. `today` is YYYY-MM-DD in the job's time zone. */
/** How far the forecast finish sits from the date it is measured against, in the CPM's working days when it has them. */
export function iorSlip(m: IorModel): { n: number; unit: "day" | "working day" } | null {
  if (!m.baseline_completion || !m.forecast_completion) return null;
  const wd = m.schedule_source?.work_days;
  return wd != null ? { n: wd, unit: "working day" } : { n: daysBetween(m.baseline_completion, m.forecast_completion), unit: "day" };
}

export const slipText = (s: { n: number; unit: string }) => `${s.n} ${s.unit}${Math.abs(s.n) === 1 ? "" : "s"}`;

/** What the forecast finish is compared to, in words. */
export function againstLabel(m: IorModel): string {
  const a = m.schedule_source?.against;
  return a === "baseline" ? "baseline finish" : a === "contract" ? "contract completion" : "baseline";
}

/** True when a risk's next review date has passed. */
export function isReviewOverdue(e: IorExposure, today: string): boolean {
  return !!e.next_review && daysBetween(e.next_review, today) > 0;
}

/** True when a risk's next review date falls before the day it was opened, a date entered wrong. */
export function isReviewBeforeOpened(e: IorExposure): boolean {
  return !!e.opened && !!e.next_review && daysBetween(e.opened, e.next_review) < 0;
}

export function iorFlags(m: IorModel, r: IorRollup, today: string): IorFlag[] {
  const out: IorFlag[] = [];
  if (!r.costKnown) out.push({ high: true, title: "No cost budget is saved.", detail: "Margin can't be read until one is." });
  if (r.costKnown && r.pendingCost > 2_500_000 && r.eHold < r.eTarget)
    out.push({ high: true, title: "Pending change orders aren't reserved.", detail: `${dollars(r.pendingCost)} of pending change-order cost is live and E-holds are ${dollars(r.eHold)}, under the ${dollars(r.eTarget)} I'd hold this phase.` });
  const slip = iorSlip(m);
  if (slip && slip.n > 0 && !m.exposures.some(isScheduleLinked))
    out.push({ high: false, title: `The schedule slipped ${slipText(slip)} with no schedule exposure logged.`, detail: "Put a dollar figure on it so the holds cover it." });
  // A risk holding nothing has nothing to review, so it never nags.
  const live = m.exposures.filter((e) => heldCents(e) > 0);
  for (const e of live) {
    if (!e.opened || e.next_review) continue;
    const age = daysBetween(e.opened, today);
    if (age > 30) out.push({ high: false, title: `${e.short} has gone ${age} days without a review.`, detail: "No next review date is set." });
  }
  // A review date before the open date is a typo, not a late review: ask for a real date.
  for (const e of live.filter(isReviewBeforeOpened))
    out.push({ high: false, title: `${e.short}'s review date is before it was opened.`, detail: `It was opened ${e.opened} with a review date of ${e.next_review}. Set the real review date.` });
  const overdue = live
    .filter((e) => isReviewOverdue(e, today) && !isReviewBeforeOpened(e))
    .map((e) => ({ e, late: daysBetween(e.next_review!, today) }))
    .sort((a, b) => b.late - a.late);
  if (overdue.length === 1) {
    const { e, late } = overdue[0];
    out.push({ high: false, title: `${e.short} is ${late} ${late === 1 ? "day" : "days"} past its review.`, detail: `The review was due ${e.next_review}. Review it and set the next date.` });
  } else if (overdue.length > 1) {
    const held = overdue.reduce((t, o) => t + heldCents(o.e), 0);
    const { e, late } = overdue[0];
    out.push({ high: false, title: `${overdue.length} risks are past their review date.`, detail: `They hold ${dollars(held)}. Furthest behind is ${e.short}, ${late} days late. Review them and set new dates.` });
  }
  const accepted = m.exposures.filter((e) => e.response === "accept").reduce((t, e) => t + heldCents(e), 0);
  if (accepted > r.originalContract * 0.01) out.push({ high: false, title: "Accepted risk is over 1% of the contract.", detail: `${dollars(accepted)} is marked accept. Confirm it can't be eliminated, recovered or offset.` });
  return out;
}

/** Athena's numbers for chat, the same figures the IOR page shows. */
export function iorModelText(m: IorModel, today: string): string[] {
  const r = iorRollup(m);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const signedAmt = (c: number) => (Math.round(c / 100) === 0 ? "$0" : `${c > 0 ? "+" : "−"}${dollars(Math.abs(c))}`);
  const lines = ["Indicated outcome (dollar risk × probability)"];
  lines.push(`Contract incl. approved change orders: ${dollars(r.signedContract)}`);
  if (r.costKnown) {
    lines.push(
      `Signed gross profit: ${dollars(r.signedGP)} · ${pct(r.signedPct)}`,
      `Indicated gross profit: ${dollars(r.indicatedGP)} · ${pct(r.indicatedPct)} of risk-adjusted contract ${dollars(r.forecastContract)}`,
      `Gap to signed: ${signedAmt(r.gap)}`,
      `Bridge: cost growth ${signedAmt(-r.costGrowth)}, pending change orders weighted ${signedAmt(r.weightedPendingContract - r.weightedPendingCost)}, E-holds ${signedAmt(-r.eHold)}, C-holds ${signedAmt(-r.cHold)}`,
      `Cost forecast: original cost budget ${dollars(r.originalCost)} ${signedAmt(r.costGrowth)} cost growth = base projected cost ${dollars(r.baseCost)} (original scope: cost to date plus forecast to complete), + approved change order cost ${dollars(r.approvedCost)}, + pending change order cost weighted ${dollars(r.weightedPendingCost)} = forecast cost ${dollars(r.forecastCost)}`,
      `Indicated gross profit = risk-adjusted contract ${dollars(r.forecastContract)} − forecast cost ${dollars(r.forecastCost)} − E-holds ${dollars(r.eHold)} − C-holds ${dollars(r.cHold)}`,
      "These are Overwatch's IOR figures, already calculated. Quote them as given. Cost growth and approved change order cost are separate money, even when the two amounts match; never net one against the other.",
    );
  } else lines.push("Gross profit: Not available, no cost budget is saved.");
  lines.push(`E-holds: ${dollars(r.eHold)} (guide ${r.ePct}% of remaining cost: ${dollars(r.eTarget)}) · C-holds: ${dollars(r.cHold)} (guide ${r.cPct}%: ${dollars(r.cTarget)})`);
  const slip = iorSlip(m);
  if (slip) {
    const src = m.schedule_source;
    const from = src ? ` (from the CPM${src.version != null ? ` v${src.version}` : ""}${src.data_date ? `, data date ${src.data_date}` : ""}; it outranks the imported dates)` : "";
    const how = slip.n > 0 ? `${slipText(slip)} late` : slip.n < 0 ? `${slipText({ ...slip, n: -slip.n })} early` : "on time";
    lines.push(`Finish${from}: forecast ${m.forecast_completion}, ${againstLabel(m)} ${m.baseline_completion} (${how})`);
  }
  if (m.exposures.length) {
    lines.push("Risks");
    for (const e of [...m.exposures].sort((a, b) => heldCents(b) - heldCents(a)))
      lines.push(`- ${e.title} · ${e.hold}-hold · ${dollars(Math.round(e.dollar_risk * 100))} × ${e.probability}% = ${dollars(heldCents(e))} held · ${e.response}${e.owner ? ` · ${e.owner}` : ""}${e.next_review ? ` · next review ${e.next_review}` : " · no review date"}${e.next_move ? ` · next move: ${e.next_move}` : ""}`);
  }
  const flags = iorFlags(m, r, today);
  if (flags.length) lines.push("Warnings", ...flags.map((f) => `- ${f.title} ${f.detail}`));
  return lines;
}
