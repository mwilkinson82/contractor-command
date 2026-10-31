import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ allowed: true, report: null as unknown, resolve: vi.fn() }));
vi.mock("./guard", () => ({
  run: async (_t: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) => fn({}),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
}));
vi.mock("./jobs", () => ({
  resolveJob: async (...args: unknown[]) => {
    state.resolve(...args);
    if (!state.allowed) throw new Error("Full project access required");
    return {
      job_id: "00000000-0000-4000-8000-000000000001",
      job_number: "SYN-1",
      company_id: "00000000-0000-4000-8000-000000000002",
    };
  },
}));
vi.mock("../accounting-report-read", () => ({
  accountingIO: (sb: unknown) => sb,
  readAccountingReport: async () => state.report,
}));
import { buildAccountingReport } from "../accounting-report";
import { accountingReport } from "./tools/accounting-report-tools";
beforeEach(() => {
  state.allowed = true;
  state.resolve.mockClear();
  state.report = buildAccountingReport(
    {
      jobId: "00000000-0000-4000-8000-000000000001",
      capturedAt: "2026-10-31T00:00:00Z",
      billing: {
        currency: "USD",
        invoices: [],
        receipts: [],
        allocations: [],
        receipt_reversals: [],
      },
      budgets: [
        {
          job_id: "00000000-0000-4000-8000-000000000001",
          key: "PRIVATE_BUDGET",
          status: "known",
          value: { amount: 9000 },
        },
      ],
      costs: { available: false, reason: "PRIVATE_COST_CANARY" },
      orders: { available: false, reason: "PRIVATE_PO_CANARY" },
    },
    { asOf: "2026-10-31" },
  );
});
it("routes the natural customer-statement request to statement mode without internal report evidence", async () => {
  const result = await accountingReport.handler(
    {
      job_number: "SYN-1",
      company_id: undefined,
      from: undefined,
      as_of: "2026-10-31",
      report_type: "statement",
      page: 1,
    },
    {} as never,
  );
  const data = result.structuredContent as Record<string, unknown>;
  expect(data.report_url).toContain("report_type=statement");
  expect(data.report_type).toBe("statement");
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE_COST_CANARY|PRIVATE_BUDGET|PRIVATE_PO_CANARY|billing-records/,
  );
  expect(state.resolve.mock.calls[0][3]).toBe("full");
});
it("does not return a statement link after the existing scope resolver denies access", async () => {
  state.allowed = false;
  await expect(
    accountingReport.handler(
      {
        job_number: "SYN-1",
        company_id: undefined,
        from: undefined,
        as_of: "2026-10-31",
        report_type: "statement",
        page: 1,
      },
      {} as never,
    ),
  ).rejects.toThrow(/Full project access/);
});
