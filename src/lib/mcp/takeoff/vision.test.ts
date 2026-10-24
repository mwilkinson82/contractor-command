import { describe, it, expect } from "vitest";
import { calibrate, type SheetSpace } from "./geometry";
import { tileGrid } from "./pdf";
import { gridPng, verifyVisionAnswer, type VisionAnswer } from "./vision";
import { decode } from "fast-png";
const tile = tileGrid(360, 360)[0],
  space: SheetSpace = {
    source_id: "source",
    source_hash: "a".repeat(64),
    page: 1,
    width: 360,
    height: 360,
  };
const cal = calibrate(space, {
  region: "Plan",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  version: 1,
  reference: {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    distance: 100,
    unit: "ft",
  },
  method: "estimator",
  confidence: "high",
  confirmed: true,
});
const p = (x: number, y: number) => ({
  column: Math.floor(x / 100),
  row: Math.floor(y / 100),
  dx: x % 100,
  dy: y % 100,
});
const image = () => new Uint8Array(tile.width * tile.height * 4).fill(255);
const ink = (rgba: Uint8Array, x: number, y: number) => {
  const i = (y * tile.width + x) * 4;
  rgba.set([24, 46, 77, 255], i);
};
const answer = (
  kind: "pins" | "polyline" | "polygon",
  points: ReturnType<typeof p>[],
  confidence = 0.95,
): VisionAnswer => ({
  findings: [{ kind, points, confidence, evidence: "Visible drawing path" }],
  uncertainties: [],
});
const check = (a: VisionAnswer, rgba: Uint8Array, kind = "count") =>
  verifyVisionAnswer({ answer: a, rgba, tile, space, calibration: cal, measure_type: kind });
describe("independent proposal checks", () => {
  it("retains a valid pin and rejects an ink-backed pin outside the confirmed room in the same finding", () => {
    const rgba = image();
    ink(rgba, 200, 200);
    ink(rgba, 800, 200);
    const result = verifyVisionAnswer({
      answer: answer("pins", [p(200, 200), p(800, 200)]),
      rgba,
      tile,
      space,
      measure_type: "count",
      count_area: { x: 0, y: 0, width: 0.5, height: 1 },
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].shape.points).toEqual([{ x: 0.2, y: 0.2 }]);
    expect(result.rejected).toEqual(["Candidate is outside the confirmed count area."]);
  });
  it("rejects a confident hallucination on a blank sheet", () => {
    expect(check(answer("pins", [p(200, 200)]), image()).accepted).toHaveLength(0);
  });
  it("does not use the blue grid itself as evidence", () => {
    const rgba = image();
    expect(decode(gridPng(rgba, tile)).width).toBe(tile.width);
    expect(check(answer("pins", [p(200, 200)]), rgba).accepted).toEqual([]);
    expect(rgba.every((v) => v === 255)).toBe(true);
  });
  it("measures visible pins without accepting them or trusting a target quantity", () => {
    const rgba = image();
    ink(rgba, 200, 200);
    ink(rgba, 400, 200);
    const r = check(answer("pins", [p(200, 200), p(400, 200)]), rgba);
    expect(r.accepted.flatMap((f) => f.shape.points)).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.2 },
    ]);
    expect(r.accepted[0]).not.toHaveProperty("measured");
    expect(r.accepted[0]).not.toHaveProperty("status");
  });
  it("refuses weak, wrong-kind and off-image proposals", () => {
    const rgba = image();
    ink(rgba, 200, 200);
    expect(check(answer("pins", [p(200, 200)], 0.7), rgba).rejected).toHaveLength(1);
    expect(check(answer("polyline", [p(200, 200), p(300, 200)]), rgba).accepted).toEqual([]);
    expect(check(answer("pins", [p(1023, 200)]), rgba).accepted).toEqual([]);
  });
  it("refuses a run joining two ink endpoints through blank space", () => {
    const rgba = image();
    ink(rgba, 200, 200);
    ink(rgba, 700, 200);
    expect(
      check(answer("polyline", [p(200, 200), p(700, 200)]), rgba, "linear").rejected[0],
    ).toMatch(/follow/);
    for (let x = 200; x <= 700; x++) ink(rgba, x, 200);
    expect(
      check(answer("polyline", [p(200, 200), p(700, 200)]), rgba, "linear").accepted,
    ).toHaveLength(1);
  });
  it("will not measure a volume without its cited depth", () => {
    const rgba = image();
    for (const [x, y] of [
      [200, 200],
      [400, 200],
      [400, 400],
      [200, 400],
    ])
      ink(rgba, x, y);
    expect(
      check(answer("polygon", [p(200, 200), p(400, 200), p(400, 400), p(200, 400)]), rgba, "volume")
        .rejected[0],
    ).toMatch(/thickness/);
  });
});
