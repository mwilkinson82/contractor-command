// Who may use Athena (the MCP). One shared decision for the consent page's
// Approve button, the /mcp request gate and the per-tool guard.
//
// Sources (any one granting access is enough):
// 1. Circle Hub membership, decided in the database by mcp_gate() ->
//    mcp_private.is_circle_active() -> get_circle_entitlement(), the same
//    decision the Hub uses (active, trialing or comped Circle/Hardcore
//    subscriptions, plus owner grants). Circle and owners get every role.
// 2. A standalone Athena subscription (Stripe: Athena PM / Athena Office),
//    written by the Stripe webhook into athena_subscriptions and read back as
//    roles by mcp_athena_roles().
//
// Role/company access rules are separate and still apply inside each tool.

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

// ---- Roles ----------------------------------------------------------------

export const ATHENA_ROLES = ["pm", "contracts", "estimating", "ap"] as const;
export type AthenaRole = (typeof ATHENA_ROLES)[number];

export const ATHENA_PRODUCT_KEYS = ["athena_pm", "athena_office"] as const;
export type AthenaProductKey = (typeof ATHENA_PRODUCT_KEYS)[number];

/** Mirrors the athena_tier_roles seed in the migration. */
export const TIER_ROLES: Record<AthenaProductKey, readonly AthenaRole[]> = {
  athena_pm: ["pm"],
  athena_office: ["pm", "contracts", "estimating", "ap"],
};

/** Every current tool is in the PM role (Khan, Oct 20). Contracts/Estimating/AP tools land later. */
export const TOOL_ROLES: Record<string, AthenaRole> = {
  onboarding: "pm",
  intake: "pm",
  next_question: "pm",
  answer: "pm",
  report: "pm",
  list_open_items: "pm",
  resolve_item: "pm",
  carry_forward: "pm",
  contract_terms: "pm",
};

/** Unknown tools default to PM so a new tool is never accidentally locked for everyone. */
export function requiredRole(tool: string): AthenaRole {
  return TOOL_ROLES[tool] ?? "pm";
}

export function rolesAllowTool(roles: readonly string[], tool: string): boolean {
  return roles.includes(requiredRole(tool));
}

const ROLE_LABEL: Record<AthenaRole, string> = {
  pm: "PM",
  contracts: "Contracts",
  estimating: "Estimating",
  ap: "AP",
};

export function lockedToolMessage(tool: string): string {
  const role = ROLE_LABEL[requiredRole(tool)];
  return `Your Athena plan doesn't include the ${role} role. Athena Office includes every role; upgrade at meetathena.io.`;
}

// ---- Standalone subscription access rule (mirrors mcp_athena_roles()) ------

export type AthenaSubscriptionRow = {
  status?: string | null;
  grace_until?: string | null;
};

export const ATHENA_ACCESS_STATUSES = ["active", "trialing", "past_due"] as const;
export const ATHENA_GRACE_DAYS = 7;

export function athenaRowGrantsAccess(row: AthenaSubscriptionRow | null | undefined, now = new Date()): boolean {
  if (!row) return false;
  const status = String(row.status ?? "").trim().toLowerCase();
  if ((ATHENA_ACCESS_STATUSES as readonly string[]).includes(status)) return true;
  if (row.grace_until) {
    const t = Date.parse(row.grace_until);
    if (Number.isFinite(t) && t > now.getTime()) return true;
  }
  return false;
}

// ---- Sources ----------------------------------------------------------------

/** Minimal Supabase surface needed here: a user-scoped client (the caller's own token). */
export type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type EntitlementSourceResult = {
  granted: boolean;
  source: string;
  roles?: AthenaRole[];
  unavailable?: boolean;
};
export type EntitlementSource = (sb: RpcClient) => Promise<EntitlementSourceResult>;

/** Circle Hub membership, evaluated by the database for the signed-in user (cached ~5 minutes there). */
export const circleMembershipSource: EntitlementSource = async (sb) => {
  try {
    const { data, error } = await sb.rpc("mcp_gate");
    if (error) return { granted: false, source: "circle", unavailable: true };
    return { granted: data === true, source: "circle", roles: data === true ? [...ATHENA_ROLES] : [] };
  } catch {
    return { granted: false, source: "circle", unavailable: true };
  }
};

/** Standalone Athena subscription (Athena PM / Athena Office). */
export const athenaSubscriptionSource: EntitlementSource = async (sb) => {
  try {
    const { data, error } = await sb.rpc("mcp_athena_roles");
    if (error) return { granted: false, source: "athena_subscription", unavailable: true };
    const roles = (Array.isArray(data) ? data : [])
      .map((r) => String(r))
      .filter((r): r is AthenaRole => (ATHENA_ROLES as readonly string[]).includes(r));
    return { granted: roles.length > 0, source: "athena_subscription", roles };
  } catch {
    return { granted: false, source: "athena_subscription", unavailable: true };
  }
};

export const ATHENA_ENTITLEMENT_SOURCES: EntitlementSource[] = [circleMembershipSource, athenaSubscriptionSource];

export type AthenaEntitlement =
  | { allowed: true; source: string; roles: AthenaRole[] }
  | { allowed: false; reason: "no_entitlement" | "unavailable" };

export const NO_ENTITLEMENT_MESSAGE =
  "This account doesn't have an active membership that includes Athena.";

/**
 * Allowed if any source grants access; roles are the union across granting sources.
 * Circle (all roles) short-circuits. Denied (fail closed) otherwise.
 */
export async function checkAthenaEntitlement(
  sb: RpcClient,
  sources: EntitlementSource[] = ATHENA_ENTITLEMENT_SOURCES,
): Promise<AthenaEntitlement> {
  let unavailable = false;
  const roles = new Set<AthenaRole>();
  let source: string | null = null;
  for (const s of sources) {
    const r = await s(sb);
    if (r.granted) {
      source ??= r.source;
      for (const role of r.roles ?? ATHENA_ROLES) roles.add(role);
      if (roles.size === ATHENA_ROLES.length) break;
    } else if (r.unavailable) unavailable = true;
  }
  if (source) return { allowed: true, source, roles: ATHENA_ROLES.filter((x) => roles.has(x)) };
  return { allowed: false, reason: unavailable ? "unavailable" : "no_entitlement" };
}
