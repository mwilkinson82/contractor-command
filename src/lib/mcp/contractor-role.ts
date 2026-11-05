// The contractor's role on a job. Setup used to ask "Are we the GC? yes for GC, no for subcontractor", which left a
// trade contractor holding the prime contract (an electrical prime self-performing an electrical scope) with no
// right answer, and a job record of "prime" pre-picked GC. Holding the prime contract and being the general
// contractor are different things, so the question now has four answers.

export const ROLE_GATE_KEY = "gate_role_gc";
/** Gate 2, "Are we self-performing any work on this job?": a prime trade contractor has already said yes to it. */
export const SELF_PERFORM_GATE_KEY = "gate_self_perform";

export const CONTRACTOR_ROLES = ["general_contractor", "prime_trade", "subcontractor", "sub_tier"] as const;
export type ContractorRole = (typeof CONTRACTOR_ROLES)[number];

export const ROLE_LABEL: Record<ContractorRole, string> = {
  general_contractor: "General contractor",
  prime_trade: "Prime trade contractor, self-performing",
  subcontractor: "Subcontractor to the GC",
  sub_tier: "Sub-tier (sub to a sub)",
};

const ROLE_HELP: Record<ContractorRole, string> = {
  general_contractor: "you hold the prime contract and sub out the trades",
  prime_trade: "you hold your own contract with the owner and do your trade's work with your own crews, for example an electrical prime on an electrical scope",
  subcontractor: "your contract is with the general contractor",
  sub_tier: "your contract is with another subcontractor",
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Reads the member's answer (a role value or plain words) as one of the four roles, or null when it isn't clear. */
export function parseContractorRole(input: unknown): ContractorRole | null {
  if (typeof input !== "string") return null;
  const t = norm(input);
  if (!t) return null;
  const direct = t.replace(/ /g, "_");
  if ((CONTRACTOR_ROLES as readonly string[]).includes(direct)) return direct as ContractorRole;
  if (/^[1-4]$/.test(t)) return CONTRACTOR_ROLES[Number(t) - 1];
  if (/\b(sub ?sub|sub tier|second tier|lower tier|tier 2|sub to a sub|sub of a sub)\b/.test(t)) return "sub_tier";
  if (/\b(not|no|never)\b.*\b(gc|general contractor)\b/.test(t)) {
    if (/\bsub(contractor)?\b/.test(t) && !/\bprime\b/.test(t)) return "subcontractor";
    return /\bprime\b|self ?perform|own (crew|forces)|owner direct|direct (to|with) (the )?owner/.test(t) ? "prime_trade" : null;
  }
  if (/\bsub(contractor)? (to|for|under|of) (the |a )?(gc|general contractor|prime)\b/.test(t)) return "subcontractor";
  if (/\b(gc|general contractor|general contracting|cm at risk|construction manager)\b/.test(t)) return "general_contractor";
  if (/\bprime\b|self ?perform|owner direct|direct (to|with) (the )?owner|multi ?prime/.test(t)) return "prime_trade";
  if (/\bsub(contractor)?\b|specialty contractor|trade contractor under/.test(t)) return "subcontractor";
  return null;
}

/** What each role means for the setup flags. GC is the only "yes" on the gate; is_sub is set separately so a prime trade isn't filed as a sub. */
export function roleOutcome(role: ContractorRole): {
  gate: "yes" | "no";
  position: "prime" | "sub" | "sub_sub";
  flags: Record<string, "yes" | "no">;
} {
  switch (role) {
    case "general_contractor":
      return { gate: "yes", position: "prime", flags: { is_gc: "yes", is_sub: "no", prime_contract: "yes", sub_position: "no" } };
    case "prime_trade":
      return { gate: "no", position: "prime", flags: { is_gc: "no", is_sub: "no", prime_contract: "yes", sub_position: "no", self_perform: "yes" } };
    case "subcontractor":
      return { gate: "no", position: "sub", flags: { is_gc: "no", is_sub: "yes", prime_contract: "no", sub_position: "yes" } };
    case "sub_tier":
      return { gate: "no", position: "sub_sub", flags: { is_gc: "no", is_sub: "yes", prime_contract: "no", sub_position: "yes" } };
  }
}

/** The estimating role that fits: only a general contractor covers every division; everyone else takes off their own trade. */
export const estimateRoleFor = (role: ContractorRole): "gc" | "self_performer" =>
  role === "general_contractor" ? "gc" : "self_performer";

/**
 * What the job record already says, in words, without picking an answer. "prime" alone never means GC: it only rules
 * out the two sub answers.
 */
export function roleRecordNote(record: { position?: unknown; companyRole?: unknown }): string | null {
  const pos = typeof record.position === "string" ? record.position : null;
  const co = typeof record.companyRole === "string" && record.companyRole.trim() ? record.companyRole.trim() : null;
  const parts: string[] = [];
  if (pos === "prime") parts.push("the job record says you hold the prime contract, which fits a general contractor or a prime trade contractor");
  else if (pos === "sub") parts.push("the job record says you're a subcontractor");
  else if (pos === "sub_sub") parts.push("the job record says you're a sub-tier contractor");
  if (co) parts.push(`your company profile describes you as "${co.slice(0, 80)}"`);
  if (!parts.length) return null;
  const s = parts.join(", and ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

/** The setup question, with the four answers. */
export function roleQuestionText(record: { position?: unknown; companyRole?: unknown } = {}): string {
  const note = roleRecordNote(record);
  return [
    "What's your role on this job?",
    ...CONTRACTOR_ROLES.map((r, i) => `${i + 1}. ${ROLE_LABEL[r]}: ${ROLE_HELP[r]}.`),
    ...(note ? ["", `${note} Pick the one that's true; I won't assume general contractor from "prime".`] : []),
  ].join("\n");
}

export const ROLE_ANSWER_HOW =
  'Answer with role general_contractor, prime_trade, subcontractor or sub_tier (plain words like "electrical prime, self-perform" work too), or response unknown.';

export const ROLE_GUIDANCE = [
  "Ask the role question as written, with all four answers. Offer them as four separate choices; never reduce it to general contractor or subcontractor.",
  "Holding the prime contract does not make the member the general contractor. Don't pre-pick an answer from the job record.",
];
