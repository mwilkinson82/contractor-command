import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { CALLER_RATE_NOTICE, estimateSummaryPdf } from "./estimate-summary-pdf";

describe("caller-rate estimate PDF", () => {
  it("labels every generated summary page as separate from the reviewed bid", async () => {
    const bytes = estimateSummaryPdf({
      job: "Estimate",
      revision: "R1",
      draft: false,
      rows: Array.from({ length: 150 }, (_, i) => ({
        trade: "Finishes",
        title: `Line ${i}`,
        ref: `T-${i}`,
        qty: "1 EA",
        rate: "$1.00",
        extension: "$1.00",
      })),
      notes: [],
    });
    const doc = await PDFDocument.load(bytes);
    const raw = Buffer.from(bytes).toString("latin1");
    const notices = raw.split(CALLER_RATE_NOTICE).length - 1;
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(notices).toBe(doc.getPageCount());
  });
});
