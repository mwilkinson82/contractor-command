import { describe, expect, it } from "vitest";
import {
  applyCostCommand,
  missingCostFacts,
  postedCosts,
  type Access,
  type CostFacts,
  type Ledger,
} from "./job-cost-foundation";

const empty = (): Ledger => ({ records: [], payments: [], operations: [] });
const full: Access = {
  companyId: "company-a",
  actor: "member-a",
  canAccessFullJob: (j) => ["job-a", "job-b"].includes(j),
};
const restricted: Access = { ...full, canAccessFullJob: (j) => j === "job-a" };
const facts = (patch: Partial<CostFacts> = {}): CostFacts => ({
  kind: "reimbursable_expense",
  description: "Fuel",
  counterpartyName: "Employee A",
  incurredOn: "2026-10-28",
  amountCents: 10000,
  allocations: [
    { jobId: "job-a", costCode: "FUEL", amountCents: 6000 },
    { jobId: "job-b", costCode: "FUEL", amountCents: 4000 },
  ],
  original: "missing",
  ...patch,
});
const apply = (
  ledger: Ledger,
  request: string,
  command: Parameters<typeof applyCostCommand>[3],
  access = full,
) => applyCostCommand(ledger, access, request, command).ledger;
function posted(f = facts()) {
  let ledger = apply(empty(), "s", { type: "submit", id: "cost", facts: f });
  ledger = apply(ledger, "a", { type: "approve", id: "cost", expectedVersion: 1 });
  return apply(ledger, "p", { type: "post", id: "cost", expectedVersion: 2 });
}
describe("job cost foundation", () => {
  it("handles a sparse field prompt without requiring a PO and flags the missing original", () => {
    expect(missingCostFacts({ description: "Home Depot receipt" })).toEqual([
      "bill or expense type and who paid",
      "supplier or payee",
      "date",
      "amount",
      "job and cost code allocation",
      "original attachment status",
    ]);
    expect(() => apply(empty(), "s", { type: "submit", id: "cost", facts: facts() })).not.toThrow();
    expect(() =>
      apply(empty(), "s", {
        type: "submit",
        id: "cost",
        facts: { ...facts(), original: "stored" as "missing" },
      }),
    ).toThrow(/storage/);
  });
  it("conserves split allocations and checks full scope of every job, including reads and corrections", () => {
    expect(() =>
      apply(empty(), "s", { type: "submit", id: "cost", facts: facts() }, restricted),
    ).toThrow(/every allocated job/);
    expect(() =>
      apply(empty(), "s", { type: "submit", id: "cost", facts: facts({ amountCents: 9999 }) }),
    ).toThrow(/equal/);
    expect(() => postedCosts(posted(), restricted, "job-a")).toThrow(/unavailable/);
    expect(() =>
      apply(
        posted(),
        "c",
        {
          type: "correct",
          id: "cost",
          expectedVersion: 3,
          facts: facts({ allocations: [{ jobId: "job-a", costCode: "FUEL", amountCents: 10000 }] }),
          reason: "Fix",
        },
        restricted,
      ),
    ).toThrow(/unavailable/);
    expect(() => postedCosts(posted(), { ...full, companyId: "company-b" }, "job-a")).not.toThrow();
    expect(postedCosts(posted(), { ...full, companyId: "company-b" }, "job-a")).toEqual([]);
  });
  it("requires approval before posting and counts only the posted version", () => {
    let ledger = apply(empty(), "s", { type: "submit", id: "cost", facts: facts() });
    expect(postedCosts(ledger, full, "job-a")).toEqual([]);
    expect(() => apply(ledger, "p", { type: "post", id: "cost", expectedVersion: 1 })).toThrow(
      /Approval/,
    );
    ledger = apply(ledger, "a", { type: "approve", id: "cost", expectedVersion: 1 });
    ledger = apply(ledger, "p", { type: "post", id: "cost", expectedVersion: 2 });
    ledger = apply(ledger, "c", {
      type: "correct",
      id: "cost",
      expectedVersion: 3,
      facts: facts({
        amountCents: 12000,
        allocations: [{ jobId: "job-a", costCode: "FUEL", amountCents: 12000 }],
      }),
      reason: "Correct amount",
    });
    expect(postedCosts(ledger, full, "job-a")[0].amountCents).toBe(6000);
    ledger = apply(ledger, "a2", { type: "approve", id: "cost", expectedVersion: 4 });
    ledger = apply(ledger, "p2", { type: "post", id: "cost", expectedVersion: 5 });
    expect(postedCosts(ledger, full, "job-a").map((a) => a.amountCents)).toEqual([12000]);
    expect(postedCosts(ledger, full, "job-b")).toEqual([]);
    expect(() =>
      apply(ledger, "stale", { type: "approve", id: "cost", expectedVersion: 4 }),
    ).toThrow(/version changed/);
  });
  it("deduplicates references and exact retries, and rejects reused request IDs", () => {
    const f = facts({ documentReference: " INV-123 " });
    const command = { type: "submit" as const, id: "cost", facts: f };
    const first = applyCostCommand(empty(), full, "retry", command);
    expect(applyCostCommand(first.ledger, full, "retry", command).result.alreadyApplied).toBe(true);
    expect(() => apply(first.ledger, "retry", { ...command, id: "different" })).toThrow(
      /different content/,
    );
    expect(() =>
      apply(first.ledger, "second", {
        type: "submit",
        id: "other",
        facts: facts({ documentReference: "inv-123", counterpartyName: "employee a" }),
      }),
    ).toThrow(/already exists/);
    expect(() => applyCostCommand(first.ledger, restricted, "retry", command)).toThrow(
      /unavailable/,
    );
  });
  it("records settlement separately from cost and bounds it against the posted payable", () => {
    let ledger = posted();
    ledger = apply(ledger, "pay", {
      type: "payment",
      id: "cost",
      paymentId: "payment",
      amountCents: 5000,
      paidOn: "2026-10-29",
      reference: "check 1",
    });
    expect(postedCosts(ledger, full, "job-a").reduce((n, a) => n + a.amountCents, 0)).toBe(6000);
    expect(() =>
      apply(ledger, "pay2", {
        type: "payment",
        id: "cost",
        paymentId: "p2",
        amountCents: 5001,
        paidOn: "2026-10-29",
        reference: "check 2",
      }),
    ).toThrow(/exceeds/);
    expect(() =>
      apply(ledger, "pay3", {
        type: "payment",
        id: "cost",
        paymentId: "p3",
        amountCents: 1,
        paidOn: "2026-10-29",
        reference: " CHECK 1 ",
      }),
    ).toThrow(/already recorded/);
    let corrected = apply(ledger, "c", {
      type: "correct",
      id: "cost",
      expectedVersion: 3,
      facts: facts({
        amountCents: 4000,
        allocations: [{ jobId: "job-a", costCode: "FUEL", amountCents: 4000 }],
      }),
      reason: "Correction",
    });
    corrected = apply(corrected, "a2", { type: "approve", id: "cost", expectedVersion: 4 });
    expect(() => apply(corrected, "p2", { type: "post", id: "cost", expectedVersion: 5 })).toThrow(
      /below recorded payments/,
    );
    const companyPaid = posted(facts({ kind: "company_paid_expense" }));
    expect(() =>
      apply(companyPaid, "pay", {
        type: "payment",
        id: "cost",
        paymentId: "p",
        amountCents: 1,
        paidOn: "2026-10-29",
        reference: "x",
      }),
    ).toThrow(/No posted payable/);
  });
  it("treats supplier bill references as optional links, not commitments or a prerequisite", () => {
    const ledger = posted(
      facts({
        kind: "supplier_bill",
        counterpartyName: "Supplier A",
        documentReference: "B-1",
        purchaseOrderId: "external-po",
      }),
    );
    expect(postedCosts(ledger, full, "job-a")[0].amountCents).toBe(6000);
    expect(() =>
      apply(empty(), "s", {
        type: "submit",
        id: "cost",
        facts: facts({ kind: "supplier_bill", counterpartyName: "Supplier A" }),
      }),
    ).not.toThrow();
    expect(() =>
      apply(empty(), "s", { type: "submit", id: "cost", facts: facts({ purchaseOrderId: "po" }) }),
    ).toThrow(/supplier bills/);
  });
});
