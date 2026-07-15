import { describe, expect, it } from "vitest";
import {
  controlPlanProgress,
  controlPlanState,
  createControlPlan,
  createWeeklyControlReview,
  isControlPlanReviewDue,
  isWeeklyControlReviewCurrent,
  latestWeeklyControlReview,
  type ControlPlan,
} from "@/lib/control-plan";

const seeds = ["AOS", "IOR", "Field Control"].map((title, index) => ({
  period: `Month ${index + 1}`,
  title,
  impact: `${title} impact`,
  playbook: `${title} playbook`,
  worksheet: `${title} worksheet`,
  actions: [`${title} action 1`, `${title} action 2`],
}));

describe("control plan", () => {
  it("creates three owned monthly milestones from the State of Control route", () => {
    const plan = createControlPlan(seeds, new Date("2026-07-15T12:00:00.000Z"));
    expect(plan.reviewDate).toBe("2026-10-13");
    expect(plan.milestones).toHaveLength(3);
    expect(plan.milestones.map((item) => item.dueDate)).toEqual([
      "2026-08-14",
      "2026-09-13",
      "2026-10-13",
    ]);
    expect(plan.milestones[0].actions[0].id).toBe("month-1-action-1");
  });

  it("calculates action progress and state", () => {
    const plan = createControlPlan(seeds) as ControlPlan;
    plan.milestones[0].actions[0].complete = true;
    expect(controlPlanProgress(plan)).toEqual({ completed: 1, total: 6, percent: 17 });
    expect(controlPlanState(plan)).toBe("in_progress");

    for (const milestone of plan.milestones) {
      for (const action of milestone.actions) action.complete = true;
    }
    expect(controlPlanProgress(plan).percent).toBe(100);
    expect(controlPlanState(plan)).toBe("complete");
  });

  it("surfaces a blocked milestone ahead of partial progress", () => {
    const plan = createControlPlan(seeds);
    plan.milestones[0].actions[0].complete = true;
    plan.milestones[1].status = "blocked";
    expect(controlPlanState(plan)).toBe("blocked");
  });

  it("creates a trimmed weekly review and identifies the latest control signal", () => {
    const plan = createControlPlan(seeds);
    const older = createWeeklyControlReview(
      {
        movement: "  Closed the billing gap.  ",
        constraintTrend: "shrinking",
        blocked: false,
        blocker: "",
        nextAction: "  Submit the revised pay app. ",
        nextOwner: "  Morgan ",
        needsPressure: false,
        pressureNote: "",
      },
      new Date("2026-07-08T12:00:00.000Z"),
    );
    const latest = createWeeklyControlReview(
      {
        movement: "Collected the receivable.",
        constraintTrend: "resolved",
        blocked: false,
        blocker: "",
        nextAction: "Reset the cash target.",
        nextOwner: "Marshall",
        needsPressure: false,
        pressureNote: "",
      },
      new Date("2026-07-15T12:00:00.000Z"),
    );
    plan.weeklyReviews = [older, latest];

    expect(older.movement).toBe("Closed the billing gap.");
    expect(older.nextOwner).toBe("Morgan");
    expect(latestWeeklyControlReview(plan)).toEqual(latest);
    expect(isWeeklyControlReviewCurrent(latest, new Date("2026-07-21T12:00:00.000Z"))).toBe(true);
    expect(isWeeklyControlReviewCurrent(latest, new Date("2026-07-23T12:00:00.000Z"))).toBe(false);
  });

  it("marks the 90-day review due after the end of its scheduled date", () => {
    expect(isControlPlanReviewDue("2026-07-15", new Date("2026-07-15T12:00:00.000Z"))).toBe(false);
    expect(isControlPlanReviewDue("2026-07-15", new Date("2026-07-16T12:00:00.000Z"))).toBe(true);
  });
});
