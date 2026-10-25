import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, type Sb } from "../guard";
import { resolveSubmittalJob, boardFor } from "./submittal-tools";
import { changeLogCard, type ChangeLogPayload } from "../change-orders";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { cardWidgetMeta } from "../cards/widget";
import type { CardModel } from "../cards/model";
const ids = {
  job_number: z.string().trim().min(1).max(40),
  company_id: z.string().uuid().optional(),
};
const state = z.enum(["draft", "priced", "submitted", "approved", "rejected", "executed"]);
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const write = { ...read, readOnlyHint: false } as const;
async function rpc<T>(sb: Sb, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      n: string,
      a: Record<string, unknown>,
    ) => PromiseLike<{ data: T; error: { message: string } | null }>
  )(name, args);
  if (error) dbError(error);
  return data;
}
const reply = (view: ReturnType<typeof changeLogCard>, extra: Record<string, unknown> = {}) => ({
  content: [{ type: "text" as const, text: renderMarkdown(view.card) }],
  structuredContent: { ...view, ...extra, html: renderHtml(view.card) },
  _meta: cardWidgetMeta,
});
export const changeOrderLog = defineTool({
  name: "change_order_log",
  title: "Change-order log and records",
  description:
    "Reads numbered potential and issued change orders, sourced pricing, decisions, execution and persistent package links. Separate from open items and RFIs.",
  inputSchema: {
    ...ids,
    number: z.string().max(40).optional(),
    state: state.optional(),
    overdue: z.boolean().optional(),
  },
  annotations: read,
  handler: (args, ctx) =>
    run(
      "change_order_log",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveSubmittalJob(sb, args.job_number, args.company_id, "full");
        if (!job) throw new ToolError("Name the job for this change-order log.");
        const [payload, board] = await Promise.all([
          rpc<ChangeLogPayload>(sb, "mcp_change_rows", { _job: job.job_id }),
          boardFor(sb, job),
        ]);
        return reply(
          changeLogCard(payload, board, { state: args.state, overdue: args.overdue }, args.number),
          { job_id: job.job_id },
        );
      },
    ),
});
export const changeOrderRecord = defineTool({
  name: "change_order_record",
  title: "Save a change-order package record",
  description:
    "Creates a numbered PCO, saves sourced pricing, records a confirmed owner decision or execution, and reopens an issued proposal as a new revision. Execution adds a separate fee-inclusive SOV line; it does not alter earlier billing or the CPM. Attachments, PDF builds and approved delivery use the shared submittal package tools.",
  inputSchema: {
    ...ids,
    action: z.enum(["create", "edit", "price", "approve", "reject", "execute", "reopen"]),
    request_id: z.string().uuid(),
    submittal_id: z.string().uuid().optional(),
    number: z.string().max(40).optional(),
    expected_version: z.number().int().min(1).optional(),
    title: z.string().min(1).max(200).optional(),
    origin: z.enum(["owner", "contractor"]).optional(),
    condition: z.string().min(1).max(12000).optional(),
    scope: z.string().min(1).max(12000).optional(),
    spec_section: z.string().max(40).optional(),
    references: z
      .array(
        z.object({
          kind: z.enum(["drawing", "spec", "contract", "condition"]),
          citation: z.string().min(1).max(2000),
          source_id: z.string().uuid().nullable().optional(),
          revision: z.string().max(120).nullable().optional(),
          page: z.number().int().min(1).nullable().optional(),
        }),
      )
      .min(1)
      .max(40)
      .optional(),
    recipient_name: z.string().max(120).nullable().optional(),
    recipient_email: z.string().email().max(320).nullable().optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    owner_number: z.string().max(80).nullable().optional(),
    schedule_days: z.number().int().min(-3650).max(3650).nullable().optional(),
    lines: z
      .array(
        z.object({
          category: z.enum(["labor", "material", "equipment", "subcontract", "other", "markup"]),
          description: z.string().min(1).max(1000),
          quantity: z.number().min(0).max(100000000).optional(),
          unit: z.string().max(40).optional(),
          unit_rate_cents: z.number().int().min(-9000000000000).max(9000000000000).optional(),
          rate_basis_points: z.number().int().min(-10000).max(10000).optional(),
          source: z.string().min(1).max(2000),
        }),
      )
      .min(1)
      .max(200)
      .optional(),
    confirmed: z.boolean().optional(),
    evidence: z
      .object({
        by: z.string().min(1).max(320),
        at: z.string().datetime({ offset: true }),
        reference: z.string().min(1).max(2000),
      })
      .optional(),
    sov_division: z
      .string()
      .regex(/^\d{2}$/)
      .optional(),
  },
  annotations: write,
  handler: (args, ctx) =>
    run(
      "change_order_record",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveSubmittalJob(sb, args.job_number, args.company_id, "full");
        if (!job) throw new ToolError("Name the job for this change order.");
        if (args.action === "create") {
          const gaps = [
            !args.title?.trim() && "A title",
            !args.condition?.trim() && "The actual condition",
            !args.scope?.trim() && "The requested change",
            !args.references?.length && "A drawing, specification, contract or condition reference",
          ].filter((value): value is string => !!value);
          if (gaps.length) {
            const card: CardModel = {
              state: "result",
              show_state: false,
              title: "Change order · information needed",
              job: job.job_number,
              sections: [
                {
                  heading: "Before saving the draft",
                  kind: "list",
                  rows: gaps.map((gap) => ({ cells: [gap] })),
                },
              ],
              next_move: "Provide the missing information. No PCO or transmittal was created.",
            };
            return {
              content: [{ type: "text" as const, text: renderMarkdown(card) }],
              structuredContent: {
                card,
                html: renderHtml(card),
                saved: false,
                missing: gaps,
                job_id: job.job_id,
              },
              _meta: cardWidgetMeta,
            };
          }
        }
        const { job_number: jn, company_id: ci, action, ...fields } = args;
        void jn;
        void ci;
        const saved = await rpc<{ saved_id: string; number?: string; already_applied: boolean }>(
          sb,
          "mcp_change_record",
          { _job: job.job_id, _action: action, _p: fields },
        );
        try {
          const [payload, board] = await Promise.all([
            rpc<ChangeLogPayload>(sb, "mcp_change_rows", { _job: job.job_id }),
            boardFor(sb, job),
          ]);
          const row = payload.records.find((r) => r.id === saved.saved_id);
          if (!row) throw new Error("A later revision is current");
          return reply(changeLogCard(payload, board, {}, row.number), {
            ...saved,
            job_id: job.job_id,
            submittal_id: saved.saved_id,
            record_version: row.change_order_details.record_version,
          });
        } catch {
          const card: CardModel = {
            state: "result",
            show_state: false,
            title: "Change order saved",
            job: job.job_number,
            sections: [
              {
                heading: "Saved record",
                kind: "list",
                rows: [
                  {
                    cells: [
                      saved.number ?? "Change order",
                      "Your change order was saved. Reopen the log to load its updated record.",
                    ],
                  },
                ],
              },
            ],
          };
          return {
            content: [{ type: "text" as const, text: renderMarkdown(card) }],
            structuredContent: {
              ...saved,
              job_id: job.job_id,
              submittal_id: saved.saved_id,
              refresh_needed: true,
              card,
              html: renderHtml(card),
            },
            _meta: cardWidgetMeta,
          };
        }
      },
    ),
});
