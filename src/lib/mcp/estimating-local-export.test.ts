import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Sb } from "./guard";
import type { Job } from "./jobs";
import type { BidBreakdown } from "./estimating-bid";
import { prepareLocalBidDownload, LOCAL_EXPORT_LIMIT } from "./estimating-local-export";
import { prepareHandoffDraft } from "./estimating-handoff-draft";

const quote = { sub: "=HYPERLINK(\"bad\")", description: "+SUM(1,1)", amount: 100, ref: "T-1" };
const breakdown: BidBreakdown = {
  direct: [{ ref: "T-1", basis: "quote", amountCents: 10000, quoteId: "0" }],
  directCents: 10000, generalConditions: [], requirements: [], generalConditionsCents: 0,
  requirementsCents: 0, overheadCents: 1000, profitCents: 1100, totalCents: 12100,
};
export const syntheticSource = () => ({
  version: 7, estimate: { lines: [1] }, takeoff: null,
  bid: { company_id: "company", pricing: { quotes: [quote] } },
  selection: { version: 7, current: true, decisions: [{ quote_index: 0, decision: "carry", ref: "T-1", quote,
    replace_labor_and_material: true, exclusive_to_line: true }] },
});
const job: Job = { company_id: "company", job_id: "job", job_number: "SYNTHETIC", name: "Example", scope: "contract" };
const calculate = (raw: unknown) => ({ snapshot: raw as ReturnType<typeof syntheticSource>, view: { ready: true, breakdown } });
const client = (sources = [syntheticSource(), syntheticSource()]) => {
  const rpc = vi.fn(async () => ({ data: sources.shift(), error: null }));
  return { rpc, sb: { rpc } as unknown as Sb };
};
describe("read-only local estimating export", () => {
  it.each(["pdf", "xlsx"] as const)("generates genuine %s bytes using only two guarded reads", async (format) => {
    const { sb, rpc } = client();
    const result = await prepareLocalBidDownload(sb, job, { format, expectedVersion: 7 }, calculate);
    const bytes = Uint8Array.from(atob(result.content_base64), (c) => c.charCodeAt(0));
    expect(result.filename).toBe(`Bid-summary-v7.${format}`);
    expect(result.size).toBe(bytes.length);
    expect(result.size).toBeLessThanOrEqual(10485760);
    expect(LOCAL_EXPORT_LIMIT).toBe(10485760);
    expect(rpc.mock.calls.map(() => true)).toHaveLength(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "mcp_estimate_coverage_snapshot", { _job: "job" });
    expect(rpc).toHaveBeenNthCalledWith(2, "mcp_estimate_coverage_snapshot", { _job: "job" });
    if (format === "pdf") expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    else {
      const xml = new TextDecoder().decode(bytes);
      expect(xml).toContain("xl/workbook.xml");
      expect(xml).toContain("<v>121</v>");
      expect(xml).toContain('t="inlineStr"');
      expect(xml).toContain("=HYPERLINK(&quot;bad&quot;)");
      expect(xml).not.toMatch(/<(?:\w+:)?f(?:\s|>)/i);
    }
  });
  it.each([undefined, "super"] as const)("denies scope %s before source reads", async (scope) => {
    const { sb, rpc } = client();
    await expect(prepareLocalBidDownload(sb, { ...job, scope }, { format: "pdf" }, calculate)).rejects.toThrow(/access/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("denies a failed guarded RPC and substituted company", async () => {
    const sb = { rpc: async () => ({ data: null, error: { message: "MCP_INACTIVE" } }) } as unknown as Sb;
    await expect(prepareLocalBidDownload(sb, job, { format: "pdf" }, calculate)).rejects.toThrow(/access/);
    const source = syntheticSource(); source.bid.company_id = "other";
    await expect(prepareLocalBidDownload(client([source]).sb, job, { format: "pdf" }, calculate)).rejects.toThrow(/access/);
  });
  it("denies stale requested version", async () => {
    await expect(prepareLocalBidDownload(client().sb, job, { format: "pdf", expectedVersion: 6 }, calculate)).rejects.toThrow(/changed/);
  });
  it("denies stale requested frozen provenance", async () => {
    await expect(prepareLocalBidDownload(client().sb, job, { format: "pdf", expectedSource: "a".repeat(64) }, calculate)).rejects.toThrow(/changed/);
  });
  it("denies same-version source changes during generation", async () => {
    const before = syntheticSource(), after = syntheticSource(); after.estimate.lines.push(2);
    await expect(prepareLocalBidDownload(client([before, after]).sb, job, { format: "pdf" }, calculate)).rejects.toThrow(/changed/);
  });
  it("denies version changes during generation", async () => {
    const after = syntheticSource(); after.version = 8; after.selection.version = 8;
    await expect(prepareLocalBidDownload(client([syntheticSource(), after]).sb, job, { format: "pdf" }, calculate)).rejects.toThrow(/changed/);
  });
  it("denies stale quote coverage and accepts the independently computed source digest", async () => {
    const source = syntheticSource(); source.selection.current = false;
    await expect(prepareLocalBidDownload(client([source]).sb, job, { format: "pdf" }, calculate)).rejects.toThrow(/current/);
    const receipt = await prepareHandoffDraft({ companyId: "company", jobId: "job", snapshot: syntheticSource(), ready: true, breakdown });
    expect((await prepareLocalBidDownload(client().sb, job, { format: "xlsx", expectedSource: receipt.sha256 }, calculate)).source_sha256).toBe(receipt.sha256);
  });
});