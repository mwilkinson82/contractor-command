// Estimate Throughput Tracker — deterministic logic.
// Structured so an AI-generated finding could be swapped in later
// without changing the calculation layer.

export type EttInputs = {
  revenueTarget: number;       // annual $
  avgContractSize: number;     // $
  winRate: number;             // 0..1
  currentEstimatesPerWeek: number;
  workingWeeks: number;        // default 50
};

export const DEFAULT_ETT: EttInputs = {
  revenueTarget: 4_000_000,
  avgContractSize: 85_000,
  winRate: 0.32,
  currentEstimatesPerWeek: 3,
  workingWeeks: 50,
};

export type EttResult = {
  contractsNeeded: number;
  estimatesNeededAnnual: number;
  requiredEstimatesPerWeek: number;
  currentEstimatesPerWeek: number;
  deficitPerWeek: number;       // negative = short
  coveragePct: number;          // current / required
  revenueAtRisk: number;        // $ if deficit persists
  headline: string;
  finding: string;
  recommendedAction: string;
  status: "on-pace" | "tight" | "short";
};

export function calcEtt(i: EttInputs): EttResult {
  const wr = Math.max(0.01, Math.min(1, i.winRate));
  const weeks = i.workingWeeks > 0 ? i.workingWeeks : 50;
  const contractsNeeded = i.avgContractSize > 0 ? i.revenueTarget / i.avgContractSize : 0;
  const estimatesNeededAnnual = contractsNeeded / wr;
  const requiredEstimatesPerWeek = estimatesNeededAnnual / weeks;
  const deficitPerWeek = i.currentEstimatesPerWeek - requiredEstimatesPerWeek;
  const coveragePct = requiredEstimatesPerWeek > 0
    ? i.currentEstimatesPerWeek / requiredEstimatesPerWeek
    : 1;

  const status: EttResult["status"] =
    coveragePct >= 1 ? "on-pace" : coveragePct >= 0.85 ? "tight" : "short";

  const revenueAtRisk = deficitPerWeek < 0
    ? Math.abs(deficitPerWeek) * weeks * wr * i.avgContractSize
    : 0;

  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const wk = (n: number) => `${n.toFixed(1)}/wk`;

  let headline: string;
  let finding: string;
  let recommendedAction: string;

  if (status === "on-pace") {
    headline = `Estimate volume is keeping up with the ${money(i.revenueTarget)} target.`;
    finding = `At ${(wr * 100).toFixed(0)}% win rate, you need ${wk(requiredEstimatesPerWeek)} estimates to hit the target. You're sending ${wk(i.currentEstimatesPerWeek)} — ${Math.round((coveragePct - 1) * 100)}% of cushion.`;
    recommendedAction = `Hold the cadence. Watch close rate and average contract size — those are the next levers, not volume.`;
  } else if (status === "tight") {
    headline = `Estimate throughput is tight — running ${Math.round(coveragePct * 100)}% of what the target requires.`;
    finding = `Required: ${wk(requiredEstimatesPerWeek)}. Current: ${wk(i.currentEstimatesPerWeek)}. Short by ${Math.abs(deficitPerWeek).toFixed(1)}/wk. If this holds, you're risking ${money(revenueAtRisk)} against the ${money(i.revenueTarget)} target.`;
    recommendedAction = `Add ${Math.ceil(Math.abs(deficitPerWeek))} estimate(s) per week, or raise close rate above ${((coveragePct * wr * 100)).toFixed(0)}% to close the gap without more volume.`;
  } else {
    headline = `Estimate volume can't carry the ${money(i.revenueTarget)} revenue target.`;
    finding = `You need ${wk(requiredEstimatesPerWeek)} estimates at your ${(wr * 100).toFixed(0)}% win rate. You're sending ${wk(i.currentEstimatesPerWeek)} — a shortfall of ${Math.abs(deficitPerWeek).toFixed(1)}/wk. At this pace, ~${money(revenueAtRisk)} of contracted revenue won't appear.`;
    recommendedAction = `Either add estimating capacity (you're short ${Math.ceil(Math.abs(deficitPerWeek))}/wk) or pull the revenue target down to ${money(i.currentEstimatesPerWeek * weeks * wr * i.avgContractSize)} — the number current throughput actually supports.`;
  }

  return {
    contractsNeeded,
    estimatesNeededAnnual,
    requiredEstimatesPerWeek,
    currentEstimatesPerWeek: i.currentEstimatesPerWeek,
    deficitPerWeek,
    coveragePct,
    revenueAtRisk,
    headline,
    finding,
    recommendedAction,
    status,
  };
}

/** Pseudo-token stream for the compute theater ticker.
 *  Pulled from the actual calculation so it feels grounded, not random. */
export function ettTickerLines(i: EttInputs, r: EttResult): string[] {
  return [
    `load inputs.revenue_target = $${i.revenueTarget.toLocaleString()}`,
    `load inputs.avg_contract = $${i.avgContractSize.toLocaleString()}`,
    `load inputs.win_rate = ${(i.winRate * 100).toFixed(1)}%`,
    `load inputs.current_throughput = ${i.currentEstimatesPerWeek}/wk`,
    `derive contracts_needed = revenue_target / avg_contract`,
    `  → ${r.contractsNeeded.toFixed(1)} contracts/yr`,
    `derive estimates_needed = contracts_needed / win_rate`,
    `  → ${r.estimatesNeededAnnual.toFixed(0)} estimates/yr`,
    `derive required_throughput = estimates_needed / ${i.workingWeeks}wk`,
    `  → ${r.requiredEstimatesPerWeek.toFixed(2)}/wk`,
    `compare current vs required`,
    `  → coverage = ${(r.coveragePct * 100).toFixed(0)}%`,
    `  → deficit = ${r.deficitPerWeek.toFixed(2)}/wk`,
    r.deficitPerWeek < 0
      ? `project revenue_at_risk = |deficit| * weeks * win_rate * avg_contract`
      : `project cushion held — no revenue at risk`,
    r.deficitPerWeek < 0
      ? `  → $${Math.round(r.revenueAtRisk).toLocaleString()}`
      : `  → $0`,
    `rank finding by financial leverage`,
    `compose command packet …`,
    `done.`,
  ];
}
