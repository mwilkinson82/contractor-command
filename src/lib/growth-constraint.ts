// Growth Constraint Map — pure calculator + constraint priority logic.

export type GcmInputs = {
  desiredRevenue: number;
  currentRevenue: number;
  avgProjectSize: number;
  avgProjectDurationMonths: number;
  currentActiveProjects: number;
  realisticActiveProjectCapacity: number;
  qualifiedLeadsPerMonth: number;
  estimatesSentPerMonth: number;
  closeRatePct: number;
  avgGrossMarginPct: number;
  pms: number;
  avgProjectsPerPm: number;
};

export const DEFAULT_GCM: GcmInputs = {
  desiredRevenue: 12_000_000,
  currentRevenue: 8_000_000,
  avgProjectSize: 750_000,
  avgProjectDurationMonths: 5,
  currentActiveProjects: 7,
  realisticActiveProjectCapacity: 9,
  qualifiedLeadsPerMonth: 14,
  estimatesSentPerMonth: 8,
  closeRatePct: 25,
  avgGrossMarginPct: 28,
  pms: 2,
  avgProjectsPerPm: 4,
};

export type ConstraintKey =
  | "target_exceeded"
  | "estimate_throughput"
  | "lead_flow"
  | "sales_conversion"
  | "project_leadership"
  | "delivery_capacity"
  | "supportable";

export type GcmResult = {
  monthlyBillingVelocityPerProject: number;
  currentAnnualCapacity: number;
  realisticAnnualCapacity: number;
  requiredActiveProjects: number;
  signedContractsRequired: number;
  estimatesRequired: number;
  estimateCapacity: number;
  pmCapacity: number;
  revenueGap: number;
  grossProfitAttachedToGap: number;
  constraint: ConstraintKey;
  headline: string;
  finding: string;
  recommendedAction: string;
  missingSystem: string;
  relatedAos: string;
  bringOneIssuePrompt: string;
  intensiveRecommended: boolean;
};

export function calcGcm(i: GcmInputs): GcmResult {
  const monthlyBillingVelocityPerProject =
    i.avgProjectDurationMonths > 0 ? i.avgProjectSize / i.avgProjectDurationMonths : 0;
  const currentAnnualCapacity = monthlyBillingVelocityPerProject * 12 * i.currentActiveProjects;
  const realisticAnnualCapacity = monthlyBillingVelocityPerProject * 12 * i.realisticActiveProjectCapacity;
  const annualPerProjectRevenue = monthlyBillingVelocityPerProject * 12;
  const requiredActiveProjects = annualPerProjectRevenue > 0 ? i.desiredRevenue / annualPerProjectRevenue : 0;
  const signedContractsRequired = i.avgProjectSize > 0 ? i.desiredRevenue / i.avgProjectSize : 0;
  const closeRate = i.closeRatePct / 100;
  const estimatesRequired = closeRate > 0 ? signedContractsRequired / closeRate : Infinity;
  const estimateCapacity = i.estimatesSentPerMonth * 12;
  const pmCapacity = i.pms * i.avgProjectsPerPm;
  const revenueGap = i.desiredRevenue - i.currentRevenue;
  const grossProfitAttachedToGap = revenueGap * (i.avgGrossMarginPct / 100);

  // Constraint priority
  let constraint: ConstraintKey = "supportable";
  if (i.desiredRevenue <= i.currentRevenue) {
    constraint = "target_exceeded";
  } else if (estimateCapacity < estimatesRequired) {
    constraint = "estimate_throughput";
  } else if (i.qualifiedLeadsPerMonth * 12 < estimatesRequired) {
    constraint = "lead_flow";
  } else if (estimatesRequired > i.estimatesSentPerMonth * 12 * 1.5) {
    constraint = "sales_conversion";
  } else if (pmCapacity < requiredActiveProjects) {
    constraint = "project_leadership";
  } else if (i.realisticActiveProjectCapacity < requiredActiveProjects) {
    constraint = "delivery_capacity";
  }

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const playbook: Record<ConstraintKey, Omit<GcmResult,
    "monthlyBillingVelocityPerProject" | "currentAnnualCapacity" | "realisticAnnualCapacity" |
    "requiredActiveProjects" | "signedContractsRequired" | "estimatesRequired" | "estimateCapacity" |
    "pmCapacity" | "revenueGap" | "grossProfitAttachedToGap" | "constraint"
  >> = {
    target_exceeded: {
      headline: "Target already exceeded. Use a higher growth target.",
      finding: "Your desired revenue is at or below current. The constraint map needs a real growth target to be useful.",
      recommendedAction: "Reset desired revenue to a stretch number that forces the business to evolve.",
      missingSystem: "Annual planning rhythm",
      relatedAos: "Vision / VTO",
      bringOneIssuePrompt: "What revenue target would force us to build the next version of this company?",
      intensiveRecommended: false,
    },
    estimate_throughput: {
      headline: "The constraint is estimate throughput.",
      finding: `To support ${fmt(i.desiredRevenue)} you need roughly ${Math.ceil(estimatesRequired)} estimates per year. You're producing ${estimateCapacity}. You do not need more ambition — you need more estimates leaving the building.`,
      recommendedAction: "Install a weekly estimate-throughput scorecard metric and assign a single owner for estimating velocity.",
      missingSystem: "Estimating process + weekly throughput metric",
      relatedAos: "Scorecard + Process",
      bringOneIssuePrompt: "What is blocking estimates from leaving the building every week?",
      intensiveRecommended: true,
    },
    lead_flow: {
      headline: "The constraint is qualified lead flow.",
      finding: `You need ${Math.ceil(estimatesRequired)} estimate opportunities a year. Your qualified leads only produce ${i.qualifiedLeadsPerMonth * 12}. The funnel cannot feed the goal.`,
      recommendedAction: "Define what 'qualified' means, then assign weekly responsibility for qualified-lead generation.",
      missingSystem: "Lead qualification SOP + pursuit accountability",
      relatedAos: "Accountability Chart + Scorecard",
      bringOneIssuePrompt: "Who owns qualified lead generation every week, and how is it measured?",
      intensiveRecommended: false,
    },
    sales_conversion: {
      headline: "The constraint is sales conversion.",
      finding: `Your close rate would require an unrealistic estimate volume to hit ${fmt(i.desiredRevenue)}. The leakage is between estimate and signed contract.`,
      recommendedAction: "Run a proposal-by-proposal loss review for the last 12 months. Find the pattern. Fix the close.",
      missingSystem: "Win/loss review + proposal scorecard",
      relatedAos: "Process + Issues",
      bringOneIssuePrompt: "Where are we losing deals we should be winning?",
      intensiveRecommended: true,
    },
    project_leadership: {
      headline: "The constraint is project leadership capacity.",
      finding: `Hitting ${fmt(i.desiredRevenue)} requires roughly ${round1(requiredActiveProjects)} active projects. Your PMs can carry ${pmCapacity}. The business cannot lead what it cannot staff.`,
      recommendedAction: "Identify the next PM seat. Define the scorecard for that seat. Begin the hire.",
      missingSystem: "PM role scorecard + hiring plan",
      relatedAos: "Accountability Chart + People",
      bringOneIssuePrompt: "What is the next leadership seat we need, and who can fill it?",
      intensiveRecommended: true,
    },
    delivery_capacity: {
      headline: "The constraint is delivery capacity.",
      finding: `The goal needs ${round1(requiredActiveProjects)} active projects. Realistic capacity is ${i.realisticActiveProjectCapacity}. The business cannot bill more work than the operating system can carry.`,
      recommendedAction: "Map every delivery bottleneck: PM bandwidth, field crews, subs, materials, billing. Pick the top one to fix this quarter.",
      missingSystem: "Delivery capacity model + quarterly rock",
      relatedAos: "Rocks + Process",
      bringOneIssuePrompt: "What single delivery bottleneck is capping revenue right now?",
      intensiveRecommended: true,
    },
    supportable: {
      headline: "Growth target is supportable — now defend the weekly numbers.",
      finding: `Capacity, throughput, and leadership can carry ${fmt(i.desiredRevenue)}. The risk is operating drift, not structural shortage.`,
      recommendedAction: "Lock a weekly scorecard with 5–7 metrics that prove the engine is moving. Defend them every Monday.",
      missingSystem: "Weekly scorecard discipline",
      relatedAos: "Scorecard + Traction",
      bringOneIssuePrompt: "Which 5 weekly numbers prove the business is on track?",
      intensiveRecommended: false,
    },
  };

  return {
    monthlyBillingVelocityPerProject,
    currentAnnualCapacity,
    realisticAnnualCapacity,
    requiredActiveProjects,
    signedContractsRequired,
    estimatesRequired,
    estimateCapacity,
    pmCapacity,
    revenueGap,
    grossProfitAttachedToGap,
    constraint,
    ...playbook[constraint],
  };
}
