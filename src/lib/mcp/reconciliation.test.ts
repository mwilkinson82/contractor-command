import { describe, expect, it } from "vitest";
import { dollars, reconcileBilling } from "./reconciliation";

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
