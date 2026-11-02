import { describe, expect, it } from "vitest";
import { applicationFixture } from "./fixtures";
import { draftProposal, resolveDraftLine } from "./working";
import type { ApplicationContext } from "./workflow";

const context = (): ApplicationContext => {
  const a = applicationFixture();
  a.snapshot.lines = [
    { item: "01", description: "Electrical rough-in", scheduled_cents: 5000000 },
    { item: "02", description: "Mechanical rough-in", scheduled_cents: 5000000 },
  ];
  return {
    job: { number: "SYN", name: "Project" },
    currency: "USD",
    snapshot: a.snapshot,
    evidence: [],
    applications: [],
    selected: null,
  };
};

describe("conversational payment working amounts", () => {
  it("requires an unambiguous SOV line and amount basis", () => {
    const ctx = context();
    const result = draftProposal(ctx, {
      request_text: "Bill rough-in",
      changes: [{ line: "rough-in", basis: "this_period", amount_cents: 10000 }],
    });
    expect(result.blocking.join(" ")).toMatch(/Choose the SOV line/);
    expect(resolveDraftLine(result.application, "electrical rough-in").line?.item).toBe("01");
    expect(
      draftProposal(ctx, {
        request_text: "Bill electrical",
        changes: [{ line: "Electrical rough-in", amount_cents: 10000 }],
      }).blocking.join(" "),
    ).toMatch(/this period or the cumulative/);
  });
  it("keeps explicit zero separate from missing prior, and blocks excessive work", () => {
    const ctx = context();
    const working = draftProposal(ctx, {
      request_text: "Zero this period",
      changes: [{ line: "Electrical rough-in", basis: "this_period", amount_cents: 0 }],
    });
    expect(working.intent["01"].amount_cents).toBe(0);
    expect(working.application.lines[0].prior_work_cents).toBeNull();
    expect(working.application.lines[0].work_cents).toBeNull();
    const tooMuch = draftProposal(ctx, {
      request_text: "Bill too much",
      changes: [
        {
          line: "Electrical rough-in",
          basis: "this_period",
          amount_cents: 3000000,
          prior_work_cents: 2500000,
        },
      ],
    });
    expect(tooMuch.blocking.join(" ")).toMatch(/exceeds/);
  });
  it("does not treat existing billing as a first-application declaration", () => {
    const ctx = context();
    ctx.evidence = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        number: "Prior",
        kind: "invoice",
        status: "submitted",
        invoice_date: "2026-01-01",
        gross_cents: 100,
        net_due_cents: 90,
        certified_cents: null,
        credit_for: null,
      },
    ];
    const result = draftProposal(ctx, {
      request_text: "First application",
      first_application: true,
      changes: [],
    });
    expect(result.blocking.join(" ")).toMatch(/Existing billing needs reconciliation/);
    expect(result.application.prior_certified_net_cents).toBeNull();
  });
});
