// Progress-photo log as a PDF. Captions only; the gallery page holds the pictures.
import { jsPDF } from "jspdf";
import { scrubProducer, pdfText } from "./lookahead-pdf";
import { shortDate } from "./styled-views";

const NAVY: [number, number, number] = [30, 58, 95];
const GRAY: [number, number, number] = [107, 114, 128];

export type PhotoLogRow = {
  taken_on: string;
  area: string;
  work?: string | null;
  sov_item?: string | null;
  activity_id?: string | null;
  client_safe?: boolean;
};

export function photoLogPdf(title: string, rows: PhotoLogRow[]): Uint8Array {
  const d = new jsPDF({ unit: "pt", format: "a6" });
  const W = d.internal.pageSize.getWidth();
  const X = 24;
  let y = 36;
  d.setFont("helvetica", "bold");
  d.setFontSize(14);
  d.setTextColor(...NAVY);
  d.text(pdfText(title || "Progress photos"), X, y);
  y += 18;
  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  d.setTextColor(...GRAY);
  d.text(pdfText(`${rows.length} photo${rows.length === 1 ? "" : "s"}`), X, y);
  y += 16;
  if (!rows.length) {
    d.setTextColor(...NAVY);
    d.text("No progress photos in this view.", X, y);
  }
  for (const row of rows) {
    if (y > d.internal.pageSize.getHeight() - 72) {
      d.addPage();
      y = 36;
    }
    d.setDrawColor(209, 213, 219);
    d.setFillColor(255, 255, 255);
    d.roundedRect(X, y, W - 2 * X, 58, 4, 4);
    d.setFont("helvetica", "bold");
    d.setFontSize(10);
    d.setTextColor(...NAVY);
    d.text(pdfText(shortDate(row.taken_on)), X + 8, y + 14);
    d.setFont("helvetica", "normal");
    d.text(pdfText(row.area), X + 8, y + 28);
    d.setFontSize(8);
    d.setTextColor(...GRAY);
    const tags = [row.work, row.sov_item ? `SOV ${row.sov_item}` : "", row.activity_id ?? "", row.client_safe ? "Client-safe" : "Internal"].filter(Boolean).join(" - ");
    d.text(pdfText(tags).slice(0, 90), X + 8, y + 44);
    y += 66;
  }
  d.setFontSize(8);
  d.setTextColor(...GRAY);
  d.text("Athena by ALP", X, d.internal.pageSize.getHeight() - 16);
  d.setProperties({ title: pdfText(title || "Progress photos"), creator: "Athena", author: "Athena" });
  return scrubProducer(new Uint8Array(d.output("arraybuffer")));
}
