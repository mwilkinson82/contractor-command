import { ToolError } from "@lovable.dev/mcp-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Sb } from "../guard";
import type { Job } from "../jobs";
import { renderExport, settle, type parseState, type StoredLine } from "../estimating";
import { bytesToBase64, groupedCsv, takeoffXlsx, type SheetRow } from "../estimating-sheet";
import { measurementLines, verifiedLines, type EngineSnapshot } from "./state";
import { loadStoredPage } from "./service";
import { saveTakeoffArtifact, type PrivateArtifact } from "./artifacts";
import { measuredPdf } from "./render";
export function measuredSettlement(loaded: ReturnType<typeof parseState>, state: EngineSnapshot) {
  // Legacy verdict quantities cannot override the geometry calculation.
  return settle(
    verifiedLines(loaded.lines, state),
    loaded.gaps,
    loaded.verdicts.map((v) => (v.item_kind === "line" ? { ...v, corrected_qty: null } : v)),
    state.estimate_scope ?? loaded.setup,
  );
}
const csvCell = (value: unknown) => {
  let text = String(value ?? "").replace(/[\r\n]/g, " ");
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};
export function measurementExport(
  job: string,
  lines: StoredLine[],
  state: EngineSnapshot,
  format: "csv" | "workbook",
  links: Record<string, string> = {},
) {
  const measured = verifiedLines(lines, state),
    view = renderExport(job, measured, format),
    summary = measurementLines(state);
  const rows: SheetRow[] = measured.map((l) => {
    const m = summary.find((m) => m.line_no === l.line_no)!;
    const geometry = state.geometry.filter(
      (g) => g.line_id === m.line_id && g.status !== "rejected" && g.shape.kind !== "not_drawable",
    );
    return {
      group: l.trade || l.element || "General",
      ref: `T-${l.line_no}`,
      item: l.item,
      unit: l.unit || "",
      qty: l.qty == null ? "" : String(l.qty),
      basis: l.basis,
      verify: m.status === "accepted" || m.status === "not_drawable" ? "" : m.status,
      math: l.math,
      sheet: l.sheet,
      spec: l.spec_section || "",
      geometry_kind:
        m.status === "not_drawable"
          ? "not_drawable"
          : [...new Set(geometry.map((g) => g.shape.kind))].join("; "),
      measured_value: m.status !== "accepted" || m.accepted == null ? "" : String(m.accepted),
      geometry_refs: m.geometry_revs.join("; "),
      sheet_png: [...new Set(m.sheets.map((s) => links[`${s.source_id}:${s.page}`] || ""))]
        .filter(Boolean)
        .join("; "),
    };
  });
  const suffix = [
    "geometry_kind",
    "measured_value",
    "geometry_refs",
    "sheet_png",
    "measurement_status",
  ];
  // Build CSV in line order independently of the legacy grouping/rank order.
  const csv = [
    "line,item,unit,qty," + suffix.join(","),
    ...rows.map((r) =>
      [
        r.ref,
        r.item,
        r.unit,
        r.qty,
        r.geometry_kind,
        r.measured_value,
        r.geometry_refs,
        r.sheet_png,
        summary.find((m) => `T-${m.line_no}` === r.ref)?.status,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
  return {
    ...view,
    text: view.text + "\n\nMeasured geometry record\n```csv\n" + csv + "\n```",
    structured: {
      ...view.structured,
      csv,
      workbook: csv,
      measurements: summary,
      spreadsheet: { grouped_csv: groupedCsv(rows), xlsx_base64: bytesToBase64(takeoffXlsx(rows)) },
    },
  };
}
export async function appendMeasuredSheets(
  sb: Sb,
  job: Job,
  state: EngineSnapshot,
  view: { structured: Record<string, unknown> },
) {
  const base = view.structured.pdf_base64;
  if (typeof base !== "string") return;
  let bytes = Uint8Array.from(atob(base), (c) => c.charCodeAt(0));
  const measurements = measurementLines(state),
    excluded = new Set(
      measurements.filter((l) => l.exception_kind === "excluded").map((l) => l.line_id),
    );
  const acceptedState = {
    ...state,
    geometry: state.geometry.filter((g) => g.status === "accepted" && !excluded.has(g.line_id)),
  };
  const exceptions = measurements.filter((l) => l.status === "not_drawable");
  if (exceptions.length) {
    const basis = await PDFDocument.load(bytes),
      font = await basis.embedFont(StandardFonts.Helvetica);
    let p = basis.addPage([792, 612]),
      y = 550;
    const heading = () => {
      p.drawText("ATHENA | Non-drawable bases and exclusions", {
        x: 32,
        y: 575,
        size: 17,
        font,
        color: rgb(30 / 255, 58 / 255, 95 / 255),
      });
    };
    heading();
    for (const line of exceptions) {
      const text =
        `L${line.line_no}: ${line.item} | ${line.exception_kind} | ${line.reason ?? ""}`.replace(
          /[^\x20-\x7e]/g,
          " ",
        );
      let row = "";
      for (const word of text.split(" ")) {
        if (font.widthOfTextAtSize(row + " " + word, 10) > 720) {
          if (y < 40) {
            p = basis.addPage([792, 612]);
            heading();
            y = 550;
          }
          p.drawText(row, { x: 32, y, size: 10, font });
          y -= 15;
          row = word;
        } else row += (row ? " " : "") + word;
      }
      if (y < 40) {
        p = basis.addPage([792, 612]);
        heading();
        y = 550;
      }
      p.drawText(row, { x: 32, y, size: 10, font });
      y -= 24;
    }
    bytes = new Uint8Array(await basis.save());
  }

  const pages = [
    ...new Set(
      acceptedState.geometry
        .filter((g) => g.source_id && g.page)
        .map((g) => `${g.source_id}:${g.page}`),
    ),
  ];
  const { drawingRecords } = await import("../drawing-set");
  const sources = await drawingRecords(sb, job);
  const artifacts: PrivateArtifact[] = [];
  let doc = await PDFDocument.load(bytes),
    estimated = bytes.length,
    inVolume = 0;
  const flush = async () => {
    const pdf = await doc.save();
    const file = await saveTakeoffArtifact(
      sb,
      job,
      `Estimate-${view.structured.draft ? "draft" : "measured"}-${new Date().toISOString().replace(/[:.]/g, "-")}-volume-${artifacts.length + 1}.pdf`,
      pdf,
      "application/pdf",
    );
    artifacts.push(file);
    if (artifacts.length === 1 && pdf.length < 2 * 1024 * 1024)
      view.structured.pdf_base64 = bytesToBase64(pdf);
    else delete view.structured.pdf_base64;
  };
  for (const key of pages) {
    const [sourceId, n] = key.split(":"),
      source = sources.find((s) => s.id === sourceId),
      sheet = source?.sheets[Number(n) - 1];
    if (!sheet)
      throw new ToolError(
        "A measured sheet source is unavailable. No completed estimate package was confirmed.",
      );
    const page = await loadStoredPage(sb, job, sheet, sourceId),
      part = await measuredPdf(page, acceptedState);
    // Bounded volumes retain every full vector sheet. No downsampling or silent
    // omission to squeeze a multi-sheet estimate through the existing 10 MB cap.
    if (part.length + bytes.length > 9 * 1024 * 1024)
      throw new ToolError(
        "This single marked-up sheet exceeds the private PDF limit. Its geometry and original are preserved; no incomplete final estimate was confirmed.",
      );
    if (inVolume && estimated + part.length > 8 * 1024 * 1024) {
      await flush();
      doc = await PDFDocument.load(bytes);
      estimated = bytes.length;
      inVolume = 0;
    }
    const sourceDoc = await PDFDocument.load(part);
    for (const copy of await doc.copyPages(sourceDoc, sourceDoc.getPageIndices()))
      doc.addPage(copy);
    estimated += part.length;
    inVolume++;
  }
  await flush();
  view.structured.pdf_volumes = artifacts;
  view.structured.geometry_revs = acceptedState.geometry
    .filter((g) => g.status === "accepted")
    .map((g) => g.id);
  view.structured.measured_sheet_count = pages.length;
}
