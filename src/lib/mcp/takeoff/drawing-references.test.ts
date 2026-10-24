import { describe, expect, it } from "vitest";
import { drawingReferences, drawingReferenceSection } from "./drawing-references";
import type { SheetInspection, VectorObject } from "./pdf";
import { renderHtml } from "../cards/html";

const caption = (text: string, x = 0.1, y = 0.1): VectorObject => ({
  kind: "text",
  text,
  bounds: { x, y, width: 0.2, height: 0.02 },
});
const sheet = (
  objects: VectorObject[],
  truncated = false,
): Pick<SheetInspection, "objects" | "truncated"> => ({ objects, truncated });

describe("source drawing references", () => {
  it("surfaces distinct detail labels from the selected sheet, with their source positions and no invented quantities", () => {
    const review = drawingReferences(
      sheet([
        caption("PIER 'B' DETAIL", 0.5, 0.8),
        caption("PIER 'A' DETAIL", 0.5, 0.7),
        caption("COLUMN SCHEDULE", 0.7, 0.5),
        caption("SEE PIER DETAIL"),
        caption("PLAN"),
      ]),
      "S-100",
      [],
    );
    expect(review.references.map((r) => r.title)).toEqual([
      "COLUMN SCHEDULE",
      "PIER 'A' DETAIL",
      "PIER 'B' DETAIL",
    ]);
    expect(review.references[1].bounds).toEqual({ x: 0.5, y: 0.7, width: 0.2, height: 0.02 });
    expect(review.references.every((r) => r.line_numbers.length === 0)).toBe(true);
    expect(review.coverage_complete).toBe(false);
    const section = drawingReferenceSection(review);
    expect(section.rows[1].cells[1]).toContain("Confirm included, excluded or covered elsewhere");
    expect(section.rows.every((r) => !r.flag)).toBe(true);
  });

  it("ties an explicit citation to its sheet without confusing Pier A with Pier B or declaring a quantity measured", () => {
    const review = drawingReferences(
      sheet([caption("PIER 'A' DETAIL"), caption("PIER 'B' DETAIL")]),
      "S-100",
      [
        { line_no: 1, sheet: " s100 ", detail: "Pier A detail, longitudinal steel" },
        { line_no: 2, sheet: "S-101", detail: "Pier B detail" },
        { line_no: 3, sheet: "S-100", detail: "Typical pier" },
      ],
    );
    expect(review.references.map((r) => r.line_numbers)).toEqual([[1], []]);
    expect(drawingReferenceSection(review).rows[1].cells[1]).toContain(
      "Confirm that the required quantities are measured",
    );
    expect(review.coverage_complete).toBe(false);
  });

  it("identifies drawing references in another trade without a fixed foundation checklist", () => {
    const review = drawingReferences(
      sheet([
        caption("LIGHT FIXTURE SCHEDULE"),
        caption("Roof Drainage Plan", 0.2, 0.3),
        caption("WALL SECTION"),
      ]),
      "E-200",
      [{ line_no: 8, sheet: "E-200", detail: "Light fixture schedule, type B" }],
    );
    expect(review.references).toHaveLength(3);
    expect(
      review.references.find((r) => r.title === "LIGHT FIXTURE SCHEDULE")?.line_numbers,
    ).toEqual([8]);
  });

  it("keeps missing text and truncated extraction visibly unresolved", () => {
    for (const truncated of [false, true]) {
      const review = drawingReferences(sheet([], truncated), "S-100", []);
      const text = drawingReferenceSection(review)
        .rows.flatMap((r) => r.cells)
        .join(" ");
      expect(text).toContain("Review the sheet visually");
      expect(text).toContain("coverage remain unverified");
      expect(review.coverage_complete).toBe(false);
      if (truncated) expect(text).toContain("reference list is partial");
    }
  });

  it("bounds long inventories and retains a partial-list warning", () => {
    const review = drawingReferences(
      sheet(Array.from({ length: 45 }, (_, i) => caption(`WALL ${i} DETAIL`))),
      "S-100",
      [],
    );
    expect(review.references).toHaveLength(40);
    expect(review.omitted_references).toBe(5);
    expect(drawingReferenceSection(review).rows.at(-1)?.cells[0]).toContain("partial");
  });

  it("displays PDF labels as escaped data and ignores invalid source locations", () => {
    const review = drawingReferences(
      sheet([
        caption('<img src=x onerror="alert(1)"> PIER DETAIL'),
        caption("OUTSIDE DETAIL", -0.2, 0.3),
        caption("DUPLICATE DETAIL"),
        caption("DUPLICATE DETAIL"),
      ]),
      "S-100",
      [],
    );
    expect(review.references).toHaveLength(2);
    const html = renderHtml({
      state: "progress",
      title: "Scope review",
      sections: [drawingReferenceSection(review)],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
