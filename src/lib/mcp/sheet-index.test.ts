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
  type Ruling,
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

// A right-hand title strip like the 2810 permit set: its left edge at x 0.88, the sheet border at
// 0.98, and field dividers across the strip. The title field runs from 0.80 to 0.88.
const vline = (x: number, y = 0.02, h = 0.96): Ruling => ({ x, y, w: 0, h });
const hline = (y: number, x = 0.88, w = 0.1): Ruling => ({ x, y, w, h: 0 });
const strip: Ruling[] = [
  vline(0.88),
  vline(0.98),
  hline(0.68),
  hline(0.8),
  hline(0.88),
  hline(0.93),
];
const stripPage = (sheet: string, title: TextRun[], extra: TextRun[] = []) => ({
  page: 1,
  rulings: strip,
  runs: [
    run("WILLOW CREEK COMMUNITY CENTER", 0.885, 0.72, 0.014, 0.09),
    ...title,
    run("SHEET NO.", 0.885, 0.935, 0.005),
    run(sheet, 0.9, 0.945, 0.025),
    ...extra,
  ],
});

describe("sheet titles from the title field (2810 permit set misses)", () => {
  it("reads both lines of a two-line title, even when a line is split into words", () => {
    const proposal = proposeSheetIndex([
      stripPage("A4.0", [
        run("REFLECTED", 0.885, 0.81, 0.012, 0.04),
        run("CEILING", 0.93, 0.81, 0.012, 0.035),
        run("PLAN", 0.885, 0.826, 0.012, 0.02),
      ]),
    ]);
    expect(proposal.pages[0]).toMatchObject({ sheet: "A4.0", title: "REFLECTED CEILING PLAN" });
  });

  it("ignores note text and view titles outside the title block", () => {
    const proposal = proposeSheetIndex([
      stripPage(
        "A7.4",
        [
          run("FEMALE B/F WASHROOM", 0.885, 0.81, 0.012, 0.08),
          run("DETAILS", 0.885, 0.826, 0.012, 0.035),
        ],
        [
          run("INTERIOR ELEVATION", 0.72, 0.9, 0.016, 0.1),
          run("POWER LINE", 0.8, 0.85, 0.018, 0.06),
          run("SEE GENERAL NOTES 4", 0.75, 0.8, 0.01, 0.08),
        ],
      ),
    ]);
    expect(proposal.pages[0].title).toBe("FEMALE B/F WASHROOM DETAILS");
  });

  it("reads a labelled title field even when the title has no usual title words", () => {
    const proposal = proposeSheetIndex([
      stripPage("A4.2", [
        run("SHEET TITLE", 0.885, 0.803, 0.005, 0.03),
        run("BUILDING ENVELOPE", 0.885, 0.815, 0.012, 0.07),
      ]),
    ]);
    expect(proposal.pages[0].title).toBe("BUILDING ENVELOPE");
  });

  it("keeps the second line of a title when the block has no drawn lines", () => {
    const proposal = proposeSheetIndex([
      {
        page: 1,
        runs: [
          run("PLUMBING SCHEDULE/", 0.86, 0.88, 0.01, 0.1),
          run("NOTES", 0.86, 0.893, 0.01, 0.03),
          run("SHEET NO.", 0.86, 0.93, 0.005),
          run("P2", 0.88, 0.95, 0.025),
        ],
      },
    ]);
    expect(proposal.pages[0]).toMatchObject({ sheet: "P2", title: "PLUMBING SCHEDULE/ NOTES" });
  });

  it("gives no title to a page with no sheet number, such as a lease schedule page", () => {
    const proposal = proposeSheetIndex([
      {
        page: 1,
        runs: [
          run("SCHEDULE C", 0.75, 0.9, 0.014, 0.08),
          run("LANDLORD'S WORK AND TENANT'S WORK", 0.75, 0.92, 0.012, 0.2),
        ],
      },
    ]);
    expect(proposal.pages[0]).toMatchObject({ sheet: null, title: null });
  });

  it("tags C-numbered cover and schedule sheets General, and a C site plan Civil", () => {
    const proposal = proposeSheetIndex([
      stripPage("C1.0", [run("COVER SHEET", 0.885, 0.81, 0.012, 0.06)]),
      stripPage("C1.1", [
        run("ROOM FINISH", 0.885, 0.81, 0.012, 0.06),
        run("SCHEDULE", 0.885, 0.826, 0.012, 0.05),
      ]),
      stripPage("C2.0", [run("SITE GRADING PLAN", 0.885, 0.81, 0.012, 0.08)]),
    ]);
    expect(proposal.pages.map((p) => [p.title, p.discipline])).toEqual([
      ["COVER SHEET", "General"],
      ["ROOM FINISH SCHEDULE", "General"],
      ["SITE GRADING PLAN", "Civil"],
    ]);
    expect(sheetDiscipline("C1.0")?.label).toBe("Civil");
    expect(sheetDiscipline("C1.0", "Code analysis")?.label).toBe("General");
    expect(sheetDiscipline("C1.0", "Site servicing schedule")?.label).toBe("Civil");
  });
});

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

  it("reads the drawn title-block lines, also inside an embedded block, and uses them for titles", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // The title block drawn once as its own small page, then placed on the sheet as a form XObject,
    // the way CAD exports often place blocks. It is 259.2 x 1658.9 points (0.1 x 0.96 of the sheet).
    const blockDoc = await PDFDocument.create();
    const blockFont = await blockDoc.embedFont(StandardFonts.Helvetica);
    const block = blockDoc.addPage([259.2, 1658.88]);
    const black = { thickness: 1 };
    block.drawRectangle({ x: 0, y: 0, width: 259.2, height: 1658.88, borderWidth: 1 });
    // Dividers at 0.93, 0.88 and 0.80 down the sheet; the title field is 0.80 to 0.88.
    for (const yFrac of [0.05 / 0.96, 0.1 / 0.96, 0.18 / 0.96])
      block.drawLine({
        start: { x: 0, y: 1658.88 * yFrac },
        end: { x: 259.2, y: 1658.88 * yFrac },
        ...black,
      });
    // Text placed in sheet fractions: y measured down from the sheet top, block starts at sheet 0.02.
    const put = (text: string, dx: number, dy: number, size: number) =>
      block.drawText(text, {
        x: 2592 * (dx - 0.88),
        y: 1728 * (0.98 - dy),
        size,
        font: blockFont,
      });
    put("REFLECTED CEILING", 0.885, 0.825, 18);
    put("PLAN", 0.885, 0.85, 18);
    put("SHEET NO.", 0.885, 0.94, 8);
    put("A4.0", 0.9, 0.975, 40);
    const [embedded] = await pdf.embedPdf(await blockDoc.save());
    const page = pdf.addPage([2592, 1728]);
    page.drawPage(embedded, { x: 2592 * 0.88, y: 1728 * 0.02 });
    // Note text on the drawing, just left of the strip, with a title word in it.
    page.drawText("POWER LINE", { x: 2592 * 0.8, y: 1728 * (1 - 0.86), size: 24, font });
    const bytes = new Uint8Array(await pdf.save());

    const read = await readPdfiumTitleBlockRuns(bytes, { maxPages: 5, budgetMs: 20_000 });
    const rulings = read.pages[0].rulings;
    expect(rulings.some((l) => l.h > 0.9 && Math.abs(l.x - 0.88) < 0.005)).toBe(true);
    expect(rulings.some((l) => l.w > 0.09 && Math.abs(l.y - 0.8) < 0.005)).toBe(true);
    const proposal = proposeSheetIndex(read.pages);
    expect(proposal.pages[0]).toMatchObject({ sheet: "A4.0", title: "REFLECTED CEILING PLAN" });
  });

  it("stops at the page cap and reports the full page count", async () => {
    const bytes = await drawingSet([{ sheet: "E1" }, { sheet: "E2" }, { sheet: "E3" }]);
    const read = await readPdfiumTitleBlockRuns(bytes, { maxPages: 2, budgetMs: 20_000 });
    expect(read.total_pages).toBe(3);
    expect(read.pages.map((p) => p.page)).toEqual([1, 2]);
  });
});
