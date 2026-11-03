import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { canonicalBidFiles, canonicalBidExport } from "./estimating-bid-files";
import { jobHeading } from "./job-label";
import type { BidBreakdown } from "./estimating-bid";

const breakdown: BidBreakdown = {
  direct: [
    { ref: "T-1", basis: "quote", quoteId: "0", amountCents: 140000 },
    { ref: "T-2", basis: "direct", quoteId: null, amountCents: 50000 },
  ],
  directCents: 190000,
  generalConditions: [{ label: "Office", ref: null, placement: "gc", amountCents: 20000 }],
  requirements: [{ label: "Permit", ref: "R-1", placement: "own_line", amountCents: 50000 }],
  generalConditionsCents: 20000,
  requirementsCents: 50000,
  overheadCents: 26000,
  profitCents: 28600,
  totalCents: 314600,
};

describe("canonical bid PDF and workbook", () => {
  const provenance = {
    companyId: "company-a",
    jobId: "job-a",
    sourceSha256: "a".repeat(64),
    selectedQuotes: [{ quoteId: "0", ref: "T-1", sub: "Trade A", description: "Paint" }],
  };
  it("preserves the real named heading and stable source provenance in both formats", () => {
    const input = {
      job: jobHeading({ job_number: "900071", name: "Synthetic Example" }),
      version: 7,
      ready: true,
      breakdown,
      provenance,
    };
    expect(input.job).toBe("900071 – Synthetic Example");
    const files = canonicalBidFiles(input)!;
    expect(files).not.toBeNull();
    for (const bytes of [files.pdf, files.xlsx]) {
      const body = new TextDecoder().decode(bytes);
      expect(body).toContain("company-a");
      expect(body).toContain("job-a");
      expect(body).toContain(provenance.sourceSha256);
      expect(body).toContain("Trade A");
    }
    expect(new TextDecoder().decode(files.xlsx)).toContain(input.job);
    expect(files.csv).toContain('"source_sha256"');
    if (process.env.ESTIMATE_EXPORT_FIXTURE_DIR) {
      writeFileSync(`${process.env.ESTIMATE_EXPORT_FIXTURE_DIR}/named-bid.pdf`, files.pdf);
      writeFileSync(`${process.env.ESTIMATE_EXPORT_FIXTURE_DIR}/named-bid.xlsx`, files.xlsx);
    }
  });
  it("keeps Unicode workbook text even when the PDF font cannot represent it", () => {
    const input = { job: "项目", version: 7, ready: true, breakdown, provenance };
    expect(canonicalBidExport(input, "pdf")).toBeNull();
    expect(new TextDecoder().decode(canonicalBidExport(input, "xlsx")!.bytes)).toContain("项目");
    expect(
      canonicalBidExport({ ...input, provenance: { ...provenance, selectedQuotes: [] } }, "xlsx"),
    ).toBeNull();
  });
  it("uses the same version and exact cents as the validated CSV", async () => {
    const files = canonicalBidFiles({ job: "Project", version: 7, ready: true, breakdown });
    expect(files).not.toBeNull();
    const result = files!;
    expect(result.csv).toContain('"total","","Bid total","","",3146.00');
    const workbook = new TextDecoder().decode(result.xlsx);
    expect(workbook).toContain("Estimate version 7");
    expect(workbook).toContain("<v>1400</v>");
    expect(workbook).toContain("<v>500</v>");
    expect(workbook).toContain("<v>260</v>");
    expect(workbook).toContain("<v>286</v>");
    expect(workbook).toContain("<v>3146</v>");
    expect(workbook).not.toContain("<v>1600</v>");
    const doc = await PDFDocument.load(result.pdf);
    expect(doc.getPageCount()).toBe(1);
    const raw = new TextDecoder().decode(result.pdf);
    expect(raw).toContain("$3,146.00");
    expect(raw).toContain("Estimate version 7");
    if (process.env.ESTIMATE_EXPORT_FIXTURE_DIR) {
      writeFileSync(`${process.env.ESTIMATE_EXPORT_FIXTURE_DIR}/bid.pdf`, result.pdf);
      writeFileSync(`${process.env.ESTIMATE_EXPORT_FIXTURE_DIR}/bid.xlsx`, result.xlsx);
    }
  });
  it("holds unready, inconsistent, unsupported text and excessive precision", () => {
    expect(canonicalBidFiles({ job: "Project", version: 7, ready: false, breakdown })).toBeNull();
    expect(
      canonicalBidFiles({
        job: "Project",
        version: 7,
        ready: true,
        breakdown: { ...breakdown, totalCents: 1 },
      }),
    ).toBeNull();
    expect(canonicalBidFiles({ job: "项目", version: 7, ready: true, breakdown })).toBeNull();
    expect(
      canonicalBidFiles({
        job: "Project",
        version: 7,
        ready: true,
        breakdown: {
          ...breakdown,
          direct: [
            { ref: "T-1", basis: "direct", quoteId: null, amountCents: 1_000_000_000_000_000 },
          ],
          directCents: 1_000_000_000_000_000,
          totalCents: 1_000_000_000_104_600,
        },
      }),
    ).toBeNull();
  });
  it("stores hostile spreadsheet text as an inline string, never a formula", () => {
    const b = { ...breakdown, requirements: [{ ...breakdown.requirements[0], label: "=1+1" }] };
    const result = canonicalBidFiles({ job: "+Project", version: 7, ready: true, breakdown: b })!;
    const workbook = new TextDecoder().decode(result.xlsx);
    expect(workbook).toContain('t="inlineStr"><is><t xml:space="preserve">=1+1 (R-1)</t>');
    expect(workbook).not.toContain("<f>");
    expect(result.csv).toContain('"\'=1+1"');
  });
});
