import { describe, expect, it } from "vitest";
import {
  invoiceBalance,
  receiptBalance,
  recordedTotals,
  type BillingInvoice,
} from "./billing-evidence-balances";
const invoice: BillingInvoice = {
  id: "invoice",
  kind: "invoice",
  credit_for: null,
  versions: [{ status: "submitted", net_due_cents: 90000 }],
};
const credit = (id: string, status: string, amount: number): BillingInvoice => ({
  id,
  kind: "credit",
  credit_for: "invoice",
  versions: [{ status, net_due_cents: amount }],
});
const allocation = {
  invoice_id: "invoice",
  receipt_id: "receipt",
  amount_cents: 40000,
  reversal_of: null,
};
describe("billing evidence balances", () => {
  it("deducts posted invoice credit once, without treating draft or void credits as actual", () => {
    expect(
      invoiceBalance(
        invoice,
        [
          invoice,
          credit("a", "posted", 10000),
          credit("b", "draft", 20000),
          credit("c", "void", 30000),
        ],
        [allocation],
      ),
    ).toEqual({ cash: 40000, credits: 10000, remaining: 40000 });
  });
  it("calculates net allocated and unapplied cash after immutable corrections", () => {
    const reversal = { ...allocation, amount_cents: 10000, reversal_of: "allocation" };
    expect(
      receiptBalance(
        { id: "receipt", amount_cents: 40000 },
        [allocation, reversal],
        [{ receipt_id: "receipt", amount_cents: 5000 }],
      ),
    ).toEqual({ allocated: 30000, reversed: 5000, unapplied: 5000 });
  });
  it("keeps submitted, certified, posted credits and cash separate and missing as unknown", () => {
    expect(recordedTotals([], [], [])).toEqual({
      submittedGross: null,
      certified: null,
      postedCredits: null,
      received: null,
    });
    const record = {
      ...invoice,
      versions: [
        { status: "submitted", net_due_cents: 90000, gross_cents: 100000, certified_cents: null },
      ],
    };
    const posted = {
      ...credit("c", "posted", 10000),
      versions: [
        { status: "posted", net_due_cents: 10000, gross_cents: null, certified_cents: null },
      ],
    };
    expect(recordedTotals([record, posted], [{ amount_cents: 40000 }], [])).toEqual({
      submittedGross: 100000,
      certified: null,
      postedCredits: 10000,
      received: 40000,
    });
  });
});
