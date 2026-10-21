// Phase 5: job cost ledger and over/under billing.
// D5: fade is the alert color when cost% runs more than 5 points ahead of billed% (line or job).
// D7: files are Excel by default; a Google Sheet only when Drive is connected and the user asks.
// D8: over/under billing is cost-to-cost: earned = contract × cost to date ÷ estimated total cost.
// Integer cents, zero tolerance: any tie that misses by even $0.01 blocks the save.
import { ALERT_COLOR } from "../alert-color";
import { divHalfUp, fmt, sum } from "./cents";

export type LedgerLine = { code: string; description: string; contract: number; estimate: number; cost_to_date: number; billed_to_date: number };
export type CostRow = { code: string; amount: number; date: string; vendor?: string; ref?: string };
export type LedgerInput = {
  contract_sum: number; // original + approved COs (G702 line 3)
  lines: LedgerLine[];
  costs: CostRow[]; // the import
  import_control_total: number; // the total printed on the accounting export
  certified_billed_to_date: number; // last certified pay app, G702 line 4
  certified_retainage: number; // last certified pay app, G702 line 5
  retainage_held: number;
  estimate_total: number; // the approved budget on file
};

export const FADE_POINTS_BP = 500; // D5: 5 points
/** Percent of a over b in basis points (half up); 0 when b is 0. */
export const pctBp = (a: number, b: number) => (b > 0 ? divHalfUp(a * 10000, b) : 0);
export const earnedCostToCost = (contract: number, cost: number, estimate: number) => (estimate > 0 ? divHalfUp(contract * cost, estimate) : 0);

export function fade(l: Pick<LedgerLine, "estimate" | "cost_to_date" | "contract" | "billed_to_date">) {
  const costBp = pctBp(l.cost_to_date, l.estimate);
  const billedBp = pctBp(l.billed_to_date, l.contract);
  const ahead = costBp - billedBp;
  return { cost_bp: costBp, billed_bp: billedBp, ahead_bp: ahead, alert: ahead > FADE_POINTS_BP };
}

export type Tie = { id: string; label: string; left: number; right: number; ok: boolean; diff: number };
const tie = (id: string, label: string, left: number, right: number): Tie => ({ id, label, left, right, ok: left === right, diff: left - right });

export function ledgerMath(x: LedgerInput) {
  const byCode = new Map<string, number>();
  for (const c of x.costs) byCode.set(c.code, (byCode.get(c.code) ?? 0) + c.amount);
  const unknown = [...byCode.keys()].filter((k) => !x.lines.some((l) => l.code === k));
  const lines = x.lines.map((l) => ({ ...l, ...fade(l), earned: earnedCostToCost(l.contract, l.cost_to_date, l.estimate) }));
  const contract = sum(lines.map((l) => l.contract));
  const estimate = sum(lines.map((l) => l.estimate));
  const cost = sum(lines.map((l) => l.cost_to_date));
  const billed = sum(lines.map((l) => l.billed_to_date));
  const earned = earnedCostToCost(x.contract_sum, cost, estimate);
  const over = billed - earned;
  const ties: Tie[] = [
    tie("T1", "Import rows = accounting control total", sum(x.costs.map((c) => c.amount)), x.import_control_total),
    tie("T2", "Import by cost code = ledger cost to date", sum([...byCode.values()]), cost),
    tie("T3", "Line contract values = contract sum to date", contract, x.contract_sum),
    tie("T4", "Ledger billed to date = last certified pay app (G702 line 4)", billed, x.certified_billed_to_date),
    tie("T5", "Retainage held = last certified pay app (G702 line 5)", x.retainage_held, x.certified_retainage),
    tie("T6", "Every imported cost code is on the ledger", unknown.length, 0),
    tie("T7", "Line estimates = approved budget on file", estimate, x.estimate_total),
  ];
  for (const l of lines) { const c = byCode.get(l.code) ?? 0; if (c !== l.cost_to_date) ties.push(tie(`T2.${l.code}`, `Cost code ${l.code} import = ledger`, c, l.cost_to_date)); }
  const job = { contract: x.contract_sum, estimate, cost, billed, earned, over_under: over, ...fade({ estimate, cost_to_date: cost, contract: x.contract_sum, billed_to_date: billed }) };
  const blocks = ties.filter((t) => !t.ok).map((t) => (t.id === "T6" ? `T6: cost codes not on the ledger: ${unknown.join(", ")}.` : `${t.id} ${t.label} misses by ${fmt(Math.abs(t.diff))}. Zero tolerance; nothing can be saved until it ties.`));
  return { lines, job, ties, blocks, unknown_codes: unknown };
}

export const overUnderLabel = (c: number) => (c > 0 ? `Overbilled ${fmt(c)}` : c < 0 ? `Underbilled ${fmt(-c)}` : "Even");

export type FileChoice = { format: "xlsx" | "google_sheet"; reason: string };
/** D7: Excel unless Drive is connected AND the user asked for a Google Sheet. */
export function fileFormat(driveConnected: boolean, askedForSheet: boolean): FileChoice {
  if (askedForSheet && driveConnected) return { format: "google_sheet", reason: "Drive is connected and you asked for a Google Sheet." };
  if (askedForSheet) return { format: "xlsx", reason: "Google Drive isn't connected, so here is the Excel file. Connect Drive to get a Google Sheet." };
  return { format: "xlsx", reason: "Excel by default." };
}

export const LEDGER_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – JOB COST LEDGER: navy header bar \"Job Cost Ledger · <job> · v<n> · Last updated <stamp>\".",
  "1. Summary cards: contract, estimate, cost to date, billed to date, earned (cost-to-cost), over/under.",
  `2. Lines: code, description, contract, estimate, cost to date, cost %, billed %, earned, fade. A fade more than 5 points (cost % ahead of billed %) is ${ALERT_COLOR}; everything else navy, blue #2563EB and gray.`,
  `3. Ties T1–T7 with a check or the miss amount. Any miss is a block in ${ALERT_COLOR}: zero tolerance.`,
  "4. File: <job>-Ledger-<date>.xlsx (Lines, Costs, Ties tabs) by default; a Google Sheet only when Drive is connected and the user asks.",
];
