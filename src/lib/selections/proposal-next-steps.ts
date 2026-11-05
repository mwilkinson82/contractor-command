/**
 * What the contractor does after looking at a Good, Better, Best proposal, in
 * order, so Athena can offer each step instead of leaving the member to work
 * out the process: tidy the wording, invite the customer to their client page,
 * send the proposal there for their choice and signature, or make a view-only
 * link. Every step that sends, invites or shares still waits for the member's yes.
 */
import { TIER_LABEL, type CustomerProposal } from "./proposal";

export type PortalState = {
  customers: { name: string; email: string }[];
  /** A proposal already on the client page, waiting on the customer. */
  open_on_client_page: boolean;
  /** The package the customer chose on the client page, if any. */
  chosen_on_client_page: string | null;
};

export type NextStepId =
  | "fix_wording"
  | "add_terms"
  | "set_change_terms"
  | "invite_customer"
  | "send_to_client_page"
  | "view_only_link"
  | "carry_choice";

export type NextStep = { id: NextStepId; label: string; detail: string; how: string };

// Words that mark a proposal as a draft or a test, never meant for a customer.
const NOT_FOR_CUSTOMER_RE =
  /\b(test|testing|sample|dummy|draft|not\s+for\s+(?:a\s+|the\s+)?customer|internal\s+only|do\s+not\s+send)\b/i;

/** The first draft or test marker in what the customer would read, or null. */
export function notForCustomerWording(view: Pick<CustomerProposal, "title" | "intro">) {
  return NOT_FOR_CUSTOMER_RE.exec(`${view.title} ${view.intro}`)?.[0] ?? null;
}

const names = (cs: { name: string }[]) => {
  const n = cs.map((c) => c.name.trim()).filter(Boolean);
  if (n.length <= 1) return n[0] ?? "the customer";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};

/**
 * The next steps, most important first. portal is null when the client page
 * could not be read; the steps then still lead to it, checking who has access.
 */
export function proposalNextSteps(
  view: CustomerProposal,
  version: number,
  portal: PortalState | null,
  /** The member confirmed each upgrade's extra time and added cost on this version. */
  termsReviewed = false,
): NextStep[] {
  const steps: NextStep[] = [];
  const chosen = view.accepted?.tier ?? portal?.chosen_on_client_page ?? null;
  if (chosen) {
    const tier = TIER_LABEL[chosen as keyof typeof TIER_LABEL] ?? chosen;
    steps.push({
      id: "carry_choice",
      label: `Carry ${tier} into the estimate`,
      detail: `The customer chose ${tier}. Carrying it into the estimate is a separate step the estimator approves.`,
      how: "estimate_pricing, after the estimator says yes",
    });
    return steps;
  }
  const marker = notForCustomerWording(view);
  if (marker)
    steps.push({
      id: "fix_wording",
      label: "Fix the title and intro",
      detail: `The customer would read "${marker}" in the title or intro. Give it a customer-ready title and one or two sentences of intro first.`,
      how: "selection_board set_proposal with the member's wording, after their yes",
    });
  if (!view.valid_until || !view.terms.trim())
    steps.push({
      id: "add_terms",
      label: "Add a valid-until date and terms",
      detail: `${!view.valid_until ? "No date the prices are good until" : "No terms"}${!view.valid_until && !view.terms.trim() ? " and no terms" : ""} yet. Optional, but most contractors set both before sending.`,
      how: "selection_board set_proposal with valid_until and terms the member gives",
    });

  if (!termsReviewed) {
    const ups = view.packages.filter((p) => p.tier !== view.base_tier);
    const set = ups.filter((p) => (p.schedule_days ?? 0) > 0 || (p.added_cents ?? 0) > 0);
    const tiers = ups.map((p) => TIER_LABEL[p.tier]).join(" and ");
    steps.push({
      id: "set_change_terms",
      label: "Set the time and any extra charge for each upgrade",
      detail: set.length
        ? `Confirm the extra time and extra charge on ${tiers} before the customer sees them.`
        : `Every change carries money and time. ${tiers} are set to no added time and no extra charge beyond the product price. Confirm that, or enter extra days and any extra charge, like extra install labor. The customer sees it right before they sign.`,
      how: "selection_board set_change_terms: show its card first, then call it again with confirmed true after the member says yes",
    });
  }

  const customers = portal?.customers ?? [];
  if (portal && !customers.length)
    steps.push({
      id: "invite_customer",
      label: "Invite the customer to their client page",
      detail:
        "No customer is on this job's client page yet. Ask for their name and email; Athena emails them a private link they sign in to with a code.",
      how: "customer_portal invite with name and email, confirmed true after the member says yes",
    });
  steps.push({
    id: "send_to_client_page",
    label: portal?.open_on_client_page
      ? "Update it on their client page"
      : customers.length
        ? `Send it to ${names(customers)}'s client page`
        : "Send it to their client page",
    detail: portal?.open_on_client_page
      ? "A proposal is already on the client page waiting on the customer. Sending this version replaces it."
      : "They get an email, open their client page, pick Good, Better or Best, type their name and confirm with an emailed code. That is their approval.",
    how: `customer_portal share_selection with expected_version ${version} and confirmed true after the member says yes${portal ? "" : "; check who has access with customer_portal list first"}`,
  });
  steps.push({
    id: "view_only_link",
    label: "Get a view-only link",
    detail:
      "A link to text or email that shows the same comparison. Anyone with it can look, but no one can choose or approve on it, and it expires.",
    how: `selection_proposal share with expected_version ${version} and confirmed true after the member says yes`,
  });
  return steps;
}
