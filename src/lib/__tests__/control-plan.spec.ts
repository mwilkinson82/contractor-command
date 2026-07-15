import { describe, expect, it } from "vitest";
import {
  controlPlanProgress,
  controlPlanState,
  createControlPlan,
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
});
