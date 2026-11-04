// Overwatch job export -> Athena import shape.
//
// Overwatch has no whole-job export of its own yet. This reads the export
// format defined in docs/athena/job-import.md: one JSON object holding the
// job's rows from Overwatch's own tables, keyed by table name, exactly as
// Overwatch stores them (dollars as numeric, G703 lines in cents).
import {
  clip,
  emptyImport,
  ImportInputError,
  toCents,
  toDay,
  type ImportChangeOrder,
  type ImportJob,
  type ImportSovLine,
  type ImportSubmittal,
} from "./model";

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === "object") : [];
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const live = (r: Row) => !r.voided_at && !r.entered_in_error_at && !r.archived_at;

/** Tables the export may carry counts for, and why the import leaves them behind for now. */
const HELD_TABLES: Record<string, string> = {
  cost_actuals:
    "Actual costs and AP invoices stay in Overwatch; Athena's cost review path takes them one reviewed submission at a time.",
  subcontracts:
    "Subcontracts and their payments come in through Athena's buyout and purchase-order reviews, not this cutover.",
  project_documents: "Files need their own copy step; this import moves records, not files.",
  daily_report_attachments: "Daily photos and attachments need their own copy step.",
  exposures: "The IOR risk register is rebuilt in Athena's living IOR report, not copied.",
  decisions: "Owner decisions are not mapped yet.",
  project_claims: "Claims are not mapped yet.",
  project_inspections: "Inspections are not mapped yet.",
  project_selections: "Selections are not mapped yet.",
  schedule_milestones: "Milestones come with the schedule step.",
};

export const OVERWATCH_FORMAT = "overwatch.job_export";

const coStatus = (r: Row): ImportChangeOrder["status"] => {
  if (r.entered_in_error_at) return "void";
  const s = str(r.status).toLowerCase();
  return s === "approved" ? "approved" : s === "denied" ? "rejected" : "pending";
};

function submittalStatus(r: Row): ImportSubmittal["status"] {
  const s = str(r.status).toLowerCase();
  const sent = !!toDay(r.date_submitted);
  if (s === "a") return "approved";
  if (s === "aan") return "approved_as_noted";
  if (s === "rar") return "revise_and_resubmit";
  if (s === "ur") return "in_review";
  return sent ? "submitted" : s === "pending" ? "in_prep" : "not_started";
}

function ballFor(status: ImportSubmittal["status"]): ImportSubmittal["ball_in_court"] {
  if (status === "submitted" || status === "in_review") return "architect_engineer";
  if (status === "approved" || status === "approved_as_noted" || status === "closed") return "gc";
  return "sub";
}

const BILLED = new Set(["submitted", "partial", "paid"]);

export function fromOverwatch(input: unknown, opts: { dailyDays?: number } = {}): ImportJob {
  if (!input || typeof input !== "object")
    throw new ImportInputError("The Overwatch export must be one JSON object.");
  const x = input as Row;
  if (x.format !== OVERWATCH_FORMAT)
    throw new ImportInputError(
      `This is not an Overwatch job export (format should be "${OVERWATCH_FORMAT}").`,
    );
  const p = (x.project ?? {}) as Row;
  const out = emptyImport("overwatch", `Overwatch job ${str(p.job_number) || str(p.name)}`);
  out.source.exported_at = str(x.exported_at) || null;
  out.job = {
    source_id: str(p.id) || "project",
    job_number: clip(p.job_number, 40),
    name: clip(p.name, 200),
    customer: clip(p.client, 200) || null,
    pm_name: clip(p.project_manager, 120) || null,
    pm_email: null,
    // The contract date is the baseline; a forecast is not a contract term.
    completion_date: toDay(p.baseline_completion_date),
  };
  if (!out.job.job_number)
    out.problems.push(
      "The Overwatch project has no job number. Add one in Overwatch or name it here.",
    );
  out.contract = {
    original_cents: toCents(p.original_contract),
    retainage_pct:
      p.default_retainage_pct == null || p.default_retainage_pct === ""
        ? null
        : num(p.default_retainage_pct),
  };

  // Change orders, with approved amounts folded onto the SOV line they were allocated to.
  const cos = rows(x.change_orders);
  const status = new Map(cos.map((c) => [str(c.id), coStatus(c)]));
  const allocations = rows(x.change_order_allocations).filter(
    (a) => status.get(str(a.change_order_id)) === "approved",
  );
  const allocatedTo = new Map<string, number>();
  const allocatedOf = new Map<string, number>();
  for (const a of allocations) {
    const c = toCents(a.contract_amount) ?? 0;
    const b = str(a.cost_bucket_id);
    if (b) allocatedTo.set(b, (allocatedTo.get(b) ?? 0) + c);
    if (b)
      allocatedOf.set(str(a.change_order_id), (allocatedOf.get(str(a.change_order_id)) ?? 0) + c);
  }

  // Opening balance: the latest application Overwatch shows as sent.
  const apps = rows(x.billing_applications)
    .filter((a) => BILLED.has(str(a.status).toLowerCase()))
    .sort(
      (a, b) =>
        num(a.sort_order) - num(b.sort_order) ||
        num(a.application_number) - num(b.application_number),
    );
  const lastApp = apps.at(-1);
  const appLines = lastApp
    ? rows(x.billing_line_items).filter((l) => str(l.billing_application_id) === str(lastApp.id))
    : [];
  const lineFor = new Map(
    appLines.filter((l) => str(l.cost_bucket_id)).map((l) => [str(l.cost_bucket_id), l]),
  );
  if (lastApp) {
    out.billing = {
      last_application: clip(lastApp.application_number, 40) || null,
      period_to: toDay(lastApp.submitted_date),
    };
    const older = apps.length - 1;
    if (older > 0)
      out.held.push({
        kind: "Earlier pay applications",
        count: older,
        why: "Billing history comes in as the opening balance from the latest sent application, so nothing is billed twice.",
      });
  }

  const sov: ImportSovLine[] = [];
  for (const b of rows(x.cost_buckets)
    .filter(live)
    .sort((a, b) => num(a.sort_order) - num(b.sort_order))) {
    const id = str(b.id);
    const l = lineFor.get(id);
    const prevThis = (a: unknown, b2: unknown) =>
      a == null && b2 == null ? null : num(a) + num(b2);
    const work = l
      ? l.work_completed_to_date_cents != null
        ? num(l.work_completed_to_date_cents)
        : prevThis(l.work_completed_previous_cents, l.work_completed_this_period_cents)
      : null;
    const stored = l
      ? l.materials_stored_to_date_cents != null
        ? num(l.materials_stored_to_date_cents)
        : prevThis(l.materials_stored_previous_cents, l.materials_stored_this_period_cents)
      : null;
    const scheduled = (toCents(b.contract_value) ?? 0) + (allocatedTo.get(id) ?? 0);
    if (l) {
      const billedScheduled = num(l.scheduled_value_cents) + num(l.change_order_value_cents);
      if (billedScheduled !== scheduled)
        out.problems.push(
          `${clip(b.bucket, 80) || clip(b.cost_code, 40)}: scheduled value ${scheduled / 100} doesn't match pay app ${clip(lastApp?.application_number, 20)} (${billedScheduled / 100}).`,
        );
    }
    sov.push({
      source_id: `cost_bucket:${id}`,
      cost_code: clip(b.cost_code, 40) || null,
      description: clip(b.bucket, 300) || clip(b.cost_code, 300) || "SOV line",
      scheduled_cents: scheduled,
      // Overwatch stores a bucket with no budget as 0. Saving that as a real
      // $0 budget would block the real number later, so 0 means no budget.
      budget_cents: toCents(b.original_budget) || null,
      work_to_date_cents: work,
      stored_to_date_cents: stored,
      retained_cents: l && l.retainage_held_cents != null ? num(l.retainage_held_cents) : null,
    });
  }
  out.change_orders = cos.map((c) => ({
    source_id: `change_order:${str(c.id)}`,
    number: clip(c.number, 40) || "CO",
    title: clip(c.description, 200) || `Change order ${clip(c.number, 40)}`,
    description: clip(c.description || c.notes, 12000),
    amount_cents: toCents(c.contract_amount) ?? 0,
    status: coStatus(c),
    date: toDay(c.client_decided_at) ?? toDay(c.date_initiated),
    schedule_days:
      c.schedule_impact_days == null || c.schedule_impact_days === ""
        ? null
        : Math.trunc(num(c.schedule_impact_days)),
  }));
  // An approved change with no SOV allocation still adds to the contract: give it its own line.
  for (const c of out.change_orders.filter((c) => c.status === "approved")) {
    const id = c.source_id.slice("change_order:".length);
    const rest = c.amount_cents - (allocatedOf.get(id) ?? 0);
    if (rest !== 0)
      sov.push({
        source_id: `change_order_line:${id}`,
        cost_code: null,
        description: clip(`CO ${c.number} · ${c.title}`, 300),
        scheduled_cents: rest,
        budget_cents: null,
        work_to_date_cents: null,
        stored_to_date_cents: null,
        retained_cents: null,
      });
  }
  out.sov = sov;

  const log = rows(x.submittal_log_entries);
  out.rfis = log
    .filter((r) => str(r.kind) === "rfi")
    .map((r) => ({
      source_id: `rfi:${str(r.id)}`,
      number: clip(r.number, 40) || "RFI",
      title: clip(r.item, 200) || clip(r.description, 200) || `RFI ${clip(r.number, 40)}`,
      question: clip(r.description, 12000),
      open: !toDay(r.date_returned) && !["a", "aan"].includes(str(r.status).toLowerCase()),
      sent_on: toDay(r.date_submitted),
      due_on: toDay(r.due_date),
    }));
  out.submittals = log
    .filter((r) => str(r.kind) !== "rfi")
    .map((r) => {
      const st = submittalStatus(r);
      const rev = parseInt(str(r.sub_rev).replace(/\D/g, ""), 10);
      return {
        source_id: `submittal:${str(r.id)}`,
        number: clip(r.number, 40),
        revision: Number.isFinite(rev) && rev >= 0 && rev <= 99 ? rev : 0,
        spec_section: clip(r.spec_section, 40),
        title: clip(r.item, 200) || clip(r.description, 200),
        submittal_type: "other" as const,
        status: st,
        ball_in_court: ballFor(st),
        submitted_on: toDay(r.date_submitted),
        returned_on: toDay(r.date_returned),
        required_by: toDay(r.due_date),
        notes:
          clip(
            [r.mfgr_supplier && `Supplier: ${str(r.mfgr_supplier)}`, r.comments]
              .filter(Boolean)
              .join(". "),
            4000,
          ) || null,
      };
    });

  out.schedule = rows(x.schedule_activities)
    .sort((a, b) => num(a.sort_order) - num(b.sort_order))
    .map((a) => ({
      source_id: `activity:${str(a.id)}`,
      id: clip(a.activity_id, 20) || clip(a.id, 20),
      name: clip(a.name, 160) || clip(a.activity_id, 160),
      start: toDay(a.actual_start_date) ?? toDay(a.forecast_start_date) ?? toDay(a.start_date),
      finish: toDay(a.actual_finish_date) ?? toDay(a.forecast_finish_date) ?? toDay(a.finish_date),
      duration_days:
        a.planned_duration_days == null
          ? null
          : Math.max(0, Math.trunc(num(a.planned_duration_days))),
      pct_complete:
        a.percent_complete == null ? null : Math.min(100, Math.max(0, num(a.percent_complete))),
      predecessors: (Array.isArray(a.predecessor_activity_ids) ? a.predecessor_activity_ids : [])
        .map((v) => clip(v, 20))
        .filter(Boolean)
        .slice(0, 20),
    }));

  // Dailies: the recent window only. Older logs stay in Overwatch as the record.
  const reports = rows(x.daily_reports).filter((d) => toDay(d.report_date));
  const latest = reports
    .map((d) => toDay(d.report_date)!)
    .sort()
    .at(-1);
  const windowDays = opts.dailyDays ?? 28;
  const cutoff = latest
    ? new Date(Date.parse(`${latest}T00:00:00Z`) - (windowDays - 1) * 86400000)
        .toISOString()
        .slice(0, 10)
    : null;
  const wip = rows(x.daily_wip_entries).filter(live);
  const recent = reports.filter((d) => cutoff && toDay(d.report_date)! >= cutoff);
  if (reports.length > recent.length)
    out.held.push({
      kind: "Older daily reports",
      count: reports.length - recent.length,
      why: `Only the last ${windowDays} days of dailies come in; older ones stay in Overwatch as the record.`,
    });
  const notRecorded = "Not recorded in Overwatch";
  out.dailies = recent.map((d) => {
    const date = toDay(d.report_date)!;
    const lines = wip
      .filter((w) => toDay(w.entry_date) === date)
      .map((w) => {
        const people =
          num(w.crew_count) * (num(w.people_per_crew) > 0 ? num(w.people_per_crew) : 2);
        return {
          work: clip(w.activity, 500),
          qty: num(w.quantity),
          unit: clip(w.unit, 40),
          crew: people,
          hours: num(w.hours),
          pct_complete:
            w.field_percent_complete == null
              ? null
              : Math.min(100, Math.max(0, num(w.field_percent_complete))),
        };
      })
      .filter((l) => l.work && l.qty > 0 && l.unit && l.crew > 0 && l.hours > 0)
      .slice(0, 80);
    return {
      source_id: `daily:${str(d.id) || date}`,
      date,
      weather: clip(d.weather, 2000) || notRecorded,
      manpower:
        clip(d.manpower, 2000) ||
        (num(d.crew_count) > 0 ? `${num(d.crew_count)} on site` : notRecorded),
      subs: notRecorded,
      deliveries: notRecorded,
      issues:
        clip(
          [d.quality_notes, d.notes, d.visitors && `Visitors: ${str(d.visitors)}`]
            .filter(Boolean)
            .join(". "),
          4000,
        ) || "None noted",
      delays: clip(d.delays, 4000) || "None noted",
      safety: clip(d.safety_notes, 4000) || "None noted",
      work_summary: clip(d.work_performed, 8000),
      lines,
    };
  });

  const counts = (x.counts ?? {}) as Row;
  for (const [table, why] of Object.entries(HELD_TABLES)) {
    const n = Math.max(rows(x[table]).length, Math.trunc(num(counts[table])));
    if (n > 0) out.held.push({ kind: table.replace(/_/g, " "), count: n, why });
  }
  return out;
}
