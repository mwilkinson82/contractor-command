import { describe, it, expect } from "vitest";
import { capMessage, DB_UNAVAILABLE, MCP_DAILY_CAP, MCP_HOURLY_CAP } from "./limits";

describe("rate limit messages", () => {
  it("hourly cap reads clearly with the reset time", () => {
    const m = capMessage({ ok: false, limit: "hourly", resets_at: "2026-10-19T14:42:00Z" }, new Date("2026-10-19T14:24:00Z"));
    expect(m).toMatch(/^You've hit Athena's hourly limit\. It resets at 10:42 EDT \(in about 18 min\)\.$/);
  });
  it("daily cap", () => expect(capMessage({ ok: false, limit: "daily", resets_at: "2026-10-20T13:00:00Z" })).toContain("daily limit"));
  it("differs from a database failure", () => expect(DB_UNAVAILABLE).not.toMatch(/limit/));
  it("caps are 200 per hour and 1,000 per day", () => {
    expect(MCP_HOURLY_CAP).toBe(200);
    expect(MCP_DAILY_CAP).toBe(1000);
  });
});

import { isMissingFunction } from "./guard";
describe("cap check before migration 0017", () => {
  it("recognises a missing function so the old cap is used", () => {
    expect(isMissingFunction({ code: "PGRST202", message: "Could not find the function public.mcp_abuse_cap_check" })).toBe(true);
    expect(isMissingFunction({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
  });
});
