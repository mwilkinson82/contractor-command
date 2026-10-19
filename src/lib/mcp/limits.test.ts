import { describe, it, expect } from "vitest";
import { capMessage, DB_UNAVAILABLE, MCP_HOURLY_CAP } from "./limits";

describe("rate limit messages", () => {
  it("hourly cap reads clearly with the reset time", () => {
    const m = capMessage({ ok: false, limit: "hourly", resets_at: "2026-10-19T14:42:00Z" }, new Date("2026-10-19T14:24:00Z"));
    expect(m).toMatch(/^You've hit Athena's hourly limit\. It resets at 10:42 EDT \(in about 18 min\)\.$/);
  });
  it("daily cap", () => expect(capMessage({ ok: false, limit: "daily", resets_at: "2026-10-20T13:00:00Z" })).toContain("daily limit"));
  it("differs from a database failure", () => expect(DB_UNAVAILABLE).not.toMatch(/limit/));
  it("cap is 60 until Marshall picks", () => expect(MCP_HOURLY_CAP).toBe(60));
});
