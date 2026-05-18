// Margin Leak Finder — deterministic logic.
// Given annual revenue, target vs actual gross margin, and the suspected
// top leak source, computes annual $ leak and recommends the single next move.

export const LEAK_SOURCES = [
  "Labor overruns in the field",
  "Material waste / pricing slip",
  "Change orders not captured or billed",
  "Subcontractor cost creep",
  "Schedule slip / extended GC's",
  "Estimating misses (scope or quantities)",
] as const;
export type LeakSource = (typeof LEAK_SOURCES)[number];

export type MarginLeakInputs = {
  annualRevenue: number;       // $
  targetMarginPct: number;     // 0..1
  actualMarginPct: number;     // 0..1
  topLeakSource: LeakSource;
  projectsAffected: number;    // out of last 10
  avgProjectSize: number;      // $
};

export const DEFAULT_MARGIN_LEAK: MarginLeakInputs = {
  annualRevenue: 4_000_000,
  targetMarginPct: 0.22,
  actualMarginPct: 0.16,
  topLeakSource: "Labor overruns in the field",
  projectsAffected: 6,
  avgProjectSize: 350_000,
};

export type MarginLeakResult = {
  gapPct: number;             // target - actual (can be negative if beating target)
  annualLeak: number;         // $
  perProjectLeak: number;     // $ on average project size
  recoveryAt50Pct: number;    // $ if you close half the gap
  status: "bleeding" | "leaking" | "tight" | "ahead";
  headline: string;
  finding: string;
  recommendedAction: string;
};

export function calcMarginLeak(i: MarginLeakInputs): MarginLeakResult {
  const target = clamp(i.targetMarginPct, 0, 1);
  const actual = clamp(i.actualMarginPct, 0, 1);
  const gapPct = target - actual;
  const annualLeak = Math.max(0, gapPct) * Math.max(0, i.annualRevenue);
  const perProjectLeak = Math.max(0, gapPct) * Math.max(0, i.avgProjectSize);
  const recoveryAt50Pct = annualLeak * 0.5;

  const status: MarginLeakResult["status"] =
    gapPct <= 0 ? "ahead"
    : gapPct < 0.02 ? "tight"
    : gapPct < 0.05 ? "leaking"
    : "bleeding";

  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const sourceMove = RECOMMENDED_MOVE[i.topLeakSource];

  let headline: string;
  let finding: string;
  let recommendedAction: string;

  if (status === "ahead") {
    headline = `You're beating your ${pct(target)} margin target.`;
    finding = `Actual margin (${pct(actual)}) is at or above target. The leak is theoretical right now — the real question is whether the win is repeatable or whether one fat job is hiding leaks elsewhere.`;
    recommendedAction = `Audit your three most profitable jobs from the last 12 months. If the win came from one outlier, raise the target to ${pct(target + 0.02)} and re-run.`;
  } else if (status === "tight") {
    headline = `Margin is slipping ${pct(gapPct)} below target — about ${money(annualLeak)}/yr.`;
    finding = `You're within striking distance (${pct(actual)} actual vs ${pct(target)} target). At ${i.projectsAffected}/10 jobs showing the pattern, ${i.topLeakSource.toLowerCase()} is the lever. Closing half the gap recovers ${money(recoveryAt50Pct)}.`;
    recommendedAction = sourceMove;
  } else if (status === "leaking") {
    headline = `Margin is leaking ${pct(gapPct)} — about ${money(annualLeak)}/yr off the table.`;
    finding = `Target ${pct(target)}, actual ${pct(actual)}. On an average ${money(i.avgProjectSize)} project, that's ${money(perProjectLeak)} per job. ${i.projectsAffected}/10 jobs show ${i.topLeakSource.toLowerCase()} — that's the structural leak, not bad luck.`;
    recommendedAction = sourceMove;
  } else {
    headline = `Margin is bleeding — ${pct(gapPct)} gap is roughly ${money(annualLeak)}/yr.`;
    finding = `You're running ${pct(actual)} against a ${pct(target)} target. At ${i.projectsAffected}/10 jobs hit, ${i.topLeakSource.toLowerCase()} is no longer a one-off — it's the operating pattern. Per typical job, that's ${money(perProjectLeak)} you don't get back.`;
    recommendedAction = sourceMove + ` This is the single biggest dollar lever in the business right now — don't queue it behind anything else.`;
  }

  return {
    gapPct,
    annualLeak,
    perProjectLeak,
    recoveryAt50Pct,
    status,
    headline,
    finding,
    recommendedAction,
  };
}

const RECOMMENDED_MOVE: Record<LeakSource, string> = {
  "Labor overruns in the field":
    "Require daily hours-vs-budget by phase from PMs. If hours can't be seen mid-job, they can't be saved.",
  "Material waste / pricing slip":
    "Lock 30-day pricing on the top 5 materials by spend and require a single buyer's signoff on substitutions.",
  "Change orders not captured or billed":
    "Block field crews from starting any out-of-scope work without a signed change order in writing — even verbal-OK = stop.",
  "Subcontractor cost creep":
    "Re-bid your top 3 sub trades for the next two jobs. Standing relationships are where creep hides.",
  "Schedule slip / extended GC's":
    "Tighten the front-loaded schedule and add a weekly look-ahead with PM + super. Every week over plan is GC's burning margin.",
  "Estimating misses (scope or quantities)":
    "Run a takeoff post-mortem on the last 3 jobs. Compare estimated vs actual quantities by line item — patterns will jump.",
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export const MARGIN_LEAK_STEPS = [
  { label: "Loading revenue, target margin, and actual margin…", ms: 360 },
  { label: "Computing margin gap and annual dollar exposure…", ms: 420 },
  { label: "Mapping leak source to operational cause…", ms: 420 },
  { label: "Projecting recovery if half the gap is closed…", ms: 380 },
  { label: "Composing Command Packet for the vault…", ms: 360 },
];

export function marginLeakTicker(i: MarginLeakInputs, r: MarginLeakResult): string[] {
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return [
    `load inputs.annual_revenue = ${money(i.annualRevenue)}`,
    `load inputs.target_margin = ${(i.targetMarginPct * 100).toFixed(1)}%`,
    `load inputs.actual_margin = ${(i.actualMarginPct * 100).toFixed(1)}%`,
    `load inputs.leak_source = ${i.topLeakSource}`,
    `load inputs.projects_affected = ${i.projectsAffected}/10`,
    `derive gap = target - actual`,
    `  → ${(r.gapPct * 100).toFixed(2)}%`,
    `derive annual_leak = gap * annual_revenue`,
    `  → ${money(r.annualLeak)}/yr`,
    `derive per_project_leak = gap * avg_project_size`,
    `  → ${money(r.perProjectLeak)}/project`,
    `project recovery if 50% of gap closed`,
    `  → ${money(r.recoveryAt50Pct)}/yr`,
    `rank leak source by leverage`,
    `compose command packet …`,
    `done.`,
  ];
}
