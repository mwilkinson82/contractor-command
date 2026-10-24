import { describe, it, expect } from "vitest";
import {
  capMessage,
  countsTowardAccountCap,
  DB_UNAVAILABLE,
  MCP_DAILY_CAP,
  MCP_HOURLY_CAP,
} from "./limits";

describe("rate limit messages", () => {
  it("hourly cap reads clearly with the reset time", () => {
    const m = capMessage(
      { ok: false, limit: "hourly", resets_at: "2026-10-19T14:42:00Z" },
      new Date("2026-10-19T14:24:00Z"),
    );
    expect(m).toMatch(
      /^You've hit Athena's hourly limit\. It resets at 10:42 EDT \(in about 18 min\)\.$/,
    );
  });
  it("daily cap", () =>
    expect(capMessage({ ok: false, limit: "daily", resets_at: "2026-10-20T13:00:00Z" })).toContain(
      "daily limit",
    ));
  it("differs from a database failure", () => expect(DB_UNAVAILABLE).not.toMatch(/limit/));
  it("caps are 200 per hour and 1,000 per day", () => {
    expect(MCP_HOURLY_CAP).toBe(200);
    expect(MCP_DAILY_CAP).toBe(1000);
  });
});

import { isMissingFunction } from "./guard";
describe("cap check before migration 0017", () => {
  it("recognises a missing function so the old cap is used", () => {
    expect(
      isMissingFunction({
        code: "PGRST202",
        message: "Could not find the function public.mcp_abuse_cap_check",
      }),
    ).toBe(true);
    expect(
      isMissingFunction({ code: "57014", message: "canceling statement due to statement timeout" }),
    ).toBe(false);
  });
});

describe("estimating account allowance", () => {
  it.each([
    "takeoff_geometry",
    "sheet_calibrate",
    "drawing_set_import",
    "drawing_markup",
    "drawing_sets_list",
    "estimate_intake",
    "estimate_gap_analysis",
  ])("%s cannot consume the PM daily allowance", (tool) => {
    expect(countsTowardAccountCap(tool, "ordinary-member")).toBe(false);
  });
  it("exempts only the verified platform owner from general business quotas", () => {
    expect(countsTowardAccountCap("morning_brief", "68ef4232-acf4-423b-a31e-6dde1d4f9639")).toBe(
      false,
    );
    expect(countsTowardAccountCap("morning_brief", "ffc8331a-1790-4a8e-a423-50c4bf850aa1")).toBe(
      false,
    );
    expect(countsTowardAccountCap("morning_brief", "company-owner")).toBe(true);
    expect(countsTowardAccountCap("morning_brief")).toBe(true);
  });
});

describe("owner heavy-tool allowance", () => {
  it("removes only the owner's volume cap while retaining security signals and normal member caps", async () => {
    const { securityTouch } = await import("./security");
    const calls: Record<string, unknown>[] = [];
    const sb = {
      rpc: async (_name: string, args?: Record<string, unknown>) => {
        calls.push(args!);
        return { data: { ok: true }, error: null };
      },
    };
    await securityTouch(
      sb,
      "report",
      "2701",
      ["odd_params"],
      undefined,
      "68ef4232-acf4-423b-a31e-6dde1d4f9639",
    );
    await securityTouch(sb, "report", "2701", [], undefined, "ordinary-member");
    expect(calls[0]).toMatchObject({ _tool_hourly: null, _signals: ["odd_params"] });
    expect(calls[1]).toMatchObject({ _tool_hourly: 60 });
  });
});
