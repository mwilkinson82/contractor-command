import { describe, it, expect } from "vitest";
import { applicationFixture } from "./fixtures";
import { calculateApplication, dollarsToCents, reconcileEvidence } from "./model";
describe("saved payment application calculation", () => {
  it("calculates first application and distinct balances in exact cents", () => {
    const c = calculateApplication(applicationFixture());
    expect(c.complete).toBe(true);
    expect(c.gross_cents).toBe(1500000);
    expect(c.retained_cents).toBe(150000);
    expect(c.payment_due_cents).toBe(1350000);
    expect(c.unearned_cents).toBe(8500000);
    expect(c.balance_including_retainage_cents).toBe(8650000);
  });
  it("carries stored materials into installed work without counting them twice", () => {
    const a = applicationFixture();
    a.prior_mode = "external";
    a.prior_certified_net_cents = 1350000;
    a.lines[0] = {
      ...a.lines[0],
      prior_work_cents: 1000000,
      prior_stored_cents: 500000,
      prior_retained_cents: 150000,
      stored_to_work_cents: 300000,
      work_cents: 1800000,
      stored_cents: 200000,
    };
    const c = calculateApplication(a);
    expect(c.complete).toBe(true);
    expect(c.gross_cents).toBe(2000000);
    expect(c.payment_due_cents).toBe(450000);
    expect(c.billing_gross_cents).toBe(500000);
    a.prior_certified_net_cents = 1800000;
    Object.assign(a.lines[0], {
      prior_work_cents: 1800000,
      prior_stored_cents: 200000,
      prior_retained_cents: 200000,
      stored_to_work_cents: 0,
      release_cents: 100000,
      release_basis: "Recorded release approval",
    });
    const r = calculateApplication(a);
    expect(r.payment_due_cents).toBe(100000);
    expect(r.billing_gross_cents).toBe(0);
    expect(r.billing_released_cents).toBe(100000);
  });
  it("propagates unknown work, storage, prior certificate and retainage", () => {
    for (const key of [
      "work_cents",
      "stored_cents",
      "stored_to_work_cents",
      "work_retainage_bps",
      "stored_retainage_bps",
      "release_cents",
    ] as const) {
      const a = applicationFixture();
      a.lines[0][key] = null;
      const c = calculateApplication(a);
      expect(c.complete).toBe(false);
      expect(c.payment_due_cents).toBeNull();
    }
    const a = applicationFixture();
    a.prior_certified_net_cents = null;
    expect(calculateApplication(a).payment_due_cents).toBeNull();
  });
  it("requires explicit zero, source evidence and valid scope bounds", () => {
    const a = applicationFixture();
    a.lines[0].work_cents = -1;
    expect(calculateApplication(a).complete).toBe(false);
    a.lines[0].work_cents = 10000001;
    expect(calculateApplication(a).complete).toBe(false);
    a.lines[0].work_cents = 1;
    a.lines[0].stored_basis = "";
    expect(calculateApplication(a).complete).toBe(false);
  });
  it("rounds retainage deterministically and parses dollars without binary drift", () => {
    const a = applicationFixture();
    a.lines[0].work_cents = 5;
    a.lines[0].stored_cents = 0;
    expect(calculateApplication(a).retained_cents).toBe(1);
    expect(dollarsToCents("1,234.01")).toBe(123401);
    expect(dollarsToCents("")).toBeNull();
    expect(() => dollarsToCents("1.001")).toThrow();
  });
  it("does not infer prior certification from issued billing, credits or cash", () => {
    const a = applicationFixture();
    const id = "00000000-0000-4000-8000-000000000001";
    a.evidence = [
      { id, version: 1, treatment: "prior_billing", reason: "Prior certificate invoice" },
    ];
    expect(
      reconcileEvidence(a, [
        {
          id,
          version: 1,
          number: "Prior",
          kind: "invoice",
          status: "submitted",
          invoice_date: "2025-12-01",
          gross_cents: 100,
          net_due_cents: 90,
          certified_cents: null,
          credit_for: null,
        },
      ]),
    ).toContain(
      "Prior issued billing exceeds the stated previous certification. Reconcile it before adding another bill.",
    );
  });
});
