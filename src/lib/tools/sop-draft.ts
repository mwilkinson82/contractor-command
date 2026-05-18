// SOP Document Builder — turns a backlog item into a real, editable SOP.
// AI drafts; user edits; output goes to vault / email / PDF.

export type SopStep = {
  number: number;
  action: string;       // the actual step — imperative voice
  detail?: string;      // optional clarification, examples, edge cases
};

export type SopDocument = {
  title: string;                    // e.g. "Pre-Con Hand-off Protocol"
  department: string;
  owner: string;                    // seat that runs this SOP
  purpose: string;                  // 1-2 sentences — why this SOP exists
  scope: string;                    // what's IN scope and what's NOT
  trigger: string;                  // exact event/cadence that fires the SOP
  inputs: string[];                 // documents, signals, artifacts needed to start
  steps: SopStep[];                 // numbered procedure — 6-14 steps
  outputs: string[];                // tangible deliverables produced
  definitionOfDone: string;         // how you know it succeeded
  kpis: string[];                   // metrics that prove it's working
  exceptions: string[];             // edge cases / escalation paths
  revisionCadence: string;          // when to re-review this SOP
};

export const SOP_DRAFT_SYSTEM_PROMPT = `You are Marshall, drafting a real, runnable SOP for a construction company. This is NOT a high-level idea — it's the document a seat-holder reads on day one and runs the next morning.

Rules:
- Steps are imperative and concrete. "Open the Pre-Con folder in SharePoint, copy the Bid Recap PDF into /02_Handoff, verify the scope-of-work tab on row 12 matches the contract Exhibit A." NOT "Review documents."
- 6 to 14 steps. Each step has a clear single action. Use "detail" for examples, edge cases, or thresholds — not for filler.
- Inputs and outputs are tangible artifacts (forms, files, sign-offs), not vibes.
- Definition of Done is testable in under 30 seconds by an outsider.
- KPIs are 2-4 measurable signals (lead time, defect rate, rework hours, $ recovered).
- Exceptions: name the 2-3 real edge cases that will happen in the first 90 days and where they escalate.
- Speak construction-native. Reference real tools (Procore, Bluebeam, BuilderTrend, Acumatica, SharePoint) when relevant, but don't invent a stack the user didn't mention.

This SOP must be specific enough that the owner can hand it to a new seat-holder and the work gets done the same way every time.`;

export function buildSopDraftPrompt(args: {
  sopName: string;
  purpose: string;
  trigger: string;
  owner: string;
  department: string;
  parentPlay?: { name: string; mechanism: string };
  context?: string;
}): string {
  return [
    `Department: ${args.department}`,
    `Seat / owner: ${args.owner}`,
    `SOP name: ${args.sopName}`,
    `Stated purpose: ${args.purpose}`,
    `Trigger: ${args.trigger}`,
    args.parentPlay
      ? `Parent optimization play: ${args.parentPlay.name}\nMechanism: ${args.parentPlay.mechanism}`
      : "",
    args.context?.trim() ? `Owner context:\n${args.context.trim()}` : "",
    "",
    "Draft the full SOP document.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const SOP_DRAFT_STEPS = [
  { label: "Scoping the SOP to the seat's authority…", ms: 420 },
  { label: "Drafting purpose, scope, trigger…", ms: 540 },
  { label: "Writing the runnable procedure…", ms: 900 },
  { label: "Wiring inputs, outputs, definition of done…", ms: 600 },
  { label: "Setting KPIs and escalation paths…", ms: 480 },
];
