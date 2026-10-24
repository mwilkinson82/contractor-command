import { expect, it } from "vitest";
import { currentDroppedLines } from "./history";

it("omits historical test additions from the current card while preserving real dropped scope and the saved input", () => {
  const rows = [
    { line_no: 211, item: "Trench concrete - EXAMPLE", version: 9 },
    { line_no: 218, item: "Slab base (sample)", version: 9 },
    { line_no: 400, item: "Placeholder line", version: 9 },
    { line_no: 17, item: "Equipment pole foundations", version: 3 },
    { line_no: 18, item: "Architectural concrete sample panels", version: 3 },
  ];
  expect(currentDroppedLines(rows)).toEqual([rows[3], rows[4]]);
  expect(rows).toHaveLength(5);
  expect(rows[0].item).toBe("Trench concrete - EXAMPLE");
});
