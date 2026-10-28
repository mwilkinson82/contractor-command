import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn(), gate: vi.fn() }));
vi.mock("./guard", () => ({
  run: async (_n: unknown, _ctx: unknown, _o: unknown, f: (s: unknown) => unknown) => {
    await state.gate();
    return f({ rpc: state.rpc });
  },
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({ resolveJob: (...args: unknown[]) => state.resolve(...args) }));
import { readReconciliation } from "./reconciliation-read";
import { accountingReconciliation } from "./tools/reconciliation-tools";
import type { Sb } from "./guard";
const scope = {
  job_id: "00000000-0000-4000-8000-000000000002",
  company_id: "00000000-0000-4000-8000-000000000001",
};
const b = { currency: "USD", invoices: [], receipts: [], allocations: [], receipt_reversals: [] };
beforeEach(() => {
  vi.clearAllMocks();
  state.gate.mockResolvedValue(undefined);
  state.resolve.mockResolvedValue({ ...scope, job_number: "SYN", scope: "full" });
  state.rpc.mockImplementation(async (name: string) =>
    name === "mcp_billing_evidence_get"
      ? { data: b, error: null }
      : name === "mcp_billing_documents_get"
        ? { data: { documents: [], links: [] }, error: null }
        : {
            data: null,
            error: { code: "PGRST202", message: "Could not find mcp_cost_submission_read" },
          },
  );
});
const read = () => readReconciliation({ rpc: state.rpc } as unknown as Sb, scope);
it("uses only gated read RPCs, passes exact job and reports missing AP coverage", async () => {
  const r = await read();
  expect(r.coverage.billing.state).toBe("checked");
  expect(r.coverage.ap.state).toBe("unavailable");
  expect(r.evidence_key).toMatch(/^[0-9a-f]{64}$/);
  expect(r.consistency).toMatch(/not an atomic/);
  expect(state.rpc.mock.calls.map((c) => c[0])).toEqual([
    "mcp_billing_evidence_get",
    "mcp_billing_documents_get",
    "mcp_cost_submission_read",
    "mcp_billing_evidence_get",
    "mcp_billing_documents_get",
    "mcp_cost_submission_read",
  ]);
  for (const c of state.rpc.mock.calls) expect(c[1]).toEqual({ _job: scope.job_id });
});
it("suppresses discrepancy claims if billing changes between observations", async () => {
  let count = 0;
  const impl = state.rpc.getMockImplementation()!;
  state.rpc.mockImplementation(async (name: string, ...args: unknown[]) =>
    name === "mcp_billing_evidence_get"
      ? { data: { ...b, revision: ++count }, error: null }
      : impl(name, ...args),
  );
  const r = await read();
  expect(r.observations_match).toBe(false);
  expect(r.coverage.billing.state).toBe("unavailable");
  expect(r.findings).toEqual([]);
  expect(r.coverage.originals.state).toBe("unavailable");
});
it("does not use changing document linkage as evidence of a missing original", async () => {
  let count = 0;
  const impl = state.rpc.getMockImplementation()!;
  state.rpc.mockImplementation(async (name: string, ...args: unknown[]) =>
    name === "mcp_billing_documents_get"
      ? { data: { documents: [], links: [], revision: ++count }, error: null }
      : impl(name, ...args),
  );
  const r = await read();
  expect(r.coverage.billing.state).toBe("checked");
  expect(r.coverage.originals.state).toBe("unavailable");
});
it("never treats a denied AP read or missing helper as an unavailable optional function", async () => {
  const impl = state.rpc.getMockImplementation()!;
  state.rpc.mockImplementation(async (name: string, ...args: unknown[]) =>
    name === "mcp_cost_submission_read"
      ? { data: null, error: { code: "42501", message: "Full project access required" } }
      : impl(name, ...args),
  );
  await expect(read()).rejects.toThrow("Full project access required");
  state.rpc.mockImplementation(async () => ({
    data: null,
    error: { code: "42883", message: "missing internal_helper" },
  }));
  await expect(read()).rejects.toThrow("missing internal_helper");
});
it("membership and job gates run before evidence reads", async () => {
  const handler = accountingReconciliation.handler as unknown as (
    args: object,
    ctx: object,
  ) => Promise<unknown>;
  state.gate.mockRejectedValueOnce(new Error("inactive"));
  await expect(handler({ job_number: "SYN", limit: 12 }, {})).rejects.toThrow("inactive");
  expect(state.rpc).not.toHaveBeenCalled();
  state.resolve.mockRejectedValueOnce(new Error("no financials"));
  await expect(handler({ job_number: "SYN", limit: 12 }, {})).rejects.toThrow("no financials");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("returns chat-first unknown coverage with source link and correction boundary", async () => {
  const r = await (
    accountingReconciliation.handler as unknown as (
      args: object,
      ctx: object,
    ) => Promise<{ content: Array<{ text?: string }>; structuredContent: object }>
  )({ job_number: "SYN", company_id: scope.company_id, limit: 12 }, {});
  expect(state.resolve.mock.calls[0].slice(1)).toEqual(["SYN", scope.company_id, "full"]);
  const json = JSON.stringify(r);
  expect(json).toContain("Recorded payment does not prove money transferred");
  expect(json).toContain("/billing-records");
  expect(json).toContain("Missing history remains unknown");
  expect(json).not.toContain("storage_path");
  expect(json).toContain('"automatic_repairs":false');
});
