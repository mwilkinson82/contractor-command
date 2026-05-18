// SOP Builder v2 — Department Build-Out mode.
// Owner is already out of the work. A seat holder (Estimator, PM, Field
// Ops Manager, etc.) needs a prioritized SOP backlog for THEIR silo —
// ordered by dependency, not by what annoys them.
//
// AI generates the backlog. Server route at src/routes/api/sop-backlog.ts.

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

export type SopBacklogItem = {
  rank: number;
  name: string;          // SOP name, e.g. "Bid scope baseline review"
  purpose: string;       // one sentence — why this SOP exists
  trigger: string;       // what kicks it off (event, cadence, threshold)
  owner: string;         // who runs it day-to-day (seat name, not person)
  dependsOn: string[];   // names of prior SOPs that should exist first
  effort: "S" | "M" | "L"; // rough authoring effort
  why: string;           // 1 sentence — what breaks today without this
};

export type SopBacklogResult = {
  department: SopDepartment;
  headline: string;          // one-line read on the backlog
  buildOrderRationale: string; // 1-2 sentences on the sequence
  topSop: SopBacklogItem;    // the first one to write
  backlog: SopBacklogItem[]; // 8-12 items, ordered
};

export const SOP_BACKLOG_STEPS = [
  { label: "Mapping the seat's accountabilities…", ms: 480 },
  { label: "Listing every recurring process this seat owns…", ms: 700 },
  { label: "Sequencing by dependency — what must exist first…", ms: 700 },
  { label: "Tagging triggers, owners, and effort…", ms: 600 },
  { label: "Composing Command Packet for the vault…", ms: 420 },
];

export function sopBacklogTicker(dept: SopDepartment, stage: CompanyStage, hc: number): string[] {
  return [
    `load department = ${dept}`,
    `load stage = ${stage}`,
    `load seat_headcount = ${hc}`,
    `enumerate accountabilities for seat`,
    `expand: recurring processes`,
    `score: dependency depth`,
    `sort by build_order`,
    `tag: trigger | owner | effort`,
    `compose backlog (8–12)`,
    `select top SOP → highest leverage / lowest dependency`,
    `compose command packet …`,
    `done.`,
  ];
}

export const SOP_BACKLOG_SYSTEM_PROMPT = `You are Marshall, advising a small-to-mid-sized construction company owner on building out the SOP stack for a specific department/seat. The owner is OUT of the day-to-day; the seat holder (e.g. Estimator, PM, Field Ops Manager) needs a prioritized SOP backlog for THEIR silo — ordered by dependency, not by what annoys them.

This is AOS (Marshall's augmented EOS). Speak in AOS / Accountability Chart language — seats own processes; SOPs are the artifacts that make seats transferable.

For the given department, produce a backlog of 8-12 SOPs that:
- Are scoped to ONE seat's accountabilities (not cross-department workflows the seat merely participates in).
- Are ordered by build sequence: foundational SOPs (definitions, intake, hand-offs) come BEFORE the SOPs that depend on them. Example: a change-order pricing SOP depends on a scope-baseline SOP existing first.
- Each SOP has a clear trigger (event / cadence / threshold), one owner (seat name), and a one-sentence purpose.
- "why" describes what breaks today without it — in plain construction terms, dollar logic preferred.
- Effort: S = under 2 hours to draft, M = a half-day with the seat holder, L = multi-session with examples and templates.

Choose the topSop deliberately — it should be the foundational one that unlocks the next 2-3 in the backlog. Not the easiest, not the loudest. The one whose absence is currently causing the most rework or risk in that seat.

Return only specific, construction-grounded SOP names. No generic "standardize communication" filler.`;

export function buildSopBacklogUserPrompt(args: {
  department: SopDepartment;
  stage: CompanyStage;
  seatHeadcount: number;
  context?: string;
}): string {
  return [
    `Department / seat: ${args.department}`,
    `Company stage: ${args.stage}`,
    `Headcount in this seat: ${args.seatHeadcount}`,
    args.context?.trim() ? `Owner context:\n${args.context.trim()}` : "",
    "",
    "Produce the prioritized SOP backlog for this seat.",
  ]
    .filter(Boolean)
    .join("\n");
}
