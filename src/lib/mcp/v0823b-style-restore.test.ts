import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ACTS, ITEMS } from "./v0819-lookahead-quality.test";
import { LOOKAHEAD_ARTIFACT_LINE, SHOW_AS_IS, lookaheadView } from "./styled-views";
import { LOOKAHEAD_VIEW_SPEC, highlightLine } from "./views";
import { ALERT_COLOR } from "./alert-color";

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
  });

  it("the lookahead data is byte-equivalent to the v0.8.22 renderer", () => {
    const data = dataOnly(view);
    // Captured from lookaheadView after the render constants were restored to the v0.8.22 text.
    // The function body emits the same strings as 39c736f9 (whitespace-only source diff).
    expect(createHash("sha256").update(data).digest("hex")).toBe(
      "1325a66e4cd8e1902a51bbe5ff3130b3ef79526dbd8bdd323f7d83572311cd6a",
    );
    expect(data).toContain("2701 – Harbor Point");
    expect(data).toContain("A1110 Underground conduit rough-in");
    expect(data).toContain("blue #2563EB");
    expect(data).toContain("gray #9CA3AF");
    expect(data).toContain("red #DC2626");
  });
});
