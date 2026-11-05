import { centsValue, formatMoney, formatRecordDate } from "./money-format";
import { recordLink, type RecordLink } from "./accounting-record-target";

/**
 * Plain-language payment trail for one supplier bill or expense: what it is, who approved it,
 * when it hit job cost, every recorded payment and what is left. Read-only; built from the
 * records the member can already read. Nothing here verifies a bank transfer.
 */
export type TrailState = "done" | "open" | "missing" | "void";
export type TrailStep = {
  key: string;
  state: TrailState;
  title: string;
  date?: string;
  amount?: string;
  detail?: string;
  link?: { label: string; url: string };
  highlight?: boolean;
  warn?: boolean;
};
export type TrailPayment = {
  id: string;
  amount: string;
  date: string;
  reference: string;
  corrected: boolean;
  highlight: boolean;
  link: RecordLink;
};
export type PaymentTrail = {
  payee: string;
  billLabel: string;
  billLink: RecordLink;
  kindLabel: string;
  currency: string | null;
  total: string;
  paid: string;
  remaining: string;
  percentPaid: number;
  status: "paid" | "partial" | "unpaid" | "overpaid";
  statusLabel: string;
  payments: TrailPayment[];
  steps: TrailStep[];
  purchaseOrder: { label: string; detail: string; url?: string; over: boolean } | null;
  focus: { amount: string; date: string; reference: string; corrected: boolean } | null;
  proof: {
    invoice: Array<{ id: string; filename: string; version?: number }>;
    invoiceNote: string;
    payment: Array<{ id: string; filename: string }>;
    paymentNote: string;
  };
};

export type TrailRecord = {
  id: string;
  kind: string;
  versions: Array<{
    version: number;
    facts: Record<string, unknown>;
    recorded_at?: string;
    reason?: string | null;
    purchase_order_ref?: string | null;
    purchase_order_version_ref?: number | null;
  }>;
  posted_version: number | null;
  approved_versions: number[];
  business_approvals?: Array<Record<string, unknown>>;
  posting_events?: Array<Record<string, unknown>>;
  payments: Array<{
    id: string;
    reference: string;
    amount_cents: number | string;
    paid_on: string;
    corrected?: boolean;
  }>;
  active_settlement_cents?: number | string | null;
};

const KIND: Record<string, string> = {
  supplier_bill: "Supplier bill",
  subcontractor_bill: "Subcontractor bill",
  reimbursable_expense: "Reimbursable expense",
  company_paid_expense: "Company-paid expense",
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function buildPaymentTrail(
  job: string,
  record: TrailRecord,
  options: {
    focusPaymentId?: string;
    timeZone?: string;
    originals?: Array<{ id: string; filename: string; version?: number }>;
    originalsNote?: string;
    purchaseOrder?: {
      number: string;
      status: string;
      totalCents: number | null;
      /** Every posted bill amount linked to this PO, this one included. */
      billedCents: number | null;
      url: string;
    };
    paymentProof?: Array<{ id: string; filename: string }>;
  } = {},
): PaymentTrail {
  const versions = [...record.versions].sort((a, b) => a.version - b.version);
  const latest = versions[versions.length - 1];
  const basis = versions.find((v) => v.version === record.posted_version) ?? latest;
  const f = basis.facts;
  const currency = str(f.currency_code);
  const tz = options.timeZone;
  const money = (c: unknown) =>
    formatMoney(
      typeof c === "number" || typeof c === "string" ? c : null,
      currency,
      "Not recorded",
    );
  const totalCents = centsValue(
    typeof f.amount_cents === "number" || typeof f.amount_cents === "string"
      ? f.amount_cents
      : null,
  );
  const active = record.payments.filter((p) => !p.corrected);
  const summed = active.reduce((n, p) => n + (centsValue(p.amount_cents) ?? 0n), 0n);
  const settled = centsValue(record.active_settlement_cents ?? null);
  const paidCents = settled ?? summed;
  const remainingCents = totalCents === null ? null : totalCents - paidCents;
  const status: PaymentTrail["status"] =
    remainingCents === null
      ? paidCents > 0n
        ? "partial"
        : "unpaid"
      : remainingCents < 0n
        ? "overpaid"
        : remainingCents === 0n
          ? "paid"
          : paidCents > 0n
            ? "partial"
            : "unpaid";
  const statusLabel = {
    paid: "Paid in full",
    partial: "Partly paid",
    unpaid: "Not paid yet",
    overpaid: "Paid more than the bill",
  }[status];
  const percentPaid =
    totalCents && totalCents > 0n
      ? Math.max(0, Math.min(100, Number((paidCents * 1000n) / totalCents) / 10))
      : 0;
  const ref = str(f.document_reference) ?? str(f.description) ?? "Bill";
  const billLink = recordLink(job, `Open ${ref}`, {
    kind: "payable",
    id: record.id,
    version: basis.version,
  });
  const payments: TrailPayment[] = [...record.payments]
    .sort((a, b) => a.paid_on.localeCompare(b.paid_on))
    .map((p) => ({
      id: p.id,
      amount: money(p.amount_cents),
      date: formatRecordDate(p.paid_on),
      reference: p.reference,
      corrected: !!p.corrected,
      highlight: p.id === options.focusPaymentId,
      link: recordLink(job, `Open payment ${p.reference}`, {
        kind: "payment",
        id: p.id,
        payableId: record.id,
      }),
    }));

  const steps: TrailStep[] = [];
  const poRef = basis.purchase_order_ref ?? str(f.purchase_order_id);
  const po = options.purchaseOrder;
  const poLeft =
    po && po.totalCents !== null && po.billedCents !== null ? po.totalCents - po.billedCents : null;
  const poDetail = po
    ? [
        po.status,
        po.billedCents === null ? null : `${money(po.billedCents)} billed against it`,
        poLeft === null
          ? null
          : poLeft < 0
            ? `${money(-poLeft)} over the PO`
            : `${money(poLeft)} left on the PO`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  steps.push(
    po
      ? {
          key: "po",
          state: "done",
          title: `Purchase order ${po.number}`,
          amount: po.totalCents === null ? undefined : money(po.totalCents),
          detail: poDetail,
          link: { label: `Open ${po.number}`, url: po.url },
          warn: poLeft !== null && poLeft < 0,
        }
      : poRef
        ? {
            key: "po",
            state: "done",
            title: "Purchase order linked",
            detail: "Open the purchase orders page for its terms and balance.",
          }
        : { key: "po", state: "missing", title: "No purchase order linked to this bill" },
  );
  steps.push({
    key: "bill",
    state: "done",
    title: `${KIND[record.kind] ?? "Bill"} ${ref} recorded`,
    date: formatRecordDate(basis.recorded_at ?? str(f.incurred_on), tz),
    amount: money(f.amount_cents),
    detail:
      basis.version > 1
        ? `Version ${basis.version}${basis.reason ? `: ${basis.reason}` : ""}`
        : (str(f.description) ?? undefined),
    link: billLink,
  });
  const approval = (record.business_approvals ?? [])
    .filter((a) => a.version === basis.version && !a.withdrawn)
    .sort((a, b) => String(b.approved_at ?? "").localeCompare(String(a.approved_at ?? "")))[0];
  steps.push(
    approval
      ? {
          key: "approved",
          state: "done",
          title: "Approved for payment by the PM",
          date: formatRecordDate(str(approval.approved_at), tz),
          detail: str(approval.notes) ?? undefined,
        }
      : record.approved_versions.includes(basis.version)
        ? { key: "approved", state: "done", title: "Approved by accounting" }
        : { key: "approved", state: "open", title: "Waiting for PM approval" },
  );
  const posting = (record.posting_events ?? []).find((e) => e.version === basis.version);
  const allocations = Array.isArray(f.allocations)
    ? (f.allocations as Array<Record<string, unknown>>)
        .map((a) => `${String(a.cost_code)} ${money(a.amount_cents)}`)
        .join(" · ")
    : "";
  steps.push(
    posting
      ? {
          key: "posted",
          state: "done",
          title: "Posted to job cost",
          date: formatRecordDate(
            str(posting.accounting_effective_on) ?? str(posting.posted_at),
            tz,
          ),
          detail: allocations ? `Cost codes ${allocations}` : undefined,
        }
      : { key: "posted", state: "open", title: "Not posted to job cost yet" },
  );
  for (const p of payments)
    steps.push({
      key: `pay:${p.id}`,
      state: p.corrected ? "void" : "done",
      title: p.corrected ? `Payment ${p.amount} corrected` : `Paid ${p.amount}`,
      date: p.date,
      detail: p.reference,
      link: p.link,
      highlight: p.highlight,
    });
  steps.push(
    status === "paid"
      ? { key: "balance", state: "done", title: "Paid in full", amount: money(0) }
      : status === "overpaid"
        ? {
            key: "balance",
            state: "open",
            title: "Paid more than the bill",
            amount: money(remainingCents === null ? null : -remainingCents),
          }
        : {
            key: "balance",
            state: "open",
            title: "Balance still owed",
            amount: money(remainingCents === null ? null : remainingCents),
          },
  );
  const focus = payments.find((p) => p.highlight) ?? null;
  return {
    payee: str(f.counterparty_name) ?? "Payee not recorded",
    billLabel: ref,
    billLink,
    kindLabel: KIND[record.kind] ?? "Bill",
    currency,
    total: money(totalCents === null ? null : totalCents.toString()),
    paid: money(paidCents.toString()),
    remaining: money(remainingCents === null ? null : remainingCents.toString()),
    percentPaid,
    status,
    statusLabel,
    payments,
    steps,
    purchaseOrder: po
      ? { label: po.number, detail: poDetail, url: po.url, over: poLeft !== null && poLeft < 0 }
      : null,
    focus: focus
      ? {
          amount: focus.amount,
          date: focus.date,
          reference: focus.reference,
          corrected: focus.corrected,
        }
      : null,
    proof: {
      invoice: options.originals ?? [],
      invoiceNote:
        options.originalsNote ?? "The supplier's invoice is not attached to this bill yet.",
      payment: options.paymentProof ?? [],
      paymentNote:
        "Check or wire confirmation is not attached. Athena records what your team entered; it does not see the bank.",
    },
  };
}
