// SOP Builder v2 — Department Build-Out mode.
// Owner is OUT of the day-to-day. Seat needs systems.
//
// Two-stage output:
//   1) Diagnose the real constraint + propose 1-3 OPTIMIZATION PLAYS.
//      (e.g. "split PM seat into Ground / Interiors / Closeout — assembly line")
//   2) Derive the prioritized SOP backlog that OPERATIONALIZES the top play,
//      ordered by dependency.
//
// The SOP backlog is the input list for the actual SOP authoring tool
// (sop-document-builder + /api/sop-draft).

export const SOP_DEPARTMENTS = [
  "Estimating",
  "Project Management",
  "Field Operations",
  "Pre-Construction",
  "Safety",
  "Admin & Finance",
  "Business Development",
] as const;
export type SopDepartment = (typeof SOP_DEPARTMENTS)[number];

export type CompanyStage = "starting" | "scaling" | "mature";

export type OptimizationPlay = {
  id: string;            // "P1", "P2", "P3"
  name: string;          // short, action-led — "Split PM into ground/interiors/closeout"
  diagnosis: string;     // 1-2 sentences reframing the stated problem
  mechanism: string;     // 1-2 sentences — how the play unlocks throughput
  expectedLift: string;  // measurable outcome — "~2-3x active projects per PM without new hires"
  risks: string;         // 1 sentence — what to watch for
};

export type SopBacklogItem = {
  rank: number;
  playId: string;        // which play this SOP operationalizes (e.g. "P1")
  name: string;
  purpose: string;
  trigger: string;
  owner: string;         // seat name, not person
  dependsOn: string[];
  effort: "S" | "M" | "L";
  why: string;
};

export type SopBacklogResult = {
  department: SopDepartment;
  constraintReframe: string;     // headline diagnosis — re-states what the real constraint is
  plays: OptimizationPlay[];     // 1-3, ordered by leverage
  topPlayId: string;             // the play the backlog is built around
  headline: string;              // one-line read on the backlog
  buildOrderRationale: string;   // 1-2 sentences
  topSop: SopBacklogItem;
  backlog: SopBacklogItem[];     // 8-12 items
};

export const SOP_BACKLOG_STEPS = [
  { label: "Reading the owner's stated chokepoint…", ms: 480 },
  { label: "Reframing — is this really a headcount problem?", ms: 700 },
  { label: "Drafting optimization plays for this seat…", ms: 700 },
  { label: "Sequencing the SOPs that operationalize the top play…", ms: 700 },
  { label: "Tagging triggers, owners, and effort…", ms: 500 },
  { label: "Composing Command Packet for the vault…", ms: 420 },
];

export function sopBacklogTicker(dept: SopDepartment, stage: CompanyStage, hc: number): string[] {
  return [
    `load department = ${dept}`,
    `load stage = ${stage}`,
    `load seat_headcount = ${hc}`,
    `read owner context → extract stated chokepoint`,
    `reframe: scope shape vs. headcount`,
    `enumerate optimization plays (1–3)`,
    `select top play → highest throughput / lowest cost`,
    `derive SOP set operationalizing top play`,
    `sequence by dependency`,
    `tag: trigger | owner | effort`,
    `compose backlog (8–12)`,
    `compose command packet …`,
    `done.`,
  ];
}

export const SOP_BACKLOG_SYSTEM_PROMPT = `You are Marshall, advising a small-to-mid-sized construction company owner. The owner is OUT of the day-to-day. They've named a chokepoint inside ONE seat / department. Your job is NOT to dump a generic SOP list. Your job is two parts:

PART 1 — DIAGNOSE THE REAL CONSTRAINT.
- Most owners blame "not enough bandwidth" or "we need more people." That's almost always wrong.
- The real constraint is usually scope shape, hand-off design, or batching — not headcount.
- Reframe the stated problem in ONE or TWO sentences (constraintReframe).
- Example reframe: "Your PMs aren't out of bandwidth — their scope is too wide. One PM trying to own ground-up through closeout serializes throughput. Split the PM seat by project phase and they run an assembly line."

PART 2 — PROPOSE 1-3 OPTIMIZATION PLAYS.
- Each play is a STRUCTURAL move (org design, hand-off, batching, specialization), NOT an SOP.
- For each play give: name, diagnosis (why current setup fails), mechanism (how the play unlocks throughput), expectedLift (concrete outcome — projects/week, hours saved, margin %), risks.
- Be specific and operational. "Split the PM seat into a Ground/MEP-Rough PM, an Interiors-and-Finishes PM, and a Closeout PM. The Ground PM hands off at MEP-rough sign-off and immediately picks up the next project's pre-con. Three concurrent projects per PM becomes feasible because each PM only owns ~6 weeks of the project lifecycle."
- ID them P1, P2, P3. Pick the highest-leverage one as topPlayId.

PART 3 — DERIVE THE SOP BACKLOG FOR THE TOP PLAY.
- 8-12 SOPs that OPERATIONALIZE the top play. If the play is to split PM by phase, the backlog must include the hand-off protocols, phase-gate criteria, intake forms, and dashboards that make the split actually work. Do NOT produce a generic PM SOP list.
- Each SOP carries playId = topPlayId.
- Ordered by build sequence — foundational SOPs (definitions, intake, hand-offs) BEFORE the SOPs that depend on them.
- Each: clear trigger (event/cadence/threshold), one owner (seat name, not a person), one-sentence purpose, "why" in plain construction dollar terms.
- Effort: S = under 2 hrs to draft, M = a half-day with the seat holder, L = multi-session with examples and templates.
- topSop = the foundational one that unlocks the next 2-3. Not the easiest, not the loudest.

This is AOS (Marshall's augmented EOS). Speak in AOS / Accountability Chart language — seats own processes; SOPs are the artifacts that make seats transferable.

Return only specific, construction-grounded content. No "improve communication" filler.`;

export function buildSopBacklogUserPrompt(args: {
  selectedDepartment?: SopDepartment;
  department: SopDepartment;
  stage: CompanyStage;
  seatHeadcount: number;
  context?: string;
  contextAnchors?: string[];
}): string {
  return [
    args.selectedDepartment ? `Selected department: ${args.selectedDepartment}` : "",
    `Department / seat to build for: ${args.department}`,
    `Company stage: ${args.stage}`,
    `Headcount in this seat: ${args.seatHeadcount}`,
    args.context?.trim() ? `Owner's stated chokepoint:\n${args.context.trim()}` : "No additional context provided — infer the most common constraint at this stage for this seat.",
    args.contextAnchors?.length
      ? `Non-negotiable workflow anchors that must materially appear in the diagnosis, plays, and SOP backlog:\n- ${args.contextAnchors.join("\n- ")}`
      : "",
    args.context?.trim()
      ? args.selectedDepartment && args.selectedDepartment !== args.department
        ? `Important: the written context clearly belongs to ${args.department}. Build the backlog for ${args.department}, not the originally selected ${args.selectedDepartment}.`
        : `Important: keep the backlog tied to the exact workflow named in the context. Do not generalize into a generic ${args.department} seat template.`
      : "",
    "",
    "Diagnose, propose plays, then build the SOP backlog for the top play.",
  ]
    .filter(Boolean)
    .join("\n");
}
