import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  buyoutProjection,
  buyoutSteps,
  readinessChecks,
  type BuyoutLedger,
  type PackageFacts,
  type ReadinessFacts,
} from "./buyout";
const party = randomUUID(),
  po = randomUUID();
const base = (): BuyoutLedger => ({
  company_id: randomUUID(),
  job_id: randomUUID(),
  today: "2026-10-30",
  records: [],
  parties: [{ id: party, version: 1, name: "Supplier" }],
  orders: [],
  documents: [],
  submittals: [],
  bills: [],
  schedule_activities: [],
  can_manage_directory: true,
  can_record: true,
});
const pkg = (): PackageFacts => ({
  code: "ELEC",
  title: "Electrical",
  scope: "Equipment",
  budget_cents: null,
  currency: "USD",
  status: "draft",
  candidates: [
    {
      party_id: party,
      party_version: 1,
      quote_cents: 50000,
      scope: "Equipment",
      exclusions: null,
      source: "Quote",
      quoted_on: null,
      expected_delivery_on: null,
    },
  ],
  selected_party_id: party,
  commitment_refs: [],
  expected_award_on: null,
  needed_by: null,
  submittal_ids: [],
  schedule_ref: null,
  source: "Scope register",
});
function packageLedger(f = pkg()) {
  const l = base();
  l.records.push({ id: randomUUID(), kind: "package", version: 1, facts: f, versions: [] });
  return l;
}
const policy = (): ReadinessFacts => ({
  party_id: party,
  party_version: 1,
  source: "Supplied terms",
  requirements: [
    {
      key: "insurance",
      label: "Insurance",
      kind: "insurance",
      applicability: "required",
      source: "Supplied clause",
      jurisdiction: null,
      due_on: null,
      document_id: randomUUID(),
      document_sha256: "a".repeat(64),
      effective_on: "2026-01-01",
      expires_on: "2026-12-31",
      review: "evidence_checked",
      review_note: "Evidence compared against supplied requirement",
      exception_expires_on: null,
      bill_id: null,
      bill_version: null,
    },
  ],
});
describe("buyout arithmetic and readiness boundaries", () => {
  it("never treats proposed quotes as commitments and preserves unknown versus actual zero", () => {
    const l = packageLedger();
    let p = buyoutProjection(l).packages[0];
    expect(p.committed_cents).toBe(0);
    expect(p.uncommitted_exposure_cents).toBeNull();
    (l.records[0].facts as PackageFacts).budget_cents = 0;
    p = buyoutProjection(l).packages[0];
    expect(p.uncommitted_exposure_cents).toBe(0);
  });
  it("retains an approved commitment through a pending draft revision and package cancellation", () => {
    const f = {
      ...pkg(),
      status: "cancelled" as const,
      budget_cents: 10000,
      commitment_refs: [{ po_id: po, version: 1 }],
    };
    const l = packageLedger(f);
    l.orders = [
      {
        id: po,
        party_id: party,
        number: "PO1",
        versions: [
          { version: 2, status: "draft", lines: [{ quantity: 1, unit_price_cents: 90000 }] },
          { version: 1, status: "approved", lines: [{ quantity: 2, unit_price_cents: 30000 }] },
        ],
      },
    ];
    const p = buyoutProjection(l);
    expect(p.canonical_committed_cents).toBe(60000);
    expect(p.packages[0].committed_cents).toBe(60000);
    expect(p.canonical_commitments[0]).toMatchObject({
      package_cancelled: true,
      pending_revision: true,
    });
    expect(p.packages[0].over_budget_cents).toBe(50000);
  });
  it("marks an old approved reference unavailable when a later approved version supersedes it", () => {
    const l = packageLedger({ ...pkg(), commitment_refs: [{ po_id: po, version: 1 }] });
    l.orders = [
      {
        id: po,
        party_id: party,
        number: "PO1",
        versions: [
          { version: 2, status: "approved", lines: [{ quantity: 1, unit_price_cents: 70000 }] },
          { version: 1, status: "approved", lines: [{ quantity: 1, unit_price_cents: 60000 }] },
        ],
      },
    ];
    const p = buyoutProjection(l);
    expect(p.packages[0].committed_cents).toBeNull();
    expect(p.canonical_committed_cents).toBe(70000);
    expect(p.canonical_commitments).toHaveLength(1);
  });
  it("does not round unrepresentable fractional cents into a commitment", () => {
    const l = packageLedger({ ...pkg(), commitment_refs: [{ po_id: po, version: 1 }] });
    l.orders = [
      {
        id: po,
        party_id: party,
        number: "PO1",
        versions: [
          { version: 1, status: "approved", lines: [{ quantity: 0.333, unit_price_cents: 100 }] },
        ],
      },
    ];
    expect(buyoutProjection(l).canonical_committed_cents).toBeNull();
  });
  it("keeps missing requirements, missing originals and missing insurance dates unresolved", () => {
    const f = policy();
    expect(readinessChecks({ ...f, requirements: [] }, "2026-10-30")[0].state).toBe("unknown");
    f.requirements[0].document_id = null;
    expect(readinessChecks(f, "2026-10-30")[0].state).toBe("blocked");
    f.requirements[0].document_id = randomUUID();
    f.requirements[0].expires_on = null;
    expect(readinessChecks(f, "2026-10-30")[0].state).toBe("unknown");
  });
  it("blocks future-effective and expired evidence, while exceptions remain exceptions", () => {
    const f = policy();
    f.requirements[0].effective_on = "2026-11-01";
    expect(readinessChecks(f, "2026-10-30")[0].state).toBe("blocked");
    f.requirements[0].effective_on = "2026-01-01";
    f.requirements[0].expires_on = "2026-10-29";
    expect(readinessChecks(f, "2026-10-30")[0].state).toBe("blocked");
    f.requirements[0].review = "exception";
    f.requirements[0].exception_expires_on = "2026-11-01";
    expect(readinessChecks(f, "2026-10-30")[0].state).toBe("exception");
    expect(readinessChecks(f, "2026-11-02")[0].state).toBe("blocked");
  });
  it("never assumes a waiver's bill/payment context and invalidates old bill versions", () => {
    const f = policy(),
      l = base();
    f.requirements[0].kind = "waiver";
    expect(readinessChecks(f, l.today)[0].state).toBe("unknown");
    const bill = randomUUID();
    f.requirements[0].bill_id = bill;
    f.requirements[0].bill_version = 1;
    l.bills = [{ id: bill, version: 2, label: "Revised bill", party_id: party }];
    expect(readinessChecks(f, l.today, l)[0].state).toBe("blocked");
  });
  it("provides guided missing states instead of an empty table-only result", () => {
    const l = base();
    l.parties = [];
    const steps = buyoutSteps(l);
    expect(steps).toHaveLength(5);
    expect(steps[0].state).toBe("missing");
    expect(steps[3].state).toBe("missing");
    expect(steps[4].state).toBe("separate_review");
  });
});
