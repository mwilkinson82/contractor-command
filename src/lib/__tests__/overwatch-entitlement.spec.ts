import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isOverwatchIncludedTier,
  overwatchEntitlementSigningString,
  verifyOverwatchEntitlementSignature,
} from "@/lib/overwatch-entitlement";

describe("OverWatch included membership", () => {
  it("includes Circle and Hardcore only", () => {
    expect(isOverwatchIncludedTier("circle")).toBe(true);
    expect(isOverwatchIncludedTier("hardcore")).toBe(true);
    expect(isOverwatchIncludedTier("power_hour")).toBe(false);
    expect(isOverwatchIncludedTier(null)).toBe(false);
  });

  it("normalizes the email in the canonical signing string", () => {
    expect(
      overwatchEntitlementSigningString({
        email: " Member@Example.COM ",
        ts: 1_721_000_000,
        nonce: "nonce-1",
      }),
    ).toBe("member@example.com|1721000000|nonce-1");
  });

  it("accepts the shared-secret signature and rejects a different key", () => {
    const signingString = "member@example.com|1721000000|nonce-1";
    const signature = createHmac("sha256", "correct-secret").update(signingString).digest("hex");

    expect(
      verifyOverwatchEntitlementSignature({
        signature,
        signingString,
        secrets: ["correct-secret"],
      }),
    ).toBe(true);
    expect(
      verifyOverwatchEntitlementSignature({
        signature,
        signingString,
        secrets: ["wrong-secret"],
      }),
    ).toBe(false);
  });
});
