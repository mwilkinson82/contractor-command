import { beforeEach, describe, expect, it, vi } from "vitest";
import { sources } from "../../../tests/fixtures/accounting-evidence";
import { buildAccountingReport } from "../accounting-report";
const state = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn(), run: vi.fn(), sb: {} }));
vi.mock("./guard", () => ({
  run: async (name: string, _c: unknown, opts: unknown, fn: (s: unknown) => unknown) => {
    state.run(name, opts);
    return fn(state.sb);
  },
  text: (s: string) => ({ content: [{ type: "text", text: s }] }),
}));
vi.mock("./jobs", () => ({ resolveJob: state.resolve }));
vi.mock("../accounting-report-read", () => ({
  accountingIO: () => ({}),
  readAccountingReport: state.read,
}));
import { accountingReport } from "./tools/accounting-report-tools";
beforeEach(() => {
  vi.clearAllMocks();
  const s = sources();
  state.resolve.mockResolvedValue({
    job_id: s.jobId,
    company_id: s.companyId,
    job_number: "SYN-1",
  });
  state.read.mockResolvedValue(buildAccountingReport(s, { asOf: "2026-10-28" }));
});
const call = (args: object) =>
  (
    accountingReport.handler as unknown as (
      a: object,
      c: object,
    ) => Promise<{ structuredContent: Record<string, unknown>; content: { text: string }[] }>
  )({ page: 1, ...args }, {});
describe("sparse accounting chat", () => {
  it("asks only for a missing job without reading data", async () => {
    const result = await call({});
    expect(result.structuredContent.missing).toEqual(["job_number"]);
    expect(state.read).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it("requires full scope and links private dated accountant export without a write", async () => {
    const result = await call({ job_number: "SYN-1", from: "2026-10-01", as_of: "2026-10-28" });
    expect(state.resolve).toHaveBeenCalledWith(state.sb, "SYN-1", undefined, "full");
    expect(result.content[0].text).toContain("not a complete P&L");
    expect(result.structuredContent.report_url).toContain("accounting?as_of=2026-10-28");
    expect(state.run).toHaveBeenCalledWith(
      "accounting_report",
      expect.objectContaining({ sweep: false }),
    );
  });
});
