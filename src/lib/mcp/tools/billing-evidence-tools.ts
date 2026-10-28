import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { sha256Hex } from "../file-share";
import {
  invoiceBalance,
  recordedTotals,
  type BillingAllocation,
  type BillingInvoice,
  type BillingReceiptReversal,
} from "../../billing-evidence-balances";

const jobFields = {
  job_number: z.string().trim().min(1).max(40),
  company_id: z.string().trim().min(1).max(200).optional(),
};
const cents = z.number().int().min(0).max(9000000000000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const facts = z
  .object({
    id: z.string().uuid().optional(),
    request_id: z.string().uuid().optional(),
    expected_version: z.number().int().min(0).optional(),
    kind: z.enum(["invoice", "pay_application", "credit"]).optional(),
    document_number: z.string().trim().min(1).max(120).optional(),
    status: z.enum(["draft", "submitted", "certified", "posted", "void"]).optional(),
    invoice_date: date.optional(),
    receipt_date: date.optional(),
    effective_date: date.optional(),
    period_start: date.nullable().optional(),
    period_end: date.nullable().optional(),
    source: z.string().trim().min(1).max(2000).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    gross_cents: cents.nullable().optional(),
    withheld_cents: cents.nullable().optional(),
    released_cents: cents.nullable().optional(),
    net_due_cents: cents.optional(),
    certified_cents: cents.nullable().optional(),
    certified_date: date.nullable().optional(),
    amount_cents: cents.optional(),
    credit_for: z.string().uuid().optional(),
    receipt_id: z.string().uuid().optional(),
    invoice_id: z.string().uuid().optional(),
    allocation_id: z.string().uuid().optional(),
  })
  .strict();
type Facts = z.infer<typeof facts>;
type Invoice = BillingInvoice & {
  document_number: string;
  versions: Array<
    BillingInvoice["versions"][number] & {
      gross_cents: number | null;
      certified_cents: number | null;
    }
  >;
};
type Ledger = {
  invoices: Invoice[];
  receipts: Array<{ id: string; amount_cents: number; source: string; receipt_date: string }>;
  allocations: Array<BillingAllocation & { id: string }>;
  receipt_reversals: BillingReceiptReversal[];
  recorded_contract: unknown;
};
type Action = "invoice" | "receipt" | "allocation" | "reverse_receipt" | "reverse_allocation";

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
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
async function reviewKey(job: string, action: Action, payload: Facts): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonical({ job, action, payload })));
}
export function missingBillingFacts(action: Action, p: Facts): string[] {
  const missing: string[] = [];
  const need = (key: keyof Facts, label: string) => {
    if (p[key] === undefined || p[key] === null) missing.push(label);
  };
  need("source", "source or reference");
  if (action === "invoice") {
    need("kind", "document type");
    need("status", "document status");
    need("invoice_date", "invoice or credit date");
    need("effective_date", "effective date");
    if (!p.expected_version) need("document_number", "document number");
    need("net_due_cents", p.kind === "credit" ? "credit amount" : "net due");
    if (p.kind === "credit" && !p.expected_version) need("credit_for", "invoice credited");
    if (p.kind && p.kind !== "credit") {
      need("gross_cents", "gross amount");
      need("withheld_cents", "retainage withheld");
      need("released_cents", "retainage released");
    }
    if (p.expected_version) {
      need("id", "record to revise");
      need("reason", "reason for correction");
    }
    if (p.status === "certified") {
      need("certified_cents", "certified amount");
      need("certified_date", "certification date");
    }
  } else {
    need("amount_cents", "amount");
    if (action === "receipt") need("receipt_date", "receipt date");
    else {
      need("effective_date", "effective date");
      if (action !== "reverse_allocation") need("receipt_id", "receipt");
    }
    if (action === "allocation") need("invoice_id", "invoice");
    if (action === "reverse_allocation") need("allocation_id", "allocation to reverse");
  }
  return missing;
}
const recordsUrl = (job: string) => `https://app.meetathena.io/r/job/${job}/billing-records`;
const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function recordedBalances(data: Ledger) {
  return data.invoices
    .filter(
      (i) => i.kind !== "credit" && ["submitted", "certified"].includes(i.versions[0]?.status),
    )
    .map((i) => {
      const b = invoiceBalance(i, data.invoices, data.allocations);
      return {
        id: i.id,
        document_number: i.document_number,
        cash_cents: b.cash,
        cash_display: usd(b.cash),
        credits_cents: b.credits,
        credits_display: usd(b.credits),
        remaining_cents: b.remaining,
        remaining_display: usd(b.remaining),
      };
    });
}
function displayedTotals(data: Ledger) {
  const totals = recordedTotals(data.invoices, data.receipts, data.receipt_reversals);
  return Object.fromEntries(
    Object.entries(totals).map(([name, amount]) => [
      name,
      { amount_cents: amount, display: amount === null ? "Unknown" : usd(amount) },
    ]),
  );
}
function reviewLines(p: Facts): string[] {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null) lines.push(`${label}: ${value}`);
  };
  add("Document", p.document_number);
  add("Type", p.kind?.replaceAll("_", " "));
  add("Status", p.status);
  add("Invoice or credit date", p.invoice_date);
  add("Receipt date", p.receipt_date);
  add("Effective date", p.effective_date);
  add("Period start", p.period_start);
  add("Period end", p.period_end);
  for (const [key, label] of [
    ["gross_cents", "Gross"],
    ["withheld_cents", "Retainage withheld"],
    ["released_cents", "Retainage released"],
    ["net_due_cents", p.kind === "credit" ? "Credit" : "Net due"],
    ["certified_cents", "Certified"],
    ["amount_cents", "Amount"],
  ] as const) {
    const value = p[key];
    if (typeof value === "number") add(label, usd(value));
  }
  add("Certification date", p.certified_date);
  add("Source", p.source);
  add("Correction reason", p.reason);
  return lines;
}

export const billingEvidenceRead = defineTool({
  name: "billing_evidence_read",
  title: "Read project billing records",
  description:
    "Reads source-recorded invoices, credits, retainage, receipts and allocations for a project; it does not infer billing from progress.",
  inputSchema: jobFields,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "billing_evidence_read",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const data = await rpc<Ledger>(sb, "mcp_billing_evidence_get", { _job: job.job_id });
        const totals = displayedTotals(data);
        const balances = recordedBalances(data);
        return guide(
          {
            ...text(
              `${job.job_number}: recorded billing and payment evidence. Missing history remains unknown.\nBilling records: ${recordsUrl(job.job_id)}`,
            ),
            structuredContent: {
              ...data,
              totals,
              balances,
              records_url: recordsUrl(job.job_id),
              currency: "USD",
            } as never,
          },
          "Present recorded submitted billing, certification, credits, retainage and cash separately. Do not infer zero from missing records or treat progress as an invoice or payment. Use document numbers to identify an invoice before allocating or crediting it.",
        );
      },
    ),
});

export const billingEvidenceRecord = defineTool({
  name: "billing_evidence_record",
  title: "Review or save billing evidence",
  description:
    "Reviews and, after explicit confirmation, records one invoice, credit, receipt, allocation or correction using the project billing ledger.",
  inputSchema: {
    ...jobFields,
    step: z.enum(["review", "save"]),
    action: z.enum(["invoice", "receipt", "allocation", "reverse_receipt", "reverse_allocation"]),
    facts,
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
      "billing_evidence_record",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const missing = missingBillingFacts(args.action, args.facts);
        if (missing.length)
          return guide(
            {
              ...text(`Before saving, I need: ${missing.join(", ")}. Nothing was recorded.`),
              structuredContent: { missing, saved: false },
            },
            "Ask only for these missing facts. Never invent zeros or statuses.",
          );
        if (args.action !== "invoice" && args.facts.amount_cents === 0)
          throw new ToolError(
            "The recorded amount must be greater than zero. Nothing was recorded.",
          );
        if (args.step === "review") {
          const state = await rpc<Ledger>(sb, "mcp_billing_evidence_get", { _job: job.job_id });
          const normalized = (s: string) => s.trim().toLowerCase();
          if (
            args.action === "invoice" &&
            !args.facts.expected_version &&
            args.facts.document_number &&
            state.invoices.some(
              (i) => normalized(i.document_number) === normalized(args.facts.document_number!),
            )
          )
            throw new ToolError(
              "An invoice or credit with that number already exists. Review the existing record before creating another.",
            );
          if (
            args.action === "receipt" &&
            args.facts.source &&
            state.receipts.some((r) => normalized(r.source) === normalized(args.facts.source!))
          )
            throw new ToolError(
              "A receipt with that source already exists. Review the existing record before creating another.",
            );
          const targetInvoiceId =
            args.facts.credit_for ??
            args.facts.invoice_id ??
            (args.action === "invoice" && args.facts.expected_version ? args.facts.id : undefined);
          const targetInvoice = targetInvoiceId
            ? state.invoices.find((i) => i.id === targetInvoiceId)
            : undefined;
          const targetReceipt = args.facts.receipt_id
            ? state.receipts.find((r) => r.id === args.facts.receipt_id)
            : undefined;
          const targetAllocation = args.facts.allocation_id
            ? state.allocations.find((a) => a.id === args.facts.allocation_id && !a.reversal_of)
            : undefined;
          if (
            (targetInvoiceId && !targetInvoice) ||
            (args.facts.receipt_id && !targetReceipt) ||
            (args.facts.allocation_id && !targetAllocation)
          )
            throw new ToolError(
              "The selected invoice, receipt or allocation is not available on this project. Nothing was recorded.",
            );
          const payload = {
            ...args.facts,
            id: args.facts.id ?? crypto.randomUUID(),
            request_id: args.facts.request_id ?? crypto.randomUUID(),
            ...(args.action === "invoice" && args.facts.expected_version === undefined
              ? { expected_version: 0 }
              : {}),
          };
          const key = await reviewKey(job.job_id, args.action, payload);
          const lines = reviewLines(payload);
          if (targetInvoice) lines.push(`Invoice: ${targetInvoice.document_number}`);
          if (targetReceipt)
            lines.push(
              `Receipt: ${targetReceipt.source} · ${usd(targetReceipt.amount_cents)} · ${targetReceipt.receipt_date}`,
            );
          if (targetAllocation) {
            const invoice = state.invoices.find((i) => i.id === targetAllocation.invoice_id);
            const receipt = state.receipts.find((r) => r.id === targetAllocation.receipt_id);
            if (!invoice || !receipt)
              throw new ToolError(
                "The allocation references unavailable records. Nothing was recorded.",
              );
            lines.push(
              `Allocation: ${usd(targetAllocation.amount_cents)} from ${receipt.source} to invoice ${invoice.document_number}`,
            );
          }
          return guide(
            {
              ...text(
                `Let’s check this ${args.action.replaceAll("_", " ")} for ${job.job_number}:\n${lines.map((line) => `- ${line}`).join("\n")}\n\nFinancial document attachments are not available yet. Is this right? Nothing has been recorded yet.`,
              ),
              structuredContent: {
                saved: false,
                action: args.action,
                facts: payload,
                review_key: key,
                currency: "USD",
                records_url: recordsUrl(job.job_id),
              } as never,
            },
            "Show a concise review of the supplied facts in dollars, including source, status and retainage. Ask for explicit confirmation. Save only after yes, using these exact facts and review key; if facts change, review again. Financial document uploads and attachments are not yet available.",
          );
        }
        if (
          !args.confirmed ||
          !args.review_key ||
          !args.facts.id ||
          !args.facts.request_id ||
          (await reviewKey(job.job_id, args.action, args.facts)) !== args.review_key
        )
          throw new ToolError(
            "Please review the exact record and confirm it before saving. Nothing was recorded.",
          );
        let result: Record<string, unknown>;
        try {
          result = await rpc<Record<string, unknown>>(sb, "mcp_billing_evidence_record", {
            _job: job.job_id,
            _action: args.action,
            _p: args.facts,
          });
        } catch (error) {
          if (error instanceof ToolError) throw error;
          return guide(
            {
              ...text(
                "The save could not be confirmed. Check the billing records before retrying; if needed, retry the same reviewed facts and request ID.",
              ),
              structuredContent: {
                saved: null,
                outcome: "unknown",
                facts: args.facts,
                review_key: args.review_key,
                records_url: recordsUrl(job.job_id),
              } as never,
            },
            "The write outcome is unknown. Do not say it failed or create a new request ID. Read the billing records to reconcile, then retry only the exact same confirmed facts and request ID if necessary.",
          );
        }
        let balances: ReturnType<typeof recordedBalances> | null = null;
        try {
          const current = await rpc<Ledger>(sb, "mcp_billing_evidence_get", { _job: job.job_id });
          balances = recordedBalances(current);
        } catch {
          /* The save succeeded; a failed readback must not cause a new write. */
        }
        const targetId =
          args.facts.credit_for ??
          args.facts.invoice_id ??
          (args.action === "invoice" && args.facts.kind !== "credit" ? args.facts.id : undefined);
        const balance = balances?.find((b) => b.id === targetId);
        return guide(
          {
            ...text(
              balances
                ? `Recorded for ${job.job_number}.${balance ? ` Invoice ${balance.document_number}: ${balance.remaining_display} remaining from recorded entries.` : ""}\nBilling records: ${recordsUrl(job.job_id)}`
                : `Recorded for ${job.job_number}, but the balance could not be refreshed. Check the records before making another entry.\nBilling records: ${recordsUrl(job.job_id)}`,
            ),
            structuredContent: {
              saved: true,
              result,
              balances,
              records_url: recordsUrl(job.job_id),
              currency: "USD",
            } as never,
          },
          "Report only the saved record and the returned balance. A receipt is recorded cash, not an approval; credit is not a refund. Never call this a forecast or inferred earned billing.",
        );
      },
    ),
});
