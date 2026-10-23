// Estimate summary as a landscape PDF, same pipeline as the lookahead PDF.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { scrubProducer, pdfText } from "./lookahead-pdf";

const NAVY: [number, number, number] = [30, 58, 95];
const BLUE: [number, number, number] = [30, 95, 237];
const GRAY: [number, number, number] = [107, 114, 128];

function logoData(): string | null {
  try {
    const buf = readFileSync(join(process.cwd(), "public/brand/athena/athena-primary-512.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export type SummaryPdfRow = {
  trade: string;
  title: string;
  ref: string;
  qty: string;
  rate: string;
  extension: string | null;
};

/** 17 in by 11 in, landscape. Athena mark at the top right. */
export function estimateSummaryPdf(input: {
  job: string;
  revision: string;
  draft: boolean;
  rows: SummaryPdfRow[];
  notes: string[];
}): Uint8Array {
  const d = new jsPDF({ orientation: "landscape", unit: "pt", format: [1224, 792] });
  const W = d.internal.pageSize.getWidth();
  const H = d.internal.pageSize.getHeight();
  const X = 36;
  let y = 48;
  const logo = logoData();
  if (logo) {
    try {
      d.addImage(logo, "PNG", W - 36 - 48, 18, 48, 48);
    } catch {
      d.setFont("helvetica", "bold");
      d.setFontSize(12);
      d.setTextColor(...BLUE);
      d.text("Athena", W - 36 - 48, 36);
    }
  } else {
    d.setFont("helvetica", "bold");
    d.setFontSize(12);
    d.setTextColor(...BLUE);
    d.text("Athena", W - 36 - 48, 36);
  }
  d.setFont("helvetica", "bold");
  d.setFontSize(18);
  d.setTextColor(...NAVY);
  d.text(pdfText(input.draft ? `${input.job} · Estimate summary, draft` : `${input.job} · Estimate Summary`), X, y);
  y += 16;
  d.setFont("helvetica", "normal");
  d.setFontSize(10);
  d.setTextColor(...GRAY);
  d.text(pdfText(input.revision), X, y);
  y += 22;
  const paint = (line: string) => {
    const wrapped = d.splitTextToSize(pdfText(line), W - 2 * X - 60) as string[];
    if (y + wrapped.length * 12 > H - 36) {
      d.addPage();
      y = 48;
    }
    d.text(wrapped, X, y);
    y += wrapped.length * 12 + 4;
  };
  d.setFont("helvetica", "normal");
  d.setFontSize(10);
  d.setTextColor(...NAVY);
  if (!input.rows.length) paint("No priced lines on this summary yet.");
  let trade = "";
  for (const row of input.rows) {
    if (row.trade !== trade) {
      trade = row.trade;
      y += 6;
      d.setFont("helvetica", "bold");
      paint(trade);
      d.setFont("helvetica", "normal");
    }
    paint(`${row.ref} ${row.title}. Qty ${row.qty}. Rate ${row.rate}.${row.extension ? ` Extension ${row.extension}.` : ""}`);
  }
  y += 8;
  for (const note of input.notes) paint(note);
  d.setFontSize(8);
  d.setTextColor(...GRAY);
  d.text("Athena by ALP", W - X - 70, H - 24);
  d.setProperties({ title: pdfText(`${input.job} Estimate Summary`), creator: "Athena", author: "Athena" });
  return scrubProducer(new Uint8Array(d.output("arraybuffer")));
}

export function estimateSummaryPdfName(jobNumber: string): string {
  return `${jobNumber} Estimate Summary.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}
