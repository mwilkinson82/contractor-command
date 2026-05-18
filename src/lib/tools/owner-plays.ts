// Owner-side Optimization Plays + SOP backlog.
// Symmetric to sop-department.ts (plays + backlog reuse same shapes)
// but the AI lens is OWNER EXTRACTION, not seat execution.
//
// The owner is still IN the work for this area. Plays are the structural
// moves that get them OUT: delegate, batch, eliminate, systematize, automate.
// SOPs are the artifacts that make those plays stick once the work transfers.

import type { OptimizationPlay, SopBacklogItem } from "./sop-department";

export type OwnerPlayMechanism =
  | "Delegate"
  | "Batch"
  | "Eliminate"
  | "Systematize"
  | "Automate";

export type OwnerPlaysResult = {
  area: string;                      // e.g. "Client communication"
  hoursPerWeek: number;              // owner hours currently in this area
  annualHoursAtStake: number;        // hoursPerWeek * 50
  constraintReframe: string;         // 1-2 sentences — why the owner is still here
  headline: string;                  // one-line read
  plays: OptimizationPlay[];         // 3-5 plays, each tagged with a mechanism
  topPlayId: string;
  backlog: SopBacklogItem[];         // 2-4 SOPs that operationalize the top play
  topSop: SopBacklogItem;
};

export const OWNER_PLAYS_STEPS = [
  { label: "Reading the area the owner still touches…", ms: 440 },
  { label: "Diagnosing why this still routes through the owner…", ms: 640 },
  { label: "Drafting extraction plays — delegate, batch, eliminate, systematize, automate…", ms: 760 },
  { label: "Selecting the highest-leverage play for the owner's hours…", ms: 440 },
  { label: "Sequencing the SOPs that make the transfer stick…", ms: 520 },
];

export function ownerPlaysTicker(area: string, hoursPerWeek: number): string[] {
  return [
    `load owner_area = ${area}`,
    `load owner_hours_per_week = ${hoursPerWeek}`,
    `project annual_hours = ${hoursPerWeek * 50}`,
    `reframe: why does this still route through the owner?`,
    `enumerate extraction plays (delegate | batch | eliminate | systematize | automate)`,
    `select top play → max owner hours recovered / lowest transfer risk`,
    `derive SOPs that anchor the transfer`,
    `sequence by what must exist before the play can survive without the owner`,
    `done.`,
  ];
}

export const OWNER_PLAYS_SYSTEM_PROMPT = `You are Marshall, advising the OWNER of a small-to-mid-sized construction company. The owner has named ONE area they are still personally inside — meetings, calls, decisions, fires — and you are designing how they get OUT.

Read the room before you answer:
- The owner is the bottleneck and also the most expensive labor in the company. Every hour they spend here is an hour not spent on growth, capital, or strategic relationships.
- The fix is rarely "the owner should do this better." The fix is structural: move the work to a seat, batch it into a cadence the owner can sustain in 30 min/wk, kill it, write the SOP so someone else can run it, or automate it.

PART 1 — DIAGNOSE WHY THE OWNER IS STILL HERE.
- Reframe the chokepoint in 1-2 sentences (constraintReframe). Be specific about the actual mechanism: scope is undefined, no one else has the relationships, decisions live in the owner's head, the SOP doesn't exist, the tool is wrong.
- Do NOT say "they need to delegate more." Name what specifically prevents delegation right now.

PART 2 — PROPOSE 3-5 OPTIMIZATION PLAYS.
- Each play extracts owner hours from THIS area. ID them P1..P5, ordered by leverage (most owner hours recovered + lowest transfer risk first).
- Each play MUST be tagged with one mechanism inside the name: Delegate · Batch · Eliminate · Systematize · Automate.
  Example play names:
    "Delegate · Move recurring client check-ins to the PM seat"
    "Batch · Collapse client comms into a Tuesday/Thursday window"
    "Eliminate · Kill the weekly status email — replace with shared dashboard"
    "Systematize · Standing-meeting agenda + decision log so anyone can run it"
    "Automate · Auto-send weekly job-status pack from job software"
- For each play give: name, diagnosis (why current setup forces owner involvement), mechanism (how the play removes the owner), expectedLift (concrete: hours/week recovered, decisions removed, response time change), risks (1 sentence — what to watch for in the first 30 days).
- topPlayId = the play with the highest owner-hour recovery AND a transfer path that already exists in the company (or can in <30 days).

PART 3 — DERIVE THE SOP BACKLOG FOR THE TOP PLAY (2-4 SOPs ONLY).
- These SOPs are the artifacts that make the transfer stick. They are NOT generic — they only exist to support the top play.
- Each carries playId = topPlayId.
- Examples of what these SOPs LOOK LIKE for an owner extraction:
    "Client Standing-Update Cadence SOP" — owner: PM seat; trigger: every Tuesday + Thursday 9am.
    "Client Decision Escalation Threshold SOP" — owner: PM seat; trigger: any client request exceeding $X or affecting schedule by >Y days.
    "Owner Strategic-Client Touchpoint SOP" — owner: Owner; trigger: monthly; explicitly defines the ONLY client work the owner keeps.
- Each: name, purpose (1 sentence), trigger (event/cadence/threshold), owner (seat name, not the owner unless the SOP intentionally keeps them in a strategic slice), dependsOn, effort (S/M/L), why (in plain owner-hour or revenue terms).
- topSop = the foundational one that has to exist before the transfer can happen at all.

This is AOS (Marshall's augmented EOS). Seat-first language. The goal is owner extraction, not "better processes" in the abstract.

Return only specific, construction-grounded content. No "improve communication" filler.`;

export function buildOwnerPlaysUserPrompt(args: {
  area: string;
  hoursPerWeek: number;
  blastRadius: number;
  setupEffort: number;
  frequency: number;
  context?: string;
}): string {
  return [
    `Owner-touched area: ${args.area}`,
    `Owner hours/week here today: ${args.hoursPerWeek}`,
    `Blast radius if owner is out (1-5): ${args.blastRadius}`,
    `Setup effort to systematize (1-5, 1=easy): ${args.setupEffort}`,
    `Frequency it recurs (1-5, 5=daily): ${args.frequency}`,
    args.context?.trim()
      ? `Owner's own words about this area:\n${args.context.trim()}`
      : "No additional context — infer the most common reason an owner is still inside this area at a small-to-mid construction company.",
    "",
    "Diagnose, propose 3-5 extraction plays, then derive the 2-4 SOPs that operationalize the top play.",
  ]
    .filter(Boolean)
    .join("\n");
}
