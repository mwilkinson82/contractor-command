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
    ["mcp_cost_reconciliation_snapshot", { _job: scope.job_id }],
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
it("keeps coverage independent when the AP snapshot is absent, denied or unsupported", async () => {
  const ap = {
    snapshot_version: 1,
    complete: true,
    status: "complete",
    ...scope,
    ap: {
      currency: null,
      currency_verified: false,
      currency_coverage: "per_version",
      cents_encoding: "decimal_string",
      coverage: "athena_cost_records_only",
      external_accounting_coverage: false,
      shared_payment_conservation_available: false,
      settlement_allocation_by_job_available: false,
      accounting_effective_date_available: false,
      accounting_effective_date_coverage: "per_posting",
      original_evidence_coverage: false,
      records: [],
    },
  };
  state.rpc.mockImplementation(async (name: string) =>
    name === "mcp_billing_reconciliation_snapshot"
      ? { data: snapshot(), error: null }
      : { data: null, error: { code: "42501", message: "permission denied" } },
  );
  const denied = await read();
  expect(denied.coverage.billing.state).toBe("checked");
  expect(denied.coverage.ap.state).toBe("unavailable");
  expect(JSON.stringify(denied)).not.toContain("permission denied");
  state.rpc.mockImplementation(async (name: string) =>
    name === "mcp_billing_reconciliation_snapshot"
      ? {
          data: null,
          error: { code: "PGRST202", message: "mcp_billing_reconciliation_snapshot missing" },
        }
      : { data: ap, error: null },
  );
  const onlyAp = await read();
  expect(onlyAp.coverage.billing.state).toBe("unavailable");
  expect(onlyAp.coverage.ap.state).toBe("checked");
  expect(onlyAp.coverage.ap_currency.state).toBe("unavailable");
  state.rpc.mockImplementation(async (name: string) =>
    name === "mcp_billing_reconciliation_snapshot"
      ? { data: snapshot(), error: null }
      : { data: { ...ap, snapshot_version: 2 }, error: null },
  );
  const unknown = await read();
  expect(unknown.coverage.billing.state).toBe("checked");
  expect(unknown.coverage.ap.state).toBe("unavailable");
  expect(unknown.findings).toEqual([]);
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
it("displays AP job totals and whole-payable findings in the actual recorded currency", async () => {
  const ap = {
    snapshot_version: 1,
    complete: true,
    status: "complete",
    ...scope,
    ap: {
      currency: null,
      currency_verified: false,
      currency_coverage: "per_version",
      cents_encoding: "decimal_string",
      coverage: "athena_cost_records_only",
      external_accounting_coverage: false,
      shared_payment_conservation_available: false,
      settlement_allocation_by_job_available: false,
      accounting_effective_date_available: true,
      accounting_effective_date_coverage: "per_posting",
      original_evidence_coverage: false,
      records: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          kind: "supplier_bill",
          posted_version: 1,
          versions: [
            {
              version: 1,
              recorded_at: "2026-10-28T00:00:00Z",
              reason: null,
              incurred_on: "2026-10-28",
              currency_code: "EUR",
              currency_source: "reviewed_submission",
              amount_cents: "5000",
              document_reference: "SYN",
              counterparty_name: "Synthetic",
              allocations: [{ job_id: scope.job_id, cost_code: "X", amount_cents: "5000" }],
            },
          ],
          accounting_approvals: [{ version: 1, approved_at: "2026-10-28T00:00:00Z" }],
          posting_events: [
            {
              version: 1,
              posted_at: "2026-10-28T00:00:00Z",
              accounting_effective_on: "2026-10-28",
            },
          ],
          business_approvals: [],
          payments: [],
          shared_allocations: [],
        },
      ],
    },
  };
  state.rpc.mockImplementation(async (name: string) =>
    name === "mcp_billing_reconciliation_snapshot"
      ? { data: snapshot(), error: null }
      : { data: ap, error: null },
  );
  const result = await (
    accountingReconciliation.handler as unknown as (args: object, ctx: object) => Promise<unknown>
  )({ job_number: "SYN", limit: 12 }, {});
  const output = JSON.stringify(result);
  expect(output).toContain("EUR 50.00");
  expect(output).not.toContain("$50.00");
  expect(output).toContain("Whole posted payable");
  expect(output).toContain("AP posted job allocations (EUR)");
  expect(output).toContain('total_findings":null');
});
