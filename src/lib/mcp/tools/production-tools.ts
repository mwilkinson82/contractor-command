// Approved work mapping and field production. Billing is maintained separately.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { audit, prefix, resolveJob } from "../jobs";
import { guide } from "../visible";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const allocation = z.object({
  sov_fact_id: uuid,
  activity_id: z.string().trim().min(1).max(20),
  allocated_cents: z.number().int().safe(),
  planned_quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().min(1).max(20).nullable().optional(),
  planned_man_hours: z.number().positive().nullable().optional(),
  planned_source: z.string().trim().min(1).max(1000).nullable().optional(),
});
const allocations = z.array(allocation).min(1).max(1000);
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const SAVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      name: string,
      input: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(fn, args);
  if (error) {
    if (isMissingFunction(error))
      throw new ToolError("This production workflow isn't available yet. Nothing was changed.");
    dbError(error);
  }
  return data as T;
}

type Sources = {
  currency: "USD";
  cpm_id: string | null;
  cpm_version: number | null;
  activities: unknown[];
  sov: { fact_id: string; item: string; status: string }[];
  mapping_version: number;
};
export const productionMappingSources = defineTool({
  name: "production_mapping_sources",
  title: "SOV and CPM mapping sources",
  description: "Returns the saved project SOV and CPM sources for a proposed production mapping.",
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: READ,
  handler: (args, ctx) =>
    run("production_mapping_sources", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const sources = await rpc<Sources>(sb, "mcp_production_mapping_sources", {
        _job: job.job_id,
      });
      await audit(sb, job, "production_mapping_sources", "view_production_mapping_sources", null);
      return guide(
        {
          ...text(
            `${prefix(job)}SOV and CPM mapping sources${sources.cpm_version ? ` · CPM v${sources.cpm_version}` : " · No saved CPM"}.`,
          ),
          structuredContent: { ...sources } as never,
        },
        "Propose allocations only from these saved USD sources. SOV amounts are line values before separately stated contract fee; a negative SOV credit is allocated as a negative value. Preserve item and activity IDs. Do not guess quantities, labor basis, or allocation amounts. Review with production_mapping_preview before approval.",
      );
    }),
});

export const productionMappingPreview = defineTool({
  name: "production_mapping_preview",
  title: "Review SOV to CPM allocation",
  description: "Validates a proposed SOV to CPM mapping for human review without saving it.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    cpm_id: uuid,
    effective_date: date,
    reason: z.string().trim().min(1).max(1000),
    allocations,
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("production_mapping_preview", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const sources = await rpc<Sources>(sb, "mcp_production_mapping_sources", {
        _job: job.job_id,
      });
      const preview = await rpc<Record<string, unknown>>(sb, "mcp_production_mapping_preview", {
        _job: job.job_id,
        _cpm: args.cpm_id,
        _base_version: sources.mapping_version,
        _effective: args.effective_date,
        _reason: args.reason,
        _allocations: args.allocations,
      });
      const requestKey = crypto.randomUUID();
      const sov = preview.sov as {
        fact_id: string;
        item: string;
        value: { description?: string };
      }[];
      const lines = args.allocations.map((a) => {
        const source = sov.find((s) => s.fact_id === a.sov_fact_id);
        const value = `${a.allocated_cents < 0 ? "-" : ""}$${(Math.abs(a.allocated_cents) / 100).toFixed(2)} USD`;
        return `SOV ${source?.item ?? a.sov_fact_id}${source?.value.description ? ` (${source.value.description})` : ""} → ${a.activity_id}: ${value}${a.planned_quantity != null ? ` · planned ${a.planned_quantity} ${a.unit ?? "unit needed"}` : ""}${a.planned_man_hours != null ? ` · ${a.planned_man_hours} planned person-hours` : ""}${a.planned_source ? ` · basis: ${a.planned_source}` : ""}`;
      });
      const included = new Set(args.allocations.map((a) => a.sov_fact_id));
      const omitted = sources.sov.filter((s) => !included.has(s.fact_id)).map((s) => s.item);
      return guide(
        {
          ...text(
            [
              `${prefix(job)}Draft mapping · CPM v${preview.cpm_version} · effective ${args.effective_date}`,
              ...lines,
              omitted.length
                ? `Unallocated SOV lines at source read: ${omitted.join(", ")}.`
                : "No additional SOV lines were listed at source read.",
              `Reason: ${args.reason}`,
              "The included SOV lines reconcile. This is not yet approved or saved.",
            ].join("\n"),
          ),
          structuredContent: {
            saved: false,
            preview: preview as never,
            allocations: args.allocations,
            cpm_id: args.cpm_id,
            base_version: sources.mapping_version,
            effective_date: args.effective_date,
            reason: args.reason,
            request_key: requestKey,
          },
        },
        "Show the entire proposed allocation and ask the authorized PM to approve it. Only after an explicit yes call production_mapping_approve with the exact returned preview, allocations, base version, effective date, reason and request key. Do not infer approval.",
      );
    }),
});

export const productionMappingApprove = defineTool({
  name: "production_mapping_approve",
  title: "Approve SOV to CPM allocation",
  description: "Saves a reviewed mapping version after explicit approval.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    cpm_id: uuid,
    base_version: z.number().int().min(0),
    effective_date: date,
    reason: z.string().trim().min(1).max(1000),
    request_key: uuid,
    preview: z.record(z.string(), z.unknown()),
    allocations,
    confirmed: z.boolean(),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("production_mapping_approve", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (!args.confirmed)
        throw new ToolError("Ask the PM to approve the reviewed mapping first. Nothing was saved.");
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const result = await rpc<{ id: string; version: number; replayed: boolean }>(
        sb,
        "mcp_production_mapping_approve",
        {
          _job: job.job_id,
          _cpm: args.cpm_id,
          _base_version: args.base_version,
          _effective: args.effective_date,
          _reason: args.reason,
          _request_key: args.request_key,
          _preview: args.preview,
          _allocations: args.allocations,
          _confirmed: true,
        },
      );
      await audit(sb, job, "production_mapping_approve", "approve_production_mapping", result.id);
      return {
        ...text(
          `${prefix(job)}Approved mapping v${result.version} is saved${result.replayed ? " (existing request)" : ""}.`,
        ),
        structuredContent: result,
      };
    }),
});

export const productionWorkReferences = defineTool({
  name: "production_work_references",
  title: "Approved work references",
  description: "Lists approved SOV and CPM references for a field work date.",
  inputSchema: { job_number: jobNumber, company_id: companyId, report_date: date },
  annotations: READ,
  handler: (args, ctx) =>
    run("production_work_references", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const refs = await rpc<
        {
          allocation_id: string;
          mapping_version: number;
          sov_item: string;
          activity_id: string;
          unit: string | null;
        }[]
      >(sb, "mcp_production_work_references", {
        _job: job.job_id,
        _date: args.report_date,
      });
      return {
        ...text(
          [
            `${prefix(job)}Approved work references for ${args.report_date}`,
            ...(refs.length
              ? refs.map(
                  (r) =>
                    `SOV ${r.sov_item} · ${r.activity_id} · mapping v${r.mapping_version}${r.unit ? ` · ${r.unit}` : ""}`,
                )
              : ["No approved references for this date."]),
          ].join("\n"),
        ),
        structuredContent: { references: refs },
      };
    }),
});

export const weeklyProduction = defineTool({
  name: "weekly_production",
  title: "Weekly production",
  description:
    "Shows recorded quantities and person-hours against approved work references for up to seven days.",
  inputSchema: { job_number: jobNumber, company_id: companyId, from: date, to: date },
  annotations: READ,
  handler: (args, ctx) =>
    run("weekly_production", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const result = await rpc<{
        rows: {
          sov_item: string;
          activity_id: string;
          mapping_version: number;
          unit: string;
          period_quantity: number | null;
          period_man_hours: number | null;
          actual_rate: number | null;
          cumulative_quantity: number | null;
          cumulative_man_hours: number | null;
          planned_rate: number | null;
          planned_source: string | null;
        }[];
        unmapped_current_lines: number;
        earned_value: null;
      }>(sb, "mcp_weekly_production", {
        _job: job.job_id,
        _from: args.from,
        _to: args.to,
      });
      return guide(
        {
          ...text(
            [
              `${prefix(job)}Production · ${args.from} to ${args.to}`,
              ...(result.rows.length
                ? result.rows.map(
                    (r) =>
                      `SOV ${r.sov_item} · ${r.activity_id} · mapping v${r.mapping_version}: period ${r.period_quantity ?? "unknown"} ${r.unit}, ${r.period_man_hours ?? "unknown"} person-hours, actual ${r.actual_rate == null ? "unknown" : `${Number(r.actual_rate).toFixed(2)} ${r.unit}/person-hour`}; planned ${r.planned_rate == null ? "unknown" : `${Number(r.planned_rate).toFixed(2)} ${r.unit}/person-hour${r.planned_source ? ` (${r.planned_source})` : ""}`}; cumulative ${r.cumulative_quantity ?? "unknown"} ${r.unit}, ${r.cumulative_man_hours ?? "unknown"} person-hours.`,
                  )
                : ["No approved-mapped production recorded through this period."]),
              ...(result.unmapped_current_lines
                ? [
                    `${result.unmapped_current_lines} earlier work line(s) have no approved mapping and are excluded.`,
                  ]
                : []),
              "Earned value: unknown. Physical progress is separate from billing and payment.",
            ].join("\n"),
          ),
          structuredContent: result,
        },
        "Show the actual and planned rates only when supplied, and show missing values as unknown. This is physical progress, not invoicing or payment; earned value is unknown.",
      );
    }),
});

export const productionPhotoAssociate = defineTool({
  name: "production_photo_associate",
  title: "Associate a progress photo",
  description: "Associates an existing photo with a specific approved daily work revision.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    photo_id: uuid,
    revision_line_id: uuid,
    request_key: uuid,
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("production_photo_associate", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const result = await rpc<{ id: string; replayed: boolean }>(
        sb,
        "mcp_production_photo_associate",
        {
          _job: job.job_id,
          _photo: args.photo_id,
          _line: args.revision_line_id,
          _key: args.request_key,
        },
      );
      await audit(sb, job, "production_photo_associate", "associate_production_photo", result.id);
      return {
        ...text(`${prefix(job)}Photo associated with the selected work revision.`),
        structuredContent: result,
      };
    }),
});
