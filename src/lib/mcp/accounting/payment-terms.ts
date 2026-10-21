// Decision D11 (corrected, Marshall via Khan, 2026-10-20 11:24 PM): payment terms come from each job's contract, like
// retainage, and are saved as a payment-term rule per job. No default.
// (a) Sub pay-when-paid: due X days after the GC's paid date. Until that date is logged, the due date is the expected
//     date (the GC's owner terms plus X), flagged Estimated, and it is recomputed once the paid date is logged.
// (b) Prime: due N days after pay app approval or submission, per the contract.
// Every invoice and pay app gets a due date, which drives AR aging (current, 1-30, 31-60, 61-90, 90+). Overdue is an alert.
import { addCountedDays, diffDays } from "../deadlines";

export const PAYMENT_TERM_KINDS = ["pay_when_paid", "after_approval", "after_submission"] as const;
export type PaymentTermKind = (typeof PAYMENT_TERM_KINDS)[number];
export type TermDayType = "calendar" | "working";

export type PaymentTermRule = {
  kind: PaymentTermKind;
  days: number; // X (pay-when-paid) or N (prime)
  day_type: TermDayType;
  // pay_when_paid only: the GC's owner terms, used for the Estimated date until the GC's paid date is logged.
  owner_terms_days: number | null;
  owner_terms_from: "approval" | "submission" | null;
  source: "contract" | "pm_answer";
  clause_section: string | null;
  clause_text: string | null;
  answered_by: string | null;
};

export const PAYMENT_TERMS_PM_ASK =
  "The contract doesn't say when you get paid. What are the payment terms on this job: paid a set number of days after the GC is paid (and how many), or a set number of days after the pay app is approved or submitted? I'll save your answer as the job's rule.";

export function termProblems(r: PaymentTermRule, contractText?: string | null): string[] {
  const p: string[] = [];
  if (!Number.isInteger(r.days) || r.days < 0 || r.days > 365) p.push("Say how many days the contract gives for payment (0 to 365).");
  if (r.kind === "pay_when_paid") {
    if ((r.owner_terms_days === null) !== (r.owner_terms_from === null)) p.push("Give the GC's owner terms as both days and what they count from, or leave both out.");
  } else if (r.owner_terms_days !== null || r.owner_terms_from !== null) p.push("Owner terms only apply to pay-when-paid.");
  if (r.source === "contract") {
    if (!r.clause_text?.trim() || !r.clause_section?.trim()) p.push("Quote the payment clause exactly, with its section number.");
    else if (contractText && !norm(contractText).includes(norm(r.clause_text))) p.push(`The clause text for §${r.clause_section} isn't found word for word in the contract. Copy it exactly.`);
  } else if (!r.answered_by?.trim()) p.push(PAYMENT_TERMS_PM_ASK);
  return p;
}
const norm = (s: string) => s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const add = (d: string, n: number, t: TermDayType) => addCountedDays(d, n, t === "working" ? "working" : "calendar", new Set());
const unit = (r: PaymentTermRule) => (r.day_type === "working" ? "working days" : "days");

export function termLine(r: PaymentTermRule): string {
  const how =
    r.kind === "pay_when_paid"
      ? `${r.days} ${unit(r)} after the GC is paid${r.owner_terms_days !== null ? ` (GC's owner terms: ${r.owner_terms_days} days after ${r.owner_terms_from}, used for the Estimated date)` : ""}`
      : `${r.days} ${unit(r)} after the pay app is ${r.kind === "after_approval" ? "approved" : "submitted"}`;
  const src = r.source === "contract" ? `§${r.clause_section} ‹${r.clause_text}› (document)` : `the contract is silent; per ${r.answered_by} (PM answer)`;
  return `Paid ${how}. Source: ${src}.`;
}

export type DueIn = { submitted?: string | null; approved?: string | null; gc_paid?: string | null };
export type Due = { due: string | null; estimated: boolean; basis: string };

/** The due date for one invoice or pay app. "Needed" (null) only when a date it counts from isn't logged yet. */
export function dueDate(r: PaymentTermRule | null, d: DueIn): Due {
  if (!r) return { due: null, estimated: false, basis: "Needed: no payment-term rule saved for this job." };
  if (r.kind === "pay_when_paid") {
    if (d.gc_paid) return { due: add(d.gc_paid, r.days, r.day_type), estimated: false, basis: `${r.days} ${unit(r)} after the GC was paid on ${d.gc_paid}` };
    const from = r.owner_terms_from === "approval" ? d.approved : r.owner_terms_from === "submission" ? d.submitted : null;
    if (r.owner_terms_days === null || !from) return { due: null, estimated: false, basis: "Needed: log the GC's paid date, or save the GC's owner terms for an estimate." };
    const gcExpected = add(from, r.owner_terms_days, "calendar");
    return { due: add(gcExpected, r.days, r.day_type), estimated: true, basis: `Estimated: GC expected to be paid ${gcExpected} (${r.owner_terms_days} days after ${r.owner_terms_from}) plus ${r.days} ${unit(r)}` };
  }
  const from = r.kind === "after_approval" ? d.approved : d.submitted;
  if (!from) return { due: null, estimated: false, basis: `Needed: log the ${r.kind === "after_approval" ? "approval" : "submission"} date.` };
  return { due: add(from, r.days, r.day_type), estimated: false, basis: `${r.days} ${unit(r)} after ${r.kind === "after_approval" ? "approval" : "submission"} on ${from}` };
}

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Aging on the as-of date. Anything past due is overdue (the alert color); current is not. */
export function agingBucket(due: string | null, asOf: string): { bucket: AgingBucket | null; days_overdue: number; overdue: boolean } {
  if (!due) return { bucket: null, days_overdue: 0, overdue: false };
  const n = diffDays(asOf, due);
  if (n <= 0) return { bucket: "current", days_overdue: 0, overdue: false };
  return { bucket: n <= 30 ? "1-30" : n <= 60 ? "31-60" : n <= 90 ? "61-90" : "90+", days_overdue: n, overdue: true };
}

/** AR aging totals in cents by bucket for open balances. */
export function agingTotals(items: { open: number; due: string | null }[], asOf: string): Record<AgingBucket | "needed", number> {
  const t = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, needed: 0 } as Record<AgingBucket | "needed", number>;
  for (const i of items) {
    if (i.open <= 0) continue;
    const b = agingBucket(i.due, asOf).bucket;
    t[b ?? "needed"] += i.open;
  }
  return t;
}

export const PAYMENT_TERMS_SETUP_RULE =
  "Payment terms are set per job from the contract; there is no default. At job setup, read the payment clause and save it with payment_terms_save: pay-when-paid (days after the GC is paid, plus the GC's owner terms if the contract states them) or days after the pay app is approved or submitted, calendar or working days, with the clause copied exactly and its section number. If the contract is silent, ask the PM and save their answer.";
