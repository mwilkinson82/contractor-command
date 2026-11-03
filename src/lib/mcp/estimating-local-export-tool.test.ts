import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authenticated: true, plan: true, allowed: true, rpc: vi.fn(), audit: vi.fn(), prepared: vi.fn() }));
vi.mock("./guard", () => ({
  guard: async (ctx: { isAuthenticated: () => boolean }) => {
    if (!ctx.isAuthenticated()) throw Error("Not authenticated");
    return { rpc: state.rpc };
  },
  run: vi.fn(), text: (text: string) => ({ content: [{ type: "text", text }] }), dbError: vi.fn(), isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => { if (!state.allowed) throw Error("No job access"); return { job_id: "job", company_id: "company", job_number: "LOCAL", scope: "full" }; },
  audit: state.audit, named: () => "LOCAL",
}));
vi.mock("./estimating-plan", () => ({ estimatingUpgrade: async () => state.plan ? null : {} }));
vi.mock("./security", () => ({ getCallSignals: () => null, securityTouch: async () => ({ ok: true }), enforceTouch: vi.fn() }));
vi.mock("./estimating-local-export", () => ({ prepareLocalBidDownload: state.prepared }));
import { estimateBidSummary } from "./tools/estimate-bid-tools";
const call = (args: Record<string, unknown> = {}) => (estimateBidSummary as unknown as {
  handler: (args: unknown, ctx: unknown) => Promise<unknown>;
}).handler({ job_number: "LOCAL", export_format: "pdf", export_delivery: "local", ...args }, { isAuthenticated: () => state.authenticated });
beforeEach(() => { state.authenticated = true; state.plan = true; state.allowed = true; vi.clearAllMocks(); state.prepared.mockResolvedValue({ delivery: "local" }); });
describe("local download tool authorization and no summary writes", () => {
  it("never enters the summary audit or save RPCs", async () => {
    await call(); expect(state.audit).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled(); expect(state.prepared).toHaveBeenCalledOnce();
  });
  it("rejects unauthenticated requests before generating bytes", async () => {
    state.authenticated = false; await expect(call()).rejects.toThrow(/authenticated/); expect(state.prepared).not.toHaveBeenCalled();
  });
  it("rejects excluded estimating plans before generating bytes", async () => {
    state.plan = false; await expect(call()).rejects.toThrow(/plan/); expect(state.prepared).not.toHaveBeenCalled();
  });
  it("rejects unauthorized company/job before generating bytes", async () => {
    state.allowed = false; await expect(call()).rejects.toThrow(/access/); expect(state.prepared).not.toHaveBeenCalled();
  });
  it.each([{ overhead_pct: 10 }, { profit_pct: 10 }, { handoff_draft: true }])("rejects mixed write/download request %j", async (args) => {
    await expect(call(args)).rejects.toThrow(/cannot change/); expect(state.prepared).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
});