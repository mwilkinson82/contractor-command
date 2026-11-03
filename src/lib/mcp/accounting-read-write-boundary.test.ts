import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ allowed: true, reads: 0, calls: [] as string[] }));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) => fn({ rpc: async (name: string) => { state.calls.push(name); throw new Error("Unexpected mutation RPC"); } }),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: unknown) => { if (error) throw error; },
}));
vi.mock("./jobs", () => ({ resolveJob: async () => {
  if (!state.allowed) throw new Error("Full project access required");
  return { job_id: "00000000-0000-4000-8000-000000000901", job_number: "SYN-READ", company_id: "00000000-0000-4000-8000-000000000902", scope: "full" };
} }));
vi.mock("../accounting-report-read", () => ({ accountingIO: (sb: unknown) => sb,
  readAccountingReport: async () => {
    state.reads++;
    return { asOf: "2026-10-31", from: null, metrics: [], basis: "Synthetic empty evidence", limitations: ["Cost coverage unknown"], rows: [], costCodes: [] };
  },
}));
import { accountingReport } from "./tools/accounting-report-tools";
import { jobCostSubmissionRecord, jobCostAccountingRecord } from "./tools/job-cost-submission-tools";
const call = (tool: any, args: Record<string, unknown>) => tool.handler(args, {} as never);
beforeEach(() => { state.allowed = true; state.reads = 0; state.calls = []; });

it("a report missing its job asks only for the job without preparing a bill", async () => {
  const result = await call(accountingReport, {});
  expect(result.structuredContent.missing).toEqual(["job_number"]);
  expect(state.reads).toBe(0);
  expect(state.calls).toEqual([]);
});

it("reads an accounting report without invoking cost review/save/approval RPCs", async () => {
  const result = await call(accountingReport, { job_number: "SYN-READ", as_of: "2026-10-31", page: 1 });
  expect(result.structuredContent.report_url).toContain("/accounting?");
  expect(state.reads).toBe(1);
  expect(state.calls).toEqual([]);
});

it("a report remains denied when existing job scope denies access", async () => {
  state.allowed = false;
  await expect(call(accountingReport, { job_number: "SYN-READ", as_of: "2026-10-31", page: 1 })).rejects.toThrow("Full project access required");
  expect(state.reads).toBe(0);
  expect(state.calls).toEqual([]);
});

it.each([jobCostSubmissionRecord, jobCostAccountingRecord])("write actions still reject a save without exact reviewed confirmation ($name)", async tool => {
  await expect(call(tool, { job_number: "SYN-READ", step: "save", confirmed: false })).rejects.toThrow(/Review and confirm the exact/);
  expect(state.calls).toEqual([]);
});

it("an incomplete submission review cannot invent bill facts or create a review record", async () => {
  const result = await call(jobCostSubmissionRecord, { job_number: "SYN-READ", step: "review" });
  expect(result.structuredContent.saved).toBe(false);
  expect(result.structuredContent.missing.length).toBeGreaterThan(0);
  expect(state.calls).toEqual([]);
});
