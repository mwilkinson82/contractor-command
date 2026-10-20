import { describe, expect, it } from "vitest";
import {
  ATHENA_ENTITLEMENT_SOURCES,
  checkAthenaEntitlement,
  circleMembershipSource,
  subscriptionGrantsAccess,
  type EntitlementSource,
  type RpcClient,
} from "./entitlement";
import { MCP_ALLOWED_EMAILS } from "./allowlist";

// A user-scoped client whose mcp_gate answers from that user's subscription row,
// the way the database decision does (active, trialing or comped => access).
function clientFor(row: { status?: string | null; is_comped?: boolean | null } | null): RpcClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string) => {
      calls.push(fn);
      if (fn !== "mcp_gate") return { data: null, error: { message: "unexpected" } };
      return { data: subscriptionGrantsAccess(row), error: null };
    },
  };
}

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

describe("checkAthenaEntitlement", () => {
  it("active member is allowed", async () => {
    const sb = clientFor({ status: "active" });
    expect(await checkAthenaEntitlement(sb)).toEqual({ allowed: true, source: "circle" });
    expect(sb.calls).toEqual(["mcp_gate"]);
  });

  it("trialing member is allowed", async () => {
    expect((await checkAthenaEntitlement(clientFor({ status: "trialing" }))).allowed).toBe(true);
  });

  it("comped member is allowed", async () => {
    expect((await checkAthenaEntitlement(clientFor({ status: "comped" }))).allowed).toBe(true);
    expect((await checkAthenaEntitlement(clientFor({ status: "active", is_comped: true }))).allowed).toBe(true);
  });

  it("canceled member is denied", async () => {
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

  it("a future standalone Athena source can grant access on its own", async () => {
    const athenaStandalone: EntitlementSource = async () => ({ granted: true, source: "athena" });
    const sources = [circleMembershipSource, athenaStandalone];
    expect(await checkAthenaEntitlement(clientFor(null), sources)).toEqual({ allowed: true, source: "athena" });
  });

  it("defaults to the Circle membership source only", () => {
    expect(ATHENA_ENTITLEMENT_SOURCES).toEqual([circleMembershipSource]);
  });
});
