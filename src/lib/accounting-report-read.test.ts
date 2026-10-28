import { describe, expect, it, vi } from "vitest";
import { sources, job, company } from "../../tests/fixtures/accounting-evidence";
import {
  BUDGET_PAGE_SIZE,
  readAccountingReport,
  type AccountingIO,
} from "./accounting-report-read";
const options = { asOf: "2026-10-28" };
const now = new Date("2026-10-28T14:00:00Z");
function reader() {
  const s = sources();
  const io = {
    rpc: vi.fn(async (name: string) => ({
      data:
        name === "mcp_billing_evidence_get"
          ? s.billing
          : name === "mcp_cost_submission_read" && s.costs.available
            ? s.costs.data
            : s.orders.available
              ? s.orders.data
              : null,
      error: null,
    })),
    budgetPage: vi.fn(async () => ({ data: s.budgets, error: null })),
  };
  return { s, io };
}
describe("user-scoped accounting source adapter", () => {
  it("gates membership and project scope before any other source is read", async () => {
    const { io } = reader();
    io.rpc.mockResolvedValue({ data: null as never, error: { message: "denied" } as never });
    await expect(readAccountingReport(io, job, options, company, now)).rejects.toThrow(
      /full access/,
    );
    expect(io.rpc).toHaveBeenCalledTimes(1);
    expect(io.budgetPage).not.toHaveBeenCalled();
  });
  it("uses exact scoped RPC job and paginates stable budget keys past one response", async () => {
    const { io, s } = reader();
    io.budgetPage.mockResolvedValueOnce({
      data: Array.from({ length: BUDGET_PAGE_SIZE }, (_, i) => ({
        ...s.budgets[0],
        key: `code-${i}`,
      })),
      error: null,
    });
    const report = await readAccountingReport(io, job, options, company, now);
    expect(io.budgetPage).toHaveBeenNthCalledWith(2, job, 500, 999);
    expect(report.costCodes).toHaveLength(501);
    expect(
      io.rpc.mock.calls.every(
        (c) => (c as unknown[])[1] && ((c as unknown[])[1] as { _job: string })._job === job,
      ),
    ).toBe(true);
  });
  it("missing integrations return explicit unknowns, while denial and transport errors stop reporting", async () => {
    const { io, s } = reader();
    const unavailable: AccountingIO = {
      ...io,
      rpc: async (name) =>
        name === "mcp_billing_evidence_get"
          ? { data: s.billing, error: null }
          : { data: null, error: { code: "PGRST202", message: "missing" } },
    };
    const report = await readAccountingReport(unavailable, job, options, company, now);
    expect(report.metrics.find((m) => m.key === "actual_costs")?.cents).toBeNull();
    expect(report.limitations.join(" ")).toContain("not installed");
    unavailable.rpc = async (name) =>
      name === "mcp_billing_evidence_get"
        ? { data: s.billing, error: null }
        : { data: null, error: { code: "42501", message: "denied" } };
    await expect(readAccountingReport(unavailable, job, options, company, now)).rejects.toThrow(
      /Access or source/,
    );
  });
  it("schema drift and any nested foreign currency withhold that integration", async () => {
    const { io, s } = reader();
    if (!s.costs.available) throw new Error();
    Object.assign(s.costs.data.records[0].versions[0].facts, { currency: "EUR" });
    const report = await readAccountingReport(io, job, options, company, now);
    expect(report.metrics.find((m) => m.key === "actual_costs")?.cents).toBeNull();
    expect(report.limitations.join(" ")).toContain("currency is unsupported");
  });
  it("budget failures and cross-job data never return partial totals", async () => {
    const { io, s } = reader();
    s.budgets[0].job_id = "other";
    await expect(readAccountingReport(io, job, options, company, now)).rejects.toThrow(
      /another project/,
    );
    io.budgetPage.mockResolvedValue({
      data: null as never,
      error: { message: "network" } as never,
    });
    await expect(readAccountingReport(io, job, options, company, now)).rejects.toThrow(
      /no partial report/,
    );
  });
});
