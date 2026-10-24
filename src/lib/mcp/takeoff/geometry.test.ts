import { describe, expect, it } from "vitest";
import { calibrate, measure, mergeOverlapPins, type SheetSpace, type Point } from "./geometry";
const space: SheetSpace = {
  source_id: "stored-source",
  source_hash: "a".repeat(64),
  page: 1,
  width: 720,
  height: 360,
};
const p = (x: number, y: number): Point => ({ x, y });
const calibration = () =>
  calibrate(space, {
    region: "Foundation plan",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    version: 1,
    reference: { points: [p(0, 0), p(1, 0)], distance: 100, unit: "ft" },
    method: "estimator",
    confidence: "high",
    confirmed: true,
  });
describe("takeoff quantities are geometry", () => {
  it("counts pins without needing scale", () =>
    expect(measure(space, { kind: "pins", points: [p(0.1, 0.2), p(0.3, 0.4)] })).toMatchObject({
      value: 2,
      unit: "EA",
      calibration_version: null,
    }));
  it("measures physical axes rather than treating normalized coordinates as square", () => {
    expect(
      measure(space, { kind: "polyline", points: [p(0, 0), p(1, 0), p(1, 1)] }, calibration())
        .value,
    ).toBeCloseTo(150);
  });
  it("deducts a net opening from the exact highlighted boundary", () => {
    const shape = {
      kind: "polygon" as const,
      points: [p(0, 0), p(1, 0), p(1, 1), p(0, 1)],
      holes: [[p(0.1, 0.1), p(0.2, 0.1), p(0.2, 0.2), p(0.1, 0.2)]],
    };
    expect(measure(space, shape, calibration())).toMatchObject({
      unit: "SF",
      calibration_version: 1,
    });
    expect(measure(space, shape, calibration()).value).toBeCloseTo(4950);
    expect(
      measure(space, { ...shape, points: shape.points.slice().reverse() }, calibration()).value,
    ).toBeCloseTo(4950);
  });
  it("derives concrete volume from area and a cited depth in inches", () => {
    const result = measure(
      space,
      {
        kind: "rect",
        points: [p(0, 0), p(1, 1)],
        depth: {
          value: 6,
          unit: "in",
          source_id: "stored-source",
          sheet: "S-100",
          detail: "Slab note 3",
        },
      },
      calibration(),
    );
    expect(result.unit).toBe("CY");
    expect(result.value).toBeCloseTo((5000 * 0.5) / 27);
  });
  it.each(["in", "m", "mm"] as const)(
    "converts a %s calibration to the same physical result",
    (unit) => {
      const c = calibration();
      const value = { in: 1200, m: 30.48, mm: 30480 }[unit];
      const scaled = calibrate(space, {
        ...c,
        reference: { points: c.reference.points, distance: value, unit },
      });
      expect(
        measure(space, { kind: "polyline", points: [p(0, 0), p(1, 0)] }, scaled).value,
      ).toBeCloseTo(100);
    },
  );
  it("is independent of render dpi", () => {
    const c = calibration();
    expect(
      measure(space, { kind: "rect", points: [p(0.1, 0.1), p(0.5, 0.5)] }, c).value,
    ).toBeCloseTo(800);
    // No render dimensions or pixels-per-unit are accepted by the measurement API.
    expect(c.feet_per_point).toBeCloseTo(100 / 720);
  });
  it("keeps different detail scales separate and rejects a shape that crosses them", () => {
    const c = calibrate(space, {
      ...calibration(),
      region: "Detail 4",
      bounds: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      reference: { points: [p(0.5, 0.1), p(1, 0.1)], distance: 10, unit: "ft" },
    });
    expect(
      measure(space, { kind: "polyline", points: [p(0.5, 0.1), p(1, 0.1)] }, c).value,
    ).toBeCloseTo(10);
    expect(() => measure(space, { kind: "polyline", points: [p(0.4, 0.1), p(1, 0.1)] }, c)).toThrow(
      /outside its calibrated/,
    );
  });
  it.each([undefined, { ...calibration(), confirmed: false }])(
    "requires confirmed calibration for a run",
    (c) =>
      expect(() => measure(space, { kind: "polyline", points: [p(0, 0), p(1, 0)] }, c)).toThrow(
        /Calibrate/,
      ),
  );
  it.each([NaN, Infinity, -1, 1.01])("rejects invalid coordinates %s", (x) =>
    expect(() => measure(space, { kind: "pins", points: [p(x, 0.5)] })).toThrow(/Every point/),
  );
  it("will not accept an unlocated quantity or count the same pin twice", () => {
    expect(() => measure(space, { kind: "pins", points: [] })).toThrow(/unlocated/);
    expect(() => measure(space, { kind: "pins", points: [p(0.1, 0.1), p(0.1, 0.1)] })).toThrow(
      /twice/,
    );
  });
  it("rejects a crossing area, an outside opening and overlapping openings", () => {
    const outer = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    expect(() =>
      measure(
        space,
        { kind: "polygon", points: [p(0, 0), p(1, 1), p(1, 0), p(0, 1)] },
        calibration(),
      ),
    ).toThrow(/cross/);
    expect(() =>
      measure(
        space,
        { kind: "polygon", points: outer, holes: [[p(0, 0), p(0.2, 0), p(0.1, 0.1)]] },
        calibration(),
      ),
    ).toThrow(/inside/);
    const hole = [p(0.1, 0.1), p(0.3, 0.1), p(0.2, 0.3)];
    expect(() =>
      measure(space, { kind: "polygon", points: outer, holes: [hole, hole] }, calibration()),
    ).toThrow(/overlap/);
  });
  it("does not measure zero length or volume without a citation", () => {
    expect(() =>
      measure(space, { kind: "polyline", points: [p(0.1, 0.1), p(0.1, 0.1)] }, calibration()),
    ).toThrow(/length/);
    expect(() =>
      measure(
        space,
        {
          kind: "rect",
          points: [p(0, 0), p(1, 1)],
          depth: { value: 6, unit: "in", source_id: "", sheet: "", detail: "" },
        },
        calibration(),
      ),
    ).toThrow(/citation/);
  });
  it("merges overlap duplicates without merging adjacent pins in one tile", () => {
    const left = { x: 0, y: 0, width: 0.6, height: 1 },
      right = { x: 0.4, y: 0, width: 0.6, height: 1 };
    const pins = mergeOverlapPins(
      [
        { tile: left, points: [p(0.5, 0.5), p(0.51, 0.5)] },
        { tile: right, points: [p(0.501, 0.5), p(0.511, 0.5)] },
      ],
      space,
    );
    expect(pins).toHaveLength(2);
  });
});
