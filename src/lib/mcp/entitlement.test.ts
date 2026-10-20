import { describe, expect, it } from "vitest";
import {
  ATHENA_ENTITLEMENT_SOURCES,
  ATHENA_ROLES,
  TIER_ROLES,
  TOOL_ROLES,
  athenaRowGrantsAccess,
  athenaSubscriptionSource,
  checkAthenaEntitlement,
  circleMembershipSource,
  lockedToolMessage,
  rolesAllowTool,
  subscriptionGrantsAccess,
  type EntitlementSource,
  type RpcClient,
} from "./entitlement";
import { MCP_ALLOWED_EMAILS } from "./allowlist";

// A user-scoped client: mcp_gate answers from the user's Circle row (active, trialing or
// comped => access); mcp_athena_roles answers from their standalone Athena roles.
function clientFor(
  row: { status?: string | null; is_comped?: boolean | null } | null,
  athenaRoles: string[] = [],
): RpcClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string) => {
      calls.push(fn);
      if (fn === "mcp_gate") return { data: subscriptionGrantsAccess(row), error: null };
      if (fn === "mcp_athena_roles") return { data: athenaRoles, error: null };
      return { data: null, error: { message: "unexpected" } };
    },
  };
}

const ALL = [...ATHENA_ROLES];

describe("subscriptionGrantsAccess (Hub status rule)", () => {
  it.each([
    ["active", true],
    ["trialing", true],
    ["comped", true],
    ["ACTIVE", true],
    ["canceled", false],
    ["past_due", false],
    ["incomplete", false],
    ["", false],
  ])("status %s -> %s", (status, expected) => {
    expect(subscriptionGrantsAccess({ status })).toBe(expected);
  });

  it("is_comped grants access whatever the status", () => {
    expect(subscriptionGrantsAccess({ status: "canceled", is_comped: true })).toBe(true);
  });

  it("no subscription is denied", () => {
    expect(subscriptionGrantsAccess(null)).toBe(false);
    expect(subscriptionGrantsAccess(undefined)).toBe(false);
  });
});

describe("checkAthenaEntitlement (Circle source)", () => {
  it("active member is allowed with every role, without asking the Athena source", async () => {
    const sb = clientFor({ status: "active" });
    expect(await checkAthenaEntitlement(sb)).toEqual({ allowed: true, source: "circle", roles: ALL });
    expect(sb.calls).toEqual(["mcp_gate"]);
  });

  it("trialing member is allowed", async () => {
    expect((await checkAthenaEntitlement(clientFor({ status: "trialing" }))).allowed).toBe(true);
  });

  it("comped member is allowed", async () => {
    expect((await checkAthenaEntitlement(clientFor({ status: "comped" }))).allowed).toBe(true);
    expect((await checkAthenaEntitlement(clientFor({ status: "active", is_comped: true }))).allowed).toBe(true);
  });

  it("canceled member with no Athena plan is denied", async () => {
    expect(await checkAthenaEntitlement(clientFor({ status: "canceled" }))).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("account with no subscription is denied", async () => {
    expect(await checkAthenaEntitlement(clientFor(null))).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("Marshall (comped account) keeps access through the membership rule, not an email list", async () => {
    expect(MCP_ALLOWED_EMAILS.size).toBe(0);
    expect((await checkAthenaEntitlement(clientFor({ status: "comped", is_comped: true }))).allowed).toBe(true);
  });

  it("fails closed when the database check errors or throws", async () => {
    const errored: RpcClient = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    const thrown: RpcClient = { rpc: async () => { throw new Error("network"); } };
    expect(await checkAthenaEntitlement(errored)).toEqual({ allowed: false, reason: "unavailable" });
    expect(await checkAthenaEntitlement(thrown)).toEqual({ allowed: false, reason: "unavailable" });
  });

  it("uses Circle first, then the standalone Athena subscription", () => {
    expect(ATHENA_ENTITLEMENT_SOURCES).toEqual([circleMembershipSource, athenaSubscriptionSource]);
  });
});

describe("checkAthenaEntitlement (standalone Athena source)", () => {
  it("Athena PM buyer gets the PM role only", async () => {
    expect(await checkAthenaEntitlement(clientFor(null, ["pm"]))).toEqual({ allowed: true, source: "athena_subscription", roles: ["pm"] });
  });

  it("Athena Office buyer gets every role", async () => {
    const r = await checkAthenaEntitlement(clientFor(null, [...TIER_ROLES.athena_office]));
    expect(r).toEqual({ allowed: true, source: "athena_subscription", roles: ALL });
  });

  it("Circle member who also bought PM still gets every role", async () => {
    expect(await checkAthenaEntitlement(clientFor({ status: "active" }, ["pm"]))).toEqual({ allowed: true, source: "circle", roles: ALL });
  });

  it("unknown role strings from the database are dropped", async () => {
    expect(await checkAthenaEntitlement(clientFor(null, ["pm", "admin"]))).toEqual({ allowed: true, source: "athena_subscription", roles: ["pm"] });
  });

  it("Athena source alone erroring with Circle denied fails closed as unavailable", async () => {
    const sb: RpcClient = {
      rpc: async (fn) => (fn === "mcp_gate" ? { data: false, error: null } : { data: null, error: { message: "missing" } }),
    };
    expect(await checkAthenaEntitlement(sb)).toEqual({ allowed: false, reason: "unavailable" });
  });

  it("a granting source without roles counts as every role (back-compat for custom sources)", async () => {
    const legacy: EntitlementSource = async () => ({ granted: true, source: "legacy" });
    expect(await checkAthenaEntitlement(clientFor(null), [legacy])).toEqual({ allowed: true, source: "legacy", roles: ALL });
  });
});

describe("athenaRowGrantsAccess (mirrors mcp_athena_roles)", () => {
  const now = new Date("2026-10-20T17:00:00Z");
  it.each([
    ["trialing", true],
    ["active", true],
    ["past_due", true], // Stripe still retrying
    ["unpaid", false],
    ["canceled", false],
    ["incomplete", false],
  ])("status %s -> %s", (status, expected) => {
    expect(athenaRowGrantsAccess({ status }, now)).toBe(expected);
  });

  it("grace runs 7 days after retries end, then stops", () => {
    expect(athenaRowGrantsAccess({ status: "unpaid", grace_until: "2026-10-25T00:00:00Z" }, now)).toBe(true);
    expect(athenaRowGrantsAccess({ status: "canceled", grace_until: "2026-10-19T00:00:00Z" }, now)).toBe(false);
  });
});

describe("role gating", () => {
  it("every current tool is in the PM role", () => {
    expect(Object.keys(TOOL_ROLES).sort()).toEqual(
      ["answer", "carry_forward", "contract_terms", "intake", "list_open_items", "next_question", "onboarding", "report", "resolve_item"],
    );
    for (const role of Object.values(TOOL_ROLES)) expect(role).toBe("pm");
  });

  it("PM and Office both open every current tool", () => {
    for (const tool of Object.keys(TOOL_ROLES)) {
      expect(rolesAllowTool(TIER_ROLES.athena_pm, tool)).toBe(true);
      expect(rolesAllowTool(TIER_ROLES.athena_office, tool)).toBe(true);
    }
  });

  it("no roles opens nothing; unknown tools need PM", () => {
    expect(rolesAllowTool([], "report")).toBe(false);
    expect(rolesAllowTool(["contracts"], "some_future_tool")).toBe(false);
    expect(rolesAllowTool(["pm"], "some_future_tool")).toBe(true);
  });

  it("locked message is plain and names the role", () => {
    expect(lockedToolMessage("report")).toContain("PM role");
  });
});
