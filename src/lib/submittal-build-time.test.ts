import { describe, expect, it } from "vitest";
import { submittalBuildTime } from "./submittal-build-time";

describe("package build time in Manaus", () => {
  it("formats the reported T-2 example as 3:11 PM without changing the source", () => {
    const source = "2026-10-24T19:11:33+00:00";
    expect(submittalBuildTime(source)).toBe("Oct 24, 2026, 3:11 PM Manaus (UTC-4)");
    expect(source).toBe("2026-10-24T19:11:33+00:00");
  });
  it("keeps the local date across midnight and stays UTC-4 in winter", () => {
    expect(submittalBuildTime("2026-12-01T02:11:33Z")).toBe(
      "Nov 30, 2026, 10:11 PM Manaus (UTC-4)",
    );
    expect(submittalBuildTime("invalid")).toBe("Build time unavailable");
  });
});
