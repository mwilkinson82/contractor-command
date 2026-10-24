/** Drawing-space measurements. Coordinates belong to an immutable PDF source/page,
 * never to a preview's pixel resolution. Only this module calculates quantities. */
export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type SheetSpace = {
  source_id: string;
  source_hash: string;
  page: number;
  width: number;
  height: number;
};
export type DistanceUnit = "ft" | "in" | "m" | "mm";
export type Calibration = {
  id?: string;
  region: string;
  bounds: Bounds;
  version: number;
  reference: { points: [Point, Point]; distance: number; unit: DistanceUnit };
  feet_per_point: number;
  method: "estimator" | "dimension_string" | "title_block";
  confidence: "high" | "medium" | "low";
  confirmed: boolean;
};
export type Shape = {
  kind: "pins" | "polyline" | "polygon" | "rect";
  points: Point[];
  holes?: Point[][];
  depth?: { value: number; unit: DistanceUnit; source_id: string; sheet: string; detail: string };
};
export type Measurement = {
  value: number;
  unit: "EA" | "LF" | "SF" | "CY";
  basis: string;
  calibration_version: number | null;
};
export class MeasurementError extends Error {}
function fail(message: string): never {
  throw new MeasurementError(message);
}
const finite = (n: number) => typeof n === "number" && Number.isFinite(n);
const EPS = 1e-10;
export const feet = (value: number, unit: DistanceUnit): number => {
  if (!finite(value) || value <= 0) fail("A known distance must be greater than zero.");
  const factor = { ft: 1, in: 1 / 12, m: 1 / 0.3048, mm: 1 / 304.8 }[unit];
  if (!factor) fail("Use ft, in, m or mm for the known distance.");
  return value * factor;
};
export function validateSpace(space: SheetSpace): void {
  if (
    !finite(space.width) ||
    !finite(space.height) ||
    space.width <= 0 ||
    space.height <= 0 ||
    space.width > 144000 ||
    space.height > 144000
  )
    fail("The stored PDF page has invalid physical dimensions.");
  if (
    !Number.isSafeInteger(space.page) ||
    space.page < 1 ||
    !space.source_id ||
    !/^[a-f0-9]{64}$/i.test(space.source_hash)
  )
    fail("Measurements require the exact stored drawing source, fingerprint and page.");
}
export function point(p: Point): Point {
  if (!p || !finite(p.x) || !finite(p.y) || p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1)
    fail("Every point must be on the stored page, from 0 to 1 on each axis.");
  return { x: p.x, y: p.y };
}
export const distance = (a: Point, b: Point, s: Pick<SheetSpace, "width" | "height">) =>
  Math.hypot((a.x - b.x) * s.width, (a.y - b.y) * s.height);
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const on = (p: Point, a: Point, b: Point) =>
  Math.abs(cross(a, b, p)) < EPS &&
  p.x >= Math.min(a.x, b.x) - EPS &&
  p.x <= Math.max(a.x, b.x) + EPS &&
  p.y >= Math.min(a.y, b.y) - EPS &&
  p.y <= Math.max(a.y, b.y) + EPS;
const intersects = (a: Point, b: Point, c: Point, d: Point) => {
  const x = cross(a, b, c),
    y = cross(a, b, d),
    z = cross(c, d, a),
    w = cross(c, d, b);
  return (x * y < -EPS && z * w < -EPS) || on(c, a, b) || on(d, a, b) || on(a, c, d) || on(b, c, d);
};
function ring(input: Point[]): Point[] {
  if (!Array.isArray(input) || input.length < 3 || input.length > 1000)
    fail("An area needs 3 to 1,000 boundary points.");
  const points = input.map(point);
  if (distance(points[0], points[points.length - 1], { width: 1, height: 1 }) < EPS) points.pop();
  if (points.length < 3) fail("The area boundary is incomplete.");
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    if (distance(points[i], points[next], { width: 1, height: 1 }) < EPS)
      fail("Remove repeated boundary points.");
    for (let j = i + 1; j < points.length; j++) {
      if (j === next || (j + 1) % points.length === i) continue;
      if (intersects(points[i], points[next], points[j], points[(j + 1) % points.length]))
        fail("An area boundary cannot cross or touch itself.");
    }
  }
  return points;
}
export function contains(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (on(p, a, b)) return false; // opening must be strictly inside its boundary
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
const ringArea = (points: Point[], s: SheetSpace) =>
  (Math.abs(
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0),
  ) *
    s.width *
    s.height) /
  2;
const ringsCross = (a: Point[], b: Point[]) =>
  a.some((p, i) =>
    b.some((q, j) => intersects(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])),
  );
export function bounds(input: Bounds): Bounds {
  if (
    !input ||
    ![input.x, input.y, input.width, input.height].every(finite) ||
    input.x < 0 ||
    input.y < 0 ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.x + input.width > 1 + EPS ||
    input.y + input.height > 1 + EPS
  )
    fail("The calibration region must fit on the stored page.");
  return { ...input };
}
export function calibrate(
  space: SheetSpace,
  input: Omit<Calibration, "feet_per_point">,
): Calibration {
  validateSpace(space);
  bounds(input.bounds);
  if (!input.region.trim() || input.region.length > 100)
    fail("Name the plan or detail being calibrated.");
  const [a, b] = input.reference.points.map(point);
  const physical = distance(a, b, space);
  if (physical < 1) fail("Choose reference points at least one PDF point apart.");
  for (const p of [a, b])
    if (!inRegion(p, input.bounds)) fail("Reference points must be inside this plan or detail.");
  return {
    ...input,
    reference: { ...input.reference, points: [a, b] },
    feet_per_point: feet(input.reference.distance, input.reference.unit) / physical,
  };
}
export const inRegion = (p: Point, b: Bounds) =>
  p.x >= b.x - EPS && p.y >= b.y - EPS && p.x <= b.x + b.width + EPS && p.y <= b.y + b.height + EPS;
export function measure(
  space: SheetSpace,
  input: Shape,
  calibration?: Calibration | null,
): Measurement {
  validateSpace(space);
  if (!input || !Array.isArray(input.points) || !input.points.length || input.points.length > 1000)
    fail("Place at least one measured point; an unlocated line is unsettled.");
  let points = input.points.map(point);
  if (input.kind === "pins") {
    if (input.holes?.length || input.depth) fail("Counts cannot have openings or a depth.");
    if (new Set(points.map((p) => `${p.x}:${p.y}`)).size !== points.length)
      fail("A repeated pin cannot be counted twice.");
    return {
      value: points.length,
      unit: "EA",
      basis: `${points.length} located pins`,
      calibration_version: null,
    };
  }
  if (
    !calibration?.confirmed ||
    !finite(calibration.feet_per_point) ||
    calibration.feet_per_point <= 0
  )
    fail("Calibrate this plan or detail before measuring lengths, areas or volumes.");
  bounds(calibration.bounds);
  if (input.kind === "rect") {
    if (points.length !== 2) fail("A rectangle needs two opposite corners.");
    const [a, b] = points;
    points = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  }
  const all = [...points, ...(input.holes ?? []).flat().map(point)];
  if (all.some((p) => !inRegion(p, calibration.bounds)))
    fail(
      "This geometry crosses outside its calibrated plan or detail. Split it at the scale boundary.",
    );
  if (input.kind === "polyline") {
    if (points.length < 2 || input.holes?.length || input.depth)
      fail("A run needs at least two points and cannot have openings or a depth.");
    const length =
      points.slice(1).reduce((n, p, i) => n + distance(points[i], p, space), 0) *
      calibration.feet_per_point;
    if (length <= EPS) fail("A measured run must have a length.");
    return {
      value: length,
      unit: "LF",
      basis: "Sum of drawn segments × calibrated feet per PDF point",
      calibration_version: calibration.version,
    };
  }
  if (input.kind !== "polygon" && input.kind !== "rect")
    fail("Use pins, polyline, polygon or rect geometry.");
  const outer = ring(points),
    holes = (input.holes ?? []).map(ring);
  if (holes.length > 100) fail("One measured area can have at most 100 openings.");
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    if (hole.some((p) => !contains(p, outer)) || ringsCross(outer, hole))
      fail("Every opening must be wholly inside the measured area.");
    for (const other of holes.slice(0, i))
      if (ringsCross(hole, other) || contains(hole[0], other) || contains(other[0], hole))
        fail("Openings cannot overlap or contain one another.");
  }
  const area =
    (ringArea(outer, space) - holes.reduce((n, h) => n + ringArea(h, space), 0)) *
    calibration.feet_per_point ** 2;
  if (area <= EPS) fail("A measured area must be greater than zero.");
  if (!input.depth)
    return {
      value: area,
      unit: "SF",
      basis: "Drawn boundary area minus openings × calibrated scale squared",
      calibration_version: calibration.version,
    };
  const d = input.depth;
  if (!d.source_id || !d.sheet?.trim() || !d.detail?.trim())
    fail("Concrete depth needs a stored sheet and a detail or note citation.");
  return {
    value: (area * feet(d.value, d.unit)) / 27,
    unit: "CY",
    basis: `Net area × depth / 27; depth from ${d.sheet}, ${d.detail}`,
    calibration_version: calibration.version,
  };
}

/** Only compare proposals for the same item in overlapping tiles. This does not
 * establish that a symbol was correctly classified; estimator acceptance does. */
export function mergeOverlapPins(
  groups: { tile: Bounds; points: Point[] }[],
  space: SheetSpace,
  tolerancePoints = (12 * 72) / 200,
): Point[] {
  const out: { tile: Bounds; point: Point; group: number }[] = [];
  for (const [index, group] of groups.entries())
    for (const p of group.points.map(point)) {
      if (!inRegion(p, group.tile)) fail("A proposed pin must be inside the tile Athena read.");
      if (
        !out.some(
          (o) =>
            o.group !== index &&
            inRegion(p, o.tile) &&
            inRegion(o.point, group.tile) &&
            distance(p, o.point, space) <= tolerancePoints,
        )
      )
        out.push({ tile: group.tile, point: p, group: index });
    }
  return out.map((o) => o.point);
}
