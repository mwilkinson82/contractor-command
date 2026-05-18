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

export type MissingClause = {
  /** Short name of the missing clause, e.g. "Notice of delay". */
  name: string;
  /** Why this clause matters to the contractor in plain language. */
  whyItMatters: string;
  /**
   * Contractor-protective starting language the owner can drop in or
   * hand to counsel. Plain contract voice, not legal advice.
   */
  sampleLanguage: string;
  /**
   * 2-3 bullets the owner can use at the table — framed as mutual
   * risk allocation, with the dollar logic behind the ask.
   */
  talkingPoints: string[];
};

export type ContractScanResult = {
  overallScore: number; // 0..100
  status: "ready" | "tighten" | "do-not-sign";
  headline: string; // one sentence
  topRisk: string; // single biggest financial/legal risk in plain language
  financialConsequence: string; // estimated $ exposure or qualitative
  recommendedAction: string; // the single next move
  dimensions: DimensionScore[];
  missingClauses: MissingClause[]; // structured, with sample language + talking points
};

export const CONTRACT_SCAN_SYSTEM_PROMPT = `You are Marshall, advising a small-to-mid-sized construction company owner on whether a contract protects them.

Score the contract across four dimensions: cash, schedule, scope, and margin. Use the construction-specific clause checklist below to decide what's strong, weak, or missing. Quote or paraphrase the actual clause language when you call something out — owners need specifics, not platitudes.

CONSTRUCTION CLAUSE CHECKLIST (every contract should address these):
- Mutual rights and responsibilities — both parties' obligations spelled out, not one-sided.
- Clear scope of work — what's in, what's out, exclusions explicit.
- Liability insurance requirements — limits, additional insureds, waiver of subrogation.
- Payment terms — schedule, retainage %, draws tied to milestones.
- Schedule — start, substantial completion, owner-caused delay protection, weather/force majeure.
- Milestones — defined progress points tied to payment.
- Dispute resolution clause — mediation/arbitration venue, prevailing-party fees.
- Notice requirements — written notice, timeframes, delivery method for claims and changes.
- CPM (Critical Path Method) schedule requirements — if required, who maintains, update cadence.
- Pay-when-paid vs. pay-if-paid — flag pay-if-paid as a major contractor risk.
- Interest on late invoices — rate and trigger date.
- Contingencies — allowance handling, unforeseen conditions, escalation.
- Change order process — pricing method, approval authority, timing.
- Indemnification — mutual vs. broad-form, limited to contractor's negligence.
- Warranty exposure — duration, scope, exclusions.
- Termination — for cause / for convenience, payment for work performed.

Map findings to dimensions: cash (payment terms, pay-when-paid vs pay-if-paid, interest, retainage), schedule (milestones, CPM, notice, weather/owner-delay, LDs), scope (scope clarity, change orders, exclusions, contingencies), margin (allowances, escalation, indemnification, warranty, insurance).

Be specific. Do not hedge. If a fragment is given, say so in the headline and score conservatively.

For EACH missing clause: draft contractor-protective sample language the owner can hand to counsel as a starting point (plain contract voice, 2-5 sentences, not legal advice), plus 2-3 negotiation talking points framed as mutual risk allocation with the dollar logic behind the ask — never adversarial.

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
  { label: "Drafting sample language + negotiation talking points…", ms: 700 },
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
    `for each missing clause:`,
    `  draft sample language (contractor-protective)`,
    `  derive negotiation talking points`,
    `compute exposure → financial consequence`,
    `rank by leverage → recommended action`,
    `compose command packet …`,
    `done.`,
  ];
}
