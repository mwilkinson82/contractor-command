import { accountingRecordUrl } from "../../accounting-record-target";
import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { resolveJob } from "../jobs";
import { guide } from "../visible";
import { apMoney } from "../../accounting-ap-versioned";

const amount = z.number().int().positive().max(9_000_000_000_000);
const revised = z
  .object({
    amount_cents: amount,
    paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().trim().min(1).max(200),
    allocations: z
      .array(
        z
          .object({
            record_id: z.string().uuid(),
            expected_version: z.number().int().positive().max(999_999_999),
            amount_cents: amount,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
type State = {
  payment: {
    id: string;
    shared: boolean;
    amount_cents: string;
    paid_on: string;
    reference: string;
  };
  records: Array<{
    record_id: string;
    job_number: string;
    description: string;
    document_reference: string | null;
    payee: string;
    currency_code: string | null;
    current_version: number;
    posted_version: number | null;
    original_amount_cents: string;
    active_paid_cents: string;
    posted_amount_cents: string | null;
  }>;
  correction: unknown;
};
type Effect = {
  record_id: string;
  job_number: string;
  currency_code: string | null;
  prior_paid_cents: string;
  revised_paid_cents: string;
  prior_unpaid_cents: string | null;
  revised_unpaid_cents: string | null;
};
type ReviewPayload = {
  id: string;
  payment_id: string;
  expected_state: string;
  mode: "replace" | "void";
  reason: string;
  revised: z.infer<typeof revised> | null;
  request_id: string;
  correction_id: string;
  replacement_id: string | null;
  before: State;
  effects: Effect[];
};
// The server-produced payload is opaque to the host; the ticket validates its
// complete contents. A loose object here preserves decimal-string snapshots.
const payload = z.record(z.string(), z.unknown());
async function call(sb: Sb, job: string, step: string, p: unknown, review?: string) {
  const { data, error } = await (
    sb.rpc as unknown as (
      n: string,
      p: unknown,
    ) => Promise<{ data: Record<string, unknown>; error: { message: string } | null }>
  )("mcp_cost_payment_correction", {
    _job: job,
    _step: step,
    _p: p,
    _review: review ?? null,
    _confirmed: step === "save",
  });
  if (error) dbError(error);
  return data;
}
function sourceLines(state: State) {
  return state.records
    .map(
      (r) =>
        `${r.job_number} · ${r.description} · ${r.payee} · bill reference ${r.document_reference ?? "missing"} · payable version ${r.current_version}${r.current_version !== r.posted_version ? ` (posted ${r.posted_version ?? "none"})` : ""}: payment allocated to this payable ${apMoney(r.original_amount_cents, r.currency_code)}`,
    )
    .join("\n");
}
function effectsLines(effects: Effect[]) {
  return effects
    .map(
      (e) =>
        `${e.job_number}, whole payable: recorded paid ${apMoney(e.prior_paid_cents, e.currency_code)} → ${apMoney(e.revised_paid_cents, e.currency_code)}; unpaid ${apMoney(e.prior_unpaid_cents, e.currency_code)} → ${apMoney(e.revised_unpaid_cents, e.currency_code)}.`,
    )
    .join("\n");
}
export const jobCostPaymentCorrection = defineTool({
  name: "job_cost_payment_correction",
  title: "Correct a recorded supplier payment",
  description:
    "Read, review and confirm a correction to existing recorded payment evidence with immutable history and reconciled payable balances; no funds move.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40).optional(),
    company_id: z.string().trim().min(1).max(200).optional(),
    step: z.enum(["read", "review", "save"]),
    id: z.string().uuid().optional(),
    payment_id: z.string().uuid().optional(),
    as_of: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    expected_state: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    mode: z.enum(["replace", "void"]).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    revised: revised.optional(),
    payload: payload.optional(),
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
      "job_cost_payment_correction",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const missing: string[] = [];
        if (!args.job_number) missing.push("job");
        if (args.step !== "save") {
          if (!args.id) missing.push("existing cost record");
          if (!args.payment_id) missing.push("existing recorded payment");
        }
        if (args.step === "review") {
          if (!args.expected_state) missing.push("current payment readback");
          if (!args.mode) missing.push("replace or remove erroneous evidence");
          if (!args.reason) missing.push("correction reason");
          if (args.mode === "replace" && !args.revised)
            missing.push("revised payment facts and allocations");
          if (args.mode === "void" && args.revised)
            throw new ToolError("Removing erroneous evidence cannot include replacement facts.");
        }
        if (missing.length)
          return guide(
            {
              ...text(`Before continuing I need: ${missing.join(", ")}. Nothing was recorded.`),
              structuredContent: { saved: false, missing },
            },
            "Read job_cost_submissions_read to identify the exact existing record and payment, then read this tool. Ask only for missing facts; never substitute a new payment.",
          );
        const job = await resolveJob(sb, args.job_number!, args.company_id, "full");
        if (args.step === "save") {
          if (!args.confirmed || !args.payload || !args.review_key)
            throw new ToolError(
              "Review and explicitly confirm this exact correction first. Nothing was recorded.",
            );
          try {
            const result = await call(sb, job.job_id, "save", args.payload, args.review_key);
            return guide(
              {
                ...text(
                  `Recorded payment evidence corrected. The original remains in history.\n${effectsLines(result.effects as Effect[])}\nNo funds were transferred or refunded, and the posted cost is unchanged.`,
                ),
                structuredContent: { saved: true, result } as never,
              },
              "Report the saved readback and correction history. Retain the exact request ID and payload on retry; never create a new payment or claim bank settlement.",
            );
          } catch (error) {
            if (error instanceof ToolError) throw error;
            return guide(
              {
                ...text(
                  "The save outcome is unknown. Keep this correction request and check the recorded payment before retrying.",
                ),
                structuredContent: {
                  saved: false,
                  outcome_unknown: true,
                  payload: args.payload,
                  review_key: args.review_key,
                } as never,
              },
              "Retry save with the same payload and review key after checking the original payment history. Do not make a new review or a new payment to retry an uncertain save.",
            );
          }
        }
        if (args.as_of && args.step !== "read")
          throw new ToolError("The as-of date is available only when reading recorded balances.");
        const result = await call(
          sb,
          job.job_id,
          args.step,
          args.step === "read"
            ? {
                id: args.id,
                payment_id: args.payment_id,
                ...(args.as_of ? { as_of: args.as_of } : {}),
              }
            : {
                id: args.id,
                payment_id: args.payment_id,
                expected_state: args.expected_state,
                mode: args.mode,
                reason: args.reason,
                revised: args.mode === "void" ? null : args.revised,
              },
        );
        if (args.step === "read") {
          const state = result.state as State;
          const historical = result.balances_as_of as Array<{
            job_number: string;
            currency_code: string | null;
            recorded_paid_cents: string | null;
            unpaid_cents: string | null;
          }> | null;
          const balances = historical
            ? `\nKnown by ${args.as_of} UTC day end:\n${historical.map((e) => `${e.job_number}, whole payable: recorded paid ${apMoney(e.recorded_paid_cents, e.currency_code)}; unpaid ${apMoney(e.unpaid_cents, e.currency_code)}.`).join("\n")}\nThis cutoff uses payment dates and recording history; it is not a restated accounting-effective correction date.`
            : "";
          const history = result.history as Array<{
            corrected_at: string;
            corrected_by_name?: string;
            reason: string;
            before: State;
            revised: z.infer<typeof revised> | null;
          }>;
          const historyText = history?.length
            ? `\nCorrection history:\n${history.map((h) => `${h.corrected_at} · ${h.corrected_by_name ?? "Accounting"}: ${h.reason}. Prior ${h.before.payment.reference} / ${h.before.payment.paid_on}; ${h.revised ? `revised ${h.revised.reference} / ${h.revised.paid_on}` : "erroneous evidence removed"}.`).join("\n")}`
            : "";
          return guide(
            {
              ...text(
                `Recorded payment ${state.payment.reference} · ${state.payment.paid_on}${state.correction ? " · corrected; see history" : ""}\n${sourceLines(state)}${balances}${historyText}\nThis is recorded evidence; it does not verify a bank payment.`,
              ),
              structuredContent: {
                ...result,
                record_url: accountingRecordUrl(job.job_id, {
                  kind: "payment",
                  id: args.payment_id!,
                  payableId: args.id!,
                }),
              } as never,
            },
            "Offer record_url to open this exact recorded payment. Use the existing payment ID and expected_state from this read. Show prior facts and current versions. Ask for a reason and complete revised facts or explicit removal of erroneous evidence. For replacement, provide every original payable allocation with its current_version as expected_version. Never infer a proportional split.",
          );
        }
        const p = result.payload as ReviewPayload;
        const currency = p.before.records[0]?.currency_code ?? null;
        const after = p.revised
          ? `${apMoney(String(p.revised.amount_cents), currency)} · ${p.revised.paid_on} · ${p.revised.reference}\n${p.revised.allocations.map((a) => `${p.before.records.find((r) => r.record_id === a.record_id)?.description ?? "Payable"}: ${apMoney(String(a.amount_cents), currency)}`).join("\n")}`
          : "Remove this erroneous evidence; no replacement.";
        return guide(
          {
            ...text(
              `Review correction to recorded payment ${p.before.payment.reference}\nPrior: ${apMoney(p.before.payment.amount_cents, currency)} · ${p.before.payment.paid_on} · ${p.before.payment.reference}\n${sourceLines(p.before)}\nRevised: ${after}\nReason: ${p.reason}\n${effectsLines(p.effects)}\nThe original stays in history. No funds move and the posted cost is unchanged. Nothing has been saved. Is this correct?`,
            ),
            structuredContent: result as never,
          },
          "Show all prior/revised facts and balance effects. Wait for explicit confirmation, then save the exact returned payload and review key. If anything changes, read and review again. Never use job_cost_accounting_record payment for a correction.",
        );
      },
    ),
});
