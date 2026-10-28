import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { sha256Hex } from "../file-share";

// This draft is deliberately not registered in ATHENA_TOOLS until the staged schema is coordinated.
const allocation = z
  .object({
    job_number: z.string().trim().min(1).max(40).optional(),
    cost_code: z.string().trim().min(1).max(40),
    amount_cents: z.number().int().positive().max(9000000000000),
  })
  .strict();
const facts = z
  .object({
    kind: z.enum(["supplier_bill", "company_paid_expense", "reimbursable_expense"]).optional(),
    description: z.string().trim().min(1).max(200).optional(),
    counterparty_name: z.string().trim().min(1).max(200).optional(),
    incurred_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    amount_cents: z.number().int().positive().max(9000000000000).optional(),
    allocations: z.array(allocation).min(1).max(100).optional(),
    document_reference: z.string().trim().min(1).max(200).optional(),
    original: z.literal("missing").optional(),
  })
  .strict();
type Facts = z.infer<typeof facts>;
const payloadSchema = z
  .object({
    id: z.string().uuid(),
    request_id: z.string().uuid(),
    expected_version: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(2000).optional(),
    facts: z
      .object({
        kind: z.enum(["supplier_bill", "company_paid_expense", "reimbursable_expense"]),
        description: z.string(),
        counterparty_name: z.string(),
        incurred_on: z.string(),
        amount_cents: z.number().int(),
        original: z.literal("missing"),
        document_reference: z.string().optional(),
        allocations: z.array(
          z
            .object({
              job_id: z.string().uuid(),
              cost_code: z.string(),
              amount_cents: z.number().int(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
type Payload = z.infer<typeof payloadSchema>;
const jobFields = {
  job_number: z.string().trim().min(1).max(40).optional(),
  company_id: z.string().trim().min(1).max(200).optional(),
};
async function rpc<T>(sb: Sb, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      n: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string } | null }>
  )(name, args);
  if (error) dbError(error);
  return data;
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
const key = (jobId: string, payload: Payload) =>
  sha256Hex(new TextEncoder().encode(canonical({ jobId, payload })));
export function missingSubmissionFacts(f: Facts): string[] {
  const missing: string[] = [];
  if (!f.kind) missing.push("bill or expense type and who paid");
  if (!f.description) missing.push("description");
  if (!f.counterparty_name) missing.push("supplier or payee");
  if (!f.incurred_on) missing.push("date");
  if (f.amount_cents === undefined) missing.push("amount");
  if (!f.allocations?.length) missing.push("job and cost code allocation");
  return missing;
}
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
export const jobCostSubmissionRead = defineTool({
  name: "job_cost_submissions_read",
  title: "Read submitted job costs",
  description:
    "Reads submitted supplier bill and field expense metadata for a job, subject to full access to every job in each record. Posting and attachments are unavailable.",
  inputSchema: jobFields,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "job_cost_submissions_read",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (!args.job_number)
          return guide(
            { ...text("Which job should I check?"), structuredContent: { missing: ["job"] } },
            "Ask which job; do not guess.",
          );
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const data = await rpc<Record<string, unknown>>(sb, "mcp_cost_submission_read", {
          _job: job.job_id,
        });
        return guide(
          {
            ...text(
              `${job.job_number}: submitted cost records. Originals are not stored here; accounting posting is not available.`,
            ),
            structuredContent: data as never,
          },
          "Show records and their current submitted version. Never claim these are posted, paid or complete financial history.",
        );
      },
    ),
});
export const jobCostSubmissionRecord = defineTool({
  name: "job_cost_submission_record",
  title: "Review or submit job cost metadata",
  description:
    "Reviews and records a supplier bill or field expense for job allocation; never moves money, retains originals, or posts to accounting.",
  inputSchema: {
    ...jobFields,
    step: z.enum(["review", "save"]),
    facts: facts.optional(),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    payload: payloadSchema.optional(),
    review_key: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "job_cost_submission_record",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (!args.job_number)
          return guide(
            {
              ...text("Which job is this for? Nothing was recorded."),
              structuredContent: { saved: false, missing: ["job"] },
            },
            "Ask which job; do not guess.",
          );
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        if (args.step === "review") {
          const f = args.facts ?? {};
          const missing = missingSubmissionFacts(f);
          if (args.expected_version && !args.id) missing.push("record to correct");
          if (args.expected_version && !args.reason) missing.push("correction reason");
          if (missing.length)
            return guide(
              {
                ...text(`Before review I need: ${missing.join(", ")}. Nothing was recorded.`),
                structuredContent: { saved: false, missing },
              },
              "Ask only for missing facts. No PO or subcontract is required for a field expense. Originals cannot be uploaded yet.",
            );
          const allocations = [];
          for (const a of f.allocations!) {
            const target = await resolveJob(
              sb,
              a.job_number ?? args.job_number,
              job.company_id,
              "full",
            );
            if (target.company_id !== job.company_id)
              throw new ToolError("All allocated jobs must belong to the same company.");
            allocations.push({
              job_id: target.job_id,
              cost_code: a.cost_code,
              amount_cents: a.amount_cents,
            });
          }
          if (allocations.reduce((n, a) => n + a.amount_cents, 0) !== f.amount_cents)
            throw new ToolError(
              "The job allocations must equal the total amount. Nothing was recorded.",
            );
          const p: Payload = {
            id: args.id ?? crypto.randomUUID(),
            request_id: crypto.randomUUID(),
            expected_version: args.expected_version ?? 0,
            ...(args.reason ? { reason: args.reason } : {}),
            facts: {
              kind: f.kind!,
              description: f.description!,
              counterparty_name: f.counterparty_name!,
              incurred_on: f.incurred_on!,
              amount_cents: f.amount_cents!,
              allocations,
              original: "missing",
              ...(f.document_reference ? { document_reference: f.document_reference } : {}),
            },
          };
          const reviewKey = await key(job.job_id, p);
          const lines = allocations.map(
            (a, i) =>
              `${f.allocations![i].job_number ?? args.job_number} / ${a.cost_code}: ${money(a.amount_cents)}`,
          );
          return guide(
            {
              ...text(
                `Review this ${p.facts.kind.replaceAll("_", " ")}: ${p.facts.description}; ${p.facts.counterparty_name}; ${p.facts.incurred_on}; ${money(p.facts.amount_cents)}.\n${lines.join("\n")}\nReference: ${p.facts.document_reference ?? "not supplied"}.${p.reason ? ` Correction reason: ${p.reason}.` : ""} Original attachment: missing; Athena cannot retain it yet. This will be submitted only, not posted or paid. Is this correct?`,
              ),
              structuredContent: { saved: false, payload: p, review_key: reviewKey } as never,
            },
            "Ask for explicit confirmation. Save the exact returned payload and review key only after confirmation. Attachments are unavailable; do not claim they were saved.",
          );
        }
        if (
          !args.confirmed ||
          !args.payload ||
          !args.review_key ||
          (await key(job.job_id, args.payload)) !== args.review_key
        )
          throw new ToolError(
            "Review and confirm the exact submission first. Nothing was recorded.",
          );
        try {
          const result = await rpc<Record<string, unknown>>(sb, "mcp_cost_submission_save", {
            _job: job.job_id,
            _p: args.payload,
          });
          return guide(
            {
              ...text(
                "Submitted cost metadata. The original is missing and this has not been posted to accounting or paid.",
              ),
              structuredContent: { saved: true, result } as never,
            },
            "Report submitted only. Do not call it posted, approved or paid.",
          );
        } catch (e) {
          if (e instanceof ToolError) throw e;
          return guide(
            {
              ...text(
                "The save outcome is unknown. Read the submitted records before retrying the same confirmed request.",
              ),
              structuredContent: {
                saved: null,
                outcome: "unknown",
                payload: args.payload,
                review_key: args.review_key,
              } as never,
            },
            "Do not invent a new request ID; reconcile and retry only the same confirmed payload.",
          );
        }
      },
    ),
});
