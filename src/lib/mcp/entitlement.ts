// Who may use Athena (the MCP). One shared decision for the consent page's
// Approve button, the /mcp request gate and the per-tool guard.
//
// Today there is one source: the Circle Hub membership, decided in the
// database by mcp_gate() -> mcp_private.is_circle_active() ->
// get_circle_entitlement(), the same decision the Hub uses (active, trialing
// or comped Circle/Hardcore subscriptions, plus owner grants), in the same
// Supabase project. A standalone Athena subscription can be added later as
// another source; any source granting access is enough.
//
// Role/company access rules are separate and still apply inside each tool.
// mcp_athena_access() adds company, past_due, and paid-period detail when that
// function is deployed. It must not grant access that mcp_gate denies, except
// a Circle or Hardcore subscription whose Stripe status is past_due.
// A missing function keeps the boolean check.

import { decideAccess, readAthenaAccess, type AthenaAccess, type PaidPeriod } from "./access";

export const ENTITLED_SUBSCRIPTION_STATUSES = ["active", "trialing", "comped"] as const;

export type SubscriptionLike = {
  status?: string | null;
  is_comped?: boolean | null;
};

/** The Hub's status rule for a single subscription row (mirrors the magic-link live-member check). */
export function subscriptionGrantsAccess(row: SubscriptionLike | null | undefined): boolean {
  if (!row) return false;
  if (row.is_comped === true) return true;
  const status = String(row.status ?? "").trim().toLowerCase();
  return (ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/** Minimal Supabase surface needed here: a user-scoped client (the caller's own token). */
export type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type EntitlementSourceResult = { granted: boolean; source: string; unavailable?: boolean };
export type EntitlementSource = (sb: RpcClient) => Promise<EntitlementSourceResult>;

/** Circle Hub membership, evaluated by the database for the signed-in user (cached ~5 minutes there). */
export const circleMembershipSource: EntitlementSource = async (sb) => {
  try {
    const { data, error } = await sb.rpc("mcp_gate");
    if (error) return { granted: false, source: "circle", unavailable: true };
    return { granted: data === true, source: "circle" };
  } catch {
    return { granted: false, source: "circle", unavailable: true };
  }
};

/** Add a standalone Athena subscription source here when it exists. */
export const ATHENA_ENTITLEMENT_SOURCES: EntitlementSource[] = [circleMembershipSource];

export type AthenaEntitlement =
  | { allowed: true; source: string; needsCompany?: boolean }
  | { allowed: false; reason: "no_entitlement" | "unavailable" }
  | { allowed: false; reason: "confirming"; confirmReason: string; paidPeriod: PaidPeriod };

export const NO_ENTITLEMENT_MESSAGE =
  "This account doesn't have an active membership that includes Athena.";

/**
 * Detail can classify a denial (confirming vs paused) and the no-company setup.
 * It grants access mcp_gate denied only when the subscription status is past_due.
 */
function denialFromDetail(detail: AthenaAccess): AthenaEntitlement {
  const decision = decideAccess({
    ...detail,
    has_access: false,
    circle_active: false,
    company_seat: false,
    past_due: false,
  });
  if (decision.kind === "confirming") {
    return { allowed: false, reason: "confirming", confirmReason: detail.reason, paidPeriod: detail.paid_period };
  }
  return { allowed: false, reason: "no_entitlement" };
}

/** Allowed if any source grants access. Denied (fail closed) otherwise. */
export async function checkAthenaEntitlement(
  sb: RpcClient,
  sources: EntitlementSource[] = ATHENA_ENTITLEMENT_SOURCES,
): Promise<AthenaEntitlement> {
  let unavailable = false;
  let granted: string | null = null;
  for (const source of sources) {
    const r = await source(sb);
    if (r.unavailable) unavailable = true;
    if (r.granted) {
      granted = r.source;
      break;
    }
  }
  // Detail is read after mcp_gate so a pending invite is accepted first.
  const detail = await readAthenaAccess(sb);
  if (!granted) {
    if (unavailable) return { allowed: false, reason: "unavailable" };
    if (detail?.past_due) {
      return { allowed: true, source: "circle", ...(detail.has_company ? {} : { needsCompany: true }) };
    }
    if (detail) return denialFromDetail(detail);
    return { allowed: false, reason: "no_entitlement" };
  }
  if (detail && !detail.has_company && (detail.circle_active || detail.past_due)) {
    return { allowed: true, source: granted, needsCompany: true };
  }
  return { allowed: true, source: granted };
}
