import { describe, expect, it } from "vitest";
import {
  documentInventory,
  inventoryDocuments,
  inventoryText,
} from "./estimate-document-inventory";
import { parseState, prepareGap, renderGaps, settle } from "./estimating";
import type { DrawingRecord } from "./drawing-set";
import { estimatingContextCard } from "./cards/estimating-context";
import { NATIVE_CARD_TOOLS } from "./cards/native";
import { CARD_TOOLS } from "./cards/attach";
import { renderHtml } from "./cards/html";

describe("estimating document inventory and evidence", () => {
  it("renders every source on a backend-built card instead of truncating intake after eight lines", () => {
    const setup = parseState({ setup: { documents: [] } }).setup;
    const sources = Array.from({ length: 12 }, (_, i) => ({
      id: `source-${i}`,
      filename: `Plan-${i}.pdf`,
      version: 1,
      sheets: [`S-${100 + i}`],
    })) as DrawingRecord[];
    const inventory = documentInventory(setup, sources, []);
    const card = estimatingContextCard({
      estimate_view_kind: "intake",
      job: "QA",
      setup,
      document_inventory: inventory,
    });
    const html = renderHtml(card!);
    for (const source of sources) expect(html).toContain(source.filename);
    expect(html).toContain("Lock the scale");
    for (const tool of ["estimate_intake", "estimate_doc_review", "estimate_gap_analysis"]) {
      expect(NATIVE_CARD_TOOLS.has(tool)).toBe(true);
      expect(CARD_TOOLS.has(tool)).toBe(true);
    }
  });
  it("lists every registered source even when intake names only the last A-200 upload", () => {
    const setup = parseState({
      setup: {
        documents: [
          { name: "A-200.pdf", kind: "sheet", sheets: ["A-200"] },
          { name: "Fictional specs.pdf", kind: "spec", path: "private/spec.pdf" },
          { name: "Fictional contract.pdf", kind: "contract", path: "private/contract.pdf" },
        ],
        doc_review: { specs: [{ section: "03 30 00", title: "Concrete" }] },
      },
    }).setup;
    const sources = [
      { id: "original", filename: "Full set.pdf", version: 1, sheets: ["S-100", "A-200"] },
      { id: "newset", filename: "S100-new.pdf", version: 2, sheets: ["S-100"] },
    ] as DrawingRecord[];
    const inventory = documentInventory(setup, sources, [
      { section: "3.2", source: "Executed agreement" },
    ]);
    const text = inventoryText(inventory);
    for (const expected of [
      "Full set.pdf",
      "S100-new.pdf",
      "S-100",
      "Fictional specs.pdf",
      "Fictional contract.pdf",
      "§3.2",
      "Lock the scale",
    ])
      expect(text).toContain(expected);
    expect(text).not.toContain("No specification");
    expect(
      inventoryDocuments(setup, inventory).filter((d) => d.name === "Full set.pdf"),
    ).toHaveLength(1);
  });
  it("preserves reported gap confidence and basis and labels unrated findings conservatively", () => {
    const gap = prepareGap(
      {
        kind: "verify",
        category: "scope_seam",
        title: "Termite treatment",
        sheet: "S-100",
        spec_section: "not supplied",
        reasoning: "Note 13 requires treatment",
        confidence: "medium",
        evidence_basis: "seen",
      },
      "G-1",
    );
    const rendered = renderGaps("QA", [gap], settle([], [gap], [], { role: "gc", trades: [] }));
    expect(rendered.text).toContain("Reported confidence: medium");
    expect(rendered.text).toContain("Basis: seen");
    const legacy = { ...gap, confidence: null, evidence_basis: null };
    expect(
      renderGaps("QA", [legacy], settle([], [legacy], [], { role: "gc", trades: [] })).text,
    ).toContain("low (not rated)");
  });
});
