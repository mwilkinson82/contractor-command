// Job logs: the claims register (with events), the inspection log and the
// owner decision log. Read with project_log; write with project_log_record.
// Full job access reads and writes all three; a Super reads and records
// inspections only, never their cost.
import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, type Sb } from "../guard";
import { resolveSubmittalJob } from "./submittal-tools";
import type { CardModel } from "../cards/model";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { cardWidgetMeta } from "../cards/widget";
import { callHost } from "../call-host";
import {
  CLAIM_EVENTS,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  DECISION_STATUSES,
  INSPECTION_RESULTS,
  INSPECTION_STATUSES,
} from "../../job-import/model";

export const JOB_LOGS = ["claims", "inspections", "decisions"] as const;
export type JobLog = (typeof JOB_LOGS)[number];
type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
export type JobLogPayload = {
  job_id: string;
  job_number: string;
  job_name: string;
  log: JobLog;
  today: string;
  read_only: boolean;
  no_financials: boolean;
  records: Row[];
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LABEL: Record<JobLog, string> = {
  claims: "Claims register",
  inspections: "Inspection log",
  decisions: "Owner decision log",
};

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => PromiseLike<{ data: T; error: { message?: string } | null }>
  )(fn, args);
  if (error) dbError(error);
  return data;
}

const s = (v: unknown) => (v == null || v === "" ? "" : String(v));
const words = (v: unknown) => s(v).replace(/_/g, " ");
const usd = (cents: unknown) =>
  typeof cents === "number"
    ? (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "";

/** The card for one log. Pure, so it is tested without a database. */
export function jobLogCard(payload: JobLogPayload, selected?: string): CardModel {
  const all = payload.records;
  const rows = selected
    ? all.filter((r) => s(r.number).toUpperCase() === selected.toUpperCase() || r.id === selected)
    : all;
  const table = (columns: string[], cells: (r: Row) => string[]) => ({
    heading: LABEL[payload.log],
    kind: "table" as const,
    columns,
    rows: rows.length
      ? rows.map((r) => ({
          cells: cells(r),
          flag: r.overdue ? ("overdue" as const) : null,
        }))
      : [
          {
            cells: [
              all.length
                ? `Nothing matches. ${all.length} on this log.`
                : "Nothing on this log yet.",
              ...columns.slice(1).map(() => ""),
            ],
          },
        ],
  });
  let section;
  let kpis: CardModel["kpis"];
  if (payload.log === "claims") {
    const open = all.filter(
      (r) => !["resolved", "rejected", "withdrawn"].includes(s(r.status)),
    ).length;
    const claimed = all.reduce((t, r) => t + (Number(r.money_claimed_cents) || 0), 0);
    kpis = [
      { label: "Open claims", value: String(open) },
      { label: "Claimed", value: usd(claimed) },
    ];
    section = table(["Claim", "Type", "Status", "Claimed", "Time", "Events", "Links"], (r) => [
      `${s(r.number)} · ${s(r.title)}`,
      words(r.claim_type),
      words(r.status),
      `${usd(r.money_claimed_cents)}${r.money_awarded_cents ? ` (awarded ${usd(r.money_awarded_cents)})` : ""}`,
      `${s(r.time_claimed_days)} days${r.time_awarded_days ? ` (awarded ${s(r.time_awarded_days)})` : ""}`,
      String((r.events as unknown[] | undefined)?.length ?? 0),
      [
        r.change_order_number ? `PCO ${s(r.change_order_number)}` : "",
        r.delay_event_id ? "Delay event" : "",
        r.exposure_ref ? `Risk: ${s(r.exposure_ref)}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    ]);
  } else if (payload.log === "inspections") {
    const failed = all.filter((r) => r.result === "fail").length;
    const upcoming = all.filter(
      (r) => ["requested", "scheduled"].includes(s(r.status)) && s(r.scheduled_on) >= payload.today,
    ).length;
    kpis = [
      { label: "Upcoming", value: String(upcoming) },
      { label: "Failed", value: String(failed), flag: failed ? "overdue" : null },
    ];
    section = table(
      [
        "Inspection",
        "Status",
        "Result",
        "Scheduled",
        "Authority",
        ...(payload.no_financials ? [] : ["Cost"]),
      ],
      (r) => [
        `${s(r.inspection_type)}${Number(r.attempt) > 1 ? ` · attempt ${s(r.attempt)}` : ""}${s(r.location) ? ` · ${s(r.location)}` : ""}`,
        words(r.status),
        words(r.result),
        s(r.scheduled_on) || s(r.requested_on) || "Not scheduled",
        s(r.authority),
        ...(payload.no_financials ? [] : [r.cost_impact_cents ? usd(r.cost_impact_cents) : ""]),
      ],
    );
  } else {
    const open = all.filter((r) => ["open", "in_progress"].includes(s(r.status))).length;
    const overdue = all.filter((r) => r.overdue).length;
    kpis = [
      { label: "Waiting on a decision", value: String(open) },
      { label: "Overdue", value: String(overdue), flag: overdue ? "overdue" : null },
    ];
    section = table(["Decision", "Status", "Owner", "Due", "Impact", "Links"], (r) => [
      `${s(r.number)} · ${s(r.decision)}`,
      words(r.status) + (r.decided_on ? ` ${s(r.decided_on)}` : ""),
      s(r.owner_name),
      s(r.due_on) || "No due date",
      s(r.impact),
      [
        r.change_order_number ? `PCO ${s(r.change_order_number)}` : "",
        r.selection_id ? "Selection board" : "",
        r.exposure_ref ? `Risk: ${s(r.exposure_ref)}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    ]);
  }
  return {
    state: "result",
    show_state: false,
    title: LABEL[payload.log],
    job: `${payload.job_number} – ${payload.job_name}`,
    kpis,
    sections: [section],
    next_move: payload.read_only
      ? "Read-only job view."
      : "Say what changed and Athena records it here, with the date.",
  };
}

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const save = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const ids = {
  job_number: z.string().trim().min(1).max(40),
  company_id: z.string().uuid().optional(),
  log: z.enum(JOB_LOGS),
};

function result(payload: JobLogPayload, extra: Row, selected?: string) {
  const card = jobLogCard(payload, selected);
  return {
    content: [{ type: "text" as const, text: renderMarkdown(card) }],
    structuredContent: {
      card,
      html: renderHtml(card),
      job_id: payload.job_id,
      log: payload.log,
      read_only: payload.read_only,
      records: payload.records,
      ...extra,
    },
    _meta: cardWidgetMeta,
  };
}

export const projectLog = defineTool({
  name: "project_log",
  title: "Claims, inspections and owner decisions",
  description:
    "Reads one of the job's logs: the claims register (claims and their events), the inspection log, or the owner decision log.",
  inputSchema: { ...ids, number: z.string().trim().min(1).max(40).optional() },
  annotations: read,
  handler: (args, ctx) =>
    run(
      "project_log",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveSubmittalJob(sb, args.job_number, args.company_id);
        if (!job) throw new ToolError("Name the job for this log.");
        const payload = await rpc<JobLogPayload>(sb, "mcp_job_log_rows", {
          _job: job.job_id,
          _log: args.log,
        });
        return result(payload, {}, args.number);
      },
    ),
});

export const projectLogRecord = defineTool({
  name: "project_log_record",
  title: "Record a claim, inspection or owner decision",
  description:
    "Adds or updates an entry on the claims register, inspection log or owner decision log, or adds an event to a claim. Nothing is sent to anyone.",
  inputSchema: {
    ...ids,
    action: z.enum(["create", "update", "event"]),
    request_id: z.string().uuid(),
    expected_version: z.number().int().min(1).optional(),
    number: z.string().trim().min(1).max(40).optional(),
    claim_id: z.string().uuid().optional(),
    inspection_id: z.string().uuid().optional(),
    decision_id: z.string().uuid().optional(),
    // Claims
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(12000).optional(),
    claim_type: z.enum(CLAIM_TYPES).optional(),
    money_claimed_cents: z.number().int().min(0).optional(),
    money_awarded_cents: z.number().int().min(0).optional(),
    time_claimed_days: z.number().int().min(0).max(3650).optional(),
    time_awarded_days: z.number().int().min(0).max(3650).optional(),
    submitted_on: date.nullable().optional(),
    resolved_on: date.nullable().optional(),
    delay_event_id: z.string().uuid().nullable().optional(),
    claim_item_id: z.string().uuid().nullable().optional(),
    event_type: z.enum(CLAIM_EVENTS).optional(),
    event_date: date.nullable().optional(),
    revision_number: z.number().int().min(0).max(99).optional(),
    note: z.string().max(4000).nullable().optional(),
    // Inspections
    inspection_type: z.string().trim().min(1).max(120).optional(),
    authority: z.string().max(200).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    inspector: z.string().max(120).nullable().optional(),
    responsible_party: z.string().max(120).nullable().optional(),
    result: z.enum(INSPECTION_RESULTS).optional(),
    requested_on: date.nullable().optional(),
    scheduled_on: date.nullable().optional(),
    completed_on: date.nullable().optional(),
    attempt: z.number().int().min(1).max(99).optional(),
    reinspection_required: z.boolean().optional(),
    cost_impact_cents: z.number().int().optional(),
    schedule_impact_weeks: z.number().min(-520).max(520).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    corrective_action: z.string().max(4000).nullable().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    risk_ref: z.string().max(300).nullable().optional(),
    // Decisions
    decision: z.string().trim().min(1).max(2000).optional(),
    owner_name: z.string().max(120).nullable().optional(),
    owner_email: z.string().email().max(320).nullable().optional(),
    due_on: date.nullable().optional(),
    impact: z.string().max(2000).nullable().optional(),
    decided_on: date.nullable().optional(),
    outcome: z.string().max(4000).nullable().optional(),
    selection_id: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe("A selection on the job's selection board this decision is about. Read only."),
    // Shared
    status: z
      .string()
      .trim()
      .max(40)
      .optional()
      .describe(
        `Claims: ${CLAIM_STATUSES.join(", ")}. Inspections: ${INSPECTION_STATUSES.join(", ")}. Decisions: ${DECISION_STATUSES.join(", ")}.`,
      ),
    change_order_id: z.string().uuid().nullable().optional(),
    exposure_ref: z.string().max(300).nullable().optional(),
  },
  annotations: save,
  handler: (args, ctx) =>
    run(
      "project_log_record",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveSubmittalJob(sb, args.job_number, args.company_id);
        if (!job) throw new ToolError("Name the job for this log.");
        const { job_number: _n, company_id: _c, log, action, ...fields } = args;
        void _n;
        void _c;
        const saved = await rpc<{ saved_id: string; number: string; already_applied: boolean }>(
          sb,
          "mcp_job_log_record",
          { _job: job.job_id, _log: log, _action: action, _p: { ...fields, host: callHost(ctx) } },
        );
        const payload = await rpc<JobLogPayload>(sb, "mcp_job_log_rows", {
          _job: job.job_id,
          _log: log,
        });
        return result(payload, { ...saved }, log === "inspections" ? undefined : saved.number);
      },
    ),
});
