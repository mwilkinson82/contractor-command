import { describe, expect, it } from "vitest";
import { bindScopeSources, documentScopeSchema, reconcileDocumentScope } from "./document-scope";
import type { DrawingRecord } from "../drawing-set";
import type { EngineSnapshot } from "./state";
import type { DocumentScopeRequirement } from "../estimating";

const requirement = (over: Partial<DocumentScopeRequirement> = {}): DocumentScopeRequirement => ({
  id: "S100-N13",
  title: "Termite treatment",
  kind: "quantity",
  source_type: "sheet",
  source_ref: "S-100",
  citation: "Foundation note 13",
  excerpt: "Fictional treatment requirement",
  line_nos: [],
  confidence: "high",
  evidence_basis: "seen",
  ...over,
});
describe("job-document scope reconciliation", () => {
  it("retains unmapped document scope and watch instructions with exact citations", () => {
    const state = {
      lines: [],
      geometry: [],
      calibrations: [],
      passes: [],
      takeoff_version: 1,
    } as unknown as EngineSnapshot;
    const result = reconcileDocumentScope(state, [
      requirement(),
      requirement({
        id: "S100-N10",
        title: "Hooks at corners",
        kind: "watch",
        citation: "Foundation note 10",
      }),
    ]);
    expect(result.map((r) => r.classification)).toEqual(["Not found", "Watch"]);
    expect(result[0]).toMatchObject({
      source_ref: "S-100",
      citation: "Foundation note 13",
      confidence: "high",
      evidence_basis: "seen",
      scope_complete: false,
    });
    expect(result[0].reason).toContain("not a claim that it is absent from the drawings");
  });
  it("cannot turn an unmeasured mapped line into Measured using high model confidence", () => {
    const state = {
      lines: [{ id: "line", line_no: 103, item: "WF-1 footing length", unit: "LF" }],
      geometry: [],
      calibrations: [],
      passes: [],
      takeoff_version: 1,
    } as unknown as EngineSnapshot;
    expect(
      reconcileDocumentScope(state, [requirement({ line_nos: [103] })])[0].classification,
    ).toBe("Verify");
  });
  it("binds a sheet paragraph to the exact stored source and refuses an unrelated ID or fingerprint", () => {
    const source = {
      id: "source-id",
      filename: "S100.pdf",
      version: 2,
      sheets: ["S-100"],
      content_hash: "a".repeat(64),
    } as DrawingRecord;
    expect(bindScopeSources([requirement()], [source])[0]).toMatchObject({
      source_id: "source-id",
      source_hash: "a".repeat(64),
    });
    expect(() => bindScopeSources([requirement({ source_id: "other-id" })], [source])).toThrow(
      "stored source",
    );
    expect(() =>
      bindScopeSources([requirement({ source_hash: "b".repeat(64) })], [source]),
    ).toThrow("fingerprint");
  });
  it("requires paragraphs, excerpts and distinct IDs", () => {
    expect(documentScopeSchema.safeParse([requirement({ excerpt: "" })]).success).toBe(false);
    expect(documentScopeSchema.safeParse([requirement(), requirement()]).success).toBe(false);
  });
});
