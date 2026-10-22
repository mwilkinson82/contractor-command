// How an already-authenticated caller may use Athena.
// mcp_gate() stays the boolean membership check. mcp_athena_access() adds the
// company and paid-period detail the guard needs. It does not change circle_decision.
import type { CardModel } from "./cards/model";

export const CONFIRMING_MESSAGE =
  "We're confirming your membership. Your job data is safe. Contact support@meetathena.io.";

export const CONFIRMING_GUIDANCE =
  "Show this card. The membership is being confirmed. Do not say the membership is paused. Do not say there is no seat.";

export const COMPANY_SETUP_GUIDANCE = [
  "Greet the member and walk them through company setup.",
  "Ask for the company name. Do not invent it.",
  "When they answer, call onboarding with action save_company and that name.",
  "The owner gets Circle's 5 seats. Then ask for the job number and the job name.",
  "Do not say there is no seat. Do not stop.",
].join(" ");

export type PaidPeriod = "current" | "stale" | "missing" | "none";

export type AthenaAccess = {
  state: string;
  reason: string;
  has_access: boolean;
  circle_active: boolean;
  has_company: boolean;
  company_seat: boolean;
  paid_period: PaidPeriod;
};

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "setup" }
  | { kind: "confirming"; reason: string; paidPeriod: PaidPeriod }
  | { kind: "paused" };

const PAID_PERIODS = new Set<PaidPeriod>(["current", "stale", "missing", "none"]);

export function parseAthenaAccess(data: unknown): AthenaAccess | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const paid = row.paid_period;
  if (typeof row.has_access !== "boolean") return null;
  if (typeof row.circle_active !== "boolean") return null;
  if (typeof row.has_company !== "boolean") return null;
  if (typeof paid !== "string" || !PAID_PERIODS.has(paid as PaidPeriod)) return null;
  return {
    state: typeof row.state === "string" ? row.state : "ineligible",
    reason: typeof row.reason === "string" ? row.reason : "no_current_entitlement",
    has_access: row.has_access,
    circle_active: row.circle_active,
    has_company: row.has_company,
    company_seat: row.company_seat === true,
    paid_period: paid as PaidPeriod,
  };
}

/**
 * Active Circle or Hardcore (hasAccess) with no company goes to setup.
 * Review, or a stale or missing paid period, is the confirming message when access is off.
 * past_due with a current paid period arrives as eligible / paid_period current and stays allowed.
 * Anything else with no access stays the paused message.
 */
export function decideAccess(access: AthenaAccess): AccessDecision {
  if (access.circle_active || access.has_access) {
    if (access.circle_active && !access.has_company) return { kind: "setup" };
    return { kind: "allow" };
  }
  if (access.state === "review" || access.paid_period === "stale" || access.paid_period === "missing") {
    return { kind: "confirming", reason: access.reason, paidPeriod: access.paid_period };
  }
  return { kind: "paused" };
}

type Rpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Null when the function is not deployed yet or the payload is not the detail shape. */
export async function readAthenaAccess(sb: Rpc): Promise<AthenaAccess | null> {
  try {
    const { data, error } = await sb.rpc("mcp_athena_access");
    if (error) return null;
    return parseAthenaAccess(data);
  } catch {
    return null;
  }
}

export function companySetupCard(): CardModel {
  return {
    state: "ask",
    show_state: false,
    title: "Welcome. Let's set up your company",
    ask: { prompt: "What is the company name?" },
    sections: [
      {
        heading: "Why",
        kind: "list",
        rows: [{ cells: ["Jobs belong to a company. You are the owner, and Circle includes 5 seats."] }],
      },
    ],
    next_move: "Send the company name.",
  };
}

export function confirmingCard(): CardModel {
  return {
    state: "ask",
    show_state: false,
    title: "We're confirming your membership",
    sections: [{ heading: "Membership", kind: "list", rows: [{ cells: [CONFIRMING_MESSAGE] }] }],
    next_move: "Your job data is safe.",
  };
}
