import { z } from "zod";
import { decode, encode } from "fast-png";
import { hasInk, tilePoint, type Tile, type VectorObject } from "./pdf";
import { pointInScope } from "./scope";
import {
  type Point,
  type Shape,
  type SheetSpace,
  measure,
  type Calibration,
  type Bounds,
} from "./geometry";

const gridPoint = z.object({
  column: z.number().int().min(0).max(10),
  row: z.number().int().min(0).max(10),
  dx: z.number().min(0).max(100),
  dy: z.number().min(0).max(100),
});
const answer = z.object({
  findings: z
    .array(
      z.object({
        kind: z.enum(["pins", "polyline", "polygon", "rect"]),
        points: z.array(gridPoint).min(1).max(100),
        holes: z.array(z.array(gridPoint).min(3).max(100)).max(20).optional(),
        confidence: z.number().min(0).max(1),
        evidence: z.string().max(800),
      }),
    )
    .max(100),
  uncertainties: z.array(z.string().max(500)).max(20),
});
// Use image-relative coordinates rather than asking vision to do grid-cell
// arithmetic. Conversion is exact; the independent raster verifier still owns
// acceptance. Out-of-range, string or mixed-format values are never repaired.
const modelPoint = z
  .object({
    x: z
      .number()
      .finite()
      .min(0)
      .max(1000)
      .describe("Horizontal position on the final TARGET TILE image, normalized 0-1000"),
    y: z
      .number()
      .finite()
      .min(0)
      .max(1000)
      .describe("Vertical position on the final TARGET TILE image, normalized 0-1000"),
  })
  .strict();
const modelAnswer = answer.extend({
  findings: z
    .array(
      answer.shape.findings.element.extend({
        points: z.array(modelPoint).min(1).max(100),
        holes: z.array(z.array(modelPoint).min(3).max(100)).max(20).optional(),
      }),
    )
    .max(100),
});
const decodePoint = (point: z.infer<typeof modelPoint>, width: number, height: number) => {
  const x = (point.x * width) / 1000,
    y = (point.y * height) / 1000;
  return { column: Math.floor(x / 100), row: Math.floor(y / 100), dx: x % 100, dy: y % 100 };
};
const kindsByMeasure = {
  count: ["pins"],
  linear: ["polyline"],
  area: ["polygon", "rect"],
  volume: ["polygon", "rect"],
} as const;
export type VisionAnswer = z.infer<typeof answer> & {
  reader_model?: string;
  host_reported_model?: string;
};
export type VisionRead = (request: {
  item: string;
  measure_type: string;
  png: Uint8Array;
  overview?: Uint8Array;
  frame?: {
    sheet: string;
    tile_bounds: Bounds;
    reference_bounds?: Bounds;
    region?: { name: string; bounds: Bounds };
  };
  hints: VectorObject[];
  legend?: Uint8Array;
  signal?: AbortSignal;
}) => Promise<VisionAnswer>;
const glyphs: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "110", "100", "110", "101"],
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "010", "100", "111"],
  "3": ["110", "001", "010", "001", "110"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "110"],
};
/** Ephemeral vision copy: the estimator and persisted source never receive the grid. */
export function gridPng(rgba: Uint8Array, tile: Tile): Uint8Array {
  const data = rgba.slice();
  const pixel = (x: number, y: number, rgb: number[]) => {
    if (x < 0 || y < 0 || x >= tile.width || y >= tile.height) return;
    const i = (y * tile.width + x) * 4;
    data.set([...rgb, 255], i);
  };
  const text = (label: string, x: number, y: number) => {
    for (let xx = x - 2; xx < x + label.length * 8 + 2; xx++)
      for (let yy = y - 2; yy < y + 12; yy++) pixel(xx, yy, [255, 255, 255]);
    [...label].forEach((c, n) =>
      (glyphs[c] ?? glyphs["0"]).forEach((row, j) =>
        [...row].forEach((v, i) => {
          if (v === "1")
            for (let dx = 0; dx < 2; dx++)
              for (let dy = 0; dy < 2; dy++)
                pixel(x + n * 8 + i * 2 + dx, y + j * 2 + dy, [30, 95, 237]);
        }),
      ),
    );
  };
  for (let x = 0; x < tile.width; x += 100)
    for (let y = 0; y < tile.height; y++) pixel(x, y, [30, 95, 237]);
  for (let y = 0; y < tile.height; y += 100)
    for (let x = 0; x < tile.width; x++) pixel(x, y, [30, 95, 237]);
  for (let col = 0; col * 100 < tile.width; col++)
    for (let row = 0; row * 100 < tile.height; row++)
      text(`${String.fromCharCode(65 + col)}${row + 1}`, col * 100 + 4, row * 100 + 4);
  return encode({ width: tile.width, height: tile.height, data, channels: 4, depth: 8 });
}
/** The connected member AI reads the image. Athena never calls an inference provider. */
export class HostDrawingReadRequired extends Error {
  checkpoint?: Record<string, unknown>;
  tile?: Tile;
  constructor(public request: Parameters<VisionRead>[0]) {
    super(
      "This region is ready for the connected AI to inspect. No quantity has been established.",
    );
  }
}
const flatObservations = modelAnswer
  .extend({
    findings: z.array(modelAnswer.shape.findings.element.strict()).max(100),
    reported_model: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const hostObservationsSchema = z.union([
  flatObservations,
  z
    .object({
      reported_model: z.string().trim().min(1).max(120).optional(),
      parts: z
        .array(
          flatObservations
            .extend({
              part: z.number().int().min(0).max(3),
              findings: z.array(modelAnswer.shape.findings.element.strict()).max(25),
              uncertainties: z.array(z.string().max(500)).max(5),
            })
            .strict(),
        )
        .length(4),
    })
    .strict()
    .refine(
      (o) => new Set(o.parts.map((p) => p.part)).size === 4,
      "Inspect all four distinct parts before advancing this region",
    ),
]);
function partFrame(width: number, height: number, part: number) {
  const x = part % 2 ? Math.floor(width / 2) : 0;
  const y = part >= 2 ? Math.floor(height / 2) : 0;
  return {
    x,
    y,
    width: part % 2 ? width - x : Math.floor(width / 2),
    height: part >= 2 ? height - y : Math.floor(height / 2),
  };
}
/** Smaller images of only the pending region; the parent checkpoint and source stay fixed. */
export function splitHostTile(png: Uint8Array) {
  const image = decode(png);
  if (
    image.width < 2 ||
    image.height < 2 ||
    image.width > 1024 ||
    image.height > 1024 ||
    image.channels !== 4 ||
    image.depth !== 8
  )
    throw new Error("Choose a bounded RGBA target to split.");
  return [0, 1, 2, 3].map((part) => {
    const frame = partFrame(image.width, image.height, part);
    const data = new Uint8Array(frame.width * frame.height * 4);
    for (let y = 0; y < frame.height; y++) {
      const start = ((frame.y + y) * image.width + frame.x) * 4;
      data.set(
        (image.data as Uint8Array).subarray(start, start + frame.width * 4),
        y * frame.width * 4,
      );
    }
    return { part, frame, png: encode({ ...frame, data, channels: 4, depth: 8 }) };
  });
}
export const readVisionTile: VisionRead = async (request) => {
  throw new HostDrawingReadRequired(request);
};
/** Validate tile-relative host observations without repairing or accepting them. */
export function hostDrawingReader(
  observations: z.infer<typeof hostObservationsSchema>,
): VisionRead {
  return async (request) => {
    const parsed = hostObservationsSchema.safeParse(observations);
    if (!parsed.success)
      throw new Error(
        "The drawing observations have invalid locations or findings. Nothing was saved.",
      );
    if (
      request.png.length < 24 ||
      request.png[0] !== 137 ||
      request.png[1] !== 80 ||
      request.png[2] !== 78 ||
      request.png[3] !== 71
    )
      throw new Error("The drawing observations need Athena's rendered PNG tile.");
    const header = new DataView(request.png.buffer, request.png.byteOffset, request.png.byteLength);
    const width = header.getUint32(16),
      height = header.getUint32(20);
    if (!width || !height || width > 1024 || height > 1024)
      throw new Error("Choose a bounded drawing tile.");
    const observed =
      "parts" in parsed.data
        ? {
            findings: parsed.data.parts.flatMap((part) => {
              const frame = partFrame(width, height, part.part);
              const parent = (p: z.infer<typeof modelPoint>) => ({
                x: ((frame.x + (p.x * frame.width) / 1000) * 1000) / width,
                y: ((frame.y + (p.y * frame.height) / 1000) * 1000) / height,
              });
              return part.findings.map((f) => ({
                ...f,
                points: f.points.map(parent),
                holes: f.holes?.map((h) => h.map(parent)),
              }));
            }),
            uncertainties: parsed.data.parts.flatMap((p) => p.uncertainties),
          }
        : parsed.data;
    const allowed = kindsByMeasure[request.measure_type as keyof typeof kindsByMeasure];
    if (!allowed || observed.findings.some((f) => !(allowed as readonly string[]).includes(f.kind)))
      throw new Error(
        "The observed geometry does not match this line's measurement type. Nothing was saved.",
      );
    return {
      ...answer.parse({
        ...observed,
        findings: observed.findings.map((f) => ({
          ...f,
          points: f.points.map((p) => decodePoint(p, width, height)),
          holes: f.holes?.map((h) => h.map((p) => decodePoint(p, width, height))),
        })),
      }),
      reader_model: "connected-host",
      ...(parsed.data.reported_model ? { host_reported_model: parsed.data.reported_model } : {}),
    };
  };
}
export function verifyVisionAnswer(input: {
  answer: VisionAnswer;
  rgba: Uint8Array;
  tile: Tile;
  space: SheetSpace;
  calibration?: Calibration | null;
  measure_type: string;
  count_area?: Bounds;
  depth?: Shape["depth"];
}) {
  const accepted: { shape: Shape; confidence: number; evidence: string }[] = [],
    rejected: string[] = [];
  const kinds: Record<string, string[]> = {
    count: ["pins"],
    linear: ["polyline"],
    area: ["polygon", "rect"],
    volume: ["polygon", "rect"],
  };
  const findings = answer
    .parse(input.answer)
    .findings.flatMap((finding) =>
      finding.kind === "pins"
        ? finding.points.map((point) => ({ ...finding, points: [point] }))
        : [finding],
    );
  for (const finding of findings) {
    try {
      if (!(kinds[input.measure_type] ?? []).includes(finding.kind))
        throw new Error("Geometry does not match the requested measure type.");
      const convert = (p: z.infer<typeof gridPoint>): Point => {
        const x = p.column * 100 + p.dx,
          y = p.row * 100 + p.dy;
        const closedRunEdge = finding.kind === "polyline";
        if (
          closedRunEdge
            ? x > input.tile.width || y > input.tile.height
            : x >= input.tile.width || y >= input.tile.height
        )
          throw new Error("Candidate is outside the tile.");
        const page = tilePoint(input.tile, { x: x / input.tile.width, y: y / input.tile.height });
        if (input.count_area && !pointInScope(page, input.count_area))
          throw new Error("Candidate is outside the confirmed count area.");
        if (!hasInk(input.rgba, input.tile, page, 6, closedRunEdge))
          throw new Error("Candidate has no drawing ink at its supplied location.");
        return page;
      };
      const points = finding.points.map(convert);
      const shape: Shape = {
        kind: finding.kind,
        points,
        ...(finding.holes?.length ? { holes: finding.holes.map((h) => h.map(convert)) } : {}),
      };
      if (input.measure_type === "volume") {
        if (!input.depth) throw new Error("Volume needs a cited thickness.");
        shape.depth = input.depth;
      }
      if (shape.kind === "polyline")
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1],
            b = points[i],
            steps = Math.max(
              1,
              Math.ceil(
                Math.hypot(
                  (b.x - a.x) * input.tile.pageWidth,
                  (b.y - a.y) * input.tile.pageHeight,
                ) / 8,
              ),
            );
          let hits = 0;
          for (let j = 0; j <= steps; j++)
            if (
              hasInk(
                input.rgba,
                input.tile,
                {
                  x: a.x + ((b.x - a.x) * j) / steps,
                  y: a.y + ((b.y - a.y) * j) / steps,
                },
                6,
                true,
              )
            )
              hits++;
          if (hits / (steps + 1) < 0.85)
            throw new Error("The run does not follow enough visible drawing ink.");
        }
      measure(input.space, shape, input.calibration);
      accepted.push({ shape, confidence: finding.confidence, evidence: finding.evidence });
    } catch (error) {
      rejected.push(error instanceof Error ? error.message : "Candidate failed verification.");
    }
  }
  return { accepted, rejected, uncertainties: input.answer.uncertainties };
}
