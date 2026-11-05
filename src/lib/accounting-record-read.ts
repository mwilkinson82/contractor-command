import { z } from "zod";
import { billingReportSchema, accountingMoney, poReportSchema } from "./accounting-report";
import { invoiceBalance, receiptBalance } from "./billing-evidence-balances";
import { AP_REPORT_CURRENCIES } from "./accounting-ap-versioned";
import {
  accountingTarget,
  recordLink,
  type AccountingTarget,
  type RecordLink,
} from "./accounting-record-target";
import { formatMoney, formatRecordDate } from "./money-format";
import { buildPaymentTrail, type PaymentTrail, type TrailRecord } from "./payable-payment-trail";

export type RecordIO = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
export type RecordDetail = {
  title: string;
  subtitle: string;
  facts: Array<[string, string]>;
  history: Array<{ label: string; facts: Array<[string, string]>; link?: RecordLink }>;
  related: RecordLink[];
  originals: Array<{ id: string; filename: string; version?: number }>;
  originalsNote: string;
  /** Plain-language trail for a supplier bill/expense or one of its payments. */
  trail?: PaymentTrail;
  /** Set when the reader may attach proof to the focused payment (owner or accounts payable). */
  proofTarget?: { recordId: string; paymentId: string } | null;
};
const unavailable = () =>
  new Error(
    "This exact record or version is unavailable for this project and your current access. No other record was substituted.",
  );
async function read(io: RecordIO, name: string, args: Record<string, unknown>) {
  const r = await io.rpc(name, args);
  if (r.error || r.data === null) throw unavailable();
  if (JSON.stringify(r.data).length > 2_097_152)
    throw new Error("Record evidence exceeds the supported read limit.");
  return r.data;
}
const uuid = z.string().uuid();
const originalList = z.array(
  z.object({ id: uuid, filename: z.string(), version: z.number().optional() }),
);
const factLabels: Record<string, string> = {
  status: "Status",
  invoice_date: "Invoice date",
  effective_date: "Effective date",
  source: "Source",
  reason: "Revision reason",
  description: "Description",
  document_reference: "Document reference",
  counterparty_name: "Payee",
  incurred_on: "Incurred date",
  accounting_effective_on: "Accounting effective date",
  recorded_at: "Recorded",
  corrected_at: "Corrected",
  posted_at: "Posted",
  paid_on: "Payment date",
  reference: "Reference",
};
const dateKeys = new Set([
  "invoice_date",
  "effective_date",
  "incurred_on",
  "accounting_effective_on",
  "recorded_at",
  "corrected_at",
  "posted_at",
  "paid_on",
]);
const moneyLabels: Record<string, string> = {
  amount_cents: "Amount",
  gross_cents: "Gross amount",
  withheld_cents: "Retainage withheld",
  released_cents: "Retainage released",
  net_due_cents: "Net due",
  certified_cents: "Certified amount",
  original_amount_cents: "Original amount",
};
/** Readable labels, "$6,400.00" money and "Nov 3, 2026" dates; a null currency is said, not guessed. */
function facts(
  value: Record<string, unknown>,
  currency: string | null = "USD",
): Array<[string, string]> {
  return Object.entries(value).flatMap(([k, v]): Array<[string, string]> => {
    if (v === null || v === undefined) return [];
    if (factLabels[k] && (typeof v === "string" || typeof v === "number"))
      return [
        [factLabels[k], dateKeys.has(k) && typeof v === "string" ? formatRecordDate(v) : String(v)],
      ];
    if (moneyLabels[k] && (typeof v === "string" || typeof v === "number"))
      return [[moneyLabels[k], formatMoney(v, currency)]];
    return [];
  });
}
const knownCurrency = (v: unknown) =>
  typeof v === "string" && AP_REPORT_CURRENCIES.includes(v) ? v : null;
const costVersion = z.object({
  version: z.number().int().positive(),
  facts: z.record(z.string(), z.unknown()),
  recorded_at: z.string().optional(),
  reason: z.string().nullable().optional(),
  purchase_order_ref: uuid.nullable().optional(),
  purchase_order_version_ref: z.number().nullable().optional(),
});
const costRecord = z.object({
  id: uuid,
  kind: z.string(),
  versions: z.array(costVersion).min(1),
  posted_version: z.number().nullable(),
  approved_versions: z.array(z.number()),
  business_approvals: z.array(z.record(z.string(), z.unknown())).optional(),
  posting_events: z.array(z.record(z.string(), z.unknown())).optional(),
  payments: z.array(
    z.object({
      id: uuid,
      reference: z.string(),
      amount_cents: z.union([z.number(), z.string()]),
      paid_on: z.string(),
      corrected: z.boolean().optional(),
      correction: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ),
  active_settlement_cents: z.union([z.number(), z.string()]).nullable().optional(),
});
type CostRecord = z.infer<typeof costRecord>;

/** Lines times unit price; null when any extension is fractional (no rounding policy is recorded). */
function poTotal(lines: Array<{ quantity: number; unit_price_cents: number }>): number | null {
  let total = 0;
  for (const l of lines) {
    const ext = l.quantity * l.unit_price_cents;
    if (!Number.isSafeInteger(ext)) return null;
    total += ext;
  }
  return total;
}
async function trailFor(
  io: RecordIO,
  job: string,
  records: CostRecord[],
  r: CostRecord,
  focusPaymentId?: string,
): Promise<{ trail: PaymentTrail; proofTarget: RecordDetail["proofTarget"] }> {
  const latest = Math.max(...r.versions.map((v) => v.version));
  const basis = r.versions.find((v) => v.version === (r.posted_version ?? latest))!;
  let purchaseOrder: NonNullable<Parameters<typeof buildPaymentTrail>[2]>["purchaseOrder"];
  if (basis.purchase_order_ref) {
    try {
      const orders = poReportSchema.parse(
        await read(io, "mcp_project_purchase_orders_get", { _job: job }),
      ).orders;
      const o = orders.find((o) => o.id === basis.purchase_order_ref);
      if (o) {
        const v = [...o.versions].sort((a, b) => b.version - a.version)[0];
        const billed = records.reduce((n, x) => {
          const posted = x.versions.find((y) => y.version === x.posted_version);
          const amount = posted?.facts.amount_cents;
          return posted?.purchase_order_ref === o.id && typeof amount === "number" ? n + amount : n;
        }, 0);
        purchaseOrder = {
          number: o.number,
          status: `${v.status[0].toUpperCase()}${v.status.slice(1)} v${v.version}`,
          totalCents: poTotal(v.lines),
          billedCents: billed,
          url: `https://app.meetathena.io/r/job/${job}/purchase-orders`,
        };
      }
    } catch {
      /* PO detail unreadable with this access: the trail still says a PO is linked. */
    }
  }
  let originals: Array<{ id: string; filename: string; version?: number }> = [];
  let originalsNote: string | undefined;
  try {
    const got = z.object({ originals: originalList }).parse(
      await read(io, "mcp_ap_original_list", {
        _job: job,
        _record: r.id,
        _version: basis.version,
      }),
    );
    originals = got.originals.filter((o) => o.version === basis.version);
  } catch {
    originalsNote = "The supplier's invoice is not available with your current access.";
  }
  let paymentProof: Array<{ id: string; filename: string }> = [];
  let canAttach = false;
  try {
    const got = z
      .object({
        proofs: z.array(z.object({ id: uuid, payment_id: uuid, filename: z.string() })),
        can_attach: z.boolean(),
      })
      .parse(await read(io, "mcp_cost_payment_proof_list", { _job: job, _record: r.id }));
    canAttach = got.can_attach;
    paymentProof = got.proofs
      .filter((p) => !focusPaymentId || p.payment_id === focusPaymentId)
      .map((p) => ({ id: p.id, filename: p.filename }));
  } catch {
    /* Proof storage is not set up yet, or not readable with this access. */
  }
  const trail = buildPaymentTrail(job, r as unknown as TrailRecord, {
    focusPaymentId,
    originals,
    originalsNote,
    purchaseOrder,
    paymentProof,
  });
  const focus = focusPaymentId ? r.payments.find((p) => p.id === focusPaymentId) : undefined;
  return {
    trail,
    proofTarget:
      canAttach && focus && !focus.corrected ? { recordId: r.id, paymentId: focus.id } : null,
  };
}
/** Only existing user-scoped RPC reads. Never calls review, save, post, allocate or confirm. */
export async function readAccountingRecord(
  io: RecordIO,
  job: string,
  input: AccountingTarget,
): Promise<RecordDetail> {
  uuid.parse(job);
  const t = accountingTarget.parse(input);
  const detail: RecordDetail = {
    title: "",
    subtitle: "",
    facts: [],
    history: [],
    related: [],
    originals: [],
    originalsNote: "No originals are linked to this selected record/version.",
  };
  if (["invoice", "credit", "receipt", "allocation"].includes(t.kind)) {
    const data = billingReportSchema.parse(
      await read(io, "mcp_billing_evidence_get", { _job: job }),
    );
    if (
      [...data.invoices, ...data.receipts, ...data.allocations, ...data.receipt_reversals].some(
        (r) => r.job_id !== job,
      )
    )
      throw unavailable();
    const invoiceLink = (id: string) => {
      const i = data.invoices.find((i) => i.id === id);
      if (!i) throw unavailable();
      return recordLink(job, i.document_number, {
        kind: i.kind === "credit" ? "credit" : "invoice",
        id: i.id,
        version: Math.max(...i.versions.map((v) => v.version)),
      });
    };
    const receiptLink = (id: string) => {
      const r = data.receipts.find((r) => r.id === id);
      if (!r) throw unavailable();
      return recordLink(job, r.source || "Receipt", { kind: "receipt", id });
    };
    if (t.kind === "invoice" || t.kind === "credit") {
      const i = data.invoices.find(
        (i) => i.id === t.id && (t.kind === "credit" ? i.kind === "credit" : i.kind !== "credit"),
      );
      if (!i) throw unavailable();
      const latest = Math.max(...i.versions.map((v) => v.version));
      const v = i.versions.find((v) => v.version === (t.version ?? latest));
      if (!v) throw unavailable();
      detail.title = `${i.document_number} · v${v.version}`;
      detail.subtitle = `${i.kind === "credit" ? "Credit" : "Invoice / pay application"} · ${v.version === latest ? "current version" : `historical version; current is v${latest}`}`;
      detail.facts = facts(v);
      const currentInvoices = data.invoices.map((i) => ({
        ...i,
        versions: [...i.versions].sort((a, b) => b.version - a.version),
      }));
      const balance = invoiceBalance(
        currentInvoices.find((x) => x.id === i.id)!,
        currentInvoices,
        data.allocations,
      );
      if (i.kind !== "credit")
        detail.facts.push([
          `Recorded remaining · current v${latest}`,
          accountingMoney(balance.remaining),
        ]);
      detail.history = i.versions.map((v) => ({
        label: `Version ${v.version}`,
        facts: facts(v),
        link: recordLink(job, `Open v${v.version}`, { ...t, version: v.version }),
      }));
      if (i.credit_for) detail.related.push(invoiceLink(i.credit_for));
      data.invoices
        .filter((c) => c.credit_for === i.id)
        .forEach((c) => detail.related.push(invoiceLink(c.id)));
    } else if (t.kind === "receipt") {
      const r = data.receipts.find((r) => r.id === t.id);
      if (!r) throw unavailable();
      detail.title = r.source || "Receipt";
      detail.subtitle = `Receipt · ${r.receipt_date}`;
      detail.facts = [["Recorded amount", accountingMoney(r.amount_cents)]];
      detail.facts.push([
        "Currently unapplied",
        accountingMoney(receiptBalance(r, data.allocations, data.receipt_reversals).unapplied),
      ]);
      detail.history = data.receipt_reversals
        .filter((x) => x.receipt_id === t.id)
        .map((x) => ({
          label: "Receipt reversal",
          facts: [
            ["Amount", accountingMoney(x.amount_cents)],
            ["Effective date", x.effective_date],
            ["Source", x.source],
          ],
        }));
    } else {
      const a = data.allocations.find((a) => a.id === t.id);
      if (!a) throw unavailable();
      detail.title = "Receipt allocation";
      detail.subtitle = a.reversal_of ? "Reversal of recorded allocation" : "Recorded allocation";
      detail.facts = [
        ["Amount", accountingMoney(a.amount_cents)],
        ["Effective date", a.effective_date],
        ["Source", a.source],
      ];
      detail.related = [invoiceLink(a.invoice_id), receiptLink(a.receipt_id)];
      if (a.reversal_of && data.allocations.some((x) => x.id === a.reversal_of))
        detail.related.push(
          recordLink(job, "Original allocation", { kind: "allocation", id: a.reversal_of }),
        );
      data.allocations
        .filter((x) => x.reversal_of === a.id)
        .forEach((x) =>
          detail.related.push(
            recordLink(job, "Allocation reversal", { kind: "allocation", id: x.id }),
          ),
        );
    }
    if (t.kind !== "allocation") {
      for (const a of data.allocations.filter((a) =>
        t.kind === "receipt" ? a.receipt_id === t.id : a.invoice_id === t.id,
      )) {
        detail.related.push(
          recordLink(
            job,
            `${a.reversal_of ? "Allocation reversal" : "Allocation"} · ${accountingMoney(a.amount_cents)} · ${a.effective_date}`,
            { kind: "allocation", id: a.id },
          ),
        );
        detail.related.push(
          t.kind === "receipt" ? invoiceLink(a.invoice_id) : receiptLink(a.receipt_id),
        );
      }
      try {
        const docs = z
          .object({
            documents: originalList,
            links: z.array(
              z.object({
                document_id: uuid,
                invoice_id: uuid.nullable(),
                invoice_version: z.number().nullable(),
                receipt_id: uuid.nullable(),
              }),
            ),
          })
          .parse(await read(io, "mcp_billing_documents_get", { _job: job }));
        const selected =
          t.kind === "receipt" ? undefined : Number(detail.title.match(/ · v(\d+)$/)?.[1]);
        const ids = new Set(
          docs.links
            .filter((l) =>
              t.kind === "receipt"
                ? l.receipt_id === t.id
                : l.invoice_id === t.id && l.invoice_version === selected,
            )
            .map((l) => l.document_id),
        );
        detail.originals = docs.documents.filter((d) => ids.has(d.id));
      } catch {
        detail.originalsNote =
          "Original evidence could not be read with your current access. No absence is inferred.";
      }
    }
  } else if (t.kind === "payable") {
    const data = z
      .object({ records: z.array(costRecord) })
      .parse(await read(io, "mcp_cost_submission_read", { _job: job }));
    const r = data.records.find((r) => r.id === t.id);
    if (!r) throw unavailable();
    const latest = Math.max(...r.versions.map((v) => v.version));
    const v = r.versions.find((v) => v.version === (t.version ?? latest));
    if (!v) throw unavailable();
    const currency = knownCurrency(v.facts.currency_code);
    detail.title = `${v.facts.document_reference || v.facts.description || "Supplier bill / expense"} · v${v.version}`;
    detail.subtitle = `${r.kind.replaceAll("_", " ")} · current v${latest}; posted ${r.posted_version === null ? "none" : `v${r.posted_version}`}`;
    detail.facts = facts({ ...v.facts, reason: v.reason, recorded_at: v.recorded_at }, currency);
    detail.facts.push([
      "Accounting approval for selected version",
      r.approved_versions.includes(v.version) ? "Recorded" : "Not recorded",
    ]);
    detail.history = r.versions.map((x) => ({
      label: `Version ${x.version}`,
      facts: facts(
        { ...x.facts, reason: x.reason, recorded_at: x.recorded_at },
        knownCurrency(x.facts.currency_code),
      ),
      link: recordLink(job, `Open v${x.version}`, { ...t, version: x.version }),
    }));
    const allocations = z
      .array(z.object({ job_id: uuid, cost_code: z.string(), amount_cents: z.number() }))
      .parse(v.facts.allocations);
    detail.history.push(
      ...allocations.map((a) => ({
        label: `v${v.version} allocation · ${a.cost_code}`,
        facts: [
          ["Project", a.job_id === job ? "This project" : a.job_id],
          ["Reviewed allocation", formatMoney(a.amount_cents, currency)],
        ] as Array<[string, string]>,
      })),
    );
    detail.history.push(
      ...(r.posting_events ?? []).map((e) => ({
        label: `Posting history · v${e.version}`,
        facts: facts(e, currency),
      })),
    );
    detail.history.push(
      ...(r.business_approvals ?? []).map((a) => ({
        label: `PM approval · v${a.version}${a.withdrawn ? " · withdrawn" : ""}`,
        facts: [
          ["Basis", String(a.basis ?? "Not recorded")],
          ["Notes", String(a.notes ?? "Not recorded")],
        ] as Array<[string, string]>,
      })),
    );
    for (const p of r.payments) {
      detail.related.push(
        recordLink(job, `Recorded payment ${p.reference}${p.corrected ? " · corrected" : ""}`, {
          kind: "payment",
          id: p.id,
          payableId: r.id,
        }),
      );
      detail.history.push({
        label: `Recorded payment ${p.reference}${p.corrected ? " · corrected" : ""}`,
        facts: [
          ["Payment date", formatRecordDate(p.paid_on)],
          ["Amount applied to this bill", formatMoney(p.amount_cents, currency)],
          ...(p.correction ? facts(p.correction, currency) : []),
        ],
      });
    }
    try {
      const originals = z
        .object({ originals: originalList })
        .parse(
          await read(io, "mcp_ap_original_list", { _job: job, _record: r.id, _version: v.version }),
        );
      if (originals.originals.some((o) => o.version !== v.version)) throw unavailable();
      detail.originals = originals.originals;
    } catch {
      detail.originalsNote =
        "Supplier originals are unavailable for this access level or version. Accounting/owner access and every allocated job must be authorized.";
    }
    const built = await trailFor(io, job, data.records, r);
    detail.trail = built.trail;
  } else {
    const raw = await read(io, "mcp_cost_payment_correction", {
      _job: job,
      _step: "read",
      _p: { id: t.payableId, payment_id: t.id },
      _review: null,
      _confirmed: false,
    });
    const result = z
      .object({
        state: z.object({
          payment: z.object({
            id: uuid,
            reference: z.string(),
            paid_on: z.string(),
            amount_cents: z.string(),
          }),
          records: z.array(
            z.object({
              record_id: uuid,
              job_id: uuid,
              document_reference: z.string().nullable(),
              description: z.string(),
              current_version: z.number(),
              posted_version: z.number().nullable(),
              currency_code: z.string().nullable(),
              original_amount_cents: z.string().regex(/^[0-9]{1,13}$/),
            }),
          ),
          correction: z.record(z.string(), z.unknown()).nullable(),
        }),
        history: z.array(z.record(z.string(), z.unknown())),
      })
      .parse(raw);
    const { state } = result;
    if (state.payment.id !== t.id || !state.records.some((r) => r.record_id === t.payableId))
      throw unavailable();
    const currencies = [...new Set(state.records.map((r) => r.currency_code))];
    const paymentCurrency = currencies.length === 1 ? knownCurrency(currencies[0]) : null;
    detail.title = `Payment ${state.payment.reference}`;
    detail.subtitle = `Payment recorded for ${formatRecordDate(state.payment.paid_on)}${state.correction ? " · corrected; original retained" : ""}`;
    // Allocation currencies are read independently; never assign one inferred currency to a shared payment.
    detail.facts = [
      ["Amount paid", formatMoney(state.payment.amount_cents, paymentCurrency)],
      ["Payment date", formatRecordDate(state.payment.paid_on)],
      ["Reference", state.payment.reference],
      ["Bank settlement", "Recorded by your team; Athena does not see the bank"],
    ];
    detail.history = state.records.map((r) => ({
      label: r.document_reference || r.description,
      facts: [
        [
          "Applied to this bill",
          formatMoney(r.original_amount_cents, knownCurrency(r.currency_code)),
        ],
        [
          "Bill version",
          `Current v${r.current_version} · posted ${r.posted_version ? `v${r.posted_version}` : "none"}`,
        ],
      ],
      link: recordLink(r.job_id, `Open ${r.document_reference || "bill"}`, {
        kind: "payable",
        id: r.record_id,
        version: r.current_version,
      }),
    }));
    detail.related = detail.history.map((h) => h.link!);
    detail.history.push(
      ...result.history.map((h) => ({
        label: "Correction history",
        facts: facts(h, paymentCurrency),
      })),
    );
    if (state.correction)
      detail.history.push({
        label: "Original payment correction",
        facts: facts(state.correction, paymentCurrency),
      });
    for (const h of result.history) {
      if (h.revised && typeof h.revised === "object")
        detail.history.push({
          label: "Replacement payment facts",
          facts: facts(h.revised as Record<string, unknown>, paymentCurrency),
        });
      for (const key of ["payment_id", "replacement_id"])
        if (typeof h[key] === "string" && uuid.safeParse(h[key]).success && h[key] !== t.id)
          detail.related.push(
            recordLink(
              job,
              key === "replacement_id" ? "Replacement recorded payment" : "Prior recorded payment",
              { kind: "payment", id: h[key] as string, payableId: t.payableId },
            ),
          );
    }
    detail.originalsNote =
      "Original source documents belong to the related payable and its exact version.";
    try {
      const costs = z
        .object({ records: z.array(costRecord) })
        .parse(await read(io, "mcp_cost_submission_read", { _job: job }));
      const bill = costs.records.find((r) => r.id === t.payableId);
      if (bill && bill.payments.some((p) => p.id === t.id)) {
        const built = await trailFor(io, job, costs.records, bill, t.id);
        detail.trail = built.trail;
        detail.proofTarget = built.proofTarget;
      }
    } catch {
      /* The bill's own read needs full project access; the payment facts above still stand. */
    }
  }
  detail.related = [...new Map(detail.related.map((l) => [l.url, l])).values()];
  return detail;
}
