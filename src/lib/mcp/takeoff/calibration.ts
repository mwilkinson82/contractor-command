import {
  calibrate,
  distance,
  feet,
  inRegion,
  type Calibration,
  type Point,
  type SheetSpace,
} from "./geometry";
import { scaleProposals, type SheetInspection, type VectorObject } from "./pdf";
/** A first calibration has no revision to look up. Replacements still require
 * the exact version so an old host response cannot overwrite a newer lock. */
export function calibrationExpectedVersion(
  rows: { source_id: string; page: number; region: string; version: number }[],
  source: string,
  page: number,
  region: string,
  expected?: number,
): number {
  if (expected != null) return expected;
  if (
    rows.some(
      (c) =>
        c.source_id === source &&
        c.page === page &&
        c.region.trim().toLowerCase() === region.trim().toLowerCase(),
    )
  )
    throw new Error(
      "This region already has a calibration. Read its current version before replacing it.",
    );
  return 0;
}
function dimensionFeet(text: string): number | null {
  const s = text.trim().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-"),
    match = /^(\d+)\s*['′](?:\s*-?\s*(\d+(?:\.\d+)?)\s*["″]?)?$/.exec(s);
  if (match) return Number(match[1]) + Number(match[2] || 0) / 12;
  return null;
}

export function dimensionChecked(calibration: Calibration): boolean {
  return (
    calibration.method === "dimension_string" ||
    (calibration.reference?.dimension_checks_verified === true &&
      (calibration.reference?.dimension_checks?.length ?? 0) >= 1)
  );
}

/** The host reads printed labels; Athena checks their numeric interpretation,
 * scale agreement and separate in-region locations. Raster checks run before save.
 * This is not server-side OCR or a claim of model interpretation accuracy. */
export function checkCalibrationDimensions(
  space: SheetSpace,
  calibration: Calibration,
  checks: NonNullable<Calibration["reference"]["dimension_checks"]>,
): Calibration {
  if (checks.length < 1 || checks.length > 4)
    throw new Error("Check one to four independent printed dimensions in this plan region.");
  if (
    calibration.method === "estimator" &&
    !checks.some(
      (check) =>
        !check.points.every((p) =>
          calibration.reference.points.some((q) => distance(p, q, space) < 2),
        ),
    )
  )
    throw new Error(
      "The calibration reference cannot verify itself; check a separate printed dimension.",
    );
  for (const [index, check] of checks.entries()) {
    const printed = dimensionFeet(check.label);
    const known = feet(check.distance, check.unit);
    if (printed == null || Math.abs(printed - known) > 0.0001)
      throw new Error(
        "Each dimension label must state the same feet/inches value as its supplied distance.",
      );
    if (!check.points.every((p) => inRegion(p, calibration.bounds)))
      throw new Error("Dimension check endpoints must be inside this calibrated plan region.");
    const physical = distance(check.points[0], check.points[1], space);
    if (physical < 1 || Math.abs(physical * calibration.feet_per_point - known) / known > 0.01)
      throw new Error(
        "The drawing dimension disagrees with the saved scale by more than 1%; review its endpoints, label and plan region.",
      );
    if (
      checks
        .slice(0, index)
        .some((other) =>
          check.points.every((p) => other.points.some((q) => distance(p, q, space) < 2)),
        )
    )
      throw new Error("Use separate dimension strings, not the same endpoints twice.");
  }
  return {
    ...calibration,
    reference: {
      ...calibration.reference,
      dimension_checks: checks,
      dimension_checks_verified: true,
    },
  };
}

/** A printed-scale lock is permitted only after the member confirms the PDF is true size.
 * It remains distinct from an independent dimension check in the measurement review. */
export function statedScaleCalibration(
  space: SheetSpace,
  label: string,
  region: string,
  bounds: Calibration["bounds"],
  trueSize: boolean,
): Calibration {
  const scales = scaleProposals(label);
  if (!trueSize || scales.length !== 1 || /as\s+noted|not\s+to\s+scale|\bNTS\b/i.test(label))
    throw new Error(
      "Confirm a single stated scale and that this PDF is true size, or use a known dimension.",
    );
  const a = { x: bounds.x, y: bounds.y };
  const b = { x: bounds.x + bounds.width, y: bounds.y };
  if (!(
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    b.x <= 1 &&
    bounds.y + bounds.height <= 1
  ))
    throw new Error("Choose the plan/detail bounds on this sheet.");
  return calibrate(space, {
    region,
    bounds,
    reference: {
      points: [a, b],
      distance: bounds.width * space.width * scales[0].feet_per_point,
      unit: "ft",
    },
    version: 1,
    method: "title_block",
    confidence: "medium",
    confirmed: true,
  });
}

export function scaleLock(text: string, locked: boolean) {
  const scales = scaleProposals(text);
  const asNoted = /as\s+noted/i.test(text);
  return {
    locked,
    printed_scales: scales.map((s) => s.label),
    as_noted: asNoted,
    question: locked ? null : "How would you like to lock the scale for this plan region?",
    choices: locked
      ? []
      : [
          "Calibrate from a known dimension on this sheet (select its two endpoints and confirm its length).",
          scales.length === 1 && !asNoted
            ? `Use the stated scale ${scales[0].label}, after confirming the PDF is true size.`
            : "Use the scale stated for this plan region, after identifying it and confirming the PDF is true size.",
        ],
  };
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
  if (inspection.truncated || scales.length !== 1 || /as\s+noted/i.test(inspection.text))
    return null;
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
