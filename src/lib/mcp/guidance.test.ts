import { describe, it, expect } from "vitest";
import { noGuidance, reconcileRecommendation, BILLING_FORECAST_REC, DEFAULT_HELP, DEFAULT_WHY } from "./guidance";

describe("setup 'no' guidance", () => {
  it("splits a stored recommendation into recommend, help and why", () => {
    const g = noGuidance("Build a logic-driven CPM schedule with the PM and super. I can help you build it. Why: without a schedule, you can't see delays coming.");
    expect(g).toEqual({ recommendation: "Build a logic-driven CPM schedule with the PM and super.", help: "I can help you build it.", why: "without a schedule, you can't see delays coming." });
  });
  it("always offers help and explains why, even when the stored text has neither", () => {
    const g = noGuidance("Get the bonds issued and on file before the contract start.", "Answered no on a best-practice check for this job.", null);
    expect(g.help).toBe(DEFAULT_HELP);
    expect(g.why).toBe(DEFAULT_WHY);
  });
  it("billing forecast never recommends a cost-loaded schedule after the member said no to one", () => {
    const live = "My recommendation is a cost-loaded CPM schedule. I can help you build the schedule and map the SOV to it. Here's why: a monthly billing forecast tells you whether you're hitting your revenue target.";
    expect(reconcileRecommendation("bss_billing_forecast", live, { cost_loaded: "no" })).toBe(BILLING_FORECAST_REC);
    expect(reconcileRecommendation("bss_billing_forecast", live, { cost_loaded: "yes" })).toBe(live);
    expect(noGuidance(BILLING_FORECAST_REC).recommendation).not.toMatch(/cost-loaded/i);
  });
});
