import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { COST_CURRENCIES } from "../cost-currencies";

// Registration and the staged schema must be released together after coordination.
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
    currency_code: z.enum(COST_CURRENCIES).optional(),
    amount_cents: z.number().int().positive().max(9000000000000).optional(),
    allocations: z.array(allocation).min(1).max(100).optional(),
    document_reference: z.string().trim().min(1).max(200).optional(),
    party_id: z.string().uuid().optional(),
    purchase_order_id: z.string().uuid().optional(),
    purchase_order_version: z.number().int().positive().max(999999999).optional(),
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
        currency_code: z.enum(COST_CURRENCIES),
        amount_cents: z.number().int(),
        original: z.literal("missing"),
        document_reference: z.string().optional(),
        party_id: z.string().uuid().optional(),
        purchase_order_id: z.string().uuid().optional(),
        purchase_order_version: z.number().int().positive().max(999999999).optional(),
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
export function missingSubmissionFacts(f: Facts): string[] {
  const missing: string[] = [];
  if (!f.kind) missing.push("bill or expense type and who paid");
  if (!f.description) missing.push("description");
  if (!f.counterparty_name) missing.push("supplier or payee");
  if (!f.incurred_on) missing.push("date incurred");
  if (!f.currency_code) missing.push("currency");
  if (f.amount_cents === undefined) missing.push("amount");
  if (!f.allocations?.length) missing.push("job and cost code allocation");
  return missing;
}
const validDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith("0000")) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const money = (n: number, currency?: string | null) =>
  currency && (COST_CURRENCIES as readonly string[]).includes(currency)
    ? `${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n / 100)} ${currency}`
    : `${(n / 100).toFixed(2)} (currency unknown)`;
export const jobCostSubmissionRead = defineTool({
  name: "job_cost_submissions_read",
  title: "Read job cost records",
  description:
    "Reads cost records for full-access members, or only the assigned superintendent’s own field submissions. Receipts are retrieved separately.",
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
        const job = await resolveJob(sb, args.job_number, args.company_id);
        if (job.scope === "super") {
          const data = await rpc<Record<string, unknown>>(sb, "mcp_cost_field_own_read", {
            _job: job.job_id,
          });
          return guide(
            {
              ...text(
                `${job.job_number}: your own field-expense submissions. Use the receipt tool to check for attachments.`,
              ),
              structuredContent: data as never,
            },
            "Show only these own submissions; do not infer accounting status or expose the financial ledger.",
          );
        }
        if (job.scope !== "full") throw new ToolError("Full project access is required.");
        const data = await rpc<Record<string, unknown>>(sb, "mcp_cost_submission_read", {
          _job: job.job_id,
        });
        return guide(
          {
            ...text(
              `${job.job_number}: cost records and accounting evidence. AP and owners can list or attach supplier originals with job_cost_original for the exact bill version. Field receipts are retrieved separately.${data.posting_available ? "" : " Accounting posting is not available."}`,
            ),
            structuredContent: data as never,
          },
          "Show the latest version, job-specific PM payment approvals, accounting-approved versions, posted version and recorded payments separately. A pending correction does not replace the posted version. Never treat missing records as complete history or payment evidence as another cost.",
        );
      },
    ),
});
export const jobCostSubmissionRecord = defineTool({
  name: "job_cost_submission_record",
  title: "Review or submit job cost metadata",
  description:
    "Reviews and submits a supplier bill or field expense. Assigned superintendents may submit their own field expense for their job. Receipts are attached separately. It does not move funds or post to accounting.",
  inputSchema: {
    ...jobFields,
    step: z.enum(["review", "save"]),
    facts: facts.optional(),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    payload: payloadSchema.optional(),
    review_key: z.string().uuid().optional(),
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
        const job = await resolveJob(sb, args.job_number, args.company_id);
        if (job.scope !== "full" && job.scope !== "super")
          throw new ToolError("Full project or assigned superintendent access is required.");
        const isField = job.scope === "super";
        if (args.step === "review") {
          const f = args.facts ?? {};
          const missing = missingSubmissionFacts(f);
          if (f.purchase_order_id && !f.party_id) missing.push("supplier for the purchase order");
          if (f.purchase_order_id && !f.purchase_order_version)
            missing.push("purchase order revision");
          if (f.purchase_order_version && !f.purchase_order_id) missing.push("purchase order");
          if (args.expected_version && !args.id) missing.push("record to correct");
          if (args.expected_version && !args.reason) missing.push("correction reason");
          if (missing.length)
            return guide(
              {
                ...text(`Before review I need: ${missing.join(", ")}. Nothing was recorded.`),
                structuredContent: { saved: false, missing },
              },
              "Ask only for missing facts. No PO or subcontract is required for a field expense. The submitter may attach a receipt separately after saving.",
            );
          if (!validDate(f.incurred_on!))
            throw new ToolError("Provide a valid date incurred in YYYY-MM-DD format.");
          if (!(COST_CURRENCIES as readonly string[]).includes(f.currency_code!))
            throw new ToolError("Provide a supported two-decimal currency code.");
          if (
            isField &&
            (f.kind === "supplier_bill" ||
              f.party_id ||
              f.purchase_order_id ||
              f.purchase_order_version ||
              args.id ||
              args.expected_version ||
              f.allocations!.length !== 1)
          )
            throw new ToolError(
              "Assigned superintendents can submit only a new field expense for this job.",
            );
          if (
            (f.party_id || f.purchase_order_id || f.purchase_order_version) &&
            f.kind !== "supplier_bill"
          )
            throw new ToolError(
              "Supplier and purchase order links are only available for supplier bills.",
            );
          const allocations = [];
          for (const a of f.allocations!) {
            const target = await resolveJob(
              sb,
              a.job_number ?? args.job_number,
              job.company_id,
              isField ? undefined : "full",
            );
            if (isField && target.job_id !== job.job_id)
              throw new ToolError("Field expenses must be allocated to your assigned job.");
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
              currency_code: f.currency_code!,
              amount_cents: f.amount_cents!,
              allocations,
              original: "missing",
              ...(f.document_reference ? { document_reference: f.document_reference } : {}),
              ...(f.party_id ? { party_id: f.party_id } : {}),
              ...(f.purchase_order_id ? { purchase_order_id: f.purchase_order_id } : {}),
              ...(f.purchase_order_version
                ? { purchase_order_version: f.purchase_order_version }
                : {}),
            },
          };
          const { review_id: reviewKey } = await rpc<{ review_id: string }>(
            sb,
            "mcp_cost_review_prepare",
            { _job: job.job_id, _purpose: isField ? "field" : "submission", _p: p },
          );
          const lines = allocations.map(
            (a, i) =>
              `${f.allocations![i].job_number ?? args.job_number} / ${a.cost_code}: ${money(a.amount_cents, p.facts.currency_code)}`,
          );
          return guide(
            {
              ...text(
                `Review this ${p.facts.kind.replaceAll("_", " ")}: ${p.facts.description}; ${p.facts.counterparty_name}; incurred ${p.facts.incurred_on}; ${money(p.facts.amount_cents, p.facts.currency_code)}.\n${lines.join("\n")}\nReference: ${p.facts.document_reference ?? "not supplied"}.${p.facts.party_id ? ` Supplier ID: ${p.facts.party_id}.` : ""}${p.facts.purchase_order_id ? ` PO ID: ${p.facts.purchase_order_id}, revision ${p.facts.purchase_order_version}.` : ""}${p.reason ? ` Correction reason: ${p.reason}.` : ""} Original attachment: missing from this submission; an eligible field submitter can attach it separately after saving. This will be submitted only, not posted or paid. Is this correct?`,
              ),
              structuredContent: { saved: false, payload: p, review_key: reviewKey } as never,
            },
            "Ask for explicit confirmation. Save the exact returned payload and review key only after confirmation. Do not claim a receipt was saved until its separate upload succeeds.",
          );
        }
        if (!args.confirmed || !args.payload || !args.review_key)
          throw new ToolError(
            "Review and confirm the exact submission first. Nothing was recorded.",
          );
        try {
          const result = await rpc<Record<string, unknown>>(
            sb,
            isField ? "mcp_cost_field_submit" : "mcp_cost_submission_save",
            {
              _job: job.job_id,
              _p: args.payload,
              _review: args.review_key,
              _confirmed: true,
            },
          );
          return guide(
            {
              ...text(
                "Submitted cost metadata without an attachment. This has not been posted to accounting or paid.",
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

const accountingPayload = z
  .object({
    action: z.enum(["approve", "post", "payment"]),
    id: z.string().uuid(),
    request_id: z.string().uuid(),
    expected_version: z.number().int().positive(),
    payment_id: z.string().uuid().optional(),
    amount_cents: z.number().int().positive().max(9000000000000).optional(),
    paid_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    reference: z.string().trim().min(1).max(200).optional(),
    accounting_effective_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
type AccountingPayload = z.infer<typeof accountingPayload>;
/** The staged database denies accounting authority until a policy is reviewed. */
export const jobCostAccountingRecord = defineTool({
  name: "job_cost_accounting_record",
  title: "Review a job cost accounting action",
  description:
    "Stages approval, accounting posting or recorded settlement evidence after explicit review; it never makes a payment. Accounting authority is disabled pending policy.",
  inputSchema: {
    ...jobFields,
    step: z.enum(["review", "save"]),
    action: z.enum(["approve", "post", "payment"]).optional(),
    id: z.string().uuid().optional(),
    payment_id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    amount_cents: z.number().int().positive().max(9000000000000).optional(),
    paid_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    reference: z.string().trim().min(1).max(200).optional(),
    accounting_effective_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    payload: accountingPayload.optional(),
    review_key: z.string().uuid().optional(),
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
      "job_cost_accounting_record",
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
          if (args.payment_id || args.payload)
            throw new ToolError(
              "To correct an existing recorded payment, use job_cost_payment_correction with its existing payment identity. This review creates a new payment only.",
            );
          const missing: string[] = [];
          if (!args.action) missing.push("action");
          if (!args.id) missing.push("cost record");
          if (!args.expected_version) missing.push("current version");
          if (args.action === "post" && !args.accounting_effective_on)
            missing.push("accounting effective date");
          if (args.action === "payment") {
            if (!args.amount_cents) missing.push("recorded payment amount");
            if (!args.paid_on) missing.push("payment date");
            if (!args.reference) missing.push("payment reference");
          }
          if (missing.length)
            return guide(
              {
                ...text(`Before review I need: ${missing.join(", ")}. Nothing was recorded.`),
                structuredContent: { saved: false, missing },
              },
              "Ask only for missing facts. Payment is evidence only and does not transfer funds.",
            );
          if (args.action === "post" && !validDate(args.accounting_effective_on!))
            throw new ToolError("Provide a valid accounting effective date in YYYY-MM-DD format.");
          if (args.action !== "post" && args.accounting_effective_on)
            throw new ToolError("The accounting effective date is recorded only when posting.");
          const data = await rpc<{
            records: Array<{
              id: string;
              versions: Array<{
                version: number;
                reason: string | null;
                facts: {
                  kind: string;
                  description: string;
                  counterparty_name: string;
                  incurred_on: string;
                  currency_code?: string;
                  amount_cents: number;
                  document_reference?: string;
                  allocations: Array<{ job_id: string; cost_code: string; amount_cents: number }>;
                };
              }>;
              approved_versions: number[];
              business_approvals: Array<{ version: number; job_id: string; withdrawn: boolean }>;
              posted_version: number | null;
            }>;
            posting_available: boolean;
          }>(sb, "mcp_cost_submission_read", { _job: job.job_id });
          if (!data.posting_available)
            throw new ToolError("Accounting approval, posting and settlement are not available.");
          const record = data.records.find((r) => r.id === args.id),
            current = record?.versions[0];
          if (!record || !current || current.version !== args.expected_version)
            throw new ToolError("Record unavailable or version changed; read it again.");
          if (
            (args.action === "post" || args.action === "payment") &&
            !(COST_CURRENCIES as readonly string[]).includes(current.facts.currency_code ?? "")
          )
            throw new ToolError(
              "Correct this cost version with its supported currency before posting or recording settlement.",
            );
          if (args.action === "post" && !record.approved_versions.includes(current.version))
            throw new ToolError("Approval is required before posting.");
          if (args.action === "payment" && record.posted_version !== current.version)
            throw new ToolError("Post this version before recording settlement.");
          if (
            args.action === "payment" &&
            current.facts.allocations.some(
              (a) =>
                !record.business_approvals.some(
                  (b) => b.version === current.version && b.job_id === a.job_id && !b.withdrawn,
                ),
            )
          )
            throw new ToolError(
              "PM payment approval is required for every allocated job before recording settlement.",
            );
          const payload: AccountingPayload = {
            action: args.action!,
            id: args.id!,
            request_id: crypto.randomUUID(),
            expected_version: args.expected_version!,
            ...(args.action === "post"
              ? { accounting_effective_on: args.accounting_effective_on! }
              : {}),
            ...(args.action === "payment"
              ? {
                  payment_id: crypto.randomUUID(),
                  amount_cents: args.amount_cents!,
                  paid_on: args.paid_on!,
                  reference: args.reference!,
                }
              : {}),
          };
          const { review_id: reviewKey } = await rpc<{ review_id: string }>(
            sb,
            "mcp_cost_review_prepare",
            { _job: job.job_id, _purpose: "accounting", _p: payload },
          );
          const allocations = current.facts.allocations
            .map(
              (a) =>
                `${a.job_id === job.job_id ? job.job_number : `job ID ${a.job_id}`} / ${a.cost_code}: ${money(a.amount_cents, current.facts.currency_code)}`,
            )
            .join("\n");
          return guide(
            {
              ...text(
                `Review accounting ${payload.action} for ${current.facts.kind.replaceAll("_", " ")}: ${current.facts.description}; ${current.facts.counterparty_name}; incurred ${current.facts.incurred_on}; ${money(current.facts.amount_cents, current.facts.currency_code)}; version ${current.version}.${payload.action === "post" ? ` Accounting effective date: ${payload.accounting_effective_on}.` : ""}\n${allocations}\nReference: ${current.facts.document_reference ?? "not supplied"}. Original attachment was missing at submission; check separate receipts.${current.reason ? ` Correction reason: ${current.reason}.` : ""}${payload.action === "payment" ? ` Recorded settlement: ${money(payload.amount_cents!, current.facts.currency_code)} on ${payload.paid_on}, reference ${payload.reference}. No funds will be transferred.` : ""} Nothing has been recorded. Is this correct?`,
              ),
              structuredContent: { saved: false, payload, review_key: reviewKey } as never,
            },
            "Show the exact action and facts, ask for explicit confirmation, then save only the reviewed payload and key. Payment is evidence, never a money transfer.",
          );
        }
        if (!args.confirmed || !args.payload || !args.review_key)
          throw new ToolError("Review and confirm the exact action first. Nothing was recorded.");
        try {
          const result = await rpc<Record<string, unknown>>(sb, "mcp_cost_accounting_action", {
            _job: job.job_id,
            _p: args.payload,
            _review: args.review_key,
            _confirmed: true,
          });
          return guide(
            {
              ...text(
                args.payload.action === "payment"
                  ? "Settlement evidence recorded. No funds were transferred."
                  : args.payload.action === "post"
                    ? "Cost posted to accounting."
                    : "Accounting review approved. PM payment approval is separate.",
              ),
              structuredContent: { saved: true, result } as never,
            },
            "Report only the recorded action; settlement is not an additional job cost and no funds were moved.",
          );
        } catch (e) {
          if (e instanceof ToolError) throw e;
          return guide(
            {
              ...text(
                "The action outcome is unknown. Read the records and retry only the same confirmed request if needed.",
              ),
              structuredContent: {
                saved: null,
                outcome: "unknown",
                payload: args.payload,
                review_key: args.review_key,
              } as never,
            },
            "Reconcile before retry and retain the same request ID.",
          );
        }
      },
    ),
});

const pmPayload = z
  .object({
    id: z.string().uuid(),
    request_id: z.string().uuid(),
    expected_version: z.number().int().positive(),
    allocated_cents: z.number().int().positive().max(9000000000000),
    basis: z.enum(["work_verified", "delivery_needed", "advance", "deposit", "owner_exception"]),
    notes: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export const jobCostPmPaymentApproval = defineTool({
  name: "job_cost_pm_payment_approval",
  title: "Review and approve payment for a job",
  description:
    "Shows only the job's share of supplier bills and reimbursements, and records a PM payment approval for the exact version and job allocation. It does not post accounting or pay anyone.",
  inputSchema: {
    ...jobFields,
    step: z.enum(["list", "review", "save"]),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    basis: z
      .enum(["work_verified", "delivery_needed", "advance", "deposit", "owner_exception"])
      .optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
    payload: pmPayload.optional(),
    review_key: z.string().uuid().optional(),
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
      "job_cost_pm_payment_approval",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (!args.job_number)
          return guide(
            {
              ...text("Which job is this for? Nothing was approved."),
              structuredContent: { missing: ["job"], saved: false },
            },
            "Ask which job.",
          );
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        if (args.step === "list") {
          const data = await rpc<Record<string, unknown>>(sb, "mcp_cost_pm_review", {
            _job: job.job_id,
          });
          return guide(
            {
              ...text(
                `${job.job_number}: payment-approval items for this job. Approval does not post or pay a bill.`,
              ),
              structuredContent: data as never,
            },
            "Show only these job allocations and current-version approvals. A PM approval is not payment.",
          );
        }
        if (args.step === "review") {
          const missing = [];
          if (!args.id) missing.push("cost record");
          if (!args.expected_version) missing.push("current version");
          if (!args.basis) missing.push("approval basis");
          if (
            (args.basis === "advance" ||
              args.basis === "deposit" ||
              args.basis === "owner_exception") &&
            !args.notes
          )
            missing.push("reason for advance, deposit or owner exception");
          if (missing.length)
            return guide(
              {
                ...text(`Before approval I need: ${missing.join(", ")}. Nothing was approved.`),
                structuredContent: { missing, saved: false },
              },
              "Ask only for missing facts. Never infer work completion, delivery need, or an advance or deposit.",
            );
          const data = await rpc<{
            records: Array<{
              id: string;
              version: number;
              description: string;
              counterparty_name: string;
              currency_code?: string;
              allocations: Array<{ cost_code: string; amount_cents: number }>;
            }>;
          }>(sb, "mcp_cost_pm_review", { _job: job.job_id });
          const record = data.records.find((r) => r.id === args.id);
          if (!record || record.version !== args.expected_version)
            throw new ToolError(
              "Record unavailable or version changed; list the job's approvals again.",
            );
          if (!(COST_CURRENCIES as readonly string[]).includes(record.currency_code ?? ""))
            throw new ToolError(
              "Correct this cost version with its supported currency before approving payment.",
            );
          const allocated = record.allocations.reduce((sum, a) => sum + a.amount_cents, 0);
          const payload = {
            id: args.id!,
            request_id: crypto.randomUUID(),
            expected_version: args.expected_version!,
            allocated_cents: allocated,
            basis: args.basis!,
            ...(args.notes ? { notes: args.notes } : {}),
          };
          const { review_id } = await rpc<{ review_id: string }>(sb, "mcp_cost_review_prepare", {
            _job: job.job_id,
            _purpose: "pm_approval",
            _p: payload,
          });
          const lines = record.allocations
            .map((a) => `${a.cost_code}: ${money(a.amount_cents, record.currency_code)}`)
            .join("; ");
          return guide(
            {
              ...text(
                `Review payment approval for ${job.job_number}: ${record.description}; ${record.counterparty_name}; version ${record.version}; this job ${money(allocated, record.currency_code)} (${lines}). Basis: ${payload.basis.replaceAll("_", " ")}.${payload.notes ? ` Note: ${payload.notes}.` : ""} This approval does not post or pay it. Is this correct?`,
              ),
              structuredContent: { saved: false, payload, review_key: review_id } as never,
            },
            "Ask for explicit confirmation. This approves the exact version and this job's allocation only; it never pays or posts.",
          );
        }
        if (!args.confirmed || !args.payload || !args.review_key)
          throw new ToolError("Review and confirm the exact approval first. Nothing was approved.");
        try {
          const result = await rpc<Record<string, unknown>>(sb, "mcp_cost_pm_approve", {
            _job: job.job_id,
            _p: args.payload,
            _review: args.review_key,
            _confirmed: true,
          });
          return guide(
            {
              ...text(
                "Payment approval for this job recorded. No payment was made and no accounting posting was created.",
              ),
              structuredContent: { saved: true, result } as never,
            },
            "Do not claim that approval paid the supplier or that other jobs have approved.",
          );
        } catch (e) {
          if (e instanceof ToolError) throw e;
          return guide(
            {
              ...text(
                "The approval outcome is unknown. List the job's approval records, then retry the same reviewed request if needed.",
              ),
              structuredContent: {
                saved: null,
                outcome: "unknown",
                payload: args.payload,
                review_key: args.review_key,
              } as never,
            },
            "Reconcile first; keep the same request ID.",
          );
        }
      },
    ),
});

const pmWithdrawalPayload = z
  .object({
    id: z.string().uuid(),
    request_id: z.string().uuid(),
    expected_version: z.number().int().positive(),
    approval_id: z.string().uuid(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export const jobCostPmPaymentWithdraw = defineTool({
  name: "job_cost_pm_payment_withdraw",
  title: "Withdraw a job payment approval",
  description:
    "Reviews and withdraws an active job-specific PM payment approval. Previously recorded payments are preserved and no bank reversal or refund occurs.",
  inputSchema: {
    ...jobFields,
    step: z.enum(["review", "save"]),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    approval_id: z.string().uuid().optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    payload: pmWithdrawalPayload.optional(),
    review_key: z.string().uuid().optional(),
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
      "job_cost_pm_payment_withdraw",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (!args.job_number)
          return guide(
            {
              ...text("Which job is this for? Nothing was withdrawn."),
              structuredContent: { missing: ["job"], saved: false },
            },
            "Ask which job.",
          );
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        if (args.step === "review") {
          const missing: string[] = [];
          if (!args.id) missing.push("cost record");
          if (!args.expected_version) missing.push("current version");
          if (!args.approval_id) missing.push("approval to withdraw");
          if (!args.reason) missing.push("withdrawal reason");
          if (missing.length)
            return guide(
              {
                ...text(`Before withdrawal I need: ${missing.join(", ")}. Nothing was withdrawn.`),
                structuredContent: { saved: false, missing },
              },
              "Ask for the missing facts; list job approvals if needed.",
            );
          const data = await rpc<{
            records: Array<{
              id: string;
              version: number;
              description: string;
              counterparty_name: string;
              approval: { id: string; basis: string } | null;
            }>;
          }>(sb, "mcp_cost_pm_review", { _job: job.job_id });
          const record = data.records.find((r) => r.id === args.id);
          if (
            !record ||
            record.version !== args.expected_version ||
            !record.approval ||
            record.approval.id !== args.approval_id
          )
            throw new ToolError(
              "Approval unavailable or version changed; list the job's approvals again.",
            );
          const payload = {
            id: args.id!,
            request_id: crypto.randomUUID(),
            expected_version: args.expected_version!,
            approval_id: args.approval_id!,
            reason: args.reason!,
          };
          const { review_id } = await rpc<{ review_id: string }>(sb, "mcp_cost_review_prepare", {
            _job: job.job_id,
            _purpose: "pm_withdraw",
            _p: payload,
          });
          return guide(
            {
              ...text(
                `Withdraw the payment approval for ${job.job_number}: ${record.description}; ${record.counterparty_name}; version ${record.version}; basis ${record.approval.basis.replaceAll("_", " ")}. Reason: ${payload.reason}. Prior recorded payments remain in history; this does not reverse funds or issue a refund. Is this correct?`,
              ),
              structuredContent: { saved: false, payload, review_key: review_id } as never,
            },
            "Ask for confirmation. Withdrawal prevents further settlement without renewed coverage; prior payments remain recorded.",
          );
        }
        if (!args.confirmed || !args.payload || !args.review_key)
          throw new ToolError(
            "Review and confirm the exact withdrawal first. Nothing was withdrawn.",
          );
        try {
          const result = await rpc<Record<string, unknown>>(sb, "mcp_cost_pm_withdraw", {
            _job: job.job_id,
            _p: args.payload,
            _review: args.review_key,
            _confirmed: true,
          });
          return guide(
            {
              ...text(
                "Payment approval withdrawn for this job. Prior recorded payments remain; no funds were reversed.",
              ),
              structuredContent: { saved: true, result } as never,
            },
            "Do not claim a refund or a reversal of funds.",
          );
        } catch (e) {
          if (e instanceof ToolError) throw e;
          return guide(
            {
              ...text(
                "The withdrawal outcome is unknown. List the job's approvals, then retry the same reviewed request if needed.",
              ),
              structuredContent: {
                saved: null,
                outcome: "unknown",
                payload: args.payload,
                review_key: args.review_key,
              } as never,
            },
            "Reconcile first and keep the same request ID.",
          );
        }
      },
    ),
});
