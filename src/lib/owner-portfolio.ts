// Owner portfolio: company totals and job cards built only from what Athena already saves.
// Every figure is read from a job's own records; a job whose records cannot be read is left out of a
// total and counted as such. Nothing missing is treated as zero.
import type { AccountingReport } from "./accounting-report";
import type { PortfolioJob, PortfolioPayload } from "./report-pages";
import { cedarOutcome } from "./ior-outcome";
import { jobWorkingDays } from "./mcp/living";
import { addDays } from "./mcp/deadlines";

/** The money facts the portfolio needs from one job's accounting read. Cents throughout. */
export type JobMoney = {
  originalCents: number | null;
  changeCents: number | null;
  contractCents: number | null;
  billedCents: number | null;
  receivedCents: number | null;
  retainageCents: number | null;
  unpaidCents: number | null;
  costCents: number | null;
  budgetCents: number | null;
  oldestUnpaidDate: string | null;
};
export type JobMoneyRead = { ok: true; money: JobMoney } | { ok: false; reason: string };

export type Health = "risk" | "watch" | "good";
export const HEALTH_LABEL: Record<Health, string> = {
  risk: "At risk",
  watch: "Watch",
  good: "On track",
};

export type PortfolioCard = {
  jobId: string;
  jobNumber: string;
  name: string;
  pm: string | null;
  health: Health;
  reasons: string[];
  money: JobMoney | null;
  moneyReason: string | null;
  pctComplete: number | null;
  plannedMargin: number | null;
  plannedProfitCents: number | null;
  iorSaved: boolean;
  iorVersion: number | null;
  iorMargin: number | null;
  iorProfitCents: number | null;
  finish: string | null;
  finishBasis: "tia" | "contract" | null;
  slipWorkingDays: number;
  spills: boolean;
  leftCents: number | null;
  leftThisYearCents: number | null;
  leftNextYearCents: number | null;
  receivableDays: number | null;
  scheduleAgeDays: number | null;
};

export type PortfolioTotals = {
  activeJobs: number;
  readJobs: number;
  contractCents: number;
  originalCents: number;
  changeCents: number;
  billedCents: number;
  receivedCents: number;
  retainageCents: number;
  unpaidCents: number;
  pctComplete: number | null;
  costCents: number;
  costJobs: number;
  budgetCents: number;
  budgetJobs: number;
  plannedProfitCents: number | null;
  plannedMargin: number | null;
  plannedJobs: number;
  iorSavedJobs: number;
  iorOutcomeJobs: number;
  iorProfitCents: number | null;
  leftThisYearCents: number;
  leftNextYearCents: number;
  leftNoFinishCents: number;
  finishingThisYear: PortfolioCard[];
  runningIntoNextYear: PortfolioCard[];
  noFinish: PortfolioCard[];
  counts: Record<Health, number>;
};

export type OwnerPortfolio = {
  company: string;
  today: string;
  year: number;
  active: PortfolioCard[];
  estimating: { jobId: string; jobNumber: string; name: string; pm: string | null }[];
  totals: PortfolioTotals;
};

const DAY_MS = 86_400_000;
const isDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}/.test(v) &&
  Number.isFinite(Date.parse(`${v.slice(0, 10)}T00:00:00Z`));
const dayNum = (v: string) => Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((dayNum(b) - dayNum(a)) / DAY_MS);
const safe = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isSafeInteger(n);
const metric = (r: AccountingReport, key: string) =>
  r.metrics.find((m) => m.key === key)?.cents ?? null;

/** Pulls the portfolio's money facts out of one job's accounting report. */
export function jobMoneyFromReport(report: AccountingReport): JobMoney {
  const contract = report.recordedContract ?? null;
  const billed = metric(report, "billed_gross");
  const credits = metric(report, "credits");
  const unpaidRows = report.rows.filter(
    (r) => r.kind === "billed" && safe(r.balanceCents) && r.balanceCents > 0 && isDate(r.date),
  );
  const oldest = unpaidRows.map((r) => r.date!.slice(0, 10)).sort()[0] ?? null;
  return {
    originalCents: safe(contract?.original_cents) ? contract!.original_cents! : null,
    changeCents: safe(contract?.recorded_change_cents) ? contract!.recorded_change_cents! : null,
    contractCents: safe(contract?.approved_cents) ? contract!.approved_cents! : null,
    billedCents: safe(billed) ? (safe(credits) ? billed - credits : billed) : null,
    receivedCents: metric(report, "receipts"),
    retainageCents: metric(report, "retainage"),
    unpaidCents: metric(report, "unpaid_invoices"),
    costCents: metric(report, "actual_costs"),
    budgetCents: metric(report, "budget"),
    oldestUnpaidDate: oldest,
  };
}

function iorOutcomeFor(job: PortfolioJob, contractCents: number | null) {
  if (!job.ior || contractCents == null || contractCents <= 0) return null;
  const outcome = cedarOutcome(job.job_id, {
    version: job.ior.version,
    contract_total: contractCents / 100,
    data: job.ior.data,
  });
  return outcome && outcome.indicated != null && outcome.contract
    ? { profit: outcome.indicated, margin: outcome.indicated / outcome.contract }
    : null;
}

function cardFor(
  job: PortfolioJob,
  read: JobMoneyRead | undefined,
  today: string,
  yearEnd: string,
): PortfolioCard {
  const money = read?.ok ? read.money : null;
  const contract = money?.contractCents ?? null;
  const billed = money?.billedCents ?? null;
  const tia = job.cpm?.tia;
  const tiaFinish = isDate(tia?.updated_completion) ? tia!.updated_completion!.slice(0, 10) : null;
  const contractFinish = isDate(job.completion_date) ? job.completion_date!.slice(0, 10) : null;
  const finish = tiaFinish ?? contractFinish;
  const slip =
    isDate(tia?.prior_completion) && tiaFinish && tiaFinish > tia!.prior_completion!.slice(0, 10)
      ? jobWorkingDays(addDays(tia!.prior_completion!.slice(0, 10), 1), tiaFinish, tia!.holidays)
      : 0;
  const pct = contract && contract > 0 && billed != null ? Math.max(0, billed / contract) : null;
  const left = contract != null && billed != null ? Math.max(0, contract - billed) : null;
  const spills = !!finish && finish > yearEnd;
  let leftThisYear: number | null = null,
    leftNextYear: number | null = null;
  if (left != null && finish) {
    if (!spills) leftThisYear = left;
    else {
      // Straight-line by calendar days from today to the finish; a cost-loaded schedule would replace this.
      const toEnd = Math.max(0, daysBetween(today, yearEnd)),
        toFinish = Math.max(1, daysBetween(today, finish));
      leftThisYear = Math.round(left * Math.min(1, toEnd / toFinish));
      leftNextYear = left - leftThisYear;
    }
  }
  const budget = money?.budgetCents ?? null;
  const cost = money?.costCents ?? null;
  const planned =
    contract && contract > 0 && budget != null ? (contract - budget) / contract : null;
  const ior = iorOutcomeFor(job, contract);
  const receivableDays = money?.oldestUnpaidDate
    ? Math.max(0, daysBetween(money.oldestUnpaidDate, today))
    : null;
  const scheduleStamp = job.cpm?.data_date ?? job.cpm?.updated_at ?? null;
  const scheduleAge = isDate(scheduleStamp)
    ? Math.max(0, daysBetween(scheduleStamp.slice(0, 10), today))
    : null;

  const reasons: string[] = [];
  let level = 0;
  const flag = (n: number, text: string) => {
    level = Math.max(level, n);
    reasons.push(text);
  };
  if (!read?.ok) flag(1, "Money records couldn't be read");
  if (slip > 10) flag(2, `Finish ${slip} working days late`);
  else if (slip > 0) flag(1, `Finish ${slip} working days late`);
  if (cost != null && budget != null && budget > 0) {
    if (cost > budget) flag(2, "Cost to date is over budget");
    else if (pct != null) {
      const gap = cost / budget - pct;
      if (gap > 0.2)
        flag(
          2,
          `Cost ${Math.round((cost / budget) * 100)}% of budget at ${Math.round(pct * 100)}% billed`,
        );
      else if (gap > 0.1)
        flag(
          1,
          `Cost ${Math.round((cost / budget) * 100)}% of budget at ${Math.round(pct * 100)}% billed`,
        );
    }
  } else if (read?.ok && budget == null) flag(1, "No cost budget saved");
  if (receivableDays != null && receivableDays > 60)
    flag(2, `Invoice unpaid ${receivableDays} days`);
  else if (receivableDays != null && receivableDays > 30)
    flag(1, `Invoice unpaid ${receivableDays} days`);
  if (!job.cpm) flag(1, "No schedule saved");
  else if (scheduleAge != null && scheduleAge > 30)
    flag(1, `Schedule not updated in ${scheduleAge} days`);
  const health: Health = level === 2 ? "risk" : level === 1 ? "watch" : "good";

  return {
    jobId: job.job_id,
    jobNumber: job.job_number,
    name: job.name,
    pm: job.pm ?? null,
    health,
    reasons,
    money,
    moneyReason: read && !read.ok ? read.reason : null,
    pctComplete: pct,
    plannedMargin: planned,
    plannedProfitCents: contract != null && budget != null ? contract - budget : null,
    iorSaved: !!job.ior,
    iorVersion: job.ior?.version ?? null,
    iorMargin: ior?.margin ?? null,
    iorProfitCents: ior?.profit ?? null,
    finish,
    finishBasis: tiaFinish ? "tia" : contractFinish ? "contract" : null,
    slipWorkingDays: slip,
    spills,
    leftCents: left,
    leftThisYearCents: leftThisYear,
    leftNextYearCents: leftNextYear,
    receivableDays,
    scheduleAgeDays: scheduleAge,
  };
}

const HEALTH_ORDER: Record<Health, number> = { risk: 0, watch: 1, good: 2 };
const add = (cards: PortfolioCard[], pick: (c: PortfolioCard) => number | null | undefined) =>
  cards.reduce((s, c) => s + (pick(c) ?? 0), 0);

/**
 * A job counts as active once it has a recorded contract value or billing. Jobs with neither are
 * listed as estimating and kept out of every total, because an estimate is saved as a job.
 */
export function buildOwnerPortfolio(
  payload: PortfolioPayload,
  reads: Record<string, JobMoneyRead | undefined>,
  today: string,
): OwnerPortfolio {
  const year = Number(today.slice(0, 4));
  const yearEnd = `${year}-12-31`;
  const active: PortfolioCard[] = [];
  const estimating: OwnerPortfolio["estimating"] = [];
  for (const job of payload.jobs ?? []) {
    const read = reads[job.job_id];
    const m = read?.ok ? read.money : null;
    const isActive =
      !read?.ok ||
      (m!.contractCents != null && m!.contractCents > 0) ||
      (m!.billedCents != null && m!.billedCents > 0);
    if (isActive) active.push(cardFor(job, read, today, yearEnd));
    else
      estimating.push({
        jobId: job.job_id,
        jobNumber: job.job_number,
        name: job.name,
        pm: job.pm ?? null,
      });
  }
  active.sort(
    (a, b) =>
      HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
      (b.money?.contractCents ?? 0) - (a.money?.contractCents ?? 0),
  );

  const withContract = active.filter(
    (c) => c.money?.contractCents != null && c.money.billedCents != null,
  );
  const contract = add(withContract, (c) => c.money!.contractCents);
  const billedForPct = add(withContract, (c) => c.money!.billedCents);
  const withCost = active.filter((c) => c.money?.costCents != null);
  const withBudget = active.filter((c) => c.money?.budgetCents != null);
  const planned = active.filter((c) => c.plannedProfitCents != null && c.money?.contractCents);
  const plannedContract = add(planned, (c) => c.money!.contractCents);
  const plannedProfit = add(planned, (c) => c.plannedProfitCents);
  const outcomes = active.filter((c) => c.iorProfitCents != null);
  const counts: Record<Health, number> = { risk: 0, watch: 0, good: 0 };
  active.forEach((c) => counts[c.health]++);
  const byFinish = (a: PortfolioCard, b: PortfolioCard) =>
    (a.finish ?? "").localeCompare(b.finish ?? "");

  return {
    company: payload.company ?? "",
    today,
    year,
    active,
    estimating,
    totals: {
      activeJobs: active.length,
      readJobs: active.filter((c) => c.money).length,
      contractCents: add(active, (c) => c.money?.contractCents),
      originalCents: add(active, (c) => c.money?.originalCents),
      changeCents: add(active, (c) => c.money?.changeCents),
      billedCents: add(active, (c) => c.money?.billedCents),
      receivedCents: add(active, (c) => c.money?.receivedCents),
      retainageCents: add(active, (c) => c.money?.retainageCents),
      unpaidCents: add(active, (c) => c.money?.unpaidCents),
      pctComplete: contract > 0 ? billedForPct / contract : null,
      costCents: add(withCost, (c) => c.money!.costCents),
      costJobs: withCost.length,
      budgetCents: add(withBudget, (c) => c.money!.budgetCents),
      budgetJobs: withBudget.length,
      plannedProfitCents: planned.length ? plannedProfit : null,
      plannedMargin: plannedContract > 0 ? plannedProfit / plannedContract : null,
      plannedJobs: planned.length,
      iorSavedJobs: active.filter((c) => c.iorSaved).length,
      iorOutcomeJobs: outcomes.length,
      iorProfitCents: outcomes.length ? add(outcomes, (c) => c.iorProfitCents) : null,
      leftThisYearCents: add(active, (c) => c.leftThisYearCents),
      leftNextYearCents: add(active, (c) => c.leftNextYearCents),
      leftNoFinishCents: add(
        active.filter((c) => !c.finish),
        (c) => c.leftCents,
      ),
      finishingThisYear: active.filter((c) => c.finish && !c.spills).sort(byFinish),
      runningIntoNextYear: active.filter((c) => c.spills).sort(byFinish),
      noFinish: active.filter((c) => !c.finish),
      counts,
    },
  };
}

export type PortfolioSort = "health" | "contract" | "finish" | "margin" | "number";
export function sortCards(cards: PortfolioCard[], sort: PortfolioSort): PortfolioCard[] {
  const list = [...cards];
  const num = (v: number | null | undefined, fallback: number) => (v == null ? fallback : v);
  if (sort === "contract")
    return list.sort((a, b) => num(b.money?.contractCents, -1) - num(a.money?.contractCents, -1));
  if (sort === "finish")
    return list.sort((a, b) => (a.finish ?? "9999").localeCompare(b.finish ?? "9999"));
  if (sort === "margin")
    return list.sort(
      (a, b) => num(a.iorMargin ?? a.plannedMargin, 9) - num(b.iorMargin ?? b.plannedMargin, 9),
    );
  if (sort === "number")
    return list.sort((a, b) =>
      a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true }),
    );
  return list.sort(
    (a, b) =>
      HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
      num(b.money?.contractCents, 0) - num(a.money?.contractCents, 0),
  );
}

/** Short money for tiles and cards: $2.64M, $412K, $950. */
export function shortMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Not available";
  const v = cents / 100,
    a = Math.abs(v),
    sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}
/** Whole-dollar money for the drill-in. */
export function fullMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Not available";
  const v = Math.round(cents / 100);
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US")}`;
}
export function percent(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "Not available" : `${(v * 100).toFixed(digits)}%`;
}
export function shortDay(v: string | null | undefined): string {
  if (!isDate(v)) return "No date";
  return new Date(dayNum(v)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
