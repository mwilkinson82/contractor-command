import { describe, expect, it } from "vitest";
import {
  plannedRate,
  productionTotals,
  validateMapping,
  type MappingProposal,
  type ProductionFact,
} from "./production-mapping";

const project = { companyId: "company", jobId: "project" };
const proposal = (): MappingProposal => ({
  ...project,
  cpm: { ...project, reportId: "cpm-v1", version: 1, activityIds: ["E090", "E100"] },
  sov: [
    {
      ...project,
      factId: "sov-id",
      item: "26.04",
      valueCents: 100_000_00,
      recordedAt: "2026-10-26T00:00:00Z",
    },
  ],
  allocations: [
    {
      id: "a1",
      sovFactId: "sov-id",
      activityId: "E090",
      valueCents: 60_000_00,
      plannedQuantity: 1000,
      unit: "LF",
      plannedManHours: 250,
      plannedBasisSource: "approved field plan",
    },
    {
      id: "a2",
      sovFactId: "sov-id",
      activityId: "E100",
      valueCents: 40_000_00,
      plannedQuantity: null,
      unit: null,
      plannedManHours: null,
      plannedBasisSource: null,
    },
  ],
});
const fact = (id: string, quantity: number, manHours: number): ProductionFact => ({
  ...project,
  logicalLineId: id,
  revision: 1,
  allocationId: "a1",
  reportDate: "2026-10-26",
  quantity,
  unit: "LF",
  manHours,
});

describe("proposed production mapping", () => {
  it("reconciles a one-to-many allocation exactly to the cent", () => {
    const p = proposal();
    expect(validateMapping(p)).toEqual([]);
    p.allocations[1].valueCents++;
    expect(validateMapping(p)).toContain("Allocations do not reconcile to SOV 26.04.");
    p.allocations[1].valueCents--;
    p.allocations[1].activityId = "E090";
    expect(validateMapping(p)).toContain("Allocation IDs and SOV/activity pairs must be unique.");
  });
  it("rejects foreign source records, missing money, and nonexistent activities", () => {
    const p = proposal();
    p.sov[0].jobId = "other";
    p.sov[0].valueCents = null;
    p.allocations[0].activityId = "missing";
    expect(validateMapping(p).join(" ")).toMatch(
      /Invalid or duplicate SOV source.*needs a supported.*reference the supplied/,
    );
  });
  it("leaves a rate unknown without both sourced planned inputs", () => {
    const a = proposal().allocations[0];
    expect(plannedRate(a)).toBe(4);
    expect(plannedRate({ ...a, plannedManHours: null })).toBeNull();
    expect(plannedRate({ ...a, plannedBasisSource: null })).toBeNull();
  });
  it("sums actual production over days and rejects duplicate or foreign facts", () => {
    const a = proposal().allocations[0];
    const f = [fact("day1", 300, 80), { ...fact("day2", 700, 175), reportDate: "2026-10-27" }];
    expect(productionTotals(project, a, f)).toEqual({
      quantity: 1000,
      manHours: 255,
      actualRate: 1000 / 255,
      plannedRate: 4,
    });
    expect(() => productionTotals(project, a, [...f, f[0]])).toThrow();
    expect(() => productionTotals(project, a, [{ ...f[0], jobId: "other" }])).toThrow();
    expect(() => productionTotals(project, a, [{ ...f[0], unit: "EA" }])).toThrow();
  });
  it("keeps no data unknown and allows actual rates without a planned basis", () => {
    const a = proposal().allocations[1];
    expect(productionTotals(project, a, [])).toEqual({
      quantity: null,
      manHours: null,
      actualRate: null,
      plannedRate: null,
    });
    expect(
      productionTotals(project, a, [{ ...fact("day1", 30, 8), allocationId: "a2" }]).actualRate,
    ).toBe(3.75);
  });
});
