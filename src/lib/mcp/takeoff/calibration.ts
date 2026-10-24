import { calibrate, distance, type Calibration, type Point, type SheetSpace } from "./geometry";
import { scaleProposals, type SheetInspection, type VectorObject } from "./pdf";
function dimensionFeet(text: string): number | null {
  const s = text.trim(),
    match = /^(\d+)\s*['′](?:\s*-?\s*(\d+(?:\.\d+)?)\s*["″]?)?$/.exec(s);
  if (match) return Number(match[1]) + Number(match[2] || 0) / 12;
  return null;
}
const center = (o: VectorObject): Point => ({
  x: o.bounds.x + o.bounds.width / 2,
  y: o.bounds.y + o.bounds.height / 2,
});
/** Conservative automatic calibration requires an unambiguous title scale AND
 * two independent dimension strings whose endpoints have witness ticks. Mixed
 * scales and scanned sheets stay unconfirmed until the estimator picks a region. */
export function automaticCalibration(
  space: SheetSpace,
  inspection: SheetInspection,
): { calibration: Calibration; checks: { text: string; length: number; error: number }[] } | null {
  const scales = scaleProposals(inspection.text);
  if (inspection.truncated || scales.length !== 1) return null;
  const scale = scales[0],
    checks: { text: string; length: number; error: number; points: [Point, Point] }[] = [];
  const paths = inspection.objects.filter((o) => o.kind === "path" && o.points?.length === 2);
  for (const text of inspection.objects.filter((o) => o.kind === "text")) {
    const feet = dimensionFeet(text.text || "");
    if (!feet || feet <= 0) continue;
    const c = center(text);
    for (const path of paths) {
      const [a, b] = path.points!;
      const len = distance(a, b, space);
      if (len < 10) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (distance(c, mid, space) > Math.max(text.bounds.width * space.width, 20)) continue;
      const error = Math.abs(len * scale.feet_per_point - feet) / feet;
      if (error > 0.01) continue;
      // Each end must touch a short nonparallel witness/tick path.
      const witness = (p: Point) =>
        paths.some(
          (other) =>
            other !== path &&
            distance(other.points![0], other.points![1], space) < 30 &&
            (() => {
              const [c, d] = other.points!,
                dx = (d.x - c.x) * space.width,
                dy = (d.y - c.y) * space.height,
                t = Math.max(
                  0,
                  Math.min(
                    1,
                    ((p.x - c.x) * space.width * dx + (p.y - c.y) * space.height * dy) /
                      (dx * dx + dy * dy),
                  ),
                );
              return (
                Number.isFinite(t) &&
                distance(p, { x: c.x + t * (d.x - c.x), y: c.y + t * (d.y - c.y) }, space) <= 2
              );
            })() &&
            Math.abs(
              (b.x - a.x) * (other.points![1].y - other.points![0].y) -
                (b.y - a.y) * (other.points![1].x - other.points![0].x),
            ) > 1e-8,
        );
      if (!witness(a) || !witness(b)) continue;
      if (!checks.some((q) => q.points.some((p) => distance(p, a, space) < 2)))
        checks.push({ text: text.text!, length: len, error, points: [a, b] });
    }
  }
  if (checks.length < 2) return null;
  const first = checks[0];
  return {
    calibration: calibrate(space, {
      region: "Main plan (dimension checked)",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      version: 1,
      reference: { points: first.points, distance: dimensionFeet(first.text)!, unit: "ft" },
      method: "dimension_string",
      confidence: "high",
      confirmed: true,
    }),
    checks,
  };
}
