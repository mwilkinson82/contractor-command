// Server-rendered markup on the actual stored sheet. Locations are supplied, never guessed.
import { jsPDF } from "jspdf";
import { ToolError } from "@lovable.dev/mcp-js";
import { BLUE, NAVY, GRAY, ALERT } from "./cards/palette";
import type { CardModel } from "./cards/model";
import type { StoredLine, StoredGap } from "./estimating";
import {
  drawingOwned,
  drawingRpc,
  originalDeleteRefused,
  renderPdfPage,
  type DrawingJob,
  type DrawingRecord,
  type DrawingStore,
} from "./drawing-set";
import { FILE_BUCKET, FILE_MAX_BYTES, safeFilename, sha256Hex, storagePath } from "./file-share";

export type Point = { x: number; y: number };
export type DrawingAnnotation = {
  label: string;
  text: string;
  location?: string;
  severity: "callout" | "risk" | "delay";
  geometry?: { kind: "pin"; point: Point } | { kind: "line" | "area"; points: Point[] };
};
export const markupColor = (severity: DrawingAnnotation["severity"]) =>
  severity === "risk" || severity === "delay" ? ALERT : BLUE;

export function savedDrawingAnnotations(
  sheet: string,
  lines: StoredLine[],
  gaps: StoredGap[],
): DrawingAnnotation[] {
  const same = (s: string) => s.trim().toLowerCase() === sheet.trim().toLowerCase();
  return [
    ...lines
      .filter((line) => same(line.sheet))
      .map(
        (line): DrawingAnnotation => ({
          label: `L${line.line_no}`,
          text: `${line.item}${line.qty == null ? " — quantity not established" : ` — ${line.qty} ${line.unit ?? ""}`} · ${line.basis} · ${line.confidence} confidence${line.math ? ` · ${line.math}` : ""}`,
          location: line.location_text ?? line.detail ?? line.markup_ref ?? undefined,
          severity: "callout",
        }),
      ),
    ...gaps
      .filter((gap) => same(gap.sheet) && gap.kind === "verify")
      .map(
        (gap): DrawingAnnotation => ({
          label: gap.ref,
          text: `${gap.title} — ${gap.reasoning}`,
          location: gap.detail ?? undefined,
          severity: gap.holds_bid ? "risk" : "callout",
        }),
      ),
  ];
}

const pdfText = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "?");

export async function renderDrawingMarkup(
  source: { png: Uint8Array; sheet: string; page: number; record: DrawingRecord },
  annotations: DrawingAnnotation[],
  dated: string,
) {
  if (annotations.length > 100)
    throw new ToolError("Use at most 100 callouts per markup version. Nothing was saved.");
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: [1224, 792],
    compress: true,
  });
  const image = doc.getImageProperties(source.png);
  const frame = { x: 24, y: 94, width: 1176, height: 630 };
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  const w = image.width * scale,
    h = image.height * scale;
  const left = frame.x + (frame.width - w) / 2,
    top = frame.y + (frame.height - h) / 2;
  const heading = (detail: string) => {
    doc.setTextColor(NAVY);
    doc.setFontSize(20);
    doc.text(pdfText(`${source.sheet} | Athena drawing markup`), 24, 30);
    doc.setTextColor(GRAY);
    doc.setFontSize(9);
    doc.text(
      pdfText(
        `${dated} | Source revision ${source.record.version} | Page ${source.page} | ${detail}`,
      ),
      24,
      49,
    );
    doc.setDrawColor(BLUE);
    doc.setLineWidth(2);
    doc.line(24, 61, 1200, 61);
  };
  heading(`${annotations.length} callouts; numbered key follows`);
  doc.addImage(source.png, "PNG", left, top, w, h);
  const xy = (p: Point): [number, number] => [left + p.x * w, top + p.y * h];
  annotations.forEach((a, i) => {
    const g = a.geometry;
    if (!g) return;
    const color = markupColor(a.severity);
    doc.setDrawColor(color);
    doc.setTextColor(NAVY);
    doc.setLineWidth(2);
    const points = g.kind === "pin" ? [g.point] : g.points;
    if (
      points.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.x > 1 ||
          p.y < 0 ||
          p.y > 1,
      )
    )
      throw new ToolError(
        "Markup coordinates must be between 0 and 1 on the displayed sheet. Nothing was saved.",
      );
    if (g.kind !== "pin") {
      for (let p = 1; p < points.length; p++) doc.line(...xy(points[p - 1]), ...xy(points[p]));
      if (g.kind === "area") doc.line(...xy(points[points.length - 1]), ...xy(points[0]));
    }
    const [x, y] = xy(points[0]);
    doc.setFillColor("#FFFFFF");
    doc.circle(x, y, 9, "FD");
    doc.setFontSize(9);
    doc.text(String(i + 1), x, y + 3, { align: "center" });
  });
  doc.setTextColor(GRAY);
  doc.setFontSize(9);
  doc.text(
    "Only supplied coordinates are drawn on the sheet. Unlocated findings appear in the key; no positions are inferred.",
    24,
    749,
  );
  doc.text(`Original preserved | Source SHA-256 ${source.record.content_hash}`, 24, 766);
  doc.addPage();
  heading("Callout key | source sheet preserved separately");
  let y = 92;
  if (!annotations.length) {
    doc.setTextColor(NAVY);
    doc.setFontSize(12);
    doc.text(
      "Review copy: no saved findings or supplied annotations. No drawing review or measurements are claimed.",
      24,
      y,
    );
  }
  annotations.forEach((a, index) => {
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(
      pdfText(
        `${index + 1}. ${a.label} | ${a.severity}\n${a.text}\nLocation: ${a.location || (a.geometry ? "Supplied drawing coordinates" : "Not located")}${a.geometry ? " (supplied coordinates)" : " (key only)"}`,
      ),
      1120,
    ) as string[];
    for (let i = 0; i < lines.length; i++) {
      if (y > 730) {
        doc.addPage();
        heading("Callout key continued");
        y = 92;
      }
      doc.setDrawColor(markupColor(a.severity));
      doc.setLineWidth(2);
      doc.line(24, y - 10, 24, y + 4);
      doc.setTextColor(i === 0 ? NAVY : GRAY);
      doc.setFontSize(11);
      doc.text(lines[i], 36, y);
      y += 15;
    }
    y += 15;
  });
  const pdf = new Uint8Array(doc.output("arraybuffer"));
  if (pdf.length > FILE_MAX_BYTES)
    throw new ToolError(
      "This markup exceeds the drawing file limit. Use fewer callouts per version. Nothing was saved.",
    );
  return pdf;
}

export async function saveDrawingMarkup(
  sb: DrawingStore,
  job: DrawingJob,
  source: Parameters<typeof renderDrawingMarkup>[0],
  annotations: DrawingAnnotation[],
) {
  const dated = new Date().toISOString();
  const pdf = await renderDrawingMarkup(source, annotations, dated);
  const name = safeFilename(`${source.sheet}-markup-${dated.replace(/[:.]/g, "-")}.pdf`).name;
  const path = storagePath(
    job.company_id,
    job.job_id,
    `drawing-markup-${crypto.randomUUID()}`,
    name,
  );
  if (!drawingOwned(path, job.company_id, job.job_id) || path === source.record.path)
    throw new ToolError("Invalid markup destination.");
  const bucket = sb.storage.from(FILE_BUCKET);
  // Finish rendering before writing. A render error cannot leave a saved-but-inaccessible version.
  const png = await renderPdfPage(pdf, 0);
  if (!png) throw new ToolError("The markup could not be rendered. Nothing was saved.");
  const uploaded = await bucket.upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "no-store",
  });
  if (uploaded.error)
    throw new ToolError("The markup could not be stored. The original is unchanged.");
  let record: DrawingRecord;
  try {
    record = await drawingRpc<DrawingRecord>(sb, "mcp_drawing_markup_save", {
      _job: job.job_id,
      _source: source.record.id,
      _record: {
        path,
        filename: name,
        sheet: source.sheet,
        page: source.page,
        annotations,
        content_hash: await sha256Hex(pdf),
      },
    });
  } catch (e) {
    // Roll back only this uncommitted markup. Never a stored original.
    if (!originalDeleteRefused(FILE_BUCKET, path, [source.record])) await bucket.remove([path]);
    throw e;
  }
  const signed = await bucket.createSignedUrl(path, 15 * 60);
  return { record, png, url: signed.data?.signedUrl ?? null };
}

export function drawingMarkupCard(
  job: string,
  source: DrawingRecord,
  sheet: string,
  annotations: DrawingAnnotation[],
  saved?: { record: DrawingRecord; url: string | null },
): CardModel {
  return {
    state: "result",
    title: `${sheet} drawing markup`,
    job,
    kpis: [
      { label: "Source revision", value: String(source.version) },
      { label: "Callouts", value: String(annotations.length) },
      { label: "Pins on sheet", value: String(annotations.filter((annotation) => annotation.geometry).length) },
      { label: "Markup version", value: saved ? String(saved.record.version) : "Preview" },
    ],
    sections: [
      {
        heading: "Drawing record",
        kind: "list",
        rows: [
          { cells: [source.filename, "Original preserved"] },
          { cells: ["Stored source", source.created_at, `Revision ${source.version}`, `SHA-256 ${source.content_hash}`] },
          { cells: ["This is the stored set used for this markup. A newly shared PDF is not included unless its import succeeded."] },
          ...(saved ? [{ cells: ["Saved", saved.record.created_at] }] : []),
          ...(saved?.url
            ? [{ cells: ["Open dated markup PDF (15-minute download link)"], href: saved.url }]
            : []),
        ],
      },
      {
        heading: "Callout key",
        kind: "list",
        rows: annotations.length
          ? annotations.map((a, i) => ({
              cells: [
                `${i + 1}. ${a.label}`,
                a.text,
                a.location ||
                  (a.geometry
                    ? "Supplied drawing coordinates"
                    : "Location not established; key only"),
              ],
              ...(a.severity === "risk" || a.severity === "delay" ? { flag: a.severity } : {}),
            }))
          : [{ cells: ["Review copy only. No findings or measurements are claimed."] }],
      },
    ],
    next_move:
      "Review the sheet and keyed findings. Why it matters: supplied coordinates keep callouts tied to the correct work.",
  };
}
