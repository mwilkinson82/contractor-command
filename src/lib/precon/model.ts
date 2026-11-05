// Pre-construction agreement: the shape mcp_precon_get returns and the pure rules both the chat card and the job
// board use (installments, money, the next step to offer). No database or server code here.
export const PRECON_PHASES = [
  "agreement",
  "design",
  "estimate",
  "proposal",
  "contract",
  "closed",
] as const;
export type PreconPhase = (typeof PRECON_PHASES)[number];
export type PreconInvoice = {
  id: string;
  number: string;
  kind: "invoice" | "pay_application" | "credit";
  status: string;
  invoice_date: string;
  net_due_cents: number;
  paid_cents: number;
  credited_cents: number;
  credit_for?: string | null;
};
/** The deductive change order that credits the pre-con fee to the construction contract. */
export type PreconCreditChange = {
  id: string;
  number: string;
  co_number: string | null;
  state: string;
  total_cents: number | null;
};
export type PreconAgreement = {
  id: string;
  job_id: string;
  version: number;
  status: "draft" | "sent" | "signed" | "closed";
  phase: PreconPhase;
  design_partner: string | null;
  design_role: string | null;
  design_fee_cents: number;
  design_days: number | null;
  design_markup_bps: number;
  hourly_rate_cents: number;
  time_lines: { label: string; hours: number; note?: string }[];
  includes: string[];
  billing: "full" | "split";
  owner_owns_drawings: boolean;
  credit: boolean;
  credit_days: number | null;
  credit_until: string | null;
  price_cents: number;
  parts: {
    design_cents: number;
    markup_cents: number;
    hours: number;
    time_cents: number;
    price_cents: number;
  };
  installments: { when: "signing" | "final_drawings"; amount_cents: number }[];
  hours_used: number;
  sent_on: string | null;
  signed_on: string | null;
  signed_name: string | null;
  signed_via: string | null;
  drawings_approved_on: string | null;
  outcome: "won" | "lost" | null;
  closed_on: string | null;
  invoices: PreconInvoice[];
  credit_change: PreconCreditChange | null;
  /** The job has its construction SOV, so the credit change order can go on the contract. */
  contract_sov: boolean;
  note: string | null;
};
export type PreconPayload = {
  status: "ok" | "none";
  job_id: string;
  job_number: string;
  job_name: string;
  agreement?: PreconAgreement;
  /** Who has a client page on this job: they get the pre-con invoices. */
  portal_customers?: { access_id: string; email: string; name: string }[];
  already?: boolean;
};

export const PHASE_LABEL: Record<PreconPhase, string> = {
  agreement: "Agreement",
  design: "Design",
  estimate: "Estimate",
  proposal: "Proposal",
  contract: "Contract",
  closed: "Closed",
};
/** The strip on the job board, in order. Closed (owner took the drawings elsewhere) replaces the last two. */
export const PHASE_STRIP: PreconPhase[] = [
  "agreement",
  "design",
  "estimate",
  "proposal",
  "contract",
];

export const usd = (cents: number | null | undefined) =>
  typeof cents === "number"
    ? (cents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents % 100 ? 2 : 0,
        maximumFractionDigits: 2,
      })
    : "";

/** Paid on the agreement's own invoices, and what is still open on them. */
export function preconMoney(a: PreconAgreement) {
  const billed = a.invoices
    .filter((i) => i.status !== "void" && i.status !== "draft")
    .reduce((t, i) => t + i.net_due_cents, 0);
  const paid = a.invoices.reduce(
    (t, i) => t + Math.max(0, i.paid_cents) + Math.max(0, i.credited_cents),
    0,
  );
  return {
    billed,
    paid,
    open: Math.max(0, billed - paid),
    unbilled: Math.max(0, a.price_cents - billed),
  };
}

/** The installment that is due next and not yet invoiced, or null when every one is out. */
export function nextInstallment(a: PreconAgreement): { index: 1 | 2; amount_cents: number } | null {
  const issued = a.invoices.filter((i) => i.status !== "void").length;
  if (issued >= a.installments.length) return null;
  const inst = a.installments[issued]!;
  if (inst.when === "signing" && a.status !== "signed" && a.status !== "closed") return null;
  if (inst.when === "final_drawings" && !a.drawings_approved_on) return null;
  return { index: (issued + 1) as 1 | 2, amount_cents: inst.amount_cents };
}

/** Where the credit stands: none owed, still to make, waiting on the owner, or on the contract. */
export function creditState(a: PreconAgreement): "none" | "to_make" | "waiting" | "applied" {
  if (!a.credit) return "none";
  const c = a.credit_change;
  if (!c || c.state === "rejected") return "to_make";
  return c.state === "executed" ? "applied" : "waiting";
}

function creditStep(a: PreconAgreement): string | null {
  const s = creditState(a);
  if (s === "to_make")
    return a.contract_sov
      ? `Add the ${usd(a.price_cents)} pre-con credit to the contract as a change order for the owner to approve?`
      : `Set up the contract's schedule of values, then I'll add the ${usd(a.price_cents)} pre-con credit as a change order.`;
  if (s === "waiting")
    return a.credit_change!.state === "approved"
      ? `The owner approved the pre-con credit (${a.credit_change!.number}). Execute it so it shows on the next pay application?`
      : `Send the pre-con credit change order ${a.credit_change!.number} to the owner to approve?`;
  return null;
}

/** Athena walks the member to the next step: one question they can say yes to. */
export function preconNextStep(a: PreconAgreement | null | undefined): string {
  if (!a)
    return "Want to start a pre-construction agreement on this job? Tell me who's drawing it, their fee and how long they need.";
  if (a.price_cents <= 0)
    return "What's the designer's fee, and how many of your hours go into it?";
  if (a.status === "draft")
    return "Send the agreement to the owner? Tell me when it's sent and I'll mark it.";
  if (a.status === "sent") return "Did the owner sign it? Tell me who signed and when.";
  const next = nextInstallment(a);
  if (next)
    return `Send invoice ${next.index} for ${usd(next.amount_cents)} to the owner's client page?`;
  if (a.status === "closed") {
    const credit = a.outcome === "won" ? creditStep(a) : null;
    if (credit) return credit;
    return a.outcome === "won"
      ? "Pre-con is wrapped up. The job runs from its contract now."
      : "Pre-con is closed. The owner kept the drawings.";
  }
  if (!a.drawings_approved_on)
    return "Did the owner approve the final drawings? That starts the estimate.";
  if (a.phase === "estimate") return "Build the estimate from the final drawings now?";
  if (a.phase === "proposal")
    return "When the owner signs the contract, tell me and I'll close pre-con as won.";
  if (a.phase === "contract") return creditStep(a) ?? "Close pre-con as won?";
  return "Anything else on the pre-con agreement?";
}
