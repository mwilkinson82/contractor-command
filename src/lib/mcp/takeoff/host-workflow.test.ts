import { describe, expect, it, vi } from "vitest";
import {
  hostReviewContext,
  hostContextForTile,
  hostWorkflowSection,
  measurementEvidence,
  TAKEOFF_MODEL_NOTICE,
} from "./host-workflow";
import type { EngineSnapshot } from "./state";
import type { Sb } from "../guard";
import { readFileSync } from "node:fs";

function client(data: unknown, contract: unknown[] = [], failed = false) {
  const eq = vi.fn().mockReturnValue({
    limit: vi
      .fn()
      .mockResolvedValue({ data: contract, error: failed ? { message: "unavailable" } : null }),
  });
  const sb = {
    rpc: vi.fn().mockResolvedValue({ data, error: failed ? { message: "unavailable" } : null }),
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) }),
  };
  return { sb: sb as unknown as Sb, eq, rpc: sb.rpc };
}
describe("member-model estimating workflow", () => {
  it("keeps the model recommendation visible and out of every advertised tool description", () => {
    const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8"));
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/strongest (?:available |image-reading )?model/i);
    expect(hostWorkflowSection().rows[0].cells).toContain(TAKEOFF_MODEL_NOTICE);
  });
  const job = { job_id: "job-private", job_number: "QA", company_id: "company-private" };
  const target = {
    pass_id: "pass-1",
    cursor: 0,
    line_no: 1,
    sheet: "S-100",
    source_id: "source-1",
    source_hash: "a".repeat(64),
    takeoff_version: 3,
    calibration_id: "cal1",
  };
  it("sends the source packet once across 20 regions and uses a compact bound reference thereafter", async () => {
    const { sb, rpc, eq } = client(
      { setup: { doc_review: { specs: [{ section: "033000", title: "Concrete" }] } } },
      [{ section: "9", verbatim_text: "UNIQUE PROJECT CLAUSE" }],
    );
    const replies = [];
    for (let cursor = 0; cursor < 20; cursor++)
      replies.push(await hostContextForTile(sb, job, { ...target, cursor }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledTimes(1);
    expect(replies.filter((r) => r.project_context)).toHaveLength(1);
    expect(JSON.stringify(replies).split("UNIQUE PROJECT CLAUSE")).toHaveLength(2);
    expect(replies[19].project_context_reference).toMatchObject({
      pass_id: "pass-1",
      source_id: "source-1",
      source_hash: target.source_hash,
      takeoff_version: 3,
      context_included: false,
      reload: {
        operation: "propose",
        pass_id: "pass-1",
        source_id: "source-1",
        sheet: "S-100",
        line_no: 1,
        calibration_id: "cal1",
        job_number: "QA",
        company_id: "company-private",
        cursor: 19,
        reload_context: true,
      },
    });
  });
  it("can reload current context at a resumed cursor without pretending the chat still has its initial packet", async () => {
    const { sb, rpc } = client({});
    const resumed = { ...target, cursor: 12 };
    const reference = await hostContextForTile(sb, job, resumed);
    expect(reference.project_context).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
    const reloaded = await hostContextForTile(sb, job, resumed, true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(reloaded.project_context_reference.context_included).toBe(true);
    expect(reloaded.project_context_reference.reload.cursor).toBe(12);
    expect(reloaded.project_context?.scope_complete).toBe(false);
    expect(resumed.cursor).toBe(12);
  });
  it("keeps accepted dimensional geometry in Verify until its own source/page calibration is dimension-checked", () => {
    const state = {
      available: true,
      takeoff_version: 1,
      passes: [],
      lines: [{ id: "l1", line_no: 1, item: "Footing run", unit: "LF" }],
      geometry: [
        {
          id: "r1",
          geometry_id: "g1",
          version: 1,
          line_id: "l1",
          status: "accepted",
          measured: 12,
          unit: "LF",
          source_id: "source-1",
          page: 2,
          calibration_id: "cal1",
          shape: { kind: "polyline", points: [] },
          evidence: { confidence: 0.99 },
        },
      ],
      calibrations: [
        { id: "cal1", source_id: "source-1", page: 2, confirmed: true, method: "estimator" },
      ],
    } as unknown as EngineSnapshot;
    expect(measurementEvidence(state)[0]).toMatchObject({
      status: "accepted",
      measurement_classification: "Verify",
      scale_status: "dimension check needed",
    });
    state.calibrations[0].method = "dimension_string";
    expect(measurementEvidence(state)[0].measurement_classification).toBe("Measured");
    state.calibrations[0].page = 3;
    expect(measurementEvidence(state)[0].measurement_classification).toBe("Verify");
    expect(state.geometry[0].status).toBe("accepted");
  });
  it("asks for the member's strongest available image-reading model without pretending to switch it", () => {
    expect(TAKEOFF_MODEL_NOTICE).toMatch(/strongest model available/);
    expect(TAKEOFF_MODEL_NOTICE).toMatch(/cannot change/);
    expect(JSON.stringify(hostWorkflowSection())).toMatch(/specifications and contract/);
    expect(JSON.stringify(hostWorkflowSection())).toMatch(/does not prove/);
  });
  it("loads this job's saved spec comparison and exact contract excerpts without declaring them reviewed", async () => {
    const { sb, eq, rpc } = client(
      {
        setup: {
          doc_review: {
            specs: [{ section: "033000", title: "Concrete" }],
            pairs: [{ spec_section: "033000", sheet: "S-100", requirement: "Vapor barrier" }],
            sheets: [],
          },
        },
      },
      [{ section: "3.2", verbatim_text: "Provide the vapor barrier." }],
    );
    const result = await hostReviewContext(sb, "job-private");
    expect(rpc).toHaveBeenCalledWith("mcp_estimate_get", { _job: "job-private" });
    expect(eq).toHaveBeenCalledWith("job_id", "job-private");
    expect(result.setup?.doc_review?.pairs[0].requirement).toBe("Vapor barrier");
    expect(result.contract_clauses[0].verbatim_text).toBe("Provide the vapor barrier.");
    expect(result.scope_complete).toBe(false);
    expect(result.basis).toMatch(/still require review/);
  });
  it("keeps missing and failed source context explicit rather than certifying scope coverage", async () => {
    const { sb } = client(null, [], true);
    const result = await hostReviewContext(sb, "job-private");
    expect(result.unresolved_context.join(" ")).toMatch(/could not be loaded/);
    expect(result.unresolved_context.join(" ")).toMatch(/specification/);
    expect(result.unresolved_context.join(" ")).toMatch(/contract/);
    expect(result.scope_complete).toBe(false);
    const partial = await hostReviewContext(
      client({ setup: { doc_review: { sheets: [] } } }).sb,
      "job-private",
    );
    expect(partial.unresolved_context.join(" ")).toMatch(/No saved specification review/);
  });
  it("labels truncated clause text instead of passing it off as a complete clause", async () => {
    const { sb } = client({}, [{ section: "9", verbatim_text: "A".repeat(2500) }]);
    const result = await hostReviewContext(sb, "job-private");
    expect(result.contract_clauses[0].verbatim_text.length).toBe(2000);
    expect(result.contract_clauses[0].truncated).toBe(true);
    expect(result.unresolved_context.join(" ")).toMatch(/truncated/);
  });
  it("keeps a high-confidence proposal unconfirmed and missing scope visible", () => {
    const state = {
      available: true,
      takeoff_version: 1,
      passes: [],
      calibrations: [],
      lines: [
        { id: "l1", line_no: 1, item: "Footings", unit: "EA" },
        { id: "l2", line_no: 2, item: "Vapor barrier", unit: "SF" },
      ],
      geometry: [
        {
          id: "r1",
          geometry_id: "g1",
          version: 1,
          line_id: "l1",
          status: "proposed",
          measured: 3,
          unit: "EA",
          source_id: "source-1",
          page: 2,
          calibration_id: null,
          shape: { kind: "pins", points: [] },
          evidence: { confidence: 0.98 },
        },
      ],
    } as unknown as EngineSnapshot;
    const result = measurementEvidence(state);
    expect(result[0]).toMatchObject({
      status: "proposed",
      quantity: 3,
      reported_confidence_range: { low: 0.98, high: 0.98 },
      scope_complete: false,
    });
    expect(result[0].confidence_basis).toMatch(/not an accuracy/);
    expect(result[0].verification_needed).toMatch(/before accepting/);
    expect(result[0].references[0]).toMatchObject({ source_id: "source-1", page: 2, revision: 1 });
    expect(result[1]).toMatchObject({
      status: "unlocated",
      quantity: null,
      reported_confidence_range: null,
      scope_complete: false,
    });
    expect(result[1].verification_needed).toMatch(/Locate and measure/);
  });
});
