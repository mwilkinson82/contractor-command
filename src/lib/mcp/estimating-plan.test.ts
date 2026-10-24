import { describe, expect, it, vi } from "vitest";
import { estimatingTool, estimatingUpgrade } from "./estimating-plan";
import type { Sb } from "./guard";
vi.mock("./jobs", () => ({
  resolveJob: vi.fn(async (_sb, _number, company) => ({
    company_id: company ?? "resolved-job-company",
    job_number: "QA",
  })),
}));

describe("estimating company-plan boundary", () => {
  const db = (plan: unknown, error: unknown = null) => ({
    rpc: vi.fn().mockResolvedValue({ data: plan, error }),
  });
  it.each(["athena_office", "circle", "hardcore"])(
    "allows %s without changing entitlements",
    async (plan) => {
      const sb = db(plan);
      expect(await estimatingUpgrade(sb as unknown as Sb, "QA")).toBeNull();
      expect(sb.rpc).toHaveBeenCalledExactlyOnceWith("mcp_company_tier", {
        _company: "resolved-job-company",
      });
    },
  );
  it("gives a PM-only owner a styled upgrade path on the named company", async () => {
    const sb = db("athena_pm");
    const card = await estimatingUpgrade(sb as unknown as Sb, "QA", "named-company");
    expect(card?.title).toBe("Estimating with Athena Office");
    expect(JSON.stringify(card)).toContain("$397/month");
    expect(JSON.stringify(card)).toContain("project management");
    expect(sb.rpc).toHaveBeenCalledWith("mcp_company_tier", { _company: "named-company" });
  });
  it.each([
    [null, null],
    [null, { message: "unavailable" }],
  ])("never guesses access if the plan check fails", async (data, error) => {
    await expect(estimatingUpgrade(db(data, error) as unknown as Sb, "QA")).rejects.toThrow(
      "couldn't check",
    );
  });
  it("covers estimation reads and writes without gating PM tools", () => {
    for (const name of [
      "estimate_intake",
      "estimate_takeoff_get",
      "estimate_build",
      "drawing_set_import",
      "drawing_markup",
      "takeoff_geometry",
      "sheet_calibrate",
    ])
      expect(estimatingTool(name)).toBe(true);
    for (const name of [
      "morning_brief",
      "lookahead_get",
      "field_pay_app",
      "submittals_list",
      "email_draft",
    ])
      expect(estimatingTool(name)).toBe(false);
  });
});
