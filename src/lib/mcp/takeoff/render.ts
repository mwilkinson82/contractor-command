import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  setFillingColor,
  setStrokingColor,
  setLineWidth,
  moveTo,
  lineTo,
  closePath,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
} from "pdf-lib";
import { decode, encode } from "fast-png";

import type { EngineSnapshot, GeometryRevision } from "./state";
import type { StoredPage } from "./service";
import type { Point, Shape } from "./geometry";
const BLUE = rgb(30 / 255, 95 / 255, 237 / 255),
  NAVY = rgb(30 / 255, 58 / 255, 95 / 255),
  GRAY = rgb(0.45, 0.48, 0.53);
export const pageGeometry = (
  state: EngineSnapshot,
  page: Pick<StoredPage, "source" | "page">,
  rejected = false,
) =>
  state.geometry
    .filter(
      (g) =>
        g.source_id === page.source.id &&
        g.page === page.page &&
        (rejected || g.status !== "rejected") &&
        g.shape.kind !== "not_drawable",
    )
    .sort((a, b) => a.geometry_id.localeCompare(b.geometry_id));
export function shapeRings(shape: Shape): Point[][] {
  const p = shape.points;
  return [
    shape.kind === "rect" ? [p[0], { x: p[1].x, y: p[0].y }, p[1], { x: p[0].x, y: p[1].y }] : p,
    ...(shape.holes ?? []),
  ];
}
export function displayToPdf(page: PDFPage, p: Point): Point {
  const b = page.getCropBox(),
    r = ((page.getRotation().angle % 360) + 360) % 360;
  const q =
    r === 90
      ? { x: p.y, y: p.x }
      : r === 180
        ? { x: 1 - p.x, y: p.y }
        : r === 270
          ? { x: 1 - p.y, y: 1 - p.x }
          : { x: p.x, y: 1 - p.y };
  return { x: b.x + q.x * b.width, y: b.y + q.y * b.height };
}
const ascii = (s: string) =>
  s
    .replace(/[^\x20-\x7e\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Original PDF vectors stay vector sharp. Only the newly copied page is changed. */
export async function measuredPdf(
  page: StoredPage,
  state: EngineSnapshot,
  dated = new Date().toISOString(),
  includeRejected = false,
): Promise<Uint8Array> {
  const source = await PDFDocument.load(page.bytes, { updateMetadata: false }),
    doc = await PDFDocument.create();
  const [sheet] = await doc.copyPages(source, [page.page - 1]);
  doc.addPage(sheet);
  const font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const rows = pageGeometry(state, page, includeRejected),
    scale = Math.max(page.space.width, page.space.height) / 1600;
  const pinNumbers = new Map<string, number>();
  for (const row of rows) {
    const shape = row.shape as Shape,
      color = row.status === "rejected" ? GRAY : BLUE;
    if (shape.kind === "pins")
      for (const [index, p] of shape.points.entries()) {
        const at = displayToPdf(sheet, p);
        sheet.drawCircle({
          x: at.x,
          y: at.y,
          size: 7 * scale,
          borderWidth: 1.5 * scale,
          borderColor: color,
          color: row.status === "accepted" ? color : rgb(1, 1, 1),
          opacity: 0.9,
        });
        sheet.drawText(String((pinNumbers.get(row.line_id) ?? 0) + index + 1), {
          x: at.x - 2 * scale,
          y: at.y - 2.5 * scale,
          size: 7 * scale,
          font: bold,
          color: row.status === "accepted" ? rgb(1, 1, 1) : BLUE,
          rotate: degrees(sheet.getRotation().angle),
        });
      }
    else if (shape.kind === "polyline")
      for (let i = 1; i < shape.points.length; i++)
        sheet.drawLine({
          start: displayToPdf(sheet, shape.points[i - 1]),
          end: displayToPdf(sheet, shape.points[i]),
          color,
          thickness: 2 * scale,
          opacity: 0.9,
        });
    else {
      const ops = [
        pushGraphicsState(),
        setFillingColor(color),
        setStrokingColor(color),
        setLineWidth(1.5 * scale),
      ];
      for (const ring of shapeRings(shape)) {
        const p = ring.map((p) => displayToPdf(sheet, p));
        ops.push(moveTo(p[0].x, p[0].y), ...p.slice(1).map((q) => lineTo(q.x, q.y)), closePath());
      }
      // Even-odd preserves openings; low opacity lets the original drawing show.
      const gs = sheet.doc.context.obj({
        Type: "ExtGState",
        ca: row.status === "accepted" ? 0.18 : 0,
        CA: 0.95,
      });
      const name = sheet.node.newExtGState("AthenaTakeoff", sheet.doc.context.register(gs));
      sheet.pushOperators(
        ...ops,
        PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams, [name]),
        PDFOperator.of(PDFOperatorNames.FillEvenOddAndStroke),
        popGraphicsState(),
      );
    }
    if (shape.kind === "pins")
      pinNumbers.set(row.line_id, (pinNumbers.get(row.line_id) ?? 0) + shape.points.length);
    const first = displayToPdf(sheet, shape.points[0]),
      line = state.lines.find((l) => l.id === row.line_id);
    sheet.drawText(
      `L${line?.line_no ?? "?"} ${Number(row.measured).toFixed(2)} ${row.unit ?? ""}`,
      {
        x: first.x + 9 * scale,
        y: first.y + 9 * scale,
        size: 9 * scale,
        font: bold,
        color: NAVY,
        rotate: degrees(sheet.getRotation().angle),
      },
    );
  }
  let key: PDFPage;
  let y = 0;
  const fresh = () => {
    key = doc.addPage([792, 612]);
    key.drawRectangle({ x: 0, y: 530, width: 792, height: 82, color: NAVY });
    key.drawText("ATHENA | Measured drawing takeoff", {
      x: 32,
      y: 573,
      size: 18,
      font: bold,
      color: rgb(1, 1, 1),
    });
    key.drawText(ascii(`${page.sheet} | Source revision ${page.source.version} | ${dated}`), {
      x: 32,
      y: 547,
      size: 10,
      font,
      color: rgb(1, 1, 1),
    });
    y = 508;
  };
  fresh();
  const write = (s: string, size = 10) => {
    const words = ascii(s).split(" ");
    let line = "";
    for (const word of words) {
      if (font.widthOfTextAtSize(line + " " + word, size) > 725) {
        if (y < 40) fresh();
        key.drawText(line, { x: 32, y, size, font, color: NAVY });
        y -= 15;
        line = word;
      } else line += (line ? " " : "") + word;
    }
    if (line) {
      if (y < 40) fresh();
      key.drawText(line, { x: 32, y, size, font, color: NAVY });
      y -= 17;
    }
  };
  write(
    `Original: ${page.source.filename}; source ID ${page.source.id}; page ${page.page}. Original unchanged.`,
  );
  write(`SHA-256 ${page.source.content_hash}`, 8);
  write(
    "Blue fill = accepted; blue outline = proposed. Proposed quantities are not confirmed. This record preserves the geometry revisions listed below.",
  );
  for (const row of rows) {
    const line = state.lines.find((l) => l.id === row.line_id);
    write(
      `L${line?.line_no}: ${line?.item} | ${Number(row.measured).toFixed(4)} ${row.unit} | ${row.status} | ${row.shape.kind}`,
    );
    write(
      `Geometry ${row.id}; revision ${row.version}; calibration ${row.calibration_id ?? "not required for count"}; ${row.created_at}`,
      8,
    );
    const calibration = state.calibrations.find((c) => c.id === row.calibration_id);
    if (calibration)
      write(
        `${calibration.region}: reference ${calibration.reference.distance} ${calibration.reference.unit}; ${calibration.feet_per_point} feet per PDF point; calibration v${calibration.version}.`,
        8,
      );
    if (row.shape.kind !== "not_drawable" && row.shape.depth) {
      const depth = row.shape.depth;
      write(
        `Depth ${depth.value} ${depth.unit}; source ${depth.source_id}; sheet ${depth.sheet}; detail/note: ${depth.detail}.`,
        8,
      );
    }
    y -= 5;
  }
  if (!rows.length)
    write("No located geometry on this source page. No quantity has been established.");
  doc.setTitle(`Athena ${page.sheet} measured takeoff ${dated}`);
  return doc.save();
}
/** Text-only hosts get the exact same derived highlights as the viewer/PDF. */
export async function highlightedPreview(
  page: StoredPage,
  state: EngineSnapshot,
  includeRejected = false,
) {
  const { renderPdfiumPage } = await import("../pdf-renderer");
  if (!pageGeometry(state, page, includeRejected).length)
    return renderPdfiumPage(page.bytes, page.page - 1);
  return renderPdfiumPage(await measuredPdf(page, state, undefined, includeRejected), 0);
}
export function cropPng(png: Uint8Array, center: Point, edge = 160): Uint8Array {
  const image = decode(png);
  if (image.depth !== 8 || image.channels < 3) throw new Error("Unsupported drawing crop.");
  const width = Math.min(edge, image.width),
    height = Math.min(edge, image.height),
    x = Math.max(0, Math.min(image.width - width, Math.round(center.x * image.width - width / 2))),
    y = Math.max(
      0,
      Math.min(image.height - height, Math.round(center.y * image.height - height / 2)),
    );
  const data = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const from = ((y + j) * image.width + x + i) * image.channels,
        to = (j * width + i) * 4;
      data.set(
        [Number(image.data[from]), Number(image.data[from + 1]), Number(image.data[from + 2]), 255],
        to,
      );
    }
  return encode({ width, height, data, channels: 4, depth: 8 });
}
