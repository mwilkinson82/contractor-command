import { describe, expect, it } from "vitest";
import { START_HERE_MIN_TIER, startHereExperience } from "@/lib/start-here-access";

describe("Start Here access", () => {
  it("opens the orientation at the Handbook Buyer tier", () => {
    expect(START_HERE_MIN_TIER).toBe("book_buyer");
  });

  it.each(["book_buyer", "intensive"] as const)(
    "gives %s members the handbook-to-control experience",
    (tier) => {
      expect(startHereExperience(tier)).toBe("handbook");
    },
  );

  it.each(["power_hour", "sm_school", "contractor_school", "circle", "hardcore"] as const)(
    "keeps %s members on the Circle onboarding experience",
    (tier) => {
      expect(startHereExperience(tier)).toBe("circle");
    },
  );
});
