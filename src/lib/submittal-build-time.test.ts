import { describe, expect, it } from "vitest";
import { submittalBuildTime, submittalTimeZone } from "./submittal-build-time";

describe("package build time in the saved project context", () => {
  it("uses the job before company and member, without changing the instant", () => {
    const source = "2026-10-24T19:11:33+00:00";
    expect(
      submittalBuildTime(source, {
        job: "America/Chicago",
        company: "America/Los_Angeles",
        member: "America/New_York",
      }),
    ).toBe("Oct 24, 2026, 2:11 PM CDT (America/Chicago)");
    expect(source).toBe("2026-10-24T19:11:33+00:00");
  });
  it("falls back from an empty job to the company, then the member", () => {
    expect(
      submittalTimeZone({ job: " ", company: "Europe/Paris", member: "America/New_York" }),
    ).toEqual({ zone: "Europe/Paris", source: "company" });
    expect(submittalTimeZone({ job: null, company: null, member: "Asia/Kolkata" })).toEqual({
      zone: "Asia/Kolkata",
      source: "member",
    });
    expect(submittalBuildTime("2026-10-24T19:11:33Z", { member: "Asia/Kolkata" })).toBe(
      "Oct 25, 2026, 12:41 AM GMT+5:30 (Asia/Kolkata)",
    );
  });
  it("names New York and changes its offset with the historical date", () => {
    expect(submittalBuildTime("2026-10-24T19:11:33Z", { job: "America/New_York" })).toBe(
      "Oct 24, 2026, 3:11 PM EDT (America/New_York)",
    );
    expect(submittalBuildTime("2026-12-01T02:11:33Z", { job: "America/New_York" })).toBe(
      "Nov 30, 2026, 9:11 PM EST (America/New_York)",
    );
  });
  it("skips invalid saved zones and labels UTC honestly when none is saved", () => {
    expect(submittalTimeZone({ job: "Bad/Zone", company: "America/Chicago" })).toEqual({
      zone: "America/Chicago",
      source: "company",
    });
    expect(submittalBuildTime("2026-10-24T19:11:33Z", {})).toBe(
      "Oct 24, 2026, 7:11 PM UTC (UTC; no saved time zone)",
    );
    expect(submittalBuildTime("invalid")).toBe("Build time unavailable");
  });
});
