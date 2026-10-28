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
const snapshot = () => ({
  snapshot_version: 1,
  ...scope,
  complete: true,
  billing: b,
  originals: { documents: [], links: [] },
});
beforeEach(() => {
  vi.clearAllMocks();
  state.gate.mockResolvedValue(undefined);
  state.resolve.mockResolvedValue({ ...scope, job_number: "SYN", scope: "full" });
  state.rpc.mockResolvedValue({ data: snapshot(), error: null });
});
const read = () => readReconciliation({ rpc: state.rpc } as unknown as Sb, scope);
it("uses one scoped snapshot and explicitly leaves AP unavailable", async () => {
  const r = await read();
  expect(r.coverage.billing.state).toBe("checked");
  expect(r.coverage.ap.state).toBe("unavailable");
  expect(r.consistent_snapshot).toBe(true);
  expect(r.evidence_key).toMatch(/^[0-9a-f]{64}$/);
  expect(state.rpc.mock.calls).toEqual([
    ["mcp_billing_reconciliation_snapshot", { _job: scope.job_id }],
  ]);
});
it("withholds all findings for absent, incomplete, wrong-scope and unsupported snapshots", async () => {
  for (const data of [
    null,
    { ...snapshot(), complete: false },
    { ...snapshot(), snapshot_version: 2 },
    { ...snapshot(), company_id: "00000000-0000-4000-8000-000000000099" },
    { ...snapshot(), job_id: "00000000-0000-4000-8000-000000000099" },
  ]) {
    state.rpc.mockResolvedValue({ data, error: null });
    const r = await read();
    expect(r.consistent_snapshot).toBeFalsy();
    expect(r.coverage.billing.state).toBe("unavailable");
    expect(r.findings).toEqual([]);
  }
  state.rpc.mockResolvedValue({
    data: null,
    error: { code: "PGRST202", message: "Could not find mcp_billing_reconciliation_snapshot" },
  });
  expect((await read()).coverage.billing.state).toBe("unavailable");
});
it("returns billing findings independently from unavailable AP", async () => {
  const invoiceId = "00000000-0000-4000-8000-000000000003";
  const bill = {
    ...b,
    invoices: [
      {
        id: invoiceId,
        ...scope,
        document_number: "SYN-1",
        kind: "invoice",
        credit_for: null,
        versions: [
          {
            invoice_id: invoiceId,
            job_id: scope.job_id,
            version: 1,
            status: "submitted",
            net_due_cents: 10000,
            source: "Synthetic",
            reason: null,
          },
        ],
      },
    ],
  };
  state.rpc.mockResolvedValue({ data: { ...snapshot(), billing: bill }, error: null });
  const r = await read();
  expect(r.coverage.ap.state).toBe("unavailable");
  expect(r.findings.find((f) => f.code === "invoice_unmatched")?.amount_cents).toBe("10000");
});
it("never treats a denied snapshot read or missing helper as an unavailable optional function", async () => {
  state.rpc.mockResolvedValue({
    data: null,
    error: { code: "42501", message: "Full project access required" },
  });
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
