/* Error presentation through the real guard. Calculation/storage correctness
 * is covered by the separate handler/PGlite integration suite. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "@lovable.dev/mcp-js";
const rpc = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const admin = vi.hoisted(() => vi.fn());
const source = vi.hoisted(() => ({
  version: 1,
  estimate: {},
  takeoff: null,
  bid: { pricing: { quotes: [] } },
  selection: null,
}));
vi.mock("./supabase", () => ({
  supabaseForUser: () => ({
    rpc,
    from: () => ({ insert }),
    auth: { getUser: async () => ({ error: null, data: { user: { id: "actor" } } }) },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: admin }));
vi.mock("./tools/estimate-bid-tools", () => ({
  calculateSavedBidSnapshot: () => ({
    snapshot: source,
    view: {
      ready: true,
      total: 1,
      breakdown: {
        direct: [{ ref: "T-1", basis: "direct", quoteId: null, amountCents: 100 }],
        directCents: 100,
        generalConditions: [],
        requirements: [],
        generalConditionsCents: 0,
        requirementsCents: 0,
        overheadCents: 0,
        profitCents: 0,
        totalCents: 100,
      },
    },
  }),
}));
import { run } from "./guard";
import { estimateHandoffRequest } from "./estimating-handoff.server";
const ctx = { isAuthenticated: () => true, getToken: () => "synthetic-token" } as never;
beforeEach(() => {
  rpc.mockReset();
  admin.mockReset();
  insert.mockClear();
  rpc.mockImplementation(async (name: string) => {
    if (name === "mcp_abuse_cap_check" || name === "mcp_security_touch")
      return { data: { ok: true }, error: null };
    if (name === "mcp_gate") return { data: true, error: null };
    if (name === "mcp_session_touch") return { data: false, error: null };
    if (name === "mcp_estimate_snapshot_read")
      return { data: { current: true, sha256: "a".repeat(64), snapshot: source }, error: null };
    if (name === "mcp_buyout_get")
      return {
        data: {
          company_id: "company",
          job_id: "job",
          records: [
            {
              id: "package",
              kind: "package",
              version: 2,
              facts: {
                code: "PAINT",
                title: "Paint",
                scope: "Paint",
                budget_cents: 50,
                currency: "USD",
                status: "draft",
                candidates: [],
                selected_party_id: null,
                commitment_refs: [],
                expected_award_on: null,
                needed_by: null,
                submittal_ids: [],
                schedule_ref: null,
                source: "Planning source",
              },
            },
          ],
        },
        error: null,
      };
    throw new Error(`Unexpected operation: ${name}`);
  });
});
describe("handoff validation through the real guard", () => {
  it("preserves the actionable stale-destination instruction and never invokes the privileged writer", async () => {
    const result = run("estimate_handoff", ctx, {}, (sb) =>
      estimateHandoffRequest(
        sb,
        ctx,
        {
          job_id: "job",
          company_id: "company",
          job_number: "900071",
          name: "Synthetic Example",
          scope: "full",
        },
        {
          step: "review",
          request_id: "request",
          snapshot_id: "snapshot",
          package_id: "package",
          expected_version: 1,
          reason: "Reviewed allocation",
          allocations: [
            { component_id: "direct:T-1", include: true, exclusion_reason: null },
            { component_id: "overhead", include: false, exclusion_reason: "Outside package" },
            { component_id: "profit", include: false, exclusion_reason: "Outside package" },
          ],
        },
      ),
    );
    await expect(result).rejects.toBeInstanceOf(ToolError);
    await expect(result).rejects.toThrow(/destination changed.*refresh before review/is);
    expect(admin).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("mcp_estimate_buyout_handoff");
    expect(insert).toHaveBeenCalled();
  });
});
