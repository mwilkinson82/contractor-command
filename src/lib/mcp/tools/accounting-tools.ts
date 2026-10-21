// Accounting phase 1 (decision D1): save the job's retainage rule from the contract, or from the PM when the contract
// is silent. No global default. The pay app math checks (phase 2) enforce the saved rule and block on any mismatch.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text, type Sb } from "../guard";
import { rpc } from "../accounting/db";
import { audit, prefix, resolveJob, type Job } from "../jobs";
import { guide } from "../visible";
import { toBp } from "../accounting/cents";
import { REDUCTION_METHODS, RETAINAGE_SETUP_RULE, THRESHOLD_BASES, ruleLine, ruleProblems, type RetainageRule } from "../accounting/retainage";
import { accountingScope, requireApproved, requireBase } from "../accounting/foundations";
import { PAYMENT_TERMS_SETUP_RULE, PAYMENT_TERM_KINDS, termLine, termProblems, type PaymentTermRule } from "../accounting/payment-terms";
import { rpcSoft } from "../accounting/db";

const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company. Pass the company name exactly as Athena lists it.");
const pct = z.number().min(0).max(100).describe("Percent, e.g. 10 for 10%. At most two decimals.");

type GotRule = Partial<RetainageRule> & { found: boolean; version: number; updated_at?: string; updated_by_name?: string | null };

/** The saved rule, or null when none is saved (or the accounting schema isn't applied yet). Never throws for contract_terms. */
export async function savedRetainageRule(sb: Sb, job: Job): Promise<(RetainageRule & { version: number }) | null> {
  try {
    const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)("mcp_retainage_rule_get", { _job: job.job_id });
    const g = data as GotRule | null;
    if (error || !g?.found) return null;
    return { ...(g as RetainageRule), version: g.version };
  } catch {
    return null;
  }
}

/** contract_terms line for the saved rule, or the setup direction when none is saved. */
export function retainageRuleLines(r: (RetainageRule & { version: number }) | null): string[] {
  return r ? [`Retainage rule (saved v${r.version}): ${ruleLine(r)}`] : ["Retainage rule: Needed. Read it from the contract's retainage clause, or ask the PM if the contract is silent. There is no default rate."];
}

export const retainageRuleSave = defineTool({
  name: "retainage_rule_save",
  title: "Save the job's retainage rule (after approval)",
  description:
    `${RETAINAGE_SETUP_RULE} Show the rule and the exact clause to the PM, and call this only after they say yes to saving it. Athena refuses a rule that leaves out a needed part, a clause that isn't word for word in the contract text, or a stale base_version. Pay app checks enforce the saved rule to the cent. Full job access only.`,
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    approved: z.literal(true).describe("true only after the PM said yes to saving this exact rule."),
    base_version: z.number().int().min(0).describe("The rule version shown by contract_terms (0 when none is saved)."),
    rate_pct: pct.describe("The retainage rate held on each payment, e.g. 10. Use 0 when the contract holds no retainage."),
    reduction: z.enum(REDUCTION_METHODS).describe("prospective: later payments at the reduced rate. whole_balance: the whole balance held drops to the reduced rate. period_start_status: the rate for a period depends on where the job stood at its start. none: one rate, no reduction."),
    threshold_pct: pct.optional().describe("% complete where the reduction starts, e.g. 50. Leave out when reduction is none."),
    threshold_basis: z.enum(THRESHOLD_BASES).optional().describe("What the % complete is measured against, as the contract says. Leave out when reduction is none."),
    reduced_rate_pct: pct.optional().describe("The reduced rate, e.g. 5. Leave out when reduction is none."),
    release_terms: z.string().trim().max(1000).optional().describe("When retainage is released, in the contract's words or the PM's answer."),
    source: z.enum(["contract", "pm_answer"]).describe("contract when read from the contract; pm_answer when the contract is silent and the PM gave the rule."),
    clause_section: z.string().trim().max(40).optional().describe("Section number of the retainage clause, e.g. 4.1. Required for source contract."),
    clause_text: z.string().trim().max(4000).optional().describe("The retainage clause copied exactly from the contract. Required for source contract."),
    contract_text: z.string().max(400000).optional().describe("The full contract text, so Athena can confirm the clause is word for word."),
    answered_by: z.string().trim().max(160).optional().describe("pm_answer: who gave the rule."),
    stored_rate_pct: pct.optional().describe("Only when the contract sets a different retainage rate for stored materials. Leave out otherwise: stored materials are held at the same rate as completed work."),
    what_changed: z.string().trim().min(1).max(300).describe("One line: what this saves or changes."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("retainage_rule_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "write");
      let rule: RetainageRule;
      try {
        rule = {
          base_rate_bp: toBp(args.rate_pct),
          reduction: args.reduction,
          threshold_bp: args.threshold_pct === undefined ? null : toBp(args.threshold_pct),
          threshold_basis: args.threshold_basis ?? null,
          reduced_rate_bp: args.reduced_rate_pct === undefined ? null : toBp(args.reduced_rate_pct),
          release_terms: args.release_terms?.trim() || null,
          source: args.source,
          clause_section: args.clause_section?.replace(/^(?:§+|section)\s*/i, "").trim() || null,
          clause_text: args.clause_text ?? null,
          answered_by: args.answered_by?.trim() || null,
          stored_rate_bp: args.stored_rate_pct === undefined ? null : toBp(args.stored_rate_pct),
        };
      } catch (e) {
        throw new ToolError(`${(e as Error).message}. Nothing was saved.`);
      }
      const problems = ruleProblems(rule, args.contract_text ?? null);
      if (problems.length) throw new ToolError(`${prefix(job)}Retainage rule not saved.\n${problems.map((p) => `- ${p}`).join("\n")}`);
      const cur = await savedRetainageRule(sb, job);
      requireBase("The retainage rule", cur?.version ?? 0, args.base_version);
      const r = await rpc<{ id: string; version: number }>(sb, "mcp_retainage_rule_save", { _job: job.job_id, _base_version: args.base_version, _rule: rule, _what: args.what_changed, _who: null });
      await audit(sb, job, "retainage_rule_save", "save_retainage_rule", r.id);
      return guide(
        {
          ...text(`${prefix(job)}Retainage rule saved as v${r.version}.\n${ruleLine(rule)}\nPay app checks now enforce this rule to the cent.`),
          structuredContent: { saved: true, version: r.version, retainage_rule: rule },
        },
        "Next move: offer to draft the next pay app against this rule, or to confirm the release terms if they show Needed.",
      );
    }),
});

// ---------- D11: payment-term rule per job ----------
type GotTerms = Partial<PaymentTermRule> & { found: boolean; version: number };

export async function savedPaymentTerms(sb: Sb, job: Job): Promise<(PaymentTermRule & { version: number }) | null> {
  const g = await rpcSoft<GotTerms>(sb, "mcp_payment_terms_get", { _job: job.job_id });
  return g?.found ? ({ ...(g as PaymentTermRule), version: g.version }) : null;
}

export function paymentTermLines(r: (PaymentTermRule & { version: number }) | null): string[] {
  return r ? [`Payment terms (saved v${r.version}): ${termLine(r)}`] : ["Payment terms: Needed. Read them from the contract's payment clause, or ask the PM if the contract is silent. There is no default."];
}

export const paymentTermsSave = defineTool({
  name: "payment_terms_save",
  title: "Save the job's payment terms (after approval)",
  description: `${PAYMENT_TERMS_SETUP_RULE} Show the terms and the exact clause to the PM and call this only after they say yes. Every pay app and invoice due date, and AR aging, comes from the saved terms. Full job access only.`,
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    approved: z.literal(true).describe("true only after the PM said yes to saving these exact terms."),
    base_version: z.number().int().min(0).describe("The terms version shown by contract_terms (0 when none is saved)."),
    kind: z.enum(PAYMENT_TERM_KINDS).describe("pay_when_paid: X days after the GC is paid. after_approval / after_submission: N days after the pay app is approved or submitted."),
    days: z.number().int().min(0).max(365).describe("X or N, as the contract says."),
    day_type: z.enum(["calendar", "working"]).describe("calendar unless the contract says working or business days."),
    owner_terms_days: z.number().int().min(0).max(365).optional().describe("pay_when_paid: the GC's owner payment terms in days, if stated. Used for the Estimated date."),
    owner_terms_from: z.enum(["approval", "submission"]).optional().describe("pay_when_paid: what the GC's owner terms count from."),
    source: z.enum(["contract", "pm_answer"]).describe("contract when read from the contract; pm_answer when the contract is silent."),
    clause_section: z.string().trim().max(40).optional().describe("Section number of the payment clause. Required for source contract."),
    clause_text: z.string().trim().max(4000).optional().describe("The payment clause copied exactly. Required for source contract."),
    contract_text: z.string().max(400000).optional().describe("The full contract text, so Athena can confirm the clause is word for word."),
    answered_by: z.string().trim().max(160).optional().describe("pm_answer: who gave the terms."),
    what_changed: z.string().trim().min(1).max(300).describe("One line: what this saves or changes."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("payment_terms_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "write");
      const rule: PaymentTermRule = {
        kind: args.kind, days: args.days, day_type: args.day_type,
        owner_terms_days: args.owner_terms_days ?? null, owner_terms_from: args.owner_terms_from ?? null,
        source: args.source, clause_section: args.clause_section?.replace(/^(?:§+|section)\s*/i, "").trim() || null,
        clause_text: args.clause_text ?? null, answered_by: args.answered_by?.trim() || null,
      };
      const problems = termProblems(rule, args.contract_text ?? null);
      if (problems.length) throw new ToolError(`${prefix(job)}Payment terms not saved.\n${problems.map((p) => `- ${p}`).join("\n")}`);
      const cur = await savedPaymentTerms(sb, job);
      requireBase("The payment terms", cur?.version ?? 0, args.base_version);
      const r = await rpc<{ id: string; version: number }>(sb, "mcp_payment_terms_save", { _job: job.job_id, _base_version: args.base_version, _rule: rule, _what: args.what_changed, _who: null });
      await audit(sb, job, "payment_terms_save", "save_payment_terms", r.id);
      return guide(
        { ...text(`${prefix(job)}Payment terms saved as v${r.version}.\n${termLine(rule)}\nEvery pay app due date and AR aging now comes from these terms.`), structuredContent: { saved: true, version: r.version, payment_terms: rule } },
        "Next move: offer to show AR aging for this job, or to log the GC's paid date on any open pay app so its Estimated date becomes firm.",
      );
    }),
});
