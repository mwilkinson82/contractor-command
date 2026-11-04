// Job import: one source-neutral shape that every feeder (an Overwatch job
// export, spreadsheet exports, later the Procore API) is turned into before
// Athena plans what it will create. Money is integer cents throughout.
import { z } from "zod";

export const IMPORT_SOURCES = ["overwatch", "procore", "buildertrend", "spreadsheet"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(-9_000_000_000_000).max(9_000_000_000_000);
const text = (max: number) => z.string().trim().max(max);
const sourceId = z.string().trim().min(1).max(120);

export const importSovLine = z.object({
  source_id: sourceId,
  cost_code: text(40).nullable(),
  description: text(300),
  scheduled_cents: cents,
  budget_cents: cents.nullable(),
  work_to_date_cents: cents.nullable(),
  stored_to_date_cents: cents.nullable(),
  retained_cents: cents.nullable(),
});

export const importChangeOrder = z.object({
  source_id: sourceId,
  number: text(40),
  title: text(200),
  description: text(12000),
  amount_cents: cents,
  status: z.enum(["approved", "pending", "rejected", "void"]),
  date: day.nullable(),
  schedule_days: z.number().int().min(-3650).max(3650).nullable(),
  /** Our cost of the change, when the source keeps one (Overwatch v2). Never sent to the owner. */
  cost_cents: cents.nullable(),
  /** Chance a pending change is approved, 0 to 100, when the source keeps one. */
  probability: z.number().min(0).max(100).nullable(),
});

export const importRfi = z.object({
  source_id: sourceId,
  number: text(40),
  title: text(200),
  question: text(12000),
  open: z.boolean(),
  sent_on: day.nullable(),
  due_on: day.nullable(),
});

export const SUBMITTAL_STATUSES = [
  "not_started",
  "in_prep",
  "submitted",
  "in_review",
  "approved",
  "approved_as_noted",
  "revise_and_resubmit",
  "rejected",
  "closed",
] as const;

export const importSubmittal = z.object({
  source_id: sourceId,
  number: text(40),
  revision: z.number().int().min(0).max(99),
  spec_section: text(40),
  title: text(200),
  submittal_type: z.enum(["product_data", "shop_drawing", "sample", "other"]),
  status: z.enum(SUBMITTAL_STATUSES),
  ball_in_court: z.enum(["sub", "gc", "architect_engineer", "owner"]),
  submitted_on: day.nullable(),
  returned_on: day.nullable(),
  required_by: day.nullable(),
  notes: text(4000).nullable(),
});

export const importActivity = z.object({
  source_id: sourceId,
  id: text(20),
  name: text(160),
  start: day.nullable(),
  finish: day.nullable(),
  duration_days: z.number().int().min(0).max(5000).nullable(),
  pct_complete: z.number().min(0).max(100).nullable(),
  predecessors: z.array(text(20)).max(20),
});

export const importDailyLine = z.object({
  work: text(500),
  qty: z.number().positive(),
  unit: text(40),
  crew: z.number().positive(),
  hours: z.number().positive(),
  pct_complete: z.number().min(0).max(100).nullable(),
});

export const importDaily = z.object({
  source_id: sourceId,
  date: day,
  weather: text(2000),
  manpower: text(2000),
  subs: text(2000),
  deliveries: text(2000),
  issues: text(4000),
  delays: text(4000),
  safety: text(4000),
  work_summary: text(8000),
  lines: z.array(importDailyLine).max(80),
});

// IOR: the shape Athena's IOR page reads as data.ior_model (src/lib/ior-model.ts).
// Money here is DOLLARS, as ior_model keeps it, not cents.
const dollarAmount = z.number().min(-90_000_000_000).max(90_000_000_000);
export const importIorChangeOrder = z.object({
  number: text(40),
  description: text(300),
  status: z.enum(["Approved", "Pending"]),
  contract_amount: dollarAmount,
  cost_amount: dollarAmount,
  probability: z.number().min(0).max(100),
});
export const IOR_CATEGORIES = [
  "owner_decision",
  "design_drift",
  "trade_performance",
  "procurement",
  "schedule_compression",
  "allowance_overrun",
  "field_change",
  "closeout_punch",
  "other",
] as const;
export const importIorExposure = z.object({
  source_id: sourceId,
  title: text(300),
  category: z.enum(IOR_CATEGORIES),
  response: z.enum(["eliminate", "recover", "offset", "accept"]),
  hold: z.enum(["E", "C"]),
  dollar_risk: z.number().min(0).max(90_000_000_000),
  probability: z.number().min(0).max(100),
  owner: text(80).nullable(),
  opened: day.nullable(),
  next_review: day.nullable(),
  next_move: text(300).nullable(),
  status: text(40).nullable(),
});
export const importIor = z.object({
  source_id: sourceId,
  original_contract: z.number().positive().max(90_000_000_000),
  original_cost_budget: z.number().min(0).max(90_000_000_000).nullable(),
  cost_growth: dollarAmount,
  cost_growth_note: text(300).nullable(),
  actual_cost_to_date: z.number().min(0).max(90_000_000_000),
  phase: z.enum(["Early", "Middle", "Late"]),
  percent_complete: z.number().min(0).max(100),
  baseline_completion: day.nullable(),
  forecast_completion: day.nullable(),
  change_orders: z.array(importIorChangeOrder).max(500),
  exposures: z.array(importIorExposure).max(1000),
});

/**
 * The archive: every source row, as the source stored it, keyed by source table
 * and then by the row's own id. Kept read-only on the job so nothing is lost,
 * including rows Athena also mapped into its own records.
 */
export const ARCHIVE_TABLE = /^[a-z][a-z0-9_]{0,62}$/;
export const ARCHIVE_MAX_ROWS = 50_000;
export const importArchive = z
  .record(
    z.string().regex(ARCHIVE_TABLE),
    z.record(z.string().min(1).max(200), z.record(z.string(), z.unknown())),
  )
  .refine(
    (a) => Object.values(a).reduce((n, t) => n + Object.keys(t).length, 0) <= ARCHIVE_MAX_ROWS,
    `The archive holds more than ${ARCHIVE_MAX_ROWS} rows.`,
  );

/** What the source holds that this import does not bring in, said plainly. */
export const importHeld = z.object({
  kind: text(60),
  count: z.number().int().min(0),
  why: text(400),
  /** True when the rows themselves are kept in the job's read-only archive. */
  archived: z.boolean().optional(),
});

export const importJob = z.object({
  source: z.object({
    system: z.enum(IMPORT_SOURCES),
    exported_at: z.string().max(40).nullable(),
    label: text(200),
  }),
  job: z.object({
    source_id: sourceId,
    job_number: text(40),
    name: text(200),
    customer: text(200).nullable(),
    pm_name: text(120).nullable(),
    pm_email: text(200).nullable(),
    completion_date: day.nullable(),
  }),
  contract: z.object({
    original_cents: cents.nullable(),
    retainage_pct: z.number().min(0).max(100).nullable(),
  }),
  billing: z.object({
    last_application: text(40).nullable(),
    period_to: day.nullable(),
  }),
  sov: z.array(importSovLine).max(300),
  change_orders: z.array(importChangeOrder).max(500),
  rfis: z.array(importRfi).max(1000),
  submittals: z.array(importSubmittal).max(1000),
  schedule: z.array(importActivity).max(400),
  dailies: z.array(importDaily).max(1000),
  ior: importIor.nullable(),
  archive: importArchive,
  held: z.array(importHeld).max(40),
  problems: z.array(text(400)).max(200),
});

export type ImportJob = z.infer<typeof importJob>;
export type ImportSovLine = z.infer<typeof importSovLine>;
export type ImportChangeOrder = z.infer<typeof importChangeOrder>;
export type ImportSubmittal = z.infer<typeof importSubmittal>;
export type ImportDaily = z.infer<typeof importDaily>;
export type ImportActivity = z.infer<typeof importActivity>;
export type ImportRfi = z.infer<typeof importRfi>;
export type ImportIor = z.infer<typeof importIor>;
export type ImportIorExposure = z.infer<typeof importIorExposure>;
export type ImportArchive = z.infer<typeof importArchive>;

export class ImportInputError extends Error {}

export const toCents = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .replace(/[$,\s]/g, "")
            .replace(/^\((.*)\)$/, "-$1"),
        );
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export const toDay = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const [y, m, d] = iso
    ? [iso[1], iso[2], iso[3]]
    : us
      ? [us[3].length === 2 ? `20${us[3]}` : us[3], us[1].padStart(2, "0"), us[2].padStart(2, "0")]
      : [];
  if (!y) return null;
  const out = `${y}-${m}-${d}`;
  const t = new Date(`${out}T00:00:00Z`);
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === out ? out : null;
};

export const clip = (value: unknown, max: number): string =>
  (value === null || value === undefined ? "" : String(value))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function emptyImport(system: ImportSource, label: string): ImportJob {
  return {
    source: { system, exported_at: null, label },
    job: {
      source_id: "job",
      job_number: "",
      name: "",
      customer: null,
      pm_name: null,
      pm_email: null,
      completion_date: null,
    },
    contract: { original_cents: null, retainage_pct: null },
    billing: { last_application: null, period_to: null },
    sov: [],
    change_orders: [],
    rfis: [],
    submittals: [],
    schedule: [],
    dailies: [],
    ior: null,
    archive: {},
    held: [],
    problems: [],
  };
}
