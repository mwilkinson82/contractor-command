import { describe, expect, it } from "vitest";
import { previewDestination } from "./estimating-handoff-preview";

const make = () => ({
  source: {
    companyId: "company",
    jobId: "job",
    snapshotId: "frozen",
    sha256: "a".repeat(64),
    sourceVersion: 7,
    breakdown: {
      direct: [{ ref: "T-1", basis: "quote" as const, quoteId: "0", amountCents: 10000 }],
      directCents: 10000,
      generalConditions: [
        { label: "Office", ref: null, placement: "gc" as const, amountCents: 2000 },
      ],
      requirements: [],
      generalConditionsCents: 2000,
      requirementsCents: 0,
      overheadCents: 1000,
      profitCents: 1100,
      totalCents: 14100,
    },
  },
  destination: {
    companyId: "company",
    jobId: "job",
    kind: "budget" as const,
    id: "budget",
    expectedVersion: 3,
    observedVersion: 3,
  },
  allocations: [
    { componentId: "direct:T-1", targetKey: "09-01", exclusionReason: null },
    { componentId: "gc:Office", targetKey: "01-01", exclusionReason: null },
    { componentId: "overhead", targetKey: null, exclusionReason: "Not included in this budget" },
    { componentId: "profit", targetKey: null, exclusionReason: "Not included in this budget" },
  ],
});
describe("version-bound downstream handoff preview", () => {
  it("reconciles only explicit mapping decisions and never authorizes posting", () => {
    expect(previewDestination(make())).toMatchObject({
      status: "preview",
      posting_permitted: false,
      mappedCents: 12000,
      excludedCents: 2100,
      totalCents: 14100,
      destination: { version: 3 },
    });
  });
  it("rejects a stale destination version and cross-job or cross-company references", () => {
    const stale = make();
    stale.destination.observedVersion = 4;
    expect(() => previewDestination(stale)).toThrow(/destination changed/i);
    const wrong = make();
    wrong.destination.companyId = "other";
    expect(() => previewDestination(wrong)).toThrow(/matching company/i);
  });
  it("does not infer, duplicate, or silently discard components", () => {
    const missing = make();
    missing.allocations.pop();
    expect(() => previewDestination(missing)).toThrow(/each source component/i);
    const duplicate = make();
    duplicate.allocations[1].componentId = duplicate.allocations[0].componentId;
    expect(() => previewDestination(duplicate)).toThrow(/each source component/i);
    const ambiguous = make();
    ambiguous.allocations[0].exclusionReason = "maybe";
    expect(() => previewDestination(ambiguous)).toThrow(/one destination/i);
  });
  it("refuses malformed or unbalanced source figures", () => {
    const bad = make();
    bad.source.breakdown.totalCents++;
    expect(() => previewDestination(bad)).toThrow(/does not reconcile/i);
  });
});
