import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readPdfiumTitleBlockRuns } from "./pdf-renderer";
import {
  proposeSheetIndex,
  sheetDiscipline,
  sheetFocus,
  sheetTags,
  tradeDisciplines,
  tradeFirstOrder,
  type TextRun,
} from "./sheet-index";

const run = (text: string, x: number, y: number, h = 0.01, w = 0.04): TextRun => ({
  text,
  x,
  y,
  w,
  h,
});

/** A 36x24 sheet with a bottom-right title block and plan text that cites other sheets.
 *  A rotated sheet is stored portrait with /Rotate 90, the way many plotters save drawings,
 *  and its text is drawn so it reads upright once displayed. Positions are display fractions. */
async function drawingSet(
  pages: { sheet?: string; title?: string; rotate?: boolean; refs?: string[] }[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = spec.rotate ? pdf.addPage([1728, 2592]) : pdf.addPage([2592, 1728]);
    if (spec.rotate) page.setRotation(degrees(90));
    const put = (text: string, dx: number, dy: number, size: number) =>
      spec.rotate
        ? page.drawText(text, { x: 1728 * dy, y: 2592 * dx, size, font, rotate: degrees(90) })
        : page.drawText(text, { x: 2592 * dx, y: 1728 * (1 - dy), size, font });
    for (const [i, ref] of (spec.refs ?? []).entries()) put(ref, 0.1 + i * 0.08, 0.5, 10);
    if (spec.title) put(spec.title, 0.84, 0.91, 14);
    put("SHEET NO.", 0.84, 0.935, 8);
    if (spec.sheet) put(spec.sheet, 0.84, 0.975, 36);
  }
  return new Uint8Array(await pdf.save());
}

describe("sheet disciplines and trade focus", () => {
  it("reads the discipline from the sheet number", () => {
    expect(sheetDiscipline("E1")?.label).toBe("Electrical");
    expect(sheetDiscipline("E-201")?.label).toBe("Electrical");
    expect(sheetDiscipline("FP-101")?.label).toBe("Fire protection");
    expect(sheetDiscipline("FA1.0")?.label).toBe("Fire alarm");
    expect(sheetDiscipline("C1.0")?.label).toBe("Civil");
    expect(sheetDiscipline("A4.1")?.label).toBe("Architectural");
    expect(sheetDiscipline("Cover")).toBeNull();
  });

  it("keeps a self-performer's trade sheets first and marks the rest coordination", () => {
    const sheets = ["C1.0", "A1.0", "E1", "A4.1", "E2", "Cover"];
    expect(sheetFocus("E1", "self_performer", ["Electrical"])).toBe("trade");
    expect(sheetFocus("A4.1", "self_performer", ["Electrical"])).toBe("coordination");
    expect(sheetFocus("Cover", "self_performer", ["Electrical"])).toBeNull();
    expect(tradeFirstOrder(sheets, "self_performer", ["Electrical"])).toEqual([3, 5, 6, 1, 2, 4]);
    expect(sheetTags(["E1"], "self_performer", ["Electrical"])).toEqual([
      { discipline: "Electrical", focus: "trade" },
    ]);
  });

  it("treats a general contractor or unknown trades as owning every sheet", () => {
    expect(tradeDisciplines("general_contractor", ["Electrical"])).toBe("all");
    expect(tradeDisciplines("self_performer", [])).toBe("all");
    expect(tradeDisciplines("self_performer", ["Underwater basket weaving"])).toBe("all");
    expect(tradeFirstOrder(["C1.0", "E1"], "general_contractor", ["Electrical"])).toEqual([1, 2]);
  });
});

describe("proposeSheetIndex", () => {
  it("prefers the large title-block number over sheet references elsewhere", () => {
    const proposal = proposeSheetIndex([
      {
        page: 1,
        runs: [
          run("SEE A4.1", 0.3, 0.4),
          run("1/E2", 0.5, 0.5),
          run("LIGHTING PLAN", 0.85, 0.9),
          run("SHEET NO.", 0.85, 0.93, 0.005),
          run("E1", 0.85, 0.95, 0.02),
        ],
      },
    ]);
    expect(proposal.pages[0]).toMatchObject({
      sheet: "E1",
      title: "LIGHTING PLAN",
      discipline: "Electrical",
      confidence: "high",
    });
    expect(proposal.complete).toBe(true);
    expect(proposal.sheets).toEqual(["E1"]);
  });

  it("never picks between two equal candidates", () => {
    const proposal = proposeSheetIndex([
      { page: 1, runs: [run("E1", 0.85, 0.95, 0.02), run("E2", 0.9, 0.95, 0.02)] },
    ]);
    expect(proposal.pages[0].sheet).toBeNull();
    expect(proposal.pages[0].note).toMatch(/E1 or E2|E2 or E1/);
    expect(proposal.complete).toBe(false);
  });

  it("drops a name that two pages share, and flags a page with no text as likely scanned", () => {
    const proposal = proposeSheetIndex([
      { page: 1, runs: [run("E1", 0.85, 0.95, 0.02)] },
      { page: 2, runs: [run("E1", 0.85, 0.95, 0.02)] },
      { page: 3, runs: [] },
    ]);
    expect(proposal.sheets).toEqual([null, null, null]);
    expect(proposal.pages[0].note).toMatch(/more than one page/);
    expect(proposal.pages[2].note).toMatch(/scanned/);
    expect(proposal.complete).toBe(false);
  });

  it("ignores code and equipment tags that look like sheet numbers", () => {
    const proposal = proposeSheetIndex([
      {
        page: 1,
        runs: [
          run("NEC 210", 0.85, 0.85, 0.03),
          run("RTU-1", 0.9, 0.85, 0.03),
          run("M2.1", 0.85, 0.95, 0.02),
        ],
      },
    ]);
    expect(proposal.pages[0].sheet).toBe("M2.1");
  });
});

describe("readPdfiumTitleBlockRuns on a real PDF", () => {
  it("reads each page's title block, including a rotated sheet, and leaves a blank page unnamed", async () => {
    const bytes = await drawingSet([
      { sheet: "C1.0", title: "SITE PLAN", refs: ["SEE E1", "1/A4.1"] },
      { sheet: "E1", title: "LIGHTING PLAN", refs: ["SEE A4.1"] },
      { sheet: "E2", title: "POWER PLAN", rotate: true },
      {},
    ]);
    const original = bytes.slice();
    const read = await readPdfiumTitleBlockRuns(bytes, { maxPages: 50, budgetMs: 20_000 });
    expect(read.total_pages).toBe(4);
    expect(read.pages).toHaveLength(4);
    const proposal = proposeSheetIndex(read.pages);
    expect(proposal.sheets).toEqual(["C1.0", "E1", "E2", null]);
    expect(proposal.pages[1]).toMatchObject({ title: "LIGHTING PLAN", discipline: "Electrical" });
    expect(proposal.pages[2]).toMatchObject({ title: "POWER PLAN", confidence: "high" });
    expect(proposal.pages[3].sheet).toBeNull();
    expect(proposal.complete).toBe(false);
    expect(bytes).toEqual(original);
  });

  it("stops at the page cap and reports the full page count", async () => {
    const bytes = await drawingSet([{ sheet: "E1" }, { sheet: "E2" }, { sheet: "E3" }]);
    const read = await readPdfiumTitleBlockRuns(bytes, { maxPages: 2, budgetMs: 20_000 });
    expect(read.total_pages).toBe(3);
    expect(read.pages.map((p) => p.page)).toEqual([1, 2]);
  });
});
