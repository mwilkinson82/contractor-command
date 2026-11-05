import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney, formatRecordDate } from "./money-format";
import { buildPaymentTrail, type TrailRecord } from "./payable-payment-trail";
import { PaymentTrailView } from "@/components/athena/PaymentTrailView";
import { AccountingRecordView, AttachProof } from "@/components/athena/AccountingRecordPage";
import { ledgerRecordUrl } from "./accounting-record-target";
import { accountingRowKindLabel } from "./accounting-report";
import { apMoney } from "./accounting-ap-versioned";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = id(1),
  bill = id(2),
  pay1 = id(3),
  pay2 = id(4),
  po = id(5);
const facts = (amount: number, extra: Record<string, unknown> = {}) => ({
  kind: "supplier_bill",
  description: "Conduit and distribution materials",
  incurred_on: "2026-10-30",
  amount_cents: amount,
  currency_code: "USD",
  counterparty_name: "Summit Electrical Supply",
  document_reference: "SES-4812",
  allocations: [
    { job_id: job, cost_code: "26.04", amount_cents: amount - 440000 },
    { job_id: job, cost_code: "26.05", amount_cents: 440000 },
  ],
  ...extra,
});
const record = (over: Partial<TrailRecord> = {}): TrailRecord => ({
  id: bill,
  kind: "supplier_bill",
  versions: [
    { version: 1, facts: facts(1240000), recorded_at: "2026-10-30T10:57:36Z" },
    {
      version: 2,
      facts: facts(1260000),
      recorded_at: "2026-10-30T11:34:08Z",
      reason: "Include additional conduit fittings.",
    },
  ],
  posted_version: 2,
  approved_versions: [1, 2],
  business_approvals: [
    { version: 2, withdrawn: false, approved_at: "2026-10-30T14:42:52Z", notes: "Owner review." },
  ],
  posting_events: [
    { version: 2, posted_at: "2026-10-30T11:35:18Z", accounting_effective_on: "2026-10-31" },
  ],
  payments: [
    { id: pay1, reference: "CHK-2810-104", amount_cents: 620000, paid_on: "2026-10-30" },
    { id: pay2, reference: "TD Bank wire", amount_cents: 640000, paid_on: "2026-11-03" },
  ],
  active_settlement_cents: 1260000,
  ...over,
});

describe("money and dates read the way people say them", () => {
  it("formats dollars with commas and cents, exactly", () => {
    expect(formatMoney(640000)).toBe("$6,400.00");
    expect(formatMoney("9000000000000")).toBe("$90,000,000,000.00");
    expect(formatMoney(-20000)).toBe("-$200.00");
    expect(formatMoney(65000, "CAD")).toBe("CAD 650.00");
    expect(formatMoney(640000, null)).toBe("6,400.00 · currency not recorded");
    expect(formatMoney(null)).toBe("Not recorded");
    expect(formatMoney(1.5)).toBe("Not recorded");
    expect(apMoney("640000", "USD")).toBe("$6,400.00");
    expect(apMoney(null, "USD")).toBe("Unknown");
  });
  it("formats recorded dates and keeps a timestamp on the member's calendar day", () => {
    expect(formatRecordDate("2026-11-03")).toBe("Nov 3, 2026");
    expect(formatRecordDate("2026-10-31T02:00:00Z", "America/Manaus")).toBe("Oct 30, 2026");
    expect(formatRecordDate("not a date")).toBe("not a date");
    expect(formatRecordDate(null)).toBe("Not recorded");
  });
});

describe("payment trail", () => {
  it("shows the whole trail and what is left, using the posted version", () => {
    const t = buildPaymentTrail(job, record(), { focusPaymentId: pay2 });
    expect(t.total).toBe("$12,600.00");
    expect(t.paid).toBe("$12,600.00");
    expect(t.remaining).toBe("$0.00");
    expect(t.status).toBe("paid");
    expect(t.focus).toMatchObject({ amount: "$6,400.00", date: "Nov 3, 2026" });
    expect(t.steps.map((s) => s.key)).toEqual([
      "po",
      "bill",
      "approved",
      "posted",
      `pay:${pay1}`,
      `pay:${pay2}`,
      "balance",
    ]);
    expect(t.steps.find((s) => s.key === "po")).toMatchObject({ state: "missing" });
    expect(t.steps.find((s) => s.key === "posted")?.date).toBe("Oct 31, 2026");
    expect(t.steps.find((s) => s.key === `pay:${pay2}`)).toMatchObject({
      title: "Paid $6,400.00",
      highlight: true,
    });
  });
  it("shows a partly paid bill, a corrected payment and an unknown settlement honestly", () => {
    const t = buildPaymentTrail(
      job,
      record({
        payments: [
          { id: pay1, reference: "CHK-1", amount_cents: 620000, paid_on: "2026-10-30" },
          {
            id: pay2,
            reference: "CHK-2",
            amount_cents: 100000,
            paid_on: "2026-11-01",
            corrected: true,
          },
        ],
        active_settlement_cents: null,
      }),
    );
    expect(t.paid).toBe("$6,200.00");
    expect(t.remaining).toBe("$6,400.00");
    expect(t.statusLabel).toBe("Partly paid");
    expect(t.steps.find((s) => s.key === `pay:${pay2}`)?.state).toBe("void");
    expect(t.percentPaid).toBeCloseTo(49.2, 1);
  });
  it("shows the PO, what was billed against it and a warning when over", () => {
    const t = buildPaymentTrail(job, record(), {
      purchaseOrder: {
        number: "WC-2810-PO01",
        status: "Approved v2",
        totalCents: 1240000,
        billedCents: 1260000,
        url: `https://app.meetathena.io/r/job/${job}/purchase-orders`,
      },
    });
    const step = t.steps[0];
    expect(step).toMatchObject({ title: "Purchase order WC-2810-PO01", amount: "$12,400.00" });
    expect(step.detail).toContain("$200.00 over the PO");
    expect(step.warn).toBe(true);
  });
});

describe("payment trail view", () => {
  it("renders big amounts, the trail, proof downloads and button-styled links", () => {
    const trail = buildPaymentTrail(job, record(), {
      focusPaymentId: pay2,
      originals: [{ id: id(9), filename: "SES-4812.pdf", version: 2 }],
      paymentProof: [{ id: id(10), filename: "wire-confirmation.pdf" }],
    });
    const html = renderToStaticMarkup(
      createElement(PaymentTrailView, { trail, download: () => undefined }),
    );
    expect(html).toContain('class="pt-amount">$6,400.00');
    expect(html).toContain("Bill paid in full");
    expect(html).toContain("Download SES-4812.pdf");
    expect(html).toContain("Download wire-confirmation.pdf");
    expect(html).toContain("pt-btn pt-btn-secondary");
    expect(html).not.toContain("6400");
  });
  it("says plainly when proof is missing and offers attach only when given", () => {
    const trail = buildPaymentTrail(job, record(), { focusPaymentId: pay2 });
    const plain = renderToStaticMarkup(createElement(PaymentTrailView, { trail }));
    expect(plain).toContain("does not see the bank");
    expect(plain).not.toContain("Attach proof of payment");
    const withAttach = renderToStaticMarkup(
      createElement(PaymentTrailView, {
        trail,
        attach: createElement(AttachProof, { onFile: () => undefined, busy: false }),
      }),
    );
    expect(withAttach).toContain("Attach proof of payment");
    expect(withAttach).toContain("application/pdf,image/jpeg,image/png");
  });
  it("puts the full record details behind a toggle under the trail", () => {
    const html = renderToStaticMarkup(
      createElement(AccountingRecordView, {
        detail: {
          title: "Payment TD Bank wire",
          subtitle: "Payment recorded for Nov 3, 2026",
          facts: [["Amount paid", "$6,400.00"]],
          history: [],
          related: [],
          originals: [],
          originalsNote: "",
          trail: buildPaymentTrail(job, record(), { focusPaymentId: pay2 }),
        },
      }),
    );
    expect(html.indexOf("Payment trail")).toBeLessThan(html.indexOf("Full record details"));
  });
});

describe("ledger rows open the record behind them", () => {
  it("links costs, bill balances and payments to their payment trail, and POs to the PO page", () => {
    expect(
      ledgerRecordUrl(job, { id: `cost:${bill}:0`, kind: "posted_cost", version: 2 }),
    ).toContain(`record_kind=payable&record_id=${bill}&version=2`);
    expect(ledgerRecordUrl(job, { id: `payable:${bill}`, kind: "payable", version: 2 })).toContain(
      "record_kind=payable",
    );
    expect(
      ledgerRecordUrl(job, {
        id: `cost_payment:${bill}:${pay2}`,
        kind: "settlement_evidence",
        version: null,
      }),
    ).toContain(`record_kind=payment&record_id=${pay2}&payable_id=${bill}`);
    expect(ledgerRecordUrl(job, { id: `po:${po}`, kind: "commitment", version: 1 })).toBe(
      `https://app.meetathena.io/r/job/${job}/purchase-orders`,
    );
    expect(ledgerRecordUrl(job, { id: `cost_payment:${bill}:bad`, kind: "x", version: null })).toBe(
      null,
    );
  });
  it("names row types in plain words", () => {
    expect(accountingRowKindLabel("settlement_evidence")).toBe("Payment made");
    expect(accountingRowKindLabel("posted_cost")).toBe("Cost posted");
    expect(accountingRowKindLabel("excluded_draft")).toBe("Not counted (draft)");
  });
});
