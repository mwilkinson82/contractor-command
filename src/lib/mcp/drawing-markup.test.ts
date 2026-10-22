import { describe, expect, it } from "vitest";
import { drawingMarkupCard } from "./drawing-markup";
import { prepareLines, renderTakeoff, settle } from "./estimating";

describe("drawing markup callouts", () => {
  it("keeps a normal callout blue and embeds the drawing in a styled card", () => {
    const card = drawingMarkupCard({ sheet: "S-100", callouts: [{ label: "Grid A" }] });
    expect(card.svg).toContain("#1E5FED");
    expect(card.svg).not.toContain("#DC2626");
    expect(card.html).toContain("<!doctype html");
    expect(card.html).toContain("<article class=\"card\"");
    expect(card.html).toContain("<svg");
    expect(card.html.trim().startsWith("<svg")).toBe(false);
    expect(card.html).not.toContain("#DC2626");

    const lines = prepareLines([
      {
        item: "Wall footing",
        sheet: "S-100",
        unit: "LF",
        basis: "measured",
        value: 174,
        markup_ref: "Grid A",
      },
    ]);
    const view = renderTakeoff("2701 – Harbor", lines, settle(lines, [], [], { role: "gc", trades: [] }), "Revision used: not stated.");
    const svg = view.text.slice(view.text.indexOf("<svg"), view.text.indexOf("</svg>"));
    expect(view.text).toContain("<article class=\"card\"");
    expect(svg).toContain("Grid A");
    expect(svg).toContain("#1E5FED");
    expect(svg).not.toContain("#DC2626");
    expect(view.structured.markup).toMatchObject({ embedded: true });
  });

  it("uses red only when a callout is flagged risk, delay, or overdue", () => {
    for (const flag of ["risk", "delay", "overdue"] as const) {
      const card = drawingMarkupCard({ callouts: [{ label: flag, flag }] });
      expect(card.svg).toContain("#DC2626");
      expect(card.svg).toContain(`data-alert="${flag}"`);
    }
  });
});
