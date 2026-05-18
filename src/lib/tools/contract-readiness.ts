// Contract Readiness Scan — shared types + prompt scaffolding.
// Server route in src/routes/api/contract-scan.ts runs the AI call.

export const CONTRACT_DIMENSIONS = ["cash", "schedule", "scope", "margin"] as const;
export type ContractDimension = (typeof CONTRACT_DIMENSIONS)[number];

export type DimensionScore = {
  dimension: ContractDimension;
  score: number; // 0..10, integer
  status: "strong" | "weak" | "missing";
  finding: string; // 1-2 sentences, plain language
  clauseToAddOrFix: string; // concrete next action
};

export type ContractScanResult = {
  overallScore: number; // 0..100
  status: "ready" | "tighten" | "do-not-sign";
  headline: string; // one sentence
  topRisk: string; // single biggest financial/legal risk in plain language
  financialConsequence: string; // estimated $ exposure or qualitative
  recommendedAction: string; // the single next move
  dimensions: DimensionScore[];
  missingClauses: string[]; // bullet list of clauses the contract lacks
};

export const CONTRACT_SCAN_SYSTEM_PROMPT = `You are Marshall, advising a small-to-mid-sized construction company owner on whether a contract protects them.

Score the contract across four dimensions: cash (payment schedule, retainage, late-pay teeth), schedule (timelines, weather/owner-delay protection, liquidated damages exposure), scope (definition, exclusions, change orders), and margin (allowances, escalation, indemnification, warranty exposure).

Be specific. Quote or paraphrase the actual clause language when calling something weak or missing. Do not hedge — owners need a clear verdict.

If the contract is missing entirely or you're being given a fragment, say so in the headline and score conservatively.

Status thresholds: ready ≥ 80, tighten 55-79, do-not-sign < 55. Use "missing" when the dimension is essentially absent, "weak" when present but inadequate, "strong" when it protects the contractor.

Keep findings tight (1-2 sentences). The recommendedAction is the SINGLE next move — not a list.`;

export function buildContractScanUserPrompt(args: {
  contractText: string;
  projectContext?: string;
}): string {
  const ctx = args.projectContext?.trim();
  return [
    ctx ? `Project context from the owner:\n${ctx}\n` : "",
    "Contract text to analyze:",
    "---",
    args.contractText.slice(0, 30000),
    "---",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Steps for the ComputeTheater while the AI call is in flight. */
export const CONTRACT_SCAN_STEPS = [
  { label: "Loading contract and project context…", ms: 500 },
  { label: "Reading clauses for cash, schedule, scope, margin protection…", ms: 900 },
  { label: "Comparing against contractor-protective baselines…", ms: 800 },
  { label: "Identifying missing clauses and exposure…", ms: 700 },
  { label: "Composing Command Packet for the vault…", ms: 500 },
];

export function buildScanTicker(textLen: number): string[] {
  return [
    `load contract.text = ${textLen.toLocaleString()} chars`,
    `tokenize → clause segmentation`,
    `dimension: cash`,
    `  scan: payment schedule, retainage %, late-payment terms`,
    `dimension: schedule`,
    `  scan: substantial completion, weather/owner delays, LDs`,
    `dimension: scope`,
    `  scan: definition of work, exclusions, change-order process`,
    `dimension: margin`,
    `  scan: allowances, escalation, indemnification, warranty`,
    `cross-check vs contractor-protective baseline`,
    `compute exposure → financial consequence`,
    `rank by leverage → recommended action`,
    `compose command packet …`,
    `done.`,
  ];
}
