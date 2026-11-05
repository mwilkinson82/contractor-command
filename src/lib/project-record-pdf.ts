// The project record as a PDF for a dispute file: the contractor's name up top, what the record is
// and how it was kept, then every entry by day with its time, who, to whom and entry ID.
// Built with the same jsPDF setup as the daily report PDF.
import { jsPDF } from "jspdf";
import { pdfText, scrubProducer } from "./mcp/lookahead-pdf";
import { drawContractorBrand, drawPoweredByAthena, type ContractorBrand } from "./client-brand";
import {
  TYPE_TAG,
  byLine,
  clock,
  dayHeading,
  entryId,
  groupByDay,
  recordType,
  shortDate,
  stampAt,
  zoneAbbr,
  type RecordEvent,
  type RecordFeed,
} from "./project-record-feed";

type RGB = [number, number, number];
const NAVY: RGB = [24, 52, 83],
  INK: RGB = [28, 54, 84],
  G1: RGB = [100, 116, 139],
  RULE: RGB = [220, 227, 236],
  FILL: RGB = [246, 248, 251];

export function projectRecordPdf(
  feed: RecordFeed,
  events: RecordEvent[],
  opts: { details: boolean; filterNote: string; brand?: ContractorBrand },
): Uint8Array {
  const d = new jsPDF({ unit: "pt", format: "letter" });
  const W = d.internal.pageSize.getWidth(),
    H = d.internal.pageSize.getHeight(),
    X = 40,
    CW = W - 2 * X,
    TOP = 48,
    BOTTOM = H - 52,
    TIME_W = 78;
  const zone = feed.time_zone;
  let y = TOP;
  const font = (size: number, bold = false, c: RGB = INK) => {
    d.setFont("helvetica", bold ? "bold" : "normal");
    d.setFontSize(size);
    d.setTextColor(c[0], c[1], c[2]);
  };
  const wrap = (s: string, w: number) => d.splitTextToSize(pdfText(s), w) as string[];
  const need = (h: number) => {
    if (y + h > BOTTOM) {
      d.addPage();
      y = TOP;
      return true;
    }
    return false;
  };

  // ---------- cover ----------
  const companyName = opts.brand?.companyName || feed.company || undefined;
  const bh = drawContractorBrand(
    d,
    { companyName, logo: opts.brand?.logo, logoFormat: opts.brand?.logoFormat },
    { x: X, y: y - 12, maxWidth: 220, maxHeight: 30, align: "left" },
  );
  if (bh) y += bh + 14;
  font(22, true, NAVY);
  d.text("Project Record", X, y);
  y += 20;
  font(11, false, G1);
  d.text(pdfText(`${feed.job_number ?? ""}${feed.job_name ? ` - ${feed.job_name}` : ""}`), X, y);
  y += 16;
  d.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
  d.setLineWidth(1.5);
  d.line(X, y, X + CW, y);
  d.setLineWidth(0.5);
  y += 18;
  const facts: [string, string][] = [
    [
      "Dates",
      `${feed.from ? shortDate(feed.from) : "Start of job"} to ${feed.to ? shortDate(feed.to) : "today"}`,
    ],
    ["Entries", String(events.length)],
    ["Filters", opts.filterNote],
    ["Time zone", `${zone}. Each entry shows the job's local time.`],
    ["Exported", stampAt(new Date().toISOString(), zone)],
  ];
  for (const [k, v] of facts) {
    font(9, false, G1);
    d.text(k, X, y);
    font(9, true);
    const l = wrap(v, CW - 110);
    d.text(l, X + 110, y);
    y += 13 * l.length;
  }
  y += 6;
  const basis = wrap(
    "Every entry was time-stamped by the system when it was saved, and saved entries cannot be edited. " +
      '"Happened" shows the date someone said it happened when they told Athena later. ' +
      "Entry IDs match the project record in Athena.",
    CW - 20,
  );
  const missing = feed.unavailable_sources.length
    ? wrap(
        `Not included because they could not be read: ${feed.unavailable_sources.join(", ")}.`,
        CW - 20,
      )
    : [];
  const boxH = 14 + (basis.length + missing.length) * 11;
  d.setFillColor(FILL[0], FILL[1], FILL[2]);
  d.rect(X, y - 10, CW, boxH, "F");
  font(8.5, false, INK);
  d.text(basis, X + 10, y + 2);
  if (missing.length) d.text(missing, X + 10, y + 2 + basis.length * 11);
  y += boxH + 8;
  if (feed.truncated) {
    font(8.5, true, [154, 91, 0]);
    d.text(
      pdfText(
        "This export holds the newest 5,000 entries. Choose a shorter date range for the rest.",
      ),
      X,
      y,
    );
    y += 14;
  }

  // ---------- entries by day, oldest first so it reads as a chronology ----------
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (!ordered.length) {
    font(10, false, G1);
    d.text("No entries match these dates and filters.", X, y + 10);
  }
  for (const g of groupByDay(ordered, zone)) {
    need(48);
    y += 8;
    d.setFillColor(FILL[0], FILL[1], FILL[2]);
    d.rect(X, y - 11, CW, 17, "F");
    font(9, true, NAVY);
    d.text(pdfText(dayHeading(g.day)), X + 6, y);
    y += 16;
    for (const e of g.events) {
      const textW = CW - TIME_W - 6;
      font(9.5, true);
      const title = wrap(`${e.title}`, textW - 70);
      font(8.5);
      const sum = opts.details && e.summary ? wrap(e.summary, textW) : [];
      const meta = wrap(
        [byLine(e), e.happened_on ? `Happened ${shortDate(e.happened_on)}` : ""]
          .filter(Boolean)
          .join(" · "),
        textW,
      );
      const h = title.length * 12 + sum.length * 10.5 + meta.length * 10 + 10;
      if (need(h)) {
        font(8, true, G1);
        d.text(pdfText(`${dayHeading(g.day)} (continued)`), X, y);
        y += 14;
      }
      font(9.5, true, NAVY);
      d.text(clock(e.at, zone), X, y);
      font(7.5, false, G1);
      d.text(zoneAbbr(e.at, zone), X, y + 10);
      d.text(entryId(e), X, y + 20);
      const tx = X + TIME_W;
      font(7.5, true, G1);
      d.text(pdfText(TYPE_TAG[recordType(e.type)].toUpperCase()), X + CW, y, { align: "right" });
      font(9.5, true, INK);
      d.text(title, tx, y);
      let yy = y + title.length * 12;
      if (sum.length) {
        font(8.5, false, INK);
        d.text(sum, tx, yy - 1);
        yy += sum.length * 10.5;
      }
      font(8, false, G1);
      d.text(meta, tx, yy);
      yy += meta.length * 10;
      y = Math.max(yy, y + 24) + 4;
      d.setDrawColor(RULE[0], RULE[1], RULE[2]);
      d.line(tx, y - 6, X + CW, y - 6);
      y += 6;
    }
  }

  // ---------- running footer ----------
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    d.setDrawColor(RULE[0], RULE[1], RULE[2]);
    d.line(X, H - 36, X + CW, H - 36);
    font(7, false, G1);
    d.text(pdfText(`${feed.job_number ?? ""} Project Record`), X, H - 24);
    d.text(`Page ${i} of ${n}`, X + CW / 2, H - 24, { align: "center" });
    drawPoweredByAthena(d, X + CW, H - 24);
  }
  d.setProperties({
    title: pdfText(`${feed.job_number ?? ""} Project Record`),
    subject: "Project record",
    creator: "Athena",
    author: pdfText(companyName ?? "") || "Athena",
  });
  return scrubProducer(new Uint8Array(d.output("arraybuffer")));
}
