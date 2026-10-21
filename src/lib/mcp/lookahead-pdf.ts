// 0.8.18: the lookahead as a real PDF, built on the server, so an email can carry an actual file.
// Live fail (v0.8.17, 2026-10-21 00:10 Manaus): ChatGPT was only told to "build a PDF and attach it"; it had no file,
// called neither file_share nor email_draft, and the Gmail draft went out with nothing attached.
import { jsPDF } from "jspdf";
import { lookaheadModel, shortDate, dayHead, type LaItem, type SAct } from "./styled-views";

const BLUE: [number, number, number] = [37, 99, 235], GRAY: [number, number, number] = [156, 163, 175], NAVY: [number, number, number] = [30, 58, 95];
const RED: [number, number, number] = [220, 38, 38], G1: [number, number, number] = [107, 114, 128], G3: [number, number, number] = [209, 213, 219];
/** Standard PDF fonts are Latin-1: keep dashes and quotes readable, drop anything else (emoji, symbols). */
export const pdfText = (s: string) => s.replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u00B7/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "").replace(/\s+/g, " ").trim();
export const lookaheadPdfName = (jobNumber: string, start: string, end: string) => `${jobNumber} Two-Week Lookahead ${start} to ${end}.pdf`.replace(/[\\/:*?"<>|]/g, "-");

export function lookaheadPdf(v: { title: string; ref: string; start: string; end: string; dataDate: string | null; acts: SAct[]; items: LaItem[]; today?: string | null }): Uint8Array {
  const m = lookaheadModel(v.start, v.end, v.acts, v.items, { today: v.today, dataDate: v.dataDate });
  const d = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight(), X = 36;
  let y = 44;
  const color = (c: [number, number, number]) => d.setTextColor(c[0], c[1], c[2]);
  const newPageIfNeeded = (need: number) => { if (y + need > H - 40) { d.addPage(); y = 44; } };
  d.setFont("helvetica", "bold"); d.setFontSize(18); color(NAVY);
  d.text(pdfText(`Two-Week Lookahead - ${v.title}`), X, y); y += 18;
  d.setFont("helvetica", "normal"); d.setFontSize(10); color(G1);
  d.text(pdfText(`Window ${shortDate(v.start)} - ${shortDate(v.end)}${v.dataDate ? ` - Data date ${shortDate(v.dataDate)}` : ""} - Ref ${v.ref}`), X, y); y += 14;
  const c = m.counts;
  d.text(pdfText(`${c.activities} activities - ${c.critical} critical - ${c.inspections} inspections - ${c.deliveries} deliveries - ${c.risks} risks - ${c.overdue} overdue${c.flags ? ` - ${c.flags} dates to check` : ""}`), X, y); y += 22;

  d.setFont("helvetica", "bold"); d.setFontSize(11); color(NAVY); d.text("TOP 3 PRIORITIES", X, y); y += 8;
  const cw = (W - 2 * X - 16) / 3;
  (m.top.length ? m.top : [null]).forEach((t, i) => {
    const bx = X + i * (cw + 8);
    d.setDrawColor(...G3); d.roundedRect(bx, y, cw, 54, 4, 4);
    d.setFillColor(...(t?.overdue || t?.flags.length ? RED : BLUE)); d.rect(bx, y, 3, 54, "F");
    d.setFont("helvetica", "bold"); d.setFontSize(9);
    if (t?.overdue) { color(RED); d.text("OVERDUE", bx + 9, y + 11); }
    color(NAVY);
    d.text(d.splitTextToSize(pdfText(`${i + 1}. ${t ? t.label : "No open items in this window"}`), cw - 14).slice(0, t?.overdue ? 2 : 3), bx + 9, y + (t?.overdue ? 22 : 13));
    d.setFont("helvetica", "normal"); d.setFontSize(8); color(t?.overdue ? RED : G1);
    if (t) d.text(pdfText(`Owner: ${t.item.owner ?? "Needed"} - Due ${t.item.due ? shortDate(t.item.due) : "Needed"}${t.flags.length ? " - date to check" : ""}`), bx + 9, y + 48);
  });
  y += 72;

  d.setFont("helvetica", "bold"); d.setFontSize(11); color(NAVY); d.text("CALENDAR", X, y); y += 14;
  const idW = 52, nameW = 200, flW = 34, gx = X + idW + nameW + flW, dayW = (W - X - gx) / Math.max(m.days.length, 1);
  d.setFontSize(7); color(G1);
  m.days.forEach((day, i) => { if (i === 0 || i === 5) d.text(i === 0 ? "WEEK 1" : "WEEK 2", gx + i * dayW + 2, y - 2); d.text(pdfText(dayHead(day)), gx + i * dayW + 2, y + 8); });
  d.text("Float", X + idW + nameW, y + 8); y += 14;
  if (!m.rows.length) { d.setFontSize(9); d.text("No saved schedule activities fall in this window.", X, y + 10); y += 20; }
  for (const r of m.rows) {
    newPageIfNeeded(18);
    d.setDrawColor(243, 244, 246); d.line(X, y, W - X, y);
    d.setFont("helvetica", "bold"); d.setFontSize(8); color(NAVY); d.text(pdfText(r.a.id), X, y + 11);
    d.setFont("helvetica", "normal"); d.text(d.splitTextToSize(pdfText(r.a.name), nameW - 6)[0] ?? "", X + idW, y + 11);
    color(Number(r.a.total_float) === 0 ? BLUE : G1); d.text(String(r.a.total_float ?? ""), X + idW + nameW, y + 11);
    r.cells.forEach((cell, i) => {
      const cx = gx + i * dayW;
      if (cell.kind === "crit" || cell.kind === "non") { d.setFillColor(...(cell.kind === "crit" ? BLUE : GRAY)); d.roundedRect(cx + 1, y + 4, dayW - 2, 9, 2, 2, "F"); }
      else if (cell.kind) { d.setFont("helvetica", "bold"); color(NAVY); d.text(cell.kind === "insp" ? "INSP" : cell.kind === "deliv" ? "DLV" : "MS", cx + 2, y + 11); d.setFont("helvetica", "normal"); }
      if (cell.risk) { d.setFillColor(...RED); d.triangle(cx + dayW - 9, y + 3, cx + dayW - 2, y + 3, cx + dayW - 9, y + 9, "F"); }
    });
    y += 16;
  }
  y += 6; d.setFontSize(7); color(G1);
  d.setFillColor(...BLUE); d.rect(X, y, 8, 6, "F"); d.text("Critical", X + 11, y + 6);
  d.setFillColor(...GRAY); d.rect(X + 50, y, 8, 6, "F"); d.text("Non-critical", X + 61, y + 6);
  d.text("INSP Inspection  DLV Delivery  MS Milestone", X + 115, y + 6);
  d.setFillColor(...RED); d.triangle(X + 280, y, X + 287, y, X + 280, y + 6, "F"); d.text("Risk", X + 290, y + 6);
  y += 20;

  const section = (title: string, list: typeof m.entries, red: boolean, lineOf: (e: (typeof m.entries)[number]) => string) => {
    if (!list.length) return;
    newPageIfNeeded(30);
    d.setFont("helvetica", "bold"); d.setFontSize(11); color(NAVY); d.text(title, X, y); y += 12;
    for (const e of list) {
      const lines = d.splitTextToSize(pdfText(lineOf(e)), W - 2 * X - 14);
      newPageIfNeeded(lines.length * 11 + 10);
      d.setFillColor(...(red ? RED : GRAY)); d.rect(X, y - 2, 3, lines.length * 11 + 4, "F");
      d.setFont("helvetica", "normal"); d.setFontSize(9); color(red && e.overdue ? RED : NAVY); d.text(lines, X + 9, y + 7);
      y += lines.length * 11 + 10;
    }
  };
  const who = (e: (typeof m.entries)[number]) => `Owner: ${e.item.owner ?? "Needed"} - Due ${e.item.due ? shortDate(e.item.due) : "Needed"}`;
  section("OVERDUE", m.overdue, true, (e) => `OVERDUE - ${e.label} - ${who(e)}`);
  section("RISKS", m.risks, true, (e) => `${e.overdue ? "OVERDUE - " : ""}${e.label} - Impact: ${e.a!.id} ${e.a!.name}${e.a!.total_float != null ? ` (float ${e.a!.total_float} WD)` : ""}. ${who(e)}`);
  section("DATES TO CHECK", m.flagged, false, (e) => `${e.label.slice(0, 90)}: ${e.flags.map((f) => f.text).join("; ")}`);
  d.setFontSize(7); color(GRAY); d.text("Athena by ALP", W - X - 50, H - 20);
  return new Uint8Array(d.output("arraybuffer"));
}
