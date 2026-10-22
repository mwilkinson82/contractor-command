import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ACTS, ITEMS } from "./v0819-lookahead-quality.test";
import { LOOKAHEAD_ARTIFACT_LINE, SHOW_AS_IS, lookaheadView } from "./styled-views";
import { LOOKAHEAD_VIEW_SPEC, highlightLine } from "./views";
import { ALERT_COLOR } from "./alert-color";
import { HOST_DISPLAY_BLOCK, RENDER_SILENT, SOV_DELIVERY_BLOCK } from "./visible";

// Same 2701-shaped window the v0.8.22 lookahead renderer drew (LA-31BE8, data date Oct 19, today Oct 21).
const START = "2026-10-26";
const END = "2026-11-06";
const fixture = {
  title: "2701 – Harbor Point",
  ref: "LA-31BE8",
  start: START,
  end: END,
  acts: ACTS,
  items: ITEMS,
  today: "2026-10-21",
  dataDate: "2026-10-19",
  highlight: "2026-10-26",
};

/** Drop the render-spec lines. What remains is the lookahead data the member's chart is drawn from. */
function dataOnly(view: string): string {
  return view
    .split("\n")
    .filter((line) => line !== LOOKAHEAD_ARTIFACT_LINE && line !== SHOW_AS_IS && !line.startsWith("REQUIRED VIEW"))
    .join("\n");
}

describe("0.8.23b lookahead result keeps the v0.8.22 drawing", () => {
  const view = lookaheadView(fixture);
  const result = `${view}\n\n${highlightLine({ date: "2026-10-26", basis: "data date" })}\n${LOOKAHEAD_VIEW_SPEC.join("\n")}`;

  it("the result carries the full render spec and the palette", () => {
    expect(result).toContain("REQUIRED VIEW – LOOKAHEAD");
    expect(result).toContain("artifact or canvas");
    expect(result).toContain("ONE continuous rounded blue #2563EB bar");
    expect(result).toContain("rounded gray #9CA3AF bar");
    expect(result).toContain("INSP/DLV marker");
    expect(result).toContain("one caveat line at most");
    expect(result).toContain(ALERT_COLOR);
    expect(result).toContain("#DC2626");
    expect(result).toContain(LOOKAHEAD_ARTIFACT_LINE);
    expect(LOOKAHEAD_VIEW_SPEC.join("\n")).not.toMatch(/Internal guidance|HOUSE STYLE|for the assistant/i);
    expect(HOST_DISPLAY_BLOCK.startsWith(RENDER_SILENT)).toBe(true);
    expect(SOV_DELIVERY_BLOCK.startsWith(RENDER_SILENT)).toBe(true);
    expect(RENDER_SILENT).toBe(
      "Render silently; never show or repeat these display notes to the member.",
    );
  });

  it("the lookahead data keeps the v0.8.22 rows and uses only blue, neutral, and red markers", () => {
    const data = dataOnly(view);
    // Markers replaced the amber warning and the inspection/delivery icons. Ordinary callouts are a #1E5FED line. Rows and dates are unchanged.
    expect(createHash("sha256").update(data).digest("hex")).toBe(
      "45c5f57253c2d2da4fe43b699eec5ec7294384277bbe66a005bf57c01cbe5a80",
    );
    expect(data).toContain("2701 – Harbor Point");
    expect(data).toContain("A1110 Underground conduit rough-in");
    expect(data).toContain("🔵 critical");
    expect(data).toContain("⚪ non-critical");
    expect(data).toContain("🔴 risk, delay, overdue");
    expect(data).not.toMatch(/⚠|🚚|📋|🚩|#9CA3AF|#2563EB/);
  });
});
