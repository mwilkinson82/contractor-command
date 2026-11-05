// Turns a source-neutral import (model.ts) plus what is already in Athena into
// the one package Athena saves, and the review card the member says yes to.
// The package shape is what public.mcp_job_import_apply reads.
import type { CardModel, CardRow, CardSection } from "../mcp/cards/model";
import { heldCents, readIorModel } from "../ior-model";
import { checkSave, type Activity, type LivingData } from "../mcp/living";
import { prepareSchedule, ScheduleInputError } from "../mcp/schedule-control";
import { importJob, type ImportArchive, type ImportJob, type ImportSource } from "./model";
import { archiveGroup } from "./overwatch";

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
  /** True when the job already has an IOR living report (any version). */
  has_ior?: boolean;
  /** source_table:source_id already in the job's import archive from this source */
  archived?: string[];
  /** True when the job already has a CPM living report (any version). */
  has_cpm?: boolean;
};

/**
 * Stage refuses a package over 6,000,000 bytes (mcp_job_import_stage). The MCP
 * export_text is capped at 2,000,000 characters, so a whole-job archive fits;
 * this guard keeps a margin and says so plainly if it ever doesn't.
 */
export const PACKAGE_MAX_BYTES = 5_500_000;

export type ImportPackage = {
  /**
   * 1: the original package. 2: adds ior and archive (migration 20261105090000).
   * 3: adds schedule, rfis, decisions, claims and inspections (20261105100000 to 20261105100300, the job logs parts).
   */
  version: 1 | 2 | 3;
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
  ior?: PlannedIor | null;
  /** Rows to add to the job's read-only archive: table -> source id -> row. */
  archive?: ImportArchive | null;
  /** Version 1 of the job's CPM, organized from the source (no cost loading). */
  schedule?: PlannedSchedule | null;
  rfis?: { source_id: string; payload: Record<string, unknown> }[];
  decisions?: PlannedLog[];
  claims?: (PlannedLog & { events: { source_id: string; payload: Record<string, unknown> }[] })[];
  inspections?: (PlannedLog & { parent: string | null })[];
};

type PlannedSchedule = {
  source_id: string;
  data_date: string;
  what: string;
  activity_count: number;
  milestones: number;
  data: LivingData;
};
/** change_order: source_id of a change order brought in earlier, resolved at save. */
type PlannedLog = {
  source_id: string;
  change_order: string | null;
  payload: Record<string, unknown>;
};

type PlannedIor = {
  source_id: string;
  data_date: string | null;
  what: string;
  /** Exactly data.ior_model for version 1 of the job's IOR living report. */
  model: Record<string, unknown>;
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
  /** Our cost, for the card and the IOR only. The PCO's price to the owner never includes it. */
  cost_cents: number | null;
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
  /** What the archive keeps that isn't otherwise live in Athena, said plainly. */
  archived: string[];
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
  const archivedNotes: string[] = [];
  const fixes = [...job.problems];
  const inArchive = (table: string) => Object.keys(job.archive[table] ?? {}).length > 0;

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
      cost_cents: c.cost_cents,
    });
  }
  const closedCos = job.change_orders.filter(
    (c) => c.status === "rejected" || c.status === "void",
  ).length;
  if (closedCos) {
    if (inArchive("change_orders"))
      archivedNotes.push(`${plural(closedCos, "rejected or void change order")}: history only.`);
    else
      held.push(
        `${plural(closedCos, "rejected or void change order")}: history only, left in ${from}.`,
      );
  }

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
  if (noLines) {
    if (inArchive("daily_reports"))
      archivedNotes.push(
        `${plural(noLines, "daily", "dailies")} with no work quantities: Athena dailies need quantity, unit, crew and hours.`,
      );
    else
      held.push(
        `${plural(noLines, "daily", "dailies")} with no work quantities: Athena dailies need quantity, unit, crew and hours, so these stay in ${from}.`,
      );
  }

  // RFIs: recorded in Athena's RFI log as sent and/or answered outside Athena.
  // Never sent from Athena, so they carry no send receipt and say so.
  const rfis: NonNullable<ImportPackage["rfis"]> = [];
  for (const r of job.rfis) {
    if (done.has(`rfi:${r.source_id}`)) continue;
    const answered = r.answered_on ?? null;
    rfis.push({
      source_id: r.source_id,
      payload: {
        title: r.title || `RFI ${r.number}`,
        question: r.question || r.title || `RFI ${r.number}`,
        condition: r.title || r.question || `RFI ${r.number}`,
        source: from,
        source_number: r.number,
        sent_on: r.sent_on,
        due_date: r.due_on,
        answer_text: answered
          ? r.answer_text || `Returned in ${from} on ${answered}; no answer text was recorded.`
          : null,
        answered_on: answered,
        answered_by: r.answered_by ?? null,
      },
    });
  }

  // Schedule: version 1 of the job's CPM through the organize path, only when
  // the job has none. IDs, logic, durations and dates as reported; no dollars.
  let schedule: PlannedSchedule | null = null;
  if (job.schedule.length) {
    if (ctx.has_cpm) kept.push("The job already has a CPM in Athena; kept Athena's.");
    else if (done.has(`schedule:${job.job.source_id}`))
      kept.push("The schedule came in on an earlier import.");
    else {
      const dataDate =
        job.source.exported_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const notes: string[] = [];
      const activities: Activity[] = job.schedule.map((a) => {
        let actualFinish = a.actual_finish ?? null;
        if (actualFinish && !a.actual_start) {
          notes.push(
            `${a.id} has an actual finish but no actual start in ${from}; the finish is left off.`,
          );
          actualFinish = null;
        }
        const done100 = !!actualFinish;
        if (done100 && a.pct_complete != null && a.pct_complete !== 100)
          notes.push(
            `${a.id} has an actual finish, so it comes in 100% complete (${from} showed ${a.pct_complete}%).`,
          );
        return {
          id: a.id,
          name: a.name || a.id,
          duration: a.milestone ? 0 : a.duration_days,
          start: a.start,
          finish: a.finish,
          predecessors: a.predecessors.map((id) => ({ id, type: "FS" as const, lag: 0 })),
          total_float: null,
          critical: null,
          pct_complete: done100 ? 100 : a.pct_complete,
          value: null,
          sov_line: null,
          cost_code: null,
          ...(a.wbs ? { wbs_id: a.wbs } : {}),
          ...(a.milestone ? { activity_type: "milestone-finish" as const } : {}),
          ...(a.actual_start ? { actual_start: a.actual_start } : {}),
          ...(actualFinish ? { actual_finish: actualFinish } : {}),
          ...(done100
            ? { remaining_duration: 0 }
            : a.remaining_days != null
              ? { remaining_duration: a.remaining_days }
              : {}),
        };
      });
      const wbs = (job.schedule_wbs ?? []).map((w) => ({
        id: w.source_id,
        name: w.name,
        parent_id: null,
        order: w.order,
      }));
      try {
        if (activities.length > 400)
          throw new ScheduleInputError("it has more than Athena's 400 activities.");
        const prepared = prepareSchedule(null, 0, {
          operation: "organize",
          data_date: dataDate,
          initial_activities: activities as never,
          ...(wbs.length ? { wbs } : {}),
        });
        const check = checkSave("cpm", prepared.data, null, null);
        if (!check.ok) throw new ScheduleInputError(check.problems.join(" "));
        const milestones = job.schedule.filter((a) => a.milestone).length;
        schedule = {
          source_id: job.job.source_id,
          data_date: dataDate,
          what: `Imported from ${from}: ${plural(activities.length, "activity", "activities")}${milestones ? ` (${plural(milestones, "milestone")})` : ""}, logic as ${from} had it, not cost loaded.`,
          activity_count: activities.length,
          milestones,
          data: prepared.data,
        };
        fixes.push(...notes);
      } catch (e) {
        if (!(e instanceof ScheduleInputError)) throw e;
        fixes.push(
          `The schedule can't come in as Athena's CPM yet, so it is left out: ${e.message}${inArchive("schedule_activities") ? " The rows are kept in the job's archive." : ""}`,
        );
      }
    }
  }

  // Owner decisions, claims with their events, and inspections.
  const coLink = (id: string | null) => (id ? id : null);
  const decisions: PlannedLog[] = (job.decisions ?? [])
    .filter((d) => !done.has(`decision:${d.source_id}`))
    .map(({ source_id, change_order, ...payload }) => ({
      source_id,
      change_order: coLink(change_order),
      payload,
    }));
  const claims: NonNullable<ImportPackage["claims"]> = (job.claims ?? [])
    .filter((c) => !done.has(`claim:${c.source_id}`))
    .map(({ source_id, change_order, events, ...payload }) => ({
      source_id,
      change_order: coLink(change_order),
      payload,
      events: events.map(({ source_id: id, ...e }) => ({ source_id: id, payload: e })),
    }));
  const inspections: NonNullable<ImportPackage["inspections"]> = (job.inspections ?? [])
    .filter((i) => !done.has(`inspection:${i.source_id}`))
    .map(({ source_id, parent, ...payload }) => ({
      source_id,
      parent,
      change_order: null,
      payload,
    }));
  const phaseB =
    !!schedule || rfis.length + decisions.length + claims.length + inspections.length > 0;

  // Held kinds are already plural ("exposures", "Earlier pay applications").
  for (const h of job.held) {
    const kind = h.kind.toLowerCase();
    (h.archived ? archivedNotes : held).push(
      `${plural(h.count, kind.replace(/s$/, ""), kind)}: ${h.why}`,
    );
  }

  // IOR: version 1 of the job's IOR living report, only when the job has none.
  let ior: PlannedIor | null = null;
  if (job.ior) {
    const { source_id, exposures, ...rest } = job.ior;
    const model = {
      ...rest,
      last_forecast_completion: null,
      exposures: exposures.map(({ source_id: _s, ...e }) => {
        void _s;
        return e;
      }),
    };
    if (ctx.has_ior) kept.push("The job already has an IOR in Athena; kept Athena's.");
    else if (done.has(`ior:${source_id}`)) kept.push("The IOR came in on an earlier import.");
    else {
      const read = readIorModel({ ior_model: model });
      if (!read.model)
        fixes.push(
          `The IOR from ${from} can't be read, so it is left out: ${read.problems.slice(0, 3).join(" ")}`,
        );
      else
        ior = {
          source_id,
          data_date: job.source.exported_at?.slice(0, 10) ?? null,
          what: `Imported from ${from}${job.source.exported_at ? ` (export ${job.source.exported_at.slice(0, 10)})` : ""}: ${plural(read.model.exposures.length, "risk")}, ${plural(read.model.change_orders.length, "change order")} with cost.`,
          model,
        };
    }
  }

  // Archive: every source row not already archived on this job.
  const already = new Set(ctx.archived ?? []);
  let archive: ImportArchive = {};
  let archiveRows = 0;
  for (const [table, list] of Object.entries(job.archive)) {
    for (const [id, row] of Object.entries(list)) {
      if (already.has(`${table}:${id}`)) continue;
      (archive[table] ??= {})[id] = row;
      archiveRows++;
    }
  }

  const pkg: ImportPackage = {
    version: phaseB ? 3 : ior || archiveRows ? 2 : 1,
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
    ...(ior || archiveRows || phaseB ? { ior, archive: archiveRows ? archive : null } : {}),
    ...(phaseB ? { schedule, rfis, decisions, claims, inspections } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(pkg)).length;
  if (bytes > PACKAGE_MAX_BYTES && pkg.archive) {
    fixes.push(
      `The archive is too large to save in one batch (${(bytes / 1_000_000).toFixed(1)} MB of ${PACKAGE_MAX_BYTES / 1_000_000} MB), so it is left out. Everything else still saves; the rows stay in ${from}.`,
    );
    pkg.archive = null;
    archive = {};
    archiveRows = 0;
    if (!pkg.ior && !phaseB) {
      pkg.version = 1;
      delete pkg.ior;
      delete pkg.archive;
    }
  }
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
      ior: ior ? 1 : 0,
      archive_rows: archiveRows,
      schedule_activities: schedule ? schedule.activity_count : 0,
      rfis: rfis.length,
      decisions: decisions.length,
      claims: claims.length,
      inspections: inspections.length,
    },
    kept,
    held,
    archived: archivedNotes,
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
  if (c.change_orders) {
    const costed = p.change_orders.filter((co) => co.cost_cents != null).length;
    create.push(
      `${plural(c.change_orders, "open change order")} as priced PCO drafts, not sent${costed ? `; our cost on ${costed} goes to the IOR only, never on the PCO` : ""}`,
    );
  }
  if (c.submittals) create.push(`Submittal log: ${plural(c.submittals, "row")}`);
  if (c.dailies) create.push(`${plural(c.dailies, "daily report", "daily reports")}`);
  if (p.ior) {
    const m = p.ior.model as { exposures: { hold: string }[]; change_orders: unknown[] };
    const read = readIorModel({ ior_model: p.ior.model }).model;
    const held = (h: string) =>
      read ? read.exposures.filter((e) => e.hold === h).reduce((t, e) => t + heldCents(e), 0) : 0;
    create.push(
      `IOR, version 1: ${plural(m.exposures.length, "risk")} (E-holds ${usd(held("E"))}, C-holds ${usd(held("C"))}), ${plural(m.change_orders.length, "change order")} with cost`,
    );
  }
  if (c.archive_rows && p.archive) {
    const groups = new Map<string, number>();
    for (const [table, list] of Object.entries(p.archive))
      groups.set(
        archiveGroup(table),
        (groups.get(archiveGroup(table)) ?? 0) + Object.keys(list).length,
      );
    create.push(
      `Read-only archive of every ${from} record: ${plural(c.archive_rows, "record")} (${[...groups]
        .map(([g, n]) => `${g} ${n}`)
        .join(", ")})`,
    );
  }
  if (p.schedule)
    create.push(
      `CPM, version 1: ${plural(p.schedule.activity_count, "activity", "activities")}${p.schedule.milestones ? ` with ${plural(p.schedule.milestones, "milestone")}` : ""}, logic and dates as ${from} had them, not cost loaded`,
    );
  if (c.rfis) {
    const answered = (p.rfis ?? []).filter((r) => r.payload.answered_on).length;
    const sent = (p.rfis ?? []).filter((r) => r.payload.sent_on && !r.payload.answered_on).length;
    create.push(
      `RFI log: ${plural(c.rfis, "RFI")} recorded as handled outside Athena (${answered} answered, ${sent} sent and waiting${c.rfis - answered - sent ? `, ${c.rfis - answered - sent} never sent, as drafts` : ""}); none is re-sent`,
    );
  }
  if (c.decisions) create.push(`Owner decision log: ${plural(c.decisions, "decision")}`);
  if (c.claims) {
    const events = (p.claims ?? []).reduce((t, cl) => t + cl.events.length, 0);
    create.push(
      `Claims register: ${plural(c.claims, "claim")}${events ? ` with ${plural(events, "event")}` : ""}`,
    );
  }
  if (c.inspections) create.push(`Inspection log: ${plural(c.inspections, "inspection")}`);
  const costed = p.change_orders.some((co) => co.cost_cents != null);
  const sections = [
    listSection("Will be saved", create, "known"),
    p.change_orders.length
      ? {
          heading: "Open change orders",
          kind: "table" as const,
          columns: costed ? ["CO", "Title", "Amount", "Our cost"] : ["CO", "Title", "Amount"],
          rows: p.change_orders.slice(0, 15).map((co) => ({
            cells: [
              co.number,
              co.title,
              usd(co.amount_cents),
              ...(costed ? [co.cost_cents == null ? "Not given" : usd(co.cost_cents)] : []),
            ],
          })),
        }
      : null,
    listSection("Kept as it is in Athena", plan.kept, "known"),
    c.archive_rows
      ? listSection("Kept in the archive, not live in Athena", plan.archived, "known")
      : null,
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
    n("ior") ? `IOR version 1 with ${plural(n("ior_risks"), "risk")}` : null,
    n("archive_rows") ? `Archive: ${plural(n("archive_rows"), "record")}, read-only` : null,
    n("schedule_activities")
      ? `CPM version 1 with ${plural(n("schedule_activities"), "activity", "activities")}`
      : null,
    n("rfis") ? `RFI log: ${plural(n("rfis"), "RFI")} recorded outside Athena` : null,
    n("decisions") ? `Owner decisions: ${n("decisions")}` : null,
    n("claims") ? `Claims: ${n("claims")}` : null,
    n("inspections") ? `Inspections: ${n("inspections")}` : null,
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
