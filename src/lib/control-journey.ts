import {
  controlPlanProgress,
  isControlPlanReviewDue,
  isWeeklyControlReviewCurrent,
  latestWeeklyControlReview,
  type ControlPlan,
} from "@/lib/control-plan";

export type MemberControlProgress = {
  orientation_opened_at: string | null;
  assessment_started_at: string | null;
  baseline_saved_at: string | null;
  latest_baseline_id: string | null;
  latest_score: number | null;
  primary_category: string | null;
  primary_constraint: string | null;
  plan_started_at: string | null;
  plan_updated_at: string | null;
  plan_completed_at: string | null;
};

export type ControlJourneyStepStatus = "complete" | "active" | "scheduled" | "pending";

export type ControlJourneyStep = {
  id: "orientation" | "assessment" | "baseline" | "plan" | "weekly" | "reassess";
  title: string;
  detail: string;
  status: ControlJourneyStepStatus;
  statusLabel: string;
};

export type ControlJourneyDestination =
  | { route: "orientation" }
  | { route: "assessment" }
  | { route: "vault" }
  | { route: "plan"; packetId: string };

export type ControlJourneyAction = {
  label: string;
  detail: string;
  destination: ControlJourneyDestination;
};

export type ControlJourney = {
  phase: string;
  legacyBaseline: boolean;
  completedControls: number;
  totalControls: number;
  score: number | null;
  primaryCategory: string | null;
  primaryConstraint: string | null;
  planPercent: number;
  planActionsCompleted: number;
  planActionsTotal: number;
  reviewDate: string | null;
  weeklyCurrent: boolean;
  steps: ControlJourneyStep[];
  nextAction: ControlJourneyAction;
};

function status(complete: boolean, active: boolean): ControlJourneyStepStatus {
  if (complete) return "complete";
  return active ? "active" : "pending";
}

export function buildControlJourney(
  progress: MemberControlProgress | null | undefined,
  plan: ControlPlan | undefined,
  now = new Date(),
  legacyBaselineAt?: string | null,
): ControlJourney {
  const orientationComplete = Boolean(progress?.orientation_opened_at);
  const assessmentComplete = Boolean(progress?.assessment_started_at);
  const baselineComplete = Boolean(progress?.baseline_saved_at);
  const legacyBaseline = Boolean(legacyBaselineAt && !baselineComplete);
  const planStarted = Boolean(progress?.plan_started_at && progress.latest_baseline_id && plan);
  const weeklyCurrent =
    planStarted && isWeeklyControlReviewCurrent(latestWeeklyControlReview(plan), now);
  const reviewDate = plan?.reviewDate ?? null;
  const reviewDue = planStarted && isControlPlanReviewDue(plan?.reviewDate, now);
  const planProgress = controlPlanProgress(plan);

  const completedControls = [
    orientationComplete,
    assessmentComplete,
    baselineComplete,
    planStarted,
    weeklyCurrent,
  ].filter(Boolean).length;

  let nextAction: ControlJourneyAction;
  let phase: string;
  if (!orientationComplete) {
    phase = "Begin the loop";
    nextAction = {
      label: "Start orientation",
      detail: "Watch the Professional Contractor Control Loop, then establish the baseline.",
      destination: { route: "orientation" },
    };
  } else if (legacyBaseline && !assessmentComplete) {
    phase = "Baseline needs refresh";
    nextAction = {
      label: "Refresh State of Control",
      detail:
        "Your earlier assessment predates the live 90-day plan. Rerun it to establish the current baseline and route.",
      destination: { route: "assessment" },
    };
  } else if (!assessmentComplete) {
    phase = "Baseline not started";
    nextAction = {
      label: "Run State of Control",
      detail: "Score company, project, and field control to expose the active constraint.",
      destination: { route: "assessment" },
    };
  } else if (!baselineComplete) {
    phase = "Assessment in progress";
    nextAction = {
      label: "Finish and save baseline",
      detail: "Complete the assessment so the 90-day route can be generated.",
      destination: { route: "assessment" },
    };
  } else if (!progress?.latest_baseline_id) {
    phase = "Baseline needs routing";
    nextAction = {
      label: "Open Company Vault",
      detail: "Find the saved State of Control baseline and continue the implementation route.",
      destination: { route: "vault" },
    };
  } else if (!planStarted) {
    phase = "Plan not started";
    nextAction = {
      label: "Start the 90-day plan",
      detail: "Assign the first owner, confirm the due date, and put the plan into motion.",
      destination: { route: "plan", packetId: progress.latest_baseline_id },
    };
  } else if (reviewDue) {
    phase = "Reassessment due";
    nextAction = {
      label: "Remeasure State of Control",
      detail: "The 90-day review date has arrived. Establish the next baseline and constraint.",
      destination: { route: "assessment" },
    };
  } else if (!weeklyCurrent) {
    phase = "Weekly update due";
    nextAction = {
      label: "Complete the weekly review",
      detail:
        "Record movement, constraint trend, the next owner, and any pressure needed from the room.",
      destination: { route: "plan", packetId: progress.latest_baseline_id },
    };
  } else {
    phase = "On rhythm";
    nextAction = {
      label: "Review the active plan",
      detail: "The weekly update is current. Keep pressure on the next owned action.",
      destination: { route: "plan", packetId: progress.latest_baseline_id },
    };
  }

  return {
    phase,
    legacyBaseline,
    completedControls,
    totalControls: 5,
    score: progress?.latest_score ?? null,
    primaryCategory: progress?.primary_category ?? null,
    primaryConstraint: progress?.primary_constraint ?? null,
    planPercent: planProgress.percent,
    planActionsCompleted: planProgress.completed,
    planActionsTotal: planProgress.total,
    reviewDate,
    weeklyCurrent,
    steps: [
      {
        id: "orientation",
        title: "Orientation",
        detail: "Understand the company, project, and field control loop.",
        status: status(orientationComplete, true),
        statusLabel: orientationComplete ? "Opened" : "Start here",
      },
      {
        id: "assessment",
        title: "State of Control",
        detail: legacyBaseline
          ? "Refresh the earlier assessment and generate the live 90-day route."
          : "Score what is true now and expose the active constraint.",
        status: status(assessmentComplete, orientationComplete),
        statusLabel: assessmentComplete
          ? "Started"
          : legacyBaseline && orientationComplete
            ? "Refresh"
            : orientationComplete
              ? "Next"
              : "Pending",
      },
      {
        id: "baseline",
        title: "Save the baseline",
        detail: "Create the current operating record and implementation route.",
        status: status(baselineComplete, assessmentComplete),
        statusLabel: baselineComplete ? "Saved" : assessmentComplete ? "Next" : "Pending",
      },
      {
        id: "plan",
        title: "Start the plan",
        detail: "Assign ownership and activate the first 30-day move.",
        status: status(planStarted, baselineComplete),
        statusLabel: planStarted ? "Active" : baselineComplete ? "Next" : "Pending",
      },
      {
        id: "weekly",
        title: "Update weekly",
        detail: "Record movement, blockers, decisions, and completed actions.",
        status: status(weeklyCurrent, planStarted),
        statusLabel: weeklyCurrent ? "Current" : planStarted ? "Due" : "Pending",
      },
      {
        id: "reassess",
        title: "Remeasure at 90 days",
        detail: reviewDate
          ? `Next control review: ${reviewDate}.`
          : "The review date begins with the plan.",
        status: reviewDue ? "active" : reviewDate ? "scheduled" : "pending",
        statusLabel: reviewDue ? "Due" : reviewDate ? "Scheduled" : "Pending",
      },
    ],
    nextAction,
  };
}
