import { describe, expect, it } from "vitest";
import { isCircleBaselineRecipient, isCircleMemberTier } from "@/lib/announcement-audience";

describe("member announcement audiences", () => {
  it.each(["circle", "hardcore"])("recognizes %s as a Contractor Circle tier", (tier) => {
    expect(isCircleMemberTier(tier)).toBe(true);
  });

  it.each(["book_buyer", "power_hour", "intensive", "aos_only", null])(
    "does not treat %s as a Contractor Circle tier",
    (tier) => {
      expect(isCircleMemberTier(tier)).toBe(false);
    },
  );

  it("includes only Circle and Hardcore members who need a baseline", () => {
    expect(isCircleBaselineRecipient({ tier: "circle", baselineState: "missing" })).toBe(true);
    expect(isCircleBaselineRecipient({ tier: "hardcore", baselineState: "needs_refresh" })).toBe(
      true,
    );
    expect(isCircleBaselineRecipient({ tier: "circle", baselineState: "current" })).toBe(false);
    expect(isCircleBaselineRecipient({ tier: "book_buyer", baselineState: "missing" })).toBe(false);
    expect(isCircleBaselineRecipient({ tier: "power_hour", baselineState: "missing" })).toBe(false);
  });
});
