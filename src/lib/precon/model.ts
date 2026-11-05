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
  /** The owner's payments in order: the agreement's own, or the old full or split billing. */
  installments: PreconInstallment[];
  /** The contractor's own payments as saved (empty: billing applies). Absent before the signing migration. */
  payments?: { amount_cents: number; due: PreconInstallment["when"]; on?: string; when?: string }[];
  /** The contractor's own extra terms, word for word. */
  own_terms?: string[];
  construction_line?: boolean;
  /** The agreement as it is on the owner's client page now, with their answer once they give it. */
  portal?: {
    item_id: string;
    shared_at: string;
    due_on: string | null;
    fingerprint: string;
    decision: {
      decision: "signed" | "declined";
      typed_name: string;
      decided_at: string;
      note: string | null;
    } | null;
  } | null;
  /** The owner's signature on the client page. */
  signature?: PreconSignature | null;
  /** The owner paying a pre-con bill by check, and the pickup set. */
  checks?: PreconCheck[];
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
export type PreconInstallment = {
  when: "signing" | "final_drawings" | "date" | "step";
  amount_cents: number;
  /** A payment due on a date. */
  on?: string | null;
  /** A payment due at a step the contractor named, in the owner's words. */
  step?: string | null;
  /** When it's due, as the owner reads it after the amount. */
  words?: string;
};
export type PreconSignature = {
  decision_id: string;
  typed_name: string;
  email: string;
  decided_at: string;
  code_verified: boolean;
  ip: string | null;
  user_agent: string | null;
  consent: string | null;
  statement: string;
  fingerprint: string;
};
export type PreconCheck = {
  invoice_id: string;
  item_id: string;
  requested_at: string | null;
  note: string | null;
  pickup_on: string | null;
  pickup_window: string | null;
  pickup_place: string | null;
  pickup_by: string | null;
};

/** When a payment is due, read after its amount. */
export function installmentWords(i: PreconInstallment): string {
  if (i.words) return i.words;
  if (i.when === "signing") return "when you sign";
  if (i.when === "final_drawings") return "when you approve the final drawings";
  if (i.when === "date" && i.on) return `on ${i.on}`;
  return i.step ?? "as agreed";
}

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
export function nextInstallment(
  a: PreconAgreement,
): { index: number; amount_cents: number; words: string } | null {
  const issued = a.invoices.filter((i) => i.status !== "void").length;
  if (issued >= a.installments.length) return null;
  if (a.status !== "signed" && a.status !== "closed") return null;
  const inst = a.installments[issued]!;
  if (inst.when === "final_drawings" && !a.drawings_approved_on) return null;
  return { index: issued + 1, amount_cents: inst.amount_cents, words: installmentWords(inst) };
}

/** A pre-con bill the owner said they're paying by check, with no pickup set yet. */
export function checkWaiting(
  a: PreconAgreement,
): { check: PreconCheck; invoice: PreconInvoice } | null {
  for (const c of a.checks ?? []) {
    if (c.pickup_on || !c.requested_at) continue;
    const invoice = a.invoices.find((i) => i.id === c.invoice_id);
    if (invoice && invoice.paid_cents + invoice.credited_cents < invoice.net_due_cents)
      return { check: c, invoice };
  }
  return null;
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
    return "Send the agreement to the owner's client page to sign? I'll read you the terms first.";
  if (a.status === "sent") {
    const d = a.portal?.decision;
    if (d?.decision === "declined")
      return `${d.typed_name} declined the agreement${d.note ? `: "${d.note}"` : ""}. Change the terms and send it again?`;
    if (a.portal)
      return "The agreement is on the owner's client page to sign. If they signed on paper instead, tell me who signed and when.";
    return "Did the owner sign it? Tell me who signed and when, or send it to their client page to sign.";
  }
  const waiting = checkWaiting(a);
  if (waiting)
    return `${a.signed_name ?? "The owner"} is paying invoice ${waiting.invoice.number} for ${usd(waiting.invoice.net_due_cents)} by check. When will you collect it?`;
  const next = nextInstallment(a);
  if (next)
    return `Send payment ${next.index} for ${usd(next.amount_cents)}, due ${next.words}, to the owner's client page?`;
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
