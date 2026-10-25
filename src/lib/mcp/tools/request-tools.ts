import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, type Sb } from "../guard";
import { boardFor, resolveSubmittalJob } from "./submittal-tools";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { cardWidgetMeta } from "../cards/widget";
import type { CardModel } from "../cards/model";
import { callHost } from "../call-host";
import { requestContentGaps } from "../package-purpose";
import { requestLogCard, type RequestKind, type RequestLogPayload } from "../request-log";

const ids = {
  job_number: z.string().trim().min(1).max(40),
  company_id: z.string().uuid().optional(),
};
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reference = z.object({
  kind: z.enum(["drawing", "spec", "contract", "condition"]),
  citation: z.string().min(1).max(2000),
  source_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      "Optional ID of a drawing stored on this job; specification and contract references use their exact citation.",
    ),
  revision: z.string().max(120).nullable().optional(),
  page: z.number().int().min(1).nullable().optional(),
});
const references = z.array(reference).min(1).max(40);
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

function logTool(kind: RequestKind) {
  const name = `${kind}_log`;
  return defineTool({
    name,
    title: kind === "rfi" ? "RFI log and request records" : "RFC bid clarification log",
    description:
      kind === "rfi"
        ? "Reads the saved request-for-information log or one numbered RFI, with its question, references, status and persistent package links."
        : "Reads the saved bid-stage request-for-clarification log or one numbered RFC, separately from construction RFIs and open items.",
    inputSchema: {
      ...ids,
      number: z.string().trim().min(1).max(40).optional(),
      state: z.enum(["draft", "sent", "answered", "closed"]).optional(),
      overdue: z.boolean().optional(),
    },
    annotations: read,
    handler: (args, ctx) =>
      run(name, ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
        const job = await resolveSubmittalJob(sb, args.job_number, args.company_id);
        if (!job) throw new ToolError("Name the job for this log.");
        const [payload, board] = await Promise.all([
          rpc<RequestLogPayload>(sb, "mcp_request_rows", { _job: job.job_id, _kind: kind }),
          boardFor(sb, job),
        ]);
        const view = requestLogCard(
          kind,
          payload,
          board,
          { state: args.state, overdue: args.overdue },
          args.number,
        );
        const record =
          args.number && view.records.length
            ? await rpc<JsonValue>(sb, "mcp_submittal_record_get", {
                _job: job.job_id,
                _number: view.records[0].number,
              })
            : null;
        return {
          content: [{ type: "text" as const, text: renderMarkdown(view.card) }],
          structuredContent: {
            ...view,
            html: renderHtml(view.card),
            job_id: job.job_id,
            read_only: payload.read_only,
            record,
          },
          _meta: cardWidgetMeta,
        };
      }),
  });
}

function recordTool(kind: RequestKind) {
  const name = `${kind}_record`;
  return defineTool({
    name,
    title: kind === "rfi" ? "Save an RFI package record" : "Save an RFC bid clarification package",
    description:
      "Creates or edits a numbered request package, captures a response, or explicitly closes/reopens it; attachments, PDF builds and approved delivery use the shared submittal package tools.",
    inputSchema: {
      ...ids,
      action: z.enum(["create", "edit", "answer", "close", "reopen"]),
      request_id: z.string().uuid(),
      submittal_id: z.string().uuid().optional(),
      number: z.string().trim().min(1).max(40).optional(),
      expected_version: z.number().int().min(1).optional(),
      title: z.string().min(1).max(200).optional(),
      condition: z.string().min(1).max(12000).optional(),
      question: z.string().min(1).max(12000).optional(),
      references: references.optional(),
      spec_section: z.string().max(40).optional(),
      suggested_resolution: z.string().max(12000).nullable().optional(),
      recipient_name: z.string().max(120).nullable().optional(),
      recipient_role: z
        .enum(["architect", "engineer", "owner", "construction_manager", "other"])
        .nullable()
        .optional(),
      recipient_email: z.string().email().max(320).nullable().optional(),
      due_date: date.nullable().optional(),
      confirmed: z.boolean().optional(),
      answer: z
        .object({
          text: z.string().min(1).max(12000),
          received_from: z.string().min(1).max(320),
          received_at: z.string().datetime({ offset: true }),
          references: z.array(reference).max(40).optional(),
        })
        .optional(),
    },
    annotations: save,
    handler: (args, ctx) =>
      run(name, ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
        const job = await resolveSubmittalJob(sb, args.job_number, args.company_id, "full");
        if (!job) throw new ToolError("Name the job for this request.");
        if (args.action === "create") {
          const gaps = requestContentGaps(args);
          if (!args.title?.trim()) gaps.unshift("A title for the request");
          if (gaps.length) {
            const card: CardModel = {
              state: "result",
              show_state: false,
              title: `${kind.toUpperCase()} · information needed`,
              job: job.job_number,
              sections: [
                {
                  heading: "Before saving the draft",
                  kind: "list",
                  rows: gaps.map((gap) => ({ cells: [gap] })),
                },
              ],
              next_move: "Provide the missing information. No request or transmittal was created.",
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
        const { job_number: _jobNumber, company_id: _companyId, action, ...fields } = args;
        void _jobNumber;
        void _companyId;
        const saved = await rpc<{ saved_id: string; number?: string; already_applied: boolean }>(
          sb,
          "mcp_request_record",
          {
            _job: job.job_id,
            _kind: kind,
            _action: action,
            _p: { ...fields, host: callHost(ctx) },
          },
        );
        try {
          const [payload, board] = await Promise.all([
            rpc<RequestLogPayload>(sb, "mcp_request_rows", { _job: job.job_id, _kind: kind }),
            boardFor(sb, job),
          ]);
          const selected = payload.records.find((row) => row.id === saved.saved_id);
          if (!selected) throw new Error("A later revision is now current");
          const view = requestLogCard(kind, payload, board, {}, selected.number);
          return {
            content: [{ type: "text" as const, text: renderMarkdown(view.card) }],
            structuredContent: {
              ...view,
              ...saved,
              html: renderHtml(view.card),
              job_id: job.job_id,
              submittal_id: saved.saved_id,
              record_version: selected.request_details.record_version,
              package_purpose: kind,
              delivery_state: selected.state,
            },
            _meta: cardWidgetMeta,
          };
        } catch {
          const card: CardModel = {
            state: "result",
            show_state: false,
            title: `${kind.toUpperCase()} saved`,
            job: job.job_number,
            sections: [
              {
                heading: "Saved record",
                kind: "list",
                rows: [
                  {
                    cells: [
                      saved.number ?? kind.toUpperCase(),
                      "Your request was saved. The updated log could not be loaded; reopen the log to view the latest record.",
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
              card,
              html: renderHtml(card),
              refresh_needed: true,
            },
            _meta: cardWidgetMeta,
          };
        }
      }),
  });
}

export const rfiLog = logTool("rfi");
export const rfcLog = logTool("rfc");
export const rfiRecord = recordTool("rfi");
export const rfcRecord = recordTool("rfc");
