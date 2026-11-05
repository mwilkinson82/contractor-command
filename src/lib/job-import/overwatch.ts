// Overwatch job export -> Athena import shape.
//
// Reads Overwatch's "Export for Athena" file (format defined in
// docs/athena/job-import.md): one JSON object holding the job's rows from
// Overwatch's own tables, keyed by table name, exactly as Overwatch stores them
// (dollars as numeric, G703 lines in cents). Format version 1 carried a few
// tables; version 2 carries every job table as full rows plus `counts` and
// `left_out`. Both read here.
import {
  ARCHIVE_TABLE,
  CLAIM_EVENTS,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  INSPECTION_RESULTS,
  INSPECTION_STATUSES,
  clip,
  emptyImport,
  IOR_CATEGORIES,
  ImportInputError,
  toCents,
  toDay,
  type ImportArchive,
  type ImportChangeOrder,
  type ImportIor,
  type ImportIorExposure,
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

/**
 * Tables the export may carry counts for, and why the import leaves them
 * behind. A version 1 file carries only counts for these; a version 2 file
 * carries their rows, which go to the job's read-only archive (ARCHIVED_HELD
 * says what is still not live in Athena).
 */
const HELD_TABLES: Record<string, string> = {
  cost_actuals:
    "Actual costs and AP invoices stay in Overwatch; Athena's cost review path takes them one reviewed submission at a time.",
  subcontracts:
    "Subcontracts and their payments come in through Athena's buyout and purchase-order reviews, not this cutover.",
  project_documents: "Files need their own copy step; this import moves records, not files.",
  daily_report_attachments: "Daily photos and attachments need their own copy step.",
  exposures: "The IOR risk register is rebuilt in Athena's living IOR report, not copied.",
  decisions:
    "This export carries only a count; export again from Overwatch to bring the decisions.",
  project_claims:
    "This export carries only a count; export again from Overwatch to bring the claims.",
  project_inspections:
    "This export carries only a count; export again from Overwatch to bring the inspections.",
  project_selections: "Selections are not mapped yet.",
  schedule_milestones: "Milestones come with the schedule step.",
};

/** Rows the archive keeps, but that are not live Athena records yet. */
const ARCHIVED_HELD: Record<string, string> = {
  project_documents:
    "Each file's name and storage path is kept in the job's archive; the files themselves copy in a later file step.",
};

const INSPECTION_RESULT_OF_STATUS: Record<string, string> = {
  passed: "pass",
  failed: "fail",
  partial: "partial",
  cancelled: "cancelled",
};

export const OVERWATCH_FORMAT = "overwatch.job_export";
export const OVERWATCH_VERSIONS = [1, 2] as const;

/** Overwatch export tables by the group the review card counts them under. */
const TABLE_GROUP: Record<string, string> = {
  projects: "Job",
  ...Object.fromEntries(
    [
      "cost_buckets",
      "cost_budget_items",
      "budget_line_overrides",
      "project_financial_overrides",
      "billing_forecast_settings",
      "change_orders",
      "change_order_allocations",
      "change_order_approvals",
      "change_order_documents",
      "billing_applications",
      "billing_line_items",
      "billing_line_change_order_allocations",
      "billing_application_events",
      "billing_invoices",
      "payment_ledger",
      "payment_refund_events",
      "sov_imports",
      "cost_actuals",
      "cost_actual_payments",
      "cost_actual_import_batches",
      "subcontracts",
      "subcontract_allocations",
      "subcontract_change_orders",
      "subcontract_payments",
      "subcontract_payment_allocations",
      "subcontract_payment_backups",
      "subcontract_documents",
      "insurance_certificates",
      "lien_waivers",
      "subcontractors",
    ].map((t) => [t, "Commercial"]),
  ),
  ...Object.fromEntries(
    [
      "schedule_wbs_sections",
      "schedule_activities",
      "schedule_milestones",
      "schedule_updates",
      "schedule_activity_updates",
      "schedule_milestone_updates",
      "schedule_delay_fragments",
      "schedule_risks",
      "schedule_activity_progress_controls",
      "schedule_activity_progress_reviews",
      "schedule_cpm_templates",
    ].map((t) => [t, "Schedule"]),
  ),
  ...Object.fromEntries(
    [
      "exposures",
      "exposure_allocations",
      "project_claims",
      "project_claim_events",
      "project_claim_documents",
      "reviews",
    ].map((t) => [t, "IOR, risk and claims"]),
  ),
  ...Object.fromEntries(
    [
      "decisions",
      "project_selections",
      "project_selection_options",
      "project_selection_decisions",
    ].map((t) => [t, "Decisions and selections"]),
  ),
  ...Object.fromEntries(
    ["submittal_log_entries", "submittal_rounds", "transmittals"].map((t) => [
      t,
      "RFIs and submittals",
    ]),
  ),
  ...Object.fromEntries(
    [
      "daily_reports",
      "daily_wip_entries",
      "daily_wip_entry_events",
      "tomorrow_plan_items",
      "project_inspections",
      "production_sov_certifications",
      "production_sov_certification_invalidations",
      "production_sov_billing_handoffs",
    ].map((t) => [t, "Field"]),
  ),
  ...Object.fromEntries(
    ["project_client_access", "project_memberships", "project_documents", "client_contacts"].map(
      (t) => [t, "Team, client portal and files"],
    ),
  ),
  ...Object.fromEntries(
    ["crm_onboarding_plans", "crm_onboarding_tasks"].map((t) => [t, "Kickoff"]),
  ),
};
export const archiveGroup = (table: string) => TABLE_GROUP[table] ?? "Other";

/** Tables keyed by something other than id (Overwatch's export sort keys). */
const ROW_KEY: Record<string, string[]> = {
  billing_forecast_settings: ["project_id"],
  billing_line_change_order_allocations: ["billing_line_item_id", "change_order_allocation_id"],
  schedule_activity_progress_controls: ["schedule_activity_id"],
};
const NOT_TABLES = new Set(["format", "format_version", "exported_at", "counts", "left_out"]);

/** Stable FNV-1a hash of a row with sorted keys, for rows with no id of their own. */
function rowHash(r: Row): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Row)
              .sort()
              .map((k) => [k, canon((v as Row)[k])]),
          )
        : v;
  const s = JSON.stringify(canon(r));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `row:${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function archiveKey(table: string, r: Row): string {
  const cols = ROW_KEY[table];
  const key = cols ? cols.map((c) => str(r[c])).join(":") : str(r.id) || str(r.uuid) || "";
  return key && key.length <= 200 && (!cols || cols.every((c) => str(r[c]))) ? key : rowHash(r);
}

/** Every row the file carries, as Overwatch stored it, by table and row id. */
function buildArchive(x: Row): ImportArchive {
  const out: ImportArchive = {};
  const add = (table: string, list: Row[]) => {
    if (!ARCHIVE_TABLE.test(table) || !list.length) return;
    const t = (out[table] ??= {});
    for (const r of list) t[archiveKey(table, r)] = r;
  };
  if (x.project && typeof x.project === "object") add("projects", [x.project as Row]);
  for (const [k, v] of Object.entries(x))
    if (!NOT_TABLES.has(k) && k !== "project") add(k, rows(v));
  return out;
}

// Overwatch IOR -> Athena ior_model. Overwatch and Athena share the category
// and response enums word for word (Overwatch public.exposure_category and
// public.response_path; Athena IorCategory and IorResponse), so they map 1:1;
// anything unknown becomes "other". Holds differ:
//   Overwatch hold_class  ->  Athena hold
//   'E-Hold'              ->  E
//   'C-Hold'              ->  C
//   'Both'                ->  two risks, one E and one C. Overwatch's IOR
//                             rollup (builder-clarity src/lib/ior.ts
//                             computeRollup) counts a 'Both' exposure in the
//                             E-holds AND the C-holds; splitting it keeps
//                             Athena's indicated gross profit equal to the one
//                             the PM saw in Overwatch. (Overwatch's cost-code
//                             ledger puts 'Both' in At Risk only; that is the
//                             budget view, not the IOR.)
//   'None'                ->  left off the IOR: Overwatch holds nothing for
//                             it. The row stays in the archive.
// Closed exposures (recovered, eliminated, released; Overwatch
// isClosedExposure) drop off the IOR, as they do in Overwatch. 'accepted'
// still carries money there, so it carries here.
const CLOSED_EXPOSURE = new Set(["recovered", "eliminated", "released"]);
const RESPONSES = new Set(["eliminate", "recover", "offset", "accept"]);

function iorExposures(list: Row[]): { exposures: ImportIorExposure[]; noHold: number } {
  const out: ImportIorExposure[] = [];
  let noHold = 0;
  for (const e of list) {
    const status = str(e.status).toLowerCase();
    if (CLOSED_EXPOSURE.has(status)) continue;
    const hold = str(e.hold_class);
    const holds: ("E" | "C")[] =
      hold === "Both" ? ["E", "C"] : hold === "C-Hold" ? ["C"] : hold === "None" ? [] : ["E"];
    if (!holds.length) {
      noHold++;
      continue;
    }
    const probability = Math.min(100, Math.max(0, num(e.probability)));
    const exposure = Math.max(0, num(e.dollar_exposure));
    // Overwatch's released_amount is a part of the weighted hold already let
    // go (remaining = exposure x probability - released). Athena holds
    // dollar_risk x probability, so the risk carried is reduced to match.
    const released = Math.max(0, num(e.released_amount));
    const dollarRisk =
      released > 0 && probability > 0
        ? Math.max(0, Math.round((exposure - released / (probability / 100)) * 100) / 100)
        : Math.round(exposure * 100) / 100;
    const category = (IOR_CATEGORIES as readonly string[]).includes(str(e.category))
      ? (str(e.category) as ImportIorExposure["category"])
      : "other";
    const response = RESPONSES.has(str(e.response_path))
      ? (str(e.response_path) as ImportIorExposure["response"])
      : "accept";
    const title =
      clip(e.title, 300) || clip(e.description, 300) || `Risk ${clip(e.id, 20) || out.length + 1}`;
    for (const h of holds)
      out.push({
        source_id: `exposure:${str(e.id) || out.length}${holds.length > 1 ? `:${h}` : ""}`,
        title: holds.length > 1 ? clip(`${title} (${h}-hold side)`, 300) : title,
        category,
        response,
        hold: h,
        dollar_risk: dollarRisk,
        probability,
        owner: clip(e.owner, 80) || null,
        opened: toDay(e.opened_at),
        next_review: toDay(e.next_review_at),
        next_move: clip(e.release_condition, 300)
          ? clip(`Release when: ${str(e.release_condition)}`, 300)
          : null,
        status: clip(status, 40) || null,
      });
  }
  return { exposures: out, noHold };
}

/**
 * The IOR as Athena's ior_model, from the Overwatch project header, its cost
 * buckets, change orders and exposures. Null, with the reason, when the file
 * doesn't carry what ior_model needs (a version 1 file has no change-order cost
 * or project phase). Nothing is guessed: a missing number stops the IOR.
 */
function buildIor(
  x: Row,
  p: Row,
  liveBuckets: Row[],
): { ior: ImportIor | null; why: string | null; noHold: number } {
  const cos = rows(x.change_orders).filter((c) => !c.entered_in_error_at && !c.voided_at);
  const contract = num(p.original_contract);
  if (!(contract > 0))
    return { ior: null, why: "the Overwatch project has no original contract.", noHold: 0 };
  const phase = str(p.phase);
  if (phase !== "Early" && phase !== "Middle" && phase !== "Late")
    return {
      ior: null,
      why: "this export doesn't carry the project's phase. Export the job again from Overwatch.",
      noHold: 0,
    };
  const live = cos.filter((c) => /^(approved|pending)$/i.test(str(c.status)));
  if (live.some((c) => c.cost_amount == null || c.cost_amount === ""))
    return {
      ior: null,
      why: "this export doesn't carry change-order cost. Export the job again from Overwatch.",
      noHold: 0,
    };
  const { exposures, noHold } = iorExposures(rows(x.exposures));
  const round = (n: number) => Math.round(n * 100) / 100;
  const cost = num(p.original_cost_budget);
  // Actual cost to date: Overwatch keeps it per cost code (cost_buckets.actual_to_date,
  // rolled up from its cost actuals), and its IOR sums the live buckets. Same here.
  const actual = round(liveBuckets.reduce((t, b) => t + Math.max(0, num(b.actual_to_date)), 0));
  // Cost growth: Overwatch's IOR projects cost as actual to date plus forecast to
  // complete across the cost codes (a finished code forecasts 0), against the
  // original cost budget. Athena keeps that difference as cost_growth. Only when
  // every live bucket carries its forecast; otherwise 0 and the note says why.
  // Overwatch's subcontract buyout layer is not included.
  const forecastKnown =
    liveBuckets.length > 0 && cost > 0 && liveBuckets.every((b) => b.ftc != null && b.ftc !== "");
  const projected = liveBuckets.reduce(
    (t, b) => t + Math.max(0, num(b.actual_to_date)) + (b.finished_at ? 0 : num(b.ftc)),
    0,
  );
  const growth = forecastKnown ? round(projected - cost) : 0;
  return {
    ior: {
      source_id: str(p.id) || "project",
      original_contract: round(contract),
      original_cost_budget: cost > 0 ? round(cost) : null,
      cost_growth: growth,
      cost_growth_note: forecastKnown
        ? `Overwatch cost to date plus forecast to complete across ${liveBuckets.length} cost codes, less the original cost budget. Subcontract buyout not included.`
        : "Overwatch export has no forecast to complete per cost code; cost growth starts at 0.",
      actual_cost_to_date: actual,
      phase,
      percent_complete: Math.min(100, Math.max(0, num(p.percent_complete))),
      baseline_completion: toDay(p.baseline_completion_date),
      forecast_completion: toDay(p.forecast_completion_date),
      change_orders: live.map((c) => {
        const approved = /^approved$/i.test(str(c.status));
        return {
          number: clip(c.number, 40) || "CO",
          description: clip(c.description, 300) || "Change order",
          status: approved ? ("Approved" as const) : ("Pending" as const),
          contract_amount: round(num(c.contract_amount)),
          cost_amount: round(num(c.cost_amount)),
          probability: approved ? 100 : Math.min(100, Math.max(0, num(c.probability ?? 100))),
        };
      }),
      exposures,
    },
    why: null,
    noHold,
  };
}

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

export function fromOverwatch(
  input: unknown,
  opts: { dailyDays?: number; jobNumber?: string; jobName?: string } = {},
): ImportJob {
  if (!input || typeof input !== "object")
    throw new ImportInputError("The Overwatch export must be one JSON object.");
  const x = input as Row;
  if (x.format !== OVERWATCH_FORMAT)
    throw new ImportInputError(
      `This is not an Overwatch job export (format should be "${OVERWATCH_FORMAT}").`,
    );
  const version = x.format_version == null ? 1 : Number(x.format_version);
  if (!(OVERWATCH_VERSIONS as readonly number[]).includes(version))
    throw new ImportInputError(
      `This Overwatch export is format version ${clip(x.format_version, 10)}; Athena reads versions 1 and 2. Update Athena or export again.`,
    );
  const p = (x.project ?? {}) as Row;
  const out = emptyImport("overwatch", `Overwatch job ${str(p.job_number) || str(p.name)}`);
  out.source.exported_at = str(x.exported_at) || null;
  out.job = {
    source_id: str(p.id) || "project",
    // A number or name given at import time wins over the export's.
    job_number: clip(opts.jobNumber, 40) || clip(p.job_number, 40),
    name: clip(opts.jobName, 200) || clip(p.name, 200),
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
        why: "Billing history comes in as the opening balance from the latest sent application, so nothing is billed twice. Every application is kept in the job's archive.",
        archived: true,
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
    // Version 2 carries Overwatch's cost side and probability (dollars, 0-100).
    cost_cents: c.cost_amount == null || c.cost_amount === "" ? null : toCents(c.cost_amount),
    probability:
      c.probability == null || c.probability === ""
        ? null
        : Math.min(100, Math.max(0, num(c.probability))),
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
      // Overwatch keeps the reply in comments once the RFI is returned; it
      // doesn't record who answered.
      answer_text: toDay(r.date_returned) ? clip(r.comments, 12000) || null : null,
      answered_on: toDay(r.date_returned),
      answered_by: null,
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

  // Schedule: activities keep Overwatch's activity IDs and logic. Overwatch
  // stores predecessors as a plain list (no relationship type or lag), so each
  // becomes finish-to-start with no lag. A predecessor may be written as the
  // activity ID or the row id; both resolve. Milestones join as zero-duration
  // finish milestones after the activities. No dollar values: Overwatch has
  // none per activity, and Athena never spreads them.
  const acts = rows(x.schedule_activities).sort((a, b) => num(a.sort_order) - num(b.sort_order));
  const idOf = new Map<string, string>();
  for (const a of acts) {
    const id = clip(a.activity_id, 20) || clip(a.id, 20);
    idOf.set(str(a.id), id);
    if (str(a.activity_id)) idOf.set(str(a.activity_id), id);
  }
  const wbsRows = rows(x.schedule_wbs_sections);
  const wbsIds = new Set(wbsRows.map((w) => str(w.id)));
  // Overwatch's work week: weekday numbers worked, 0 = Sunday (getUTCDay), plus holidays.
  const workDays = (Array.isArray(p.schedule_workdays) ? p.schedule_workdays : [])
    .map((d) => Math.trunc(num(d)))
    .filter((d, i, all) => d >= 0 && d <= 6 && all.indexOf(d) === i)
    .sort();
  const holidays = (Array.isArray(p.schedule_holidays) ? p.schedule_holidays : [])
    .map((d) => toDay(d))
    .filter((d): d is string => !!d);
  if (workDays.length) out.schedule_calendar = { work_days: workDays, holidays };
  // Overwatch figures an activity's duration as working days from its start
  // through its finish on this calendar (planned_duration_days can be a
  // calendar-day count), so Athena counts the same way.
  const working = (from: string | null, to: string | null) => {
    if (!workDays.length || !from || !to || to < from) return null;
    const off = new Set(holidays);
    let n = 0;
    for (
      let d = Date.parse(`${from}T00:00:00Z`);
      d <= Date.parse(`${to}T00:00:00Z`);
      d += 86400000
    ) {
      const iso = new Date(d).toISOString().slice(0, 10);
      if (workDays.includes(new Date(d).getUTCDay()) && !off.has(iso)) n++;
      if (n > 5000) return null;
    }
    return n;
  };
  // Activities name their section by division ("06 - Wood / Framing" is
  // Framing under 06 - Wood) when the row has no section id.
  const wbsById = new Map(wbsRows.map((w) => [str(w.id), w]));
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const wbsPath = (w: Row, depth = 0): string => {
    const parent = wbsById.get(str(w.parent_id));
    return parent && depth < 20 ? `${wbsPath(parent, depth + 1)} / ${str(w.name)}` : str(w.name);
  };
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const w of wbsRows) {
    byPath.set(norm(wbsPath(w)), str(w.id));
    byName.set(norm(str(w.name)), [...(byName.get(norm(str(w.name))) ?? []), str(w.id)]);
  }
  const sectionFor = (a: Row) => {
    if (wbsIds.has(str(a.wbs_section_id))) return str(a.wbs_section_id);
    const div = norm(str(a.division));
    if (!div) return null;
    const named = byName.get(div);
    return byPath.get(div) ?? (named?.length === 1 ? named[0] : null);
  };
  const updates = rows(x.schedule_updates)
    .map((u) => toDay(u.data_date) ?? toDay(u.update_date))
    .filter((d): d is string => !!d)
    .sort();
  if (updates.length) out.schedule_data_date = updates[updates.length - 1];
  const unknownLinks: string[] = [];
  out.schedule = acts.map((a) => {
    const id = idOf.get(str(a.id))!;
    const preds = (Array.isArray(a.predecessor_activity_ids) ? a.predecessor_activity_ids : [])
      .map((v) => {
        const hit = idOf.get(str(v));
        if (!hit && str(v)) unknownLinks.push(`${id} -> ${clip(v, 40)}`);
        return hit ?? "";
      })
      .filter((v, i, all) => v && v !== id && all.indexOf(v) === i)
      .slice(0, 20);
    return {
      source_id: `activity:${str(a.id)}`,
      id,
      name: clip(a.name, 160) || clip(a.activity_id, 160),
      start: toDay(a.actual_start_date) ?? toDay(a.forecast_start_date) ?? toDay(a.start_date),
      finish: toDay(a.actual_finish_date) ?? toDay(a.forecast_finish_date) ?? toDay(a.finish_date),
      duration_days:
        (num(a.planned_duration_days) === 0 && a.planned_duration_days != null
          ? 0
          : (working(toDay(a.baseline_start_date), toDay(a.baseline_finish_date)) ??
            working(toDay(a.start_date), toDay(a.finish_date)))) ??
        (a.planned_duration_days == null
          ? null
          : Math.max(0, Math.trunc(num(a.planned_duration_days)))),
      pct_complete:
        a.percent_complete == null ? null : Math.min(100, Math.max(0, num(a.percent_complete))),
      predecessors: preds,
      actual_start: toDay(a.actual_start_date),
      actual_finish: toDay(a.actual_finish_date),
      remaining_days:
        a.remaining_duration_days == null || a.remaining_duration_days === ""
          ? null
          : Math.max(0, Math.trunc(num(a.remaining_duration_days))),
      wbs: sectionFor(a) ? `wbs:${sectionFor(a)}` : null,
      baseline_start: toDay(a.baseline_start_date),
      baseline_finish: toDay(a.baseline_finish_date),
    };
  });
  rows(x.schedule_milestones)
    .sort((a, b) => num(a.sort_order) - num(b.sort_order))
    .forEach((m, i) => {
      const date = toDay(m.forecast_date) ?? toDay(m.baseline_date);
      let id = `MS-${String(i + 1).padStart(2, "0")}`;
      while (idOf.has(id)) id = `${id}A`;
      out.schedule.push({
        source_id: `milestone:${str(m.id) || i}`,
        id,
        name: clip(m.name, 160) || `Milestone ${i + 1}`,
        start: date,
        finish: date,
        duration_days: 0,
        pct_complete: null,
        predecessors: [],
        milestone: true,
      });
    });
  out.schedule_wbs = rows(x.schedule_wbs_sections)
    .sort((a, b) => num(a.sort_order) - num(b.sort_order))
    .map((w, i) => ({
      source_id: `wbs:${str(w.id)}`,
      name: clip(w.name, 160) || `Section ${i + 1}`,
      order: i,
      parent: wbsIds.has(str(w.parent_id)) ? `wbs:${str(w.parent_id)}` : null,
    }));
  if (unknownLinks.length)
    out.problems.push(
      `${unknownLinks.length} schedule logic link${unknownLinks.length === 1 ? "" : "s"} point${unknownLinks.length === 1 ? "s" : ""} at an activity not in the export and ${unknownLinks.length === 1 ? "is" : "are"} left off: ${unknownLinks.slice(0, 5).join(", ")}.`,
    );

  // Owner decisions, claims (with their events) and inspections, from a file
  // that carries their rows. Links to an Overwatch change order resolve at save
  // through the import ledger; a link to an exposure is kept by its title, as
  // the IOR names it.
  const exposureTitle = new Map(
    rows(x.exposures).map((e) => [str(e.id), clip(e.title, 300) || clip(e.description, 300)]),
  );
  const coLink = (v: unknown) => (str(v) ? `change_order:${str(v)}` : null);
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly string[]).includes(str(v)) ? (str(v) as T) : fallback;
  out.decisions = rows(x.decisions)
    .filter((d) => clip(d.decision, 2000))
    .map((d) => ({
      source_id: `decision:${str(d.id)}`,
      decision: clip(d.decision, 2000),
      // Overwatch: open, in_progress, resolved, overdue. Overdue is a date
      // fact Athena reads from the due date, so it comes in open.
      status:
        str(d.status) === "resolved"
          ? ("decided" as const)
          : str(d.status) === "in_progress"
            ? ("in_progress" as const)
            : ("open" as const),
      owner_name: clip(d.owner, 120) || null,
      due_on: toDay(d.due_date),
      impact: clip(d.impact, 2000) || null,
      notes: clip(d.notes, 4000) || null,
      exposure_ref: exposureTitle.get(str(d.linked_exposure_id)) || null,
      change_order: coLink(d.linked_co_id),
    }));
  const claimEvents = rows(x.project_claim_events);
  out.claims = rows(x.project_claims).map((c, i) => ({
    source_id: `claim:${str(c.id)}`,
    number: clip(c.claim_number, 40) || `CL-${String(i + 1).padStart(3, "0")}`,
    claim_type: pick(c.claim_type, CLAIM_TYPES, "other"),
    title: clip(c.title, 200) || clip(c.description, 200) || `Claim ${i + 1}`,
    description: clip(c.description, 12000),
    status: pick(c.status, CLAIM_STATUSES, "in_preparation"),
    money_claimed_cents: Math.max(0, toCents(c.money_claimed) ?? 0),
    money_awarded_cents: Math.max(0, toCents(c.money_awarded) ?? 0),
    time_claimed_days: Math.max(0, Math.trunc(num(c.time_claimed_days))),
    time_awarded_days: Math.max(0, Math.trunc(num(c.time_awarded_days))),
    submitted_on: toDay(c.submitted_at),
    resolved_on: toDay(c.resolved_at),
    outcome: clip(c.outcome, 4000) || null,
    owner_name: clip(c.owner, 120) || null,
    exposure_ref: exposureTitle.get(str(c.risk_exposure_id)) || null,
    change_order: coLink(c.change_order_id),
    events: claimEvents
      .filter((e) => str(e.claim_id) === str(c.id))
      .sort((a, b) => (toDay(a.event_date) ?? "").localeCompare(toDay(b.event_date) ?? ""))
      .map((e) => ({
        source_id: `claim_event:${str(e.id)}`,
        event_type: pick(e.event_type, CLAIM_EVENTS, "other"),
        event_date: toDay(e.event_date),
        revision_number: Math.min(99, Math.max(0, Math.trunc(num(e.revision_number)))),
        note: clip(e.note, 4000) || null,
      })),
  }));
  // Parents before their reinspections, so each parent resolves first.
  const insp = rows(x.project_inspections);
  const depth = (r: Row, seen = 0): number => {
    const parent = insp.find((p) => str(p.id) === str(r.parent_inspection_id));
    return parent && seen < 50 ? 1 + depth(parent, seen + 1) : 0;
  };
  out.inspections = [...insp]
    .sort((a, b) => depth(a) - depth(b) || num(a.attempt_number) - num(b.attempt_number))
    .map((r) => ({
      source_id: `inspection:${str(r.id)}`,
      inspection_type: clip(r.inspection_type, 120) || "Inspection",
      authority: clip(r.authority, 200) || null,
      location: clip(r.location, 200) || null,
      inspector: clip(r.inspector, 120) || null,
      responsible_party: clip(r.responsible_party, 120) || null,
      status: pick(r.status, INSPECTION_STATUSES, "planned"),
      // Overwatch can leave the result unset on a closed inspection; its status says it.
      result: pick(
        r.result || INSPECTION_RESULT_OF_STATUS[str(r.status)],
        INSPECTION_RESULTS,
        "pending",
      ),
      requested_on: toDay(r.requested_date),
      scheduled_on: toDay(r.scheduled_date),
      completed_on: toDay(r.completed_date),
      attempt: Math.min(99, Math.max(1, Math.trunc(num(r.attempt_number) || 1))),
      reinspection_required: r.required_reinspection === true,
      cost_impact_cents: toCents(r.cost_impact) ?? 0,
      schedule_impact_weeks:
        r.schedule_impact_weeks == null || r.schedule_impact_weeks === ""
          ? null
          : num(r.schedule_impact_weeks),
      notes: clip(r.notes, 4000) || null,
      corrective_action: clip(r.corrective_action, 4000) || null,
      risk_ref: exposureTitle.get(str(r.risk_exposure_id)) || null,
      parent: str(r.parent_inspection_id) ? `inspection:${str(r.parent_inspection_id)}` : null,
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
      why: `Only the last ${windowDays} days of dailies come in as Athena dailies; older ones are kept in the job's archive.`,
      archived: rows(x.daily_reports).length > 0,
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

  out.archive = buildArchive(x);
  const liveBuckets = rows(x.cost_buckets).filter(live);
  const ior = rows(x.exposures).length || version >= 2 ? buildIor(x, p, liveBuckets) : null;
  out.ior = ior?.ior ?? null;

  const counts = (x.counts ?? {}) as Row;
  for (const [table, why] of Object.entries(HELD_TABLES)) {
    const inFile = rows(x[table]).length;
    const n = Math.max(inFile, Math.trunc(num(counts[table])));
    if (n <= 0) continue;
    const kind = table.replace(/_/g, " ");
    if (table === "exposures") {
      if (out.ior) {
        if (ior?.noHold)
          out.held.push({
            kind: "exposures with no hold",
            count: ior.noHold,
            why: "Hold class None carries nothing on Overwatch's IOR, so these stay off Athena's IOR; they are kept in the job's archive.",
            archived: true,
          });
        continue;
      }
      out.held.push({
        kind,
        count: n,
        why: ior?.why
          ? `The IOR can't come in because ${ior.why}${inFile ? " The rows are kept in the job's archive." : ""}`
          : why,
        archived: inFile > 0,
      });
      continue;
    }
    if (inFile > 0) {
      // In the file: the archive keeps every row. Only what is still not live says so.
      if (ARCHIVED_HELD[table]) out.held.push({ kind, count: inFile, why: ARCHIVED_HELD[table] });
      continue;
    }
    out.held.push({ kind, count: n, why });
  }
  return out;
}
