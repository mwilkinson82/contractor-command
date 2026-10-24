import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";
const fixture = vi.hoisted(() => ({
  plan: "athena_pm",
  calls: [] as string[],
  entitled: true,
  cap: true,
}));
vi.mock("./supabase", () => ({
  supabaseForUser: () => ({
    rpc: async (name: string) => {
      fixture.calls.push(name);
      return {
        error: null,
        data:
          name === "mcp_abuse_cap_check"
            ? { ok: fixture.cap, limit: "daily" }
            : name === "mcp_company_tier"
              ? fixture.plan
              : false,
      };
    },
  }),
}));
vi.mock("./entitlement", () => ({
  checkAthenaEntitlement: async () => ({ allowed: fixture.entitled }),
}));
vi.mock("./security", () => ({
  getCallSignals: () => null,
  securityTouch: async () => ({}),
  enforceTouch: () => {},
  stampCanary: (r: unknown) => r,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({ job_number: "QA", company_id: "resolved-company" }),
  WhichCompanyAsk: class extends Error {},
}));
vi.mock("./field-reminder", () => ({
  attachDailyReminder: async (_sb: unknown, _job: unknown, r: unknown) => r,
}));
vi.mock("./getting-started", () => ({
  attachGettingStarted: async (_sb: unknown, r: unknown) => r,
}));
vi.mock("./morning-brief-card", () => ({
  attachMorningCard: async (_sb: unknown, r: unknown) => r,
}));
import { guard, run } from "./guard";
const ctx = { isAuthenticated: () => true } as ToolContext;
beforeEach(() => {
  fixture.entitled = true;
  fixture.cap = true;
  fixture.plan = "athena_pm";
  fixture.calls = [];
});
describe("estimating plan enforced before tool data access", () => {
  it("does not execute an estimating handler for a PM-only owner", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "restricted data" }] }));
    const result = await run("takeoff_geometry", ctx, { jobNumber: "QA" }, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain("Estimating with Athena Office");
    expect(JSON.stringify(result)).not.toContain("restricted data");
  });
  it.each(["athena_office", "circle", "hardcore"])(
    "executes only the authorized handler for %s",
    async (plan) => {
      fixture.plan = plan;
      const handler = vi.fn(async () => ({ content: [{ type: "text", text: "authorized" }] }));
      await run("estimate_status", ctx, { jobNumber: "QA" }, handler);
      expect(handler).toHaveBeenCalledOnce();
    },
  );
  it("keeps project management usable on PM without an estimating plan check", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "PM reply" }] }));
    await run("morning_brief", ctx, { jobNumber: "QA" }, handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(fixture.calls).not.toContain("mcp_company_tier");
  });
});

describe("takeoff business-quota exemption preserves access controls", () => {
  it("allows estimating at the daily quota without consuming or checking that allowance", async () => {
    fixture.cap = false;
    await expect(guard(ctx, "takeoff_geometry")).resolves.toBeDefined();
    expect(fixture.calls).not.toContain("mcp_abuse_cap_check");
    await expect(guard(ctx, "morning_brief")).rejects.toThrow("daily limit");
  });
  it("still refuses an inactive member and an unauthenticated caller", async () => {
    fixture.entitled = false;
    await expect(guard(ctx, "takeoff_geometry")).rejects.toThrow("membership isn't active");
    await expect(
      guard({ isAuthenticated: () => false } as ToolContext, "takeoff_geometry"),
    ).rejects.toThrow("Not authenticated");
  });
  it("keeps the Office plan gate even for the verified platform owner", async () => {
    fixture.cap = false;
    const handler = vi.fn();
    await run(
      "takeoff_geometry",
      { ...ctx, getUserId: () => "68ef4232-acf4-423b-a31e-6dde1d4f9639" } as ToolContext,
      { jobNumber: "QA" },
      handler,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(fixture.calls).toContain("mcp_company_tier");
  });
});
