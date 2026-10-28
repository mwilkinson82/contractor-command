import { describe, expect, it } from "vitest";
import { dollars, reconcileBilling, reconcileCosts } from "./reconciliation";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const scope = { company_id: id(1), job_id: id(2) };
const inv = (n = 3, amount = 10000) => ({
  id: id(n),
  ...scope,
  document_number: `INV-${n}`,
  kind: "invoice",
  credit_for: null as string | null,
  versions: [
    {
      invoice_id: id(n),
      job_id: scope.job_id,
      version: 1,
      status: "submitted",
      net_due_cents: amount,
      source: "Signed original",
      reason: null as string | null,
    },
  ],
});
const receipt = (n = 4, amount = 4000) => ({
  id: id(n),
  ...scope,
  source: `CHECK-${n}`,
  amount_cents: amount,
});
const allocation = (n = 5, amount = 4000) => ({
  id: id(n),
  job_id: scope.job_id,
  invoice_id: id(3),
  receipt_id: id(4),
  amount_cents: amount,
  reversal_of: null as string | null,
  source: "Applied check",
});
const billing = () => ({
  currency: "USD",
  invoices: [inv()],
  receipts: [receipt()],
  allocations: [allocation()],
  receipt_reversals: [] as Array<{
    id: string;
    job_id: string;
    receipt_id: string;
    amount_cents: number;
    source: string;
  }>,
});
const docs = () => ({
  documents: [{ id: id(8), ...scope }],
  links: [
    {
      document_id: id(8),
      job_id: scope.job_id,
      invoice_id: id(3),
      invoice_version: 1,
      receipt_id: null,
    },
  ],
});
const check = (b = billing(), d: unknown = docs()) => reconcileBilling(b, d, scope);
const codes = (r: { findings: { code: string }[] }) => r.findings.map((f) => f.code);
const cost = () => ({
  records: [
    {
      id: id(20),
      kind: "supplier_bill",
      versions: [
        {
          record_id: id(20),
          version: 1,
          reason: null as string | null,
          facts: {
            kind: "supplier_bill",
            amount_cents: 10000,
            counterparty_name: "Synthetic vendor",
            document_reference: "B-1",
            original: "missing",
            allocations: [{ job_id: scope.job_id, cost_code: "0300", amount_cents: 10000 }],
          },
        },
      ],
      posted_version: 1 as number | null,
      approved_versions: [1],
      payments: [
        {
          id: id(21),
          record_id: id(20),
          amount_cents: 4000,
          reference: "P-1",
          shared: false,
          corrected: false,
          correction: null as { reason: string } | null,
        },
      ],
      active_settlement_cents: 4000,
    },
  ],
  originals_available: false,
  posting_available: true,
});

describe("recorded billing reconciliation", () => {
  it("keeps partial payments and unpaid balance separate from missing originals", () => {
    const r = check();
    expect(r.coverage.state).toBe("checked");
    expect(r.findings.find((f) => f.code === "invoice_unmatched")?.amount_cents).toBe("6000");
    expect(codes(r)).toEqual(["invoice_unmatched", "receipt_original_gap"]);
  });
  it("applies only the current posted credit and never calls it a refund", () => {
    const b = billing();
    const credit = { ...inv(6, 6000), kind: "credit", credit_for: id(3) };
    credit.versions[0].status = "posted";
    b.invoices.push(credit);
    expect(codes(check(b))).not.toContain("invoice_unmatched");
    credit.versions.push({
      ...credit.versions[0],
      version: 2,
      status: "void",
      reason: "Credit corrected",
    });
    expect(check(b).findings.find((f) => f.code === "invoice_unmatched")?.amount_cents).toBe(
      "6000",
    );
  });
  it("net reversals restore unapplied receipt without inventing a cash refund", () => {
    const b = billing();
    b.allocations.push({ ...allocation(6, 1000), reversal_of: id(5) });
    b.receipt_reversals.push({
      id: id(7),
      job_id: scope.job_id,
      receipt_id: id(4),
      amount_cents: 1000,
      source: "Receipt correction",
    });
    expect(check(b).findings.find((f) => f.code === "invoice_unmatched")?.amount_cents).toBe(
      "7000",
    );
    expect(codes(check(b))).not.toContain("receipt_unapplied");
  });
  it("detects over-allocation on both sides", () => {
    const b = billing();
    b.allocations[0].amount_cents = 12000;
    expect(codes(check(b))).toContain("invoice_over_allocated");
    expect(codes(check(b))).toContain("receipt_over_allocated");
  });
  it("suppresses balances when reversal lineage is broken", () => {
    const b = billing();
    b.allocations.push({ ...allocation(6, 5000), reversal_of: id(5) });
    const r = check(b);
    expect(r.coverage.state).toBe("unavailable");
    expect(codes(r)).toContain("allocation_over_reversed");
    expect(codes(r)).not.toContain("invoice_unmatched");
    b.allocations[1].reversal_of = id(99);
    expect(codes(check(b))).toContain("allocation_lineage_gap");
  });
  it("detects unavailable allocation and credit targets", () => {
    const b = billing();
    b.allocations[0].receipt_id = id(99);
    b.invoices.push({ ...inv(6), kind: "credit", credit_for: id(98) });
    expect(codes(check(b))).toEqual(
      expect.arrayContaining(["allocation_lineage_gap", "credit_target_gap"]),
    );
  });
  it("requires a reason and continuous immutable invoice versions", () => {
    const b = billing();
    b.invoices[0].versions.push({ ...b.invoices[0].versions[0], version: 3 });
    expect(codes(check(b))).toContain("invoice_correction_lineage");
  });
  it("normalizes duplicate references conservatively", () => {
    const b = billing();
    b.invoices.push({ ...inv(6), document_number: " inv-3 " });
    b.receipts.push({ ...receipt(7), source: " check-4 " });
    expect(codes(check(b))).toEqual(
      expect.arrayContaining(["duplicate_invoice_reference", "duplicate_receipt_reference"]),
    );
  });
  it("rejects mixed company, job and nested-version scopes without disclosing foreign identifiers", () => {
    for (const mutate of [
      (b: ReturnType<typeof billing>) => (b.invoices[0].company_id = id(99)),
      (b: ReturnType<typeof billing>) => (b.receipts[0].job_id = id(99)),
      (b: ReturnType<typeof billing>) => (b.allocations[0].job_id = id(99)),
      (b: ReturnType<typeof billing>) => (b.invoices[0].versions[0].job_id = id(99)),
    ]) {
      const b = billing();
      mutate(b);
      const r = check(b);
      expect(r.coverage.state).toBe("unavailable");
      expect(JSON.stringify(r)).not.toContain(id(99));
    }
  });
  it("calculates aggregate cents above Number precision with exact integer arithmetic", () => {
    const b = billing();
    b.invoices[0].versions[0].net_due_cents = Number.MAX_SAFE_INTEGER;
    b.receipts = [receipt(4, Number.MAX_SAFE_INTEGER), receipt(6, Number.MAX_SAFE_INTEGER)];
    b.allocations = [
      allocation(5, Number.MAX_SAFE_INTEGER),
      { ...allocation(7, Number.MAX_SAFE_INTEGER), receipt_id: id(6) },
    ];
    expect(check(b).findings.find((f) => f.code === "invoice_over_allocated")?.amount_cents).toBe(
      "9007199254740991",
    );
    expect(dollars("18014398509481982")).toBe("$180,143,985,094,819.82");
  });
  it("rejects unsafe, fractional and unknown monetary evidence", () => {
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, -1]) {
      const b = billing();
      b.receipts[0].amount_cents = amount;
      expect(check(b).coverage.state).toBe("unavailable");
    }
    expect(reconcileBilling(null, null, scope).coverage.state).toBe("unavailable");
  });
  it("does not treat missing history or missing original coverage as zero or proven gaps", () => {
    const b = {
      currency: "USD",
      invoices: [],
      receipts: [],
      allocations: [],
      receipt_reversals: [],
    };
    expect(check(b, { documents: [], links: [] }).findings).toEqual([]);
    expect(check(b).coverage.reason).toMatch(/unknown/);
    expect(check(billing(), null).originals.state).toBe("unavailable");
    expect(codes(check(billing(), null))).not.toContain("invoice_original_gap");
  });
  it("requires a current-version original, detects unlinked and dangling originals", () => {
    const b = billing();
    b.invoices[0].versions.push({ ...b.invoices[0].versions[0], version: 2, reason: "Correction" });
    expect(codes(check(b))).toContain("invoice_original_gap");
    const d = docs();
    d.links[0].invoice_id = id(99);
    expect(codes(check(b, d))).toContain("document_link_target_gap");
    expect(codes(check(b, d))).toContain("unlinked_original");
    d.documents[0].company_id = id(99);
    expect(check(b, d).originals.state).toBe("unavailable");
  });
});
describe("provisional AP settlement adapter", () => {
  it("reconciles recorded partial settlement to the posted payable", () => {
    const r = reconcileCosts(cost(), scope);
    expect(r.coverage.state).toBe("checked");
    expect(r.findings.find((f) => f.code === "ap_unmatched")?.amount_cents).toBe("6000");
    expect(r.coverage.reason).toMatch(/not proof/);
  });
  it("keeps unposted corrections out of the effective payable", () => {
    const c = cost();
    c.records[0].versions.push({
      ...c.records[0].versions[0],
      version: 2,
      reason: "Revised bill",
      facts: {
        ...c.records[0].versions[0].facts,
        amount_cents: 20000,
        allocations: [{ job_id: scope.job_id, cost_code: "0300", amount_cents: 20000 }],
      },
    });
    const r = reconcileCosts(c, scope);
    expect(codes(r)).toContain("ap_pending_correction");
    expect(r.findings.find((f) => f.code === "ap_unmatched")?.amount_cents).toBe("6000");
  });
  it("retains corrected settlement history without asserting refund", () => {
    const c = cost();
    c.records[0].payments[0].corrected = true;
    c.records[0].payments[0].correction = { reason: "Erroneous record" };
    c.records[0].active_settlement_cents = 0;
    expect(
      reconcileCosts(c, scope).findings.find((f) => f.code === "ap_unmatched")?.amount_cents,
    ).toBe("10000");
    c.records[0].payments[0].correction = null;
    expect(codes(reconcileCosts(c, scope))).toContain("ap_payment_lineage_gap");
  });
  it("detects over-settlement, missing approval and conservation failures", () => {
    const c = cost();
    c.records[0].payments[0].amount_cents = 12000;
    c.records[0].active_settlement_cents = 12000;
    expect(codes(reconcileCosts(c, scope))).toContain("ap_over_settled");
    c.records[0].active_settlement_cents = 1;
    expect(codes(reconcileCosts(c, scope))).toContain("ap_settlement_total_gap");
    c.records[0].approved_versions = [];
    expect(codes(reconcileCosts(c, scope))).toContain("ap_posting_lineage_gap");
  });
  it("does not confuse a shared payment allocation with duplicate payment evidence", () => {
    const c = cost();
    c.records[0].payments[0].shared = true;
    const other = structuredClone(c.records[0]);
    other.id = id(30);
    other.versions[0].record_id = other.id;
    other.versions[0].facts.document_reference = "B-2";
    other.payments[0].record_id = other.id;
    c.records.push(other);
    expect(codes(reconcileCosts(c, scope))).not.toContain("duplicate_payment_reference");
    other.payments[0].shared = false;
    expect(codes(reconcileCosts(c, scope))).toContain("ap_payment_identity_gap");
    expect(codes(reconcileCosts(c, scope))).not.toContain("ap_unmatched");
    other.payments[0].shared = true;
    other.payments[0].id = id(31);
    expect(codes(reconcileCosts(c, scope))).toContain("duplicate_payment_reference");
  });
  it("rejects unrelated records and unavailable contracts without returning source payloads", () => {
    const c = cost();
    c.records[0].versions[0].facts.allocations[0].job_id = id(99);
    const r = reconcileCosts(c, scope);
    expect(r.coverage.state).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("Synthetic vendor");
    expect(reconcileCosts(null, scope).coverage.state).toBe("unavailable");
    expect(reconcileCosts({ records: [] }, scope).coverage.state).toBe("unavailable");
  });
});
