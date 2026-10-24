import { describe, it, expect } from "vitest";
import { automaticCalibration, scaleLock, statedScaleCalibration } from "./calibration";
import { tileGrid, type SheetInspection, type VectorObject } from "./pdf";
const space = {
  source_id: "source",
  source_hash: "a".repeat(64),
  page: 1,
  width: 720,
  height: 360,
};
const line = (a: { x: number; y: number }, b: { x: number; y: number }): VectorObject => ({
  kind: "path",
  points: [a, b],
  bounds: {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  },
});
const inspection = (): SheetInspection => ({
  width: 720,
  height: 360,
  text: 'SCALE 1/4" = 1\'-0"',
  tiles: tileGrid(720, 360),
  truncated: false,
  objects: [],
});
function dimension(i: SheetInspection, x: number, y: number, label: string, length: number) {
  i.objects.push(
    {
      kind: "text",
      text: label,
      bounds: { x: x + length / 2 - 0.01, y: y - 0.01, width: 0.02, height: 0.02 },
    },
    line({ x, y }, { x: x + length, y }),
    line({ x, y: y - 0.01 }, { x, y: y + 0.01 }),
    line({ x: x + length, y: y - 0.01 }, { x: x + length, y: y + 0.01 }),
  );
}
describe("independent scale confirmation", () => {
  it("offers one question with two choices, and never asks again after a saved lock", () => {
    const unresolved = scaleLock('SCALE As Noted. Detail 3/16" = 1\'-0"', false);
    expect(unresolved.as_noted).toBe(true);
    expect(unresolved.question).toBe("How would you like to lock the scale for this plan region?");
    expect(unresolved.choices).toHaveLength(2);
    expect(unresolved.choices[0]).toContain("known dimension");
    expect(unresolved.choices[1]).toContain("true size");
    expect(scaleLock("As Noted", true)).toMatchObject({
      locked: true,
      question: null,
      choices: [],
    });
  });
  it("locks 3/16 at true size without falsely claiming a dimension check", () => {
    const cal = statedScaleCalibration(
      space,
      '3/16" = 1\'-0"',
      "Main plan",
      { x: 0, y: 0, width: 1, height: 1 },
      true,
    );
    expect(cal.feet_per_point).toBeCloseTo(1 / 13.5);
    expect(cal).toMatchObject({ confirmed: true, method: "title_block", confidence: "medium" });
    expect(() =>
      statedScaleCalibration(space, '3/16" = 1\'-0"', "Plan", cal.bounds, false),
    ).toThrow("true size");
    for (const text of ["As Noted", "NTS", '1/4" = 1\'-0" and 1/2" = 1\'-0"'])
      expect(() => statedScaleCalibration(space, text, "Plan", cal.bounds, true)).toThrow();
  });
  it("will not confirm a title alone, one dimension, NTS or mixed scales", () => {
    const i = inspection();
    expect(automaticCalibration(space, i)).toBeNull();
    dimension(i, 0.1, 0.2, "8'-0\"", 0.2);
    expect(automaticCalibration(space, i)).toBeNull();
    dimension(i, 0.1, 0.5, "12'-0\"", 0.3);
    i.text += " N.T.S.";
    expect(automaticCalibration(space, i)).toBeNull();
    i.text = '1/4" = 1\'-0" and 1/2" = 1\'-0"';
    expect(automaticCalibration(space, i)).toBeNull();
  });
  it("confirms matching title scale against two independent dimension strings with witness ticks", () => {
    const i = inspection();
    dimension(i, 0.1, 0.2, "8'-0\"", 0.2);
    dimension(i, 0.1, 0.5, "12'-0\"", 0.3);
    const checked = automaticCalibration(space, i);
    expect(checked?.calibration.confirmed).toBe(true);
    expect(checked?.calibration.feet_per_point).toBeCloseTo(1 / 18);
    expect(checked?.checks).toHaveLength(2);
  });
  it("refuses dimensions that disagree with the title beyond one percent", () => {
    const i = inspection();
    dimension(i, 0.1, 0.2, "8'-0\"", 0.2);
    dimension(i, 0.1, 0.5, "13'-0\"", 0.3);
    expect(automaticCalibration(space, i)).toBeNull();
  });
});
