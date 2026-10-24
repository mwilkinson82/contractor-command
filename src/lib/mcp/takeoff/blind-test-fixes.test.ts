import { describe, expect, it } from "vitest";
import { describeStoredSets, resolveStoredSource, reviewFlag } from "./service";
import { geometryLabel } from "./render";
import { EXAMPLE_LINE_RE } from "../tools/estimate-tools";
import type { DrawingRecord } from "../drawing-set";

const set = (id: string, filename: string, version: number, sheets: string[]) =>
  ({ id, filename, version, sheets, content_hash: "a".repeat(64), path: `c/j/drawing-${id}/x.pdf` }) as unknown as DrawingRecord;
// Newest first, as mcp_drawing_records returns them: the newest set on the job has no S-100.
const sets = [
  set("33333333-3333-4333-8333-333333333333", "Site plan.pdf", 1, ["C-100", "C-101"]),
  set("22222222-2222-4222-8222-222222222222", "Foundation rev 3.pdf", 3, ["S-100", "S-101"]),
  set("11111111-1111-4111-8111-111111111111", "Foundation rev 1.pdf", 1, ["S-100"]),
];

describe("stored set resolution for measure and scale (blind test item 1)", () => {
  it("finds the sheet in whichever stored set holds it, newest revision first", () => {
    expect(resolveStoredSource(sets, "S-100").id).toBe("22222222-2222-4222-8222-222222222222");
    expect(resolveStoredSource(sets, "s-101 ").id).toBe("22222222-2222-4222-8222-222222222222");
    expect(resolveStoredSource(sets, "C-101").id).toBe("33333333-3333-4333-8333-333333333333");
  });
  it("honours an explicit source_id and names where the sheet actually is", () => {
    expect(resolveStoredSource(sets, "S-100", "11111111-1111-4111-8111-111111111111").version).toBe(1);
    expect(() => resolveStoredSource(sets, "S-100", "33333333-3333-4333-8333-333333333333")).toThrow(
      /not in Site plan\.pdf \(source_id 33333333[^)]*\)\. It is in Foundation rev 3\.pdf \(source_id 22222222[^)]*\) and Foundation rev 1\.pdf/,
    );
    expect(() => resolveStoredSource(sets, "S-100", "99999999-9999-4999-8999-999999999999")).toThrow(/No stored drawing set has source_id 9999/);
  });
  it("lists every stored set with its source_id when the sheet is nowhere", () => {
    expect(() => resolveStoredSource(sets, "E-401")).toThrow(/Sheet E-401 is not in any stored set.*Foundation rev 3\.pdf \(revision 3, 2 sheets, source_id 22222222/);
    expect(describeStoredSets([])).toBe("No drawing set is stored on this job.");
    expect(() => resolveStoredSource([], "S-100")).toThrow(/Choose a drawing set stored on this job/);
    expect(() => resolveStoredSource([set("4", "Unnamed.pdf", 1, [])], "S-100")).toThrow(/sheet names are needed/);
  });
});

describe("review rows are red only for a risk (blind test item 3)", () => {
  it("leaves an open quantity navy and flags a conflict or a hard gap that holds the bid", () => {
    expect(reviewFlag({ holdsBid: true, category: "scope_seam", severity: "soft" })).toBeNull();
    expect(reviewFlag({ holdsBid: true, category: "missing_on_drawings", severity: "cannot_know" })).toBeNull();
    expect(reviewFlag({ holdsBid: false, category: "conflict", severity: "hard" })).toBeNull();
    expect(reviewFlag({ holdsBid: true, category: "conflict" })).toBe("risk");
    expect(reviewFlag({ holdsBid: true, severity: "hard" })).toBe("risk");
  });
});

describe("example lines never reach a job takeoff (blind test item 4)", () => {
  it("catches the tags the test saves used and leaves real items alone", () => {
    for (const item of ["Tire seal pit - EXAMPLE", "EXAMPLE: WF-1 footing", "Slab edge forms (sample)", "placeholder line", "Example footing"])
      expect(item).toMatch(EXAMPLE_LINE_RE);
    for (const item of ["Water sampler station", "Exemplar Court curb", "WF-1 continuous footing", "Trench drain concrete"])
      expect(item).not.toMatch(EXAMPLE_LINE_RE);
  });
});

describe("markup labels (first report)", () => {
  it("gives each shape on a line its own label only when the line has several", () => {
    expect(geometryLabel(2, 1, 1)).toBe("L2");
    expect(geometryLabel(2, 1, 2)).toBe("L2.1");
    expect(geometryLabel(2, 2, 2)).toBe("L2.2");
  });
});
