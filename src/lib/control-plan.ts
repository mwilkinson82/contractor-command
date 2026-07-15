export type ControlPlanStatus = "not_started" | "in_progress" | "blocked" | "complete";

export type ConstraintTrend = "growing" | "unchanged" | "shrinking" | "resolved";

export type WeeklyControlReview = {
  id: string;
  reviewedAt: string;
  movement: string;
  constraintTrend: ConstraintTrend;
  blocked: boolean;
  blocker: string;
  nextAction: string;
  nextOwner: string;
  needsPressure: boolean;
  pressureNote: string;
};

export type ControlPlanAction = {
  id: string;
  title: string;
  complete: boolean;
};

export type ControlPlanMilestone = {
  id: string;
  period: string;
  title: string;
  impact: string;
  playbook: string;
  worksheet: string;
  owner: string;
  dueDate: string;
  status: ControlPlanStatus;
  notes: string;
  actions: ControlPlanAction[];
};

export type ControlPlan = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  reviewDate: string;
  milestones: ControlPlanMilestone[];
  weeklyReviews?: WeeklyControlReview[];
};

export type WeeklyControlReviewInput = Omit<WeeklyControlReview, "id" | "reviewedAt">;

export type ControlPlanSeed = {
  period: string;
  title: string;
  impact: string;
  playbook: string;
  worksheet: string;
  actions: string[];
};

function dateAfter(start: Date, days: number) {
  const result = new Date(start);
  result.setDate(result.getDate() + days);
  const year = result.getFullYear();
  const month = String(result.getMonth() + 1).padStart(2, "0");
  const day = String(result.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createControlPlan(seeds: ControlPlanSeed[], now = new Date()): ControlPlan {
  const createdAt = now.toISOString();
  return {
    version: 1,
    createdAt,
    updatedAt: createdAt,
    reviewDate: dateAfter(now, 90),
    weeklyReviews: [],
    milestones: seeds.slice(0, 3).map((seed, index) => ({
      id: `month-${index + 1}`,
      period: seed.period,
      title: seed.title,
      impact: seed.impact,
      playbook: seed.playbook,
      worksheet: seed.worksheet,
      owner: "",
      dueDate: dateAfter(now, (index + 1) * 30),
      status: "not_started",
      notes: "",
      actions: seed.actions.map((title, actionIndex) => ({
        id: `month-${index + 1}-action-${actionIndex + 1}`,
        title,
        complete: false,
      })),
    })),
  };
}

export function createWeeklyControlReview(
  input: WeeklyControlReviewInput,
  now = new Date(),
): WeeklyControlReview {
  const reviewedAt = now.toISOString();
  return {
    ...input,
    id: `weekly-${reviewedAt}`,
    reviewedAt,
    movement: input.movement.trim(),
    blocker: input.blocker.trim(),
    nextAction: input.nextAction.trim(),
    nextOwner: input.nextOwner.trim(),
    pressureNote: input.pressureNote.trim(),
  };
}

export function latestWeeklyControlReview(plan: Pick<ControlPlan, "weeklyReviews"> | undefined) {
  return plan?.weeklyReviews?.reduce<WeeklyControlReview | undefined>((latest, review) => {
    if (!latest) return review;
    return review.reviewedAt > latest.reviewedAt ? review : latest;
  }, undefined);
}

export function isWeeklyControlReviewCurrent(
  review: WeeklyControlReview | undefined,
  now = new Date(),
) {
  if (!review) return false;
  const reviewedAt = new Date(review.reviewedAt).getTime();
  return !Number.isNaN(reviewedAt) && now.getTime() - reviewedAt <= 7 * 24 * 60 * 60 * 1000;
}

export function isControlPlanReviewDue(reviewDate: string | undefined, now = new Date()) {
  if (!reviewDate) return false;
  const dueAt = new Date(`${reviewDate}T23:59:59`).getTime();
  return !Number.isNaN(dueAt) && now.getTime() > dueAt;
}

export function controlPlanProgress(plan: ControlPlan | undefined) {
  if (!plan) return { completed: 0, total: 0, percent: 0 };
  const actions = plan.milestones.flatMap((milestone) => milestone.actions);
  const completed = actions.filter((action) => action.complete).length;
  return {
    completed,
    total: actions.length,
    percent: actions.length ? Math.round((completed / actions.length) * 100) : 0,
  };
}

export function controlPlanState(plan: ControlPlan | undefined): ControlPlanStatus {
  if (!plan) return "not_started";
  if (plan.milestones.some((milestone) => milestone.status === "blocked")) return "blocked";
  const progress = controlPlanProgress(plan);
  if (progress.total > 0 && progress.completed === progress.total) return "complete";
  if (
    progress.completed > 0 ||
    plan.milestones.some(
      (milestone) => milestone.status === "in_progress" || milestone.status === "complete",
    )
  ) {
    return "in_progress";
  }
  return "not_started";
}
