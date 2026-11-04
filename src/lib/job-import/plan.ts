// Turns a source-neutral import (model.ts) plus what is already in Athena into
// the one package Athena saves, and the review card the member says yes to.
// The package shape is what public.mcp_job_import_apply reads.
import type { CardModel, CardRow, CardSection } from "../mcp/cards/model";
import { importJob, type ImportJob, type ImportSource } from "./model";

export type ImportContext = {
  job_exists: boolean;
  job_id?: string;
  scope?: string | null;
  name?: string;
  sov_fee_pct?: number | null;
  sov_basis?: string | null;
  has_official_sov?: boolean;
  contract_keys?: string[];
  budget_keys?: string[];
  /** lower(number)#revision */
  submittals?: string[];
  daily_dates?: string[];
  /** kind:source_id already brought in from this source */
  imported?: string[];
};

export type ImportPackage = {
  version: 1;
  source: { system: ImportSource; label: string; exported_at: string | null };
  job: { source_id: string; name: string; pm_name: string | null; pm_email: string | null };
  billing: { last_application: string | null; period_to: string | null };
  contract_facts: Record<string, unknown>;
  sov: { basis: string; lines: Record<string, SovFact> } | null;
  opening_balances: OpeningBalance[];
  budget: Record<string, { description: string; amount: number }>;
  change_orders: PlannedChangeOrder[];
  submittals: { source_id: string; payload: Record<string, unknown> }[];
  dailies: PlannedDaily[];
};

type SovFact = { description: string; billable_value: number; cost_codes: string[] };
type OpeningBalance = {
  sov_key: string;
  scheduled_cents: number;
  work_to_date_cents: number;
  stored_to_date_cents: number;
  retained_cents: number;
};
type PlannedChangeOrder = {
  source_id: string;
  number: string;
  title: string;
  condition: string;
  scope: string;
  citation: string;
  amount_cents: number;
  schedule_days: number | null;
};
type PlannedDaily = {
  source_id: string;
  date: string;
  weather: string;
  manpower: string;
  subs: string;
  deliveries: string;
  issues: string;
  delays: string;
  safety: string;
  transcript: string;
  lines: {
    work: string;
    qty: number;
    unit: string;
    crew: number;
    hours: number;
    pct_complete: number | null;
  }[];
};

export type ImportPlan = {
  package: ImportPackage;
  counts: Record<string, number>;
  kept: string[];
  held: string[];
  fixes: string[];
  totals: {
    contract_cents: number | null;
    approved_co_cents: number;
    sov_cents: number;
    billed_cents: number;
    retained_cents: number;
  };
};

const SOURCE_NAME: Record<ImportSource, string> = {
  overwatch: "Overwatch",
  procore: "Procore",
  buildertrend: "Buildertrend",
  spreadsheet: "the spreadsheet",
};
const DIVISION_ITEM = /^\d{2}\.\d{2,3}$/;

export const usd = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dollars = (cents: number) => Math.round(cents) / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** SOV item numbers: the source's own CSI-style item when every line has a unique one, else 01, 02, ... */
function sovKeys(lines: ImportJob["sov"]): string[] {
  const codes = lines.map((l) => (l.cost_code ?? "").trim());
  if (codes.every((c) => DIVISION_ITEM.test(c)) && new Set(codes).size === codes.length)
    return codes;
  const width = Math.max(2, String(lines.length).length);
  return lines.map((_, i) => String(i + 1).padStart(width, "0"));
}

export function planImport(raw: ImportJob, ctx: ImportContext): ImportPlan {
  const job = importJob.parse(raw);
  const from = SOURCE_NAME[job.source.system];
  const done = new Set(ctx.imported ?? []);
  const kept: string[] = [];
  const held: string[] = [];
  const fixes = [...job.problems];

  // Contract
  const approved = job.change_orders.filter((c) => c.status === "approved");
  const approvedCents = approved.reduce((s, c) => s + c.amount_cents, 0);
  const contractFacts: Record<string, unknown> = {};
  if (job.contract.original_cents != null) {
    contractFacts.contract_value = dollars(job.contract.original_cents);
    contractFacts.contract_value_basis = `Original contract as recorded in ${from}${job.source.exported_at ? ` (export ${job.source.exported_at.slice(0, 10)})` : ""}.`;
    if (approved.length) contractFacts.executed_change_orders = dollars(approvedCents);
  }
  if (job.contract.retainage_pct != null)
    contractFacts.retainage = `${job.contract.retainage_pct}%`;
  if (job.job.customer) contractFacts.customer = job.job.customer;
  if (job.job.completion_date) contractFacts.substantial_completion = job.job.completion_date;
  for (const key of Object.keys(contractFacts)) {
    if ((ctx.contract_keys ?? []).includes(key)) {
      kept.push(`Contract ${key.replace(/_/g, " ")} already on the job; kept Athena's.`);
      delete contractFacts[key];
    }
  }

  // SOV, opening balances, budget
  let sov: ImportPackage["sov"] = null;
  const opening: OpeningBalance[] = [];
  const sovCents = job.sov.reduce((s, l) => s + l.scheduled_cents, 0);
  const billedCents = job.sov.reduce(
    (s, l) => s + (l.work_to_date_cents ?? 0) + (l.stored_to_date_cents ?? 0),
    0,
  );
  const retainedCents = job.sov.reduce((s, l) => s + (l.retained_cents ?? 0), 0);
  if (job.sov.length) {
    if (ctx.has_official_sov) {
      kept.push(
        "The job already has an SOV in Athena; the imported SOV and billing balances are not written. Change it by change order.",
      );
    } else if (ctx.sov_fee_pct != null && ctx.sov_fee_pct !== 0) {
      kept.push("The job already has a fee percent in Athena; the imported SOV is not written.");
    } else if (job.sov.some((l) => l.scheduled_cents < 0)) {
      const neg = job.sov
        .filter((l) => l.scheduled_cents < 0)
        .map((l) => l.description)
        .join("; ");
      fixes.push(
        `An SOV line is negative (${neg}). Athena's SOV can't hold a negative line, so the SOV and billing balances are left out until that credit is allocated to a line in ${from}.`,
      );
    } else {
      const keys = sovKeys(job.sov);
      const lines: Record<string, SovFact> = {};
      job.sov.forEach((l, i) => {
        lines[keys[i]] = {
          description: l.description || l.cost_code || `Line ${keys[i]}`,
          billable_value: dollars(l.scheduled_cents),
          cost_codes: l.cost_code ? [l.cost_code] : [],
        };
        if (
          l.work_to_date_cents != null ||
          l.stored_to_date_cents != null ||
          l.retained_cents != null
        )
          opening.push({
            sov_key: keys[i],
            scheduled_cents: l.scheduled_cents,
            work_to_date_cents: l.work_to_date_cents ?? 0,
            stored_to_date_cents: l.stored_to_date_cents ?? 0,
            retained_cents: l.retained_cents ?? 0,
          });
      });
      sov = {
        basis: `Imported from ${from}. Scheduled values include fee and approved change orders.`,
        lines,
      };
    }
    const contractTotal =
      job.contract.original_cents == null ? null : job.contract.original_cents + approvedCents;
    if (contractTotal != null && contractTotal !== sovCents)
      fixes.push(
        `The SOV adds up to ${usd(sovCents)} but the contract plus approved change orders is ${usd(contractTotal)}. Check it in ${from} before you say yes.`,
      );
  }
  const budget: ImportPackage["budget"] = {};
  for (const l of job.sov) {
    if (l.budget_cents == null) continue;
    const key = (l.cost_code || l.description).slice(0, 120);
    if (!key) continue;
    const prior = budget[key];
    budget[key] = {
      description: prior ? prior.description : l.description,
      amount: dollars(Math.round((prior?.amount ?? 0) * 100) + l.budget_cents),
    };
  }
  for (const key of Object.keys(budget)) {
    if ((ctx.budget_keys ?? []).includes(key)) {
      delete budget[key];
      kept.push(`Budget cost code ${key} already on the job; kept Athena's.`);
    }
  }

  // Change orders: approved ones are in the SOV and contract; open ones become priced PCO drafts.
  const changeOrders: PlannedChangeOrder[] = [];
  for (const c of job.change_orders) {
    if (c.status !== "pending") continue;
    if (done.has(`change_order:${c.source_id}`)) {
      kept.push(`Change order ${c.number} came in on an earlier import.`);
      continue;
    }
    const citation = `${from} change order ${c.number}${c.date ? ` dated ${c.date}` : ""}, pending, ${usd(c.amount_cents)}`;
    changeOrders.push({
      source_id: c.source_id,
      number: c.number,
      title: c.title,
      condition: `Open change order carried over from ${from} (${c.number}).`,
      scope: c.description || c.title,
      citation,
      amount_cents: c.amount_cents,
      schedule_days: c.schedule_days,
    });
  }
  const closedCos = job.change_orders.filter(
    (c) => c.status === "rejected" || c.status === "void",
  ).length;
  if (closedCos)
    held.push(
      `${plural(closedCos, "rejected or void change order")}: history only, left in ${from}.`,
    );

  // Submittals
  const onJob = new Set(ctx.submittals ?? []);
  const submittals: ImportPackage["submittals"] = [];
  for (const s of job.submittals) {
    if (done.has(`submittal:${s.source_id}`)) continue;
    if (onJob.has(`${s.number.toLowerCase()}#${s.revision}`)) {
      kept.push(`Submittal ${s.number} rev ${s.revision} already on the job; kept Athena's.`);
      continue;
    }
    if (!s.spec_section) {
      fixes.push(`Submittal ${s.number} has no spec section; it is left out until one is added.`);
      continue;
    }
    const { source_id, ...payload } = s;
    submittals.push({ source_id, payload: { ...payload, required: true } });
  }

  // Dailies: Athena needs at least one work line with quantity, unit, crew and hours.
  const dailyDates = new Set(ctx.daily_dates ?? []);
  const dailies: PlannedDaily[] = [];
  let noLines = 0;
  for (const d of job.dailies) {
    if (done.has(`daily:${d.source_id}`)) continue;
    if (dailyDates.has(d.date)) {
      kept.push(`A daily for ${d.date} is already on the job; kept Athena's.`);
      continue;
    }
    if (!d.lines.length) {
      noLines++;
      continue;
    }
    const { source_id, date, work_summary, lines, ...sections } = d;
    dailies.push({
      source_id,
      date,
      ...sections,
      transcript:
        `Imported from ${from}.${work_summary ? ` Work performed: ${work_summary}` : ""}`.slice(
          0,
          8000,
        ),
      lines: lines.map((l) => ({ ...l })),
    });
  }
  if (noLines)
    held.push(
      `${plural(noLines, "daily", "dailies")} with no work quantities: Athena dailies need quantity, unit, crew and hours, so these stay in ${from}.`,
    );

  // Not brought in yet
  if (job.rfis.length) {
    const open = job.rfis.filter((r) => r.open).length;
    held.push(
      `${plural(job.rfis.length, "RFI")} (${open} open): Athena's RFI log only tracks RFIs it sends, so these stay in ${from} for now.`,
    );
  }
  if (job.schedule.length)
    held.push(
      `${plural(job.schedule.length, "schedule activity", "schedule activities")}: the CPM comes in through Athena's schedule step, which ties activities to the SOV.`,
    );
  // Held kinds are already plural ("exposures", "Earlier pay applications").
  for (const h of job.held) {
    const kind = h.kind.toLowerCase();
    held.push(`${plural(h.count, kind.replace(/s$/, ""), kind)}: ${h.why}`);
  }

  const pkg: ImportPackage = {
    version: 1,
    source: {
      system: job.source.system,
      label: job.source.label,
      exported_at: job.source.exported_at,
    },
    job: {
      source_id: job.job.source_id,
      name: job.job.name || ctx.name || job.job.job_number,
      pm_name: job.job.pm_name,
      pm_email: job.job.pm_email,
    },
    billing: job.billing,
    contract_facts: contractFacts,
    sov,
    opening_balances: sov ? opening : [],
    budget,
    change_orders: changeOrders,
    submittals,
    dailies,
  };
  return {
    package: pkg,
    counts: {
      job: ctx.job_exists ? 0 : 1,
      contract_facts: Object.keys(contractFacts).length,
      sov_lines: sov ? Object.keys(sov.lines).length : 0,
      opening_balances: pkg.opening_balances.length,
      budget_lines: Object.keys(budget).length,
      change_orders: changeOrders.length,
      submittals: submittals.length,
      dailies: dailies.length,
    },
    kept,
    held,
    fixes,
    totals: {
      contract_cents: job.contract.original_cents,
      approved_co_cents: approvedCents,
      sov_cents: sovCents,
      billed_cents: billedCents,
      retained_cents: retainedCents,
    },
  };
}

export const nothingToSave = (plan: ImportPlan) => Object.values(plan.counts).every((n) => n === 0);

const listSection = (
  heading: string,
  lines: string[],
  tone: CardRow["tone"],
): CardSection | null =>
  lines.length
    ? {
        heading,
        kind: "list",
        rows: lines
          .slice(0, 25)
          .map((l) => ({ cells: [l], tone }))
          .concat(lines.length > 25 ? [{ cells: [`and ${lines.length - 25} more`], tone }] : []),
      }
    : null;

export function reviewCard(plan: ImportPlan, jobNumber: string, jobExists: boolean): CardModel {
  const p = plan.package;
  const from = SOURCE_NAME[p.source.system];
  const c = plan.counts;
  const create: string[] = [];
  if (!jobExists)
    create.push(
      `New job ${jobNumber}, ${p.job.name}${p.job.pm_name ? `, PM ${p.job.pm_name}` : ""}`,
    );
  if (c.contract_facts)
    create.push(
      `Contract terms: ${Object.keys(p.contract_facts)
        .map((k) => k.replace(/_/g, " "))
        .join(", ")}`,
    );
  if (c.sov_lines)
    create.push(`SOV: ${plural(c.sov_lines, "line")}, ${usd(plan.totals.sov_cents)}`);
  if (c.opening_balances)
    create.push(
      `Billed to date carried in: ${usd(plan.totals.billed_cents)}, retainage held ${usd(plan.totals.retained_cents)}${p.billing.last_application ? ` (through pay app ${p.billing.last_application})` : ""}`,
    );
  if (c.budget_lines) create.push(`Budget: ${plural(c.budget_lines, "cost code")}`);
  if (c.change_orders)
    create.push(`${plural(c.change_orders, "open change order")} as priced PCO drafts, not sent`);
  if (c.submittals) create.push(`Submittal log: ${plural(c.submittals, "row")}`);
  if (c.dailies) create.push(`${plural(c.dailies, "daily report", "daily reports")}`);
  const sections = [
    listSection("Will be saved", create, "known"),
    p.change_orders.length
      ? {
          heading: "Open change orders",
          kind: "table" as const,
          columns: ["CO", "Title", "Amount"],
          rows: p.change_orders
            .slice(0, 15)
            .map((co) => ({ cells: [co.number, co.title, usd(co.amount_cents)] })),
        }
      : null,
    listSection("Kept as it is in Athena", plan.kept, "known"),
    listSection(`Staying in ${from} for now`, plan.held, "unknown"),
    listSection("Check before you say yes", plan.fixes, "action"),
  ].filter((s): s is CardSection => !!s);
  const kpis = [
    plan.totals.contract_cents != null
      ? {
          label: "Contract",
          value: usd(plan.totals.contract_cents + plan.totals.approved_co_cents),
        }
      : null,
    c.sov_lines ? { label: "SOV lines", value: String(c.sov_lines) } : null,
    c.opening_balances ? { label: "Billed to date", value: usd(plan.totals.billed_cents) } : null,
    { label: "Open COs", value: String(c.change_orders) },
  ].filter((k): k is { label: string; value: string } => !!k);
  const empty = nothingToSave(plan);
  return {
    state: empty ? "result" : "ask",
    title: `Import job ${jobNumber} from ${from}`,
    show_state: false,
    job: `${jobNumber} · ${p.job.name}`,
    kpis,
    sections,
    ask: empty
      ? null
      : { prompt: `Save all of this to job ${jobNumber}? Nothing is sent to anyone.` },
    next_move: empty
      ? "Nothing new to bring in from this export."
      : "Say yes to save it all at once, or say what to change.",
  };
}

export function appliedCard(
  result: Record<string, unknown>,
  jobNumber: string,
  from: ImportSource,
): CardModel {
  const n = (k: string) => Number(result[k] ?? 0);
  const rows = [
    result.job_created ? `Created job ${jobNumber}` : null,
    n("contract_facts") ? plural(n("contract_facts"), "contract term") : null,
    n("sov_lines") ? `SOV: ${plural(n("sov_lines"), "line")}` : null,
    n("opening_balances")
      ? `Billing balances for ${plural(n("opening_balances"), "SOV line")}`
      : null,
    n("budget_lines") ? `Budget: ${plural(n("budget_lines"), "cost code")}` : null,
    n("change_orders") ? `${plural(n("change_orders"), "PCO draft")}, not sent` : null,
    n("submittals") ? `Submittal log: ${plural(n("submittals"), "row")}` : null,
    n("dailies") ? plural(n("dailies"), "daily report", "daily reports") : null,
  ].filter((r): r is string => !!r);
  const skipped = Array.isArray(result.skipped) ? (result.skipped as string[]) : [];
  return {
    state: "result",
    title: result.already_applied
      ? `Job ${jobNumber} import was already saved`
      : `Job ${jobNumber} imported from ${SOURCE_NAME[from]}`,
    show_state: false,
    job: jobNumber,
    sections: [
      listSection("Saved", rows.length ? rows : ["Nothing new"], "known"),
      listSection("Kept as it was", skipped, "known"),
    ].filter((s): s is CardSection => !!s),
    next_move: n("change_orders")
      ? "Open change orders are drafts. Review each one before it goes to the owner."
      : null,
  };
}
