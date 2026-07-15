import { describe, expect, it } from "vitest";
import { CONTROL_BASELINE_CAMPAIGN } from "@/lib/control-activation-campaign";

describe("State of Control activation campaign", () => {
  it("preserves the operating hierarchy and routes members into Start Here", () => {
    expect(CONTROL_BASELINE_CAMPAIGN.body).toContain("**AOS**");
    expect(CONTROL_BASELINE_CAMPAIGN.body).toContain("**OverWatch / IOR**");
    expect(CONTROL_BASELINE_CAMPAIGN.body).toContain("**Daily Logs + Daily Project WIP**");
    expect(CONTROL_BASELINE_CAMPAIGN.audience).toBe("control_baseline");
    expect(CONTROL_BASELINE_CAMPAIGN.ctaUrl).toBe("https://app.alpcontractorcircle.com/start-here");
  });

  it("gives members a concrete next action", () => {
    expect(CONTROL_BASELINE_CAMPAIGN.subject).toBeTruthy();
    expect(CONTROL_BASELINE_CAMPAIGN.headline).toContain("State of Control");
    expect(CONTROL_BASELINE_CAMPAIGN.ctaLabel).toContain("90-day roadmap");
    expect(CONTROL_BASELINE_CAMPAIGN.body).toContain("Complete the baseline");
  });
});
