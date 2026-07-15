import { describe, expect, it } from "vitest";
import { createControlPlan } from "@/lib/control-plan";
import { buildControlJourney, type MemberControlProgress } from "@/lib/control-journey";

const now = new Date("2026-07-15T12:00:00.000Z");

const emptyProgress: MemberControlProgress = {
  orientation_opened_at: null,
  assessment_started_at: null,
  baseline_saved_at: null,
  latest_baseline_id: null,
  latest_score: null,
  primary_category: null,
  primary_constraint: null,
  plan_started_at: null,
  plan_updated_at: null,
  plan_completed_at: null,
};

const plan = createControlPlan(
  [
    {
      period: "Month 1",
      title: "Economics",
      impact: "Close the capacity gap.",
      playbook: "Economics Engine",
      worksheet: "Cash Conversion Snapshot",
      actions: ["Complete the snapshot", "Reduce aged AR"],
    },
  ],
  now,
);

describe("member Control Journey", () => {
  it("starts a new member at orientation", () => {
    const journey = buildControlJourney(emptyProgress, undefined, now);

    expect(journey.phase).toBe("Begin the loop");
    expect(journey.nextAction.destination).toEqual({ route: "orientation" });
    expect(journey.completedControls).toBe(0);
    expect(journey.steps[0]).toMatchObject({ status: "active", statusLabel: "Start here" });
  });

  it("routes an opened orientation into State of Control", () => {
    const journey = buildControlJourney(
      { ...emptyProgress, orientation_opened_at: "2026-07-15T10:00:00.000Z" },
      undefined,
      now,
    );

    expect(journey.phase).toBe("Baseline not started");
    expect(journey.nextAction.destination).toEqual({ route: "assessment" });
    expect(journey.steps[1]).toMatchObject({ status: "active", statusLabel: "Next" });
  });

  it("asks a member to save an assessment that is already in progress", () => {
    const journey = buildControlJourney(
      {
        ...emptyProgress,
        orientation_opened_at: "2026-07-15T09:00:00.000Z",
        assessment_started_at: "2026-07-15T10:00:00.000Z",
      },
      undefined,
      now,
    );

    expect(journey.phase).toBe("Assessment in progress");
    expect(journey.nextAction.label).toBe("Finish and save baseline");
    expect(journey.steps[2].status).toBe("active");
  });

  it("opens the saved baseline plan before it has started", () => {
    const journey = buildControlJourney(
      {
        ...emptyProgress,
        orientation_opened_at: "2026-07-14T09:00:00.000Z",
        assessment_started_at: "2026-07-14T10:00:00.000Z",
        baseline_saved_at: "2026-07-14T10:30:00.000Z",
        latest_baseline_id: "baseline-1",
        latest_score: 45,
        primary_category: "Economics",
        primary_constraint: "Cash capacity",
      },
      plan,
      now,
    );

    expect(journey.phase).toBe("Plan not started");
    expect(journey.nextAction.destination).toEqual({
      route: "plan",
      packetId: "baseline-1",
    });
    expect(journey.score).toBe(45);
  });

  it("keeps a recently updated plan on rhythm", () => {
    const currentPlan = structuredClone(plan);
    currentPlan.milestones[0].actions[0].complete = true;
    const journey = buildControlJourney(
      {
        ...emptyProgress,
        orientation_opened_at: "2026-07-01T09:00:00.000Z",
        assessment_started_at: "2026-07-01T10:00:00.000Z",
        baseline_saved_at: "2026-07-01T10:30:00.000Z",
        latest_baseline_id: "baseline-1",
        plan_started_at: "2026-07-01T11:00:00.000Z",
        plan_updated_at: "2026-07-14T11:00:00.000Z",
      },
      currentPlan,
      now,
    );

    expect(journey.phase).toBe("On rhythm");
    expect(journey.completedControls).toBe(5);
    expect(journey.planPercent).toBe(50);
    expect(journey.steps[4]).toMatchObject({ status: "complete", statusLabel: "Current" });
  });

  it("prioritizes a 90-day reassessment over a stale weekly update", () => {
    const duePlan = structuredClone(plan);
    duePlan.reviewDate = "2026-07-14";
    const journey = buildControlJourney(
      {
        ...emptyProgress,
        orientation_opened_at: "2026-04-01T09:00:00.000Z",
        assessment_started_at: "2026-04-01T10:00:00.000Z",
        baseline_saved_at: "2026-04-01T10:30:00.000Z",
        latest_baseline_id: "baseline-1",
        plan_started_at: "2026-04-01T11:00:00.000Z",
        plan_updated_at: "2026-07-01T11:00:00.000Z",
      },
      duePlan,
      now,
    );

    expect(journey.phase).toBe("Reassessment due");
    expect(journey.nextAction.label).toBe("Remeasure State of Control");
    expect(journey.steps[5]).toMatchObject({ status: "active", statusLabel: "Due" });
  });
});
