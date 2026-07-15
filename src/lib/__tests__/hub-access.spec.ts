import { describe, expect, it } from "vitest";
import { hasCircleFeature, hasContractorCircleAccess } from "@/lib/hub-access";
import type { Tier } from "@/hooks/use-tier";

describe("Hub ecosystem access", () => {
  it.each<Tier>(["aos_only", "book_buyer", "intensive"])(
    "keeps Contractor Circle implementation surfaces locked for %s",
    (tier) => {
      expect(hasContractorCircleAccess(tier)).toBe(false);
      expect(hasCircleFeature(tier, "calls")).toBe(false);
      expect(hasCircleFeature(tier, "templates")).toBe(false);
      expect(hasCircleFeature(tier, "replays")).toBe(false);
    },
  );

  it.each<Tier>(["power_hour", "sm_school", "contractor_school", "circle", "hardcore"])(
    "unlocks the implementation layer for %s",
    (tier) => {
      expect(hasContractorCircleAccess(tier)).toBe(true);
      expect(hasCircleFeature(tier, "contractor-os")).toBe(true);
      expect(hasCircleFeature(tier, "community")).toBe(true);
    },
  );
});
