// 0.8.18: the lookahead as a real PDF, built on the server, so an email can carry an actual file.
// Live fail (v0.8.17, 2026-10-21 00:10 Manaus): ChatGPT was only told to "build a PDF and attach it"; it had no file,
// called neither file_share nor email_draft, and the Gmail draft went out with nothing attached.
import { jsPDF } from "jspdf";
import { lookaheadModel, lookaheadAlert, lookaheadDates, lookaheadSourceLine, shortDate, dayHead, type LaItem, type SAct } from "./styled-views";
import { drawContractorBrand, drawPoweredByAthena, type ContractorBrand } from "../client-brand";
import type { LookaheadPlan } from "../cpm-gantt";

const BLUE: [number, number, number] = [30, 95, 237], GRAY: [number, number, number] = [156, 163, 175], NAVY: [number, number, number] = [30, 58, 95];
const RED: [number, number, number] = [220, 38, 38], G1: [number, number, number] = [107, 114, 128], G3: [number, number, number] = [209, 213, 219];
/** Standard PDF fonts are Latin-1: keep dashes and quotes readable, drop anything else (emoji, symbols). */
export const pdfText = (s: string) => s.replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u00B7/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "").replace(/\s+/g, " ").trim();
/** 0.8.21: "1 risk", "2 risks" (LA-31BE8 said "1 risks"). */
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
export const lookaheadPdfName = (jobNumber: string, start: string, end: string) => `${jobNumber} Two-Week Lookahead ${start} to ${end}.pdf`.replace(/[\\/:*?"<>|]/g, "-");

type LaModelT = ReturnType<typeof lookaheadModel>;
/** The three priority cards from the open items in the window, shared by both lookahead PDFs. Returns the next y. */
function drawPriorities(d: jsPDF, m: LaModelT, X: number, W: number, y0: number, brk: (y: number, need: number) => number): number {
  let y = y0;
  const color = (c: [number, number, number]) => d.setTextColor(c[0], c[1], c[2]);
  d.setFont("helvetica", "bold"); d.setFontSize(11); color(NAVY); d.text("TOP 3 PRIORITIES", X, y); y += 8;
  const cw = (W - 2 * X - 16) / 3;
  // 0.8.21: wrap priority titles in full (LA-31BE8 card 1 was cut at "...exposure from"); every card grows to the tallest one.
  d.setFont("helvetica", "bold"); d.setFontSize(9);
  const cards = (m.top.length ? m.top : [null]).map((t, i) => ({ t, lines: d.splitTextToSize(pdfText(`${i + 1}. ${t ? t.label : "No open items in this window"}`), cw - 14) as string[] }));
  const ch = Math.max(54, ...cards.map(({ t, lines }) => (t?.overdue ? 22 : 13) + lines.length * 10 + 16));
  y = brk(y, ch + 18);
  cards.forEach(({ t, lines }, i) => {
    const bx = X + i * (cw + 8);
    d.setDrawColor(...G3); d.roundedRect(bx, y, cw, ch, 4, 4);
    d.setFillColor(...(t && lookaheadAlert(t) ? RED : BLUE)); d.rect(bx, y, 3, ch, "F");
    d.setFont("helvetica", "bold"); d.setFontSize(9);
    if (t?.overdue) { color(RED); d.text("OVERDUE", bx + 9, y + 11); }
    color(NAVY);
    d.text(lines, bx + 9, y + (t?.overdue ? 22 : 13), { lineHeightFactor: 10 / 9 });
    d.setFont("helvetica", "normal"); d.setFontSize(8); color(t?.overdue ? RED : G1);
    if (t) d.text(pdfText(`Owner: ${t.item.owner ?? "Needed"} - Due ${t.item.due ? shortDate(t.item.due) : "Needed"}${t.flags.length ? " - date to check" : ""}`), bx + 9, y + ch - 6);
  });
  y += ch + 18;
  return y;
}

export function lookaheadPdf(v: { title: string; ref: string; start: string; end: string; dataDate: string | null; acts: SAct[]; items: LaItem[]; today?: string | null; brand?: ContractorBrand; version?: number | null }): Uint8Array {
  const m = lookaheadModel(v.start, v.end, v.acts, v.items, { today: v.today, dataDate: v.dataDate });
  const d = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight(), X = 36;
  let y = 44;
  const color = (c: [number, number, number]) => d.setTextColor(c[0], c[1], c[2]);
  const newPageIfNeeded = (need: number) => { if (y + need > H - 40) { d.addPage(); y = 44; } };
  // Client branding: the contractor leads in the top-right corner, Athena is one small line at the bottom.
  drawContractorBrand(d, v.brand, { x: W - X, y: 24, maxWidth: 170, maxHeight: 28, align: "right" });
  d.setFont("helvetica", "bold"); d.setFontSize(18); color(NAVY);
  d.text(d.splitTextToSize(pdfText(`Two-Week Lookahead - ${v.title}`), W - 2 * X - 190)[0] ?? "", X, y); y += 18;
  d.setFont("helvetica", "normal"); d.setFontSize(10); color(G1);
  d.text(pdfText(`Window ${shortDate(v.start)} - ${shortDate(v.end)}${v.dataDate ? ` - Data date ${shortDate(v.dataDate)}` : ""} - Ref ${v.ref}`), X, y); y += 14;
  d.text(pdfText(lookaheadSourceLine(v.end, v.dataDate, v.version)), X, y); y += 14;
  const c = m.counts;
  d.text(pdfText(`${plural(c.activities, "activity", "activities")} - ${c.critical} critical - ${plural(c.inspections, "inspection")} - ${plural(c.deliveries, "delivery", "deliveries")} - ${plural(c.risks, "risk")} - ${c.overdue} overdue${c.flags ? ` - ${plural(c.flags, "date to check", "dates to check")}` : ""}`), X, y); y += 22;

  y = drawPriorities(d, m, X, W, y, (yy, need) => { if (yy + need > H - 40) { d.addPage(); return 44; } return yy; });

  d.setFont("helvetica", "bold"); d.setFontSize(11); color(NAVY); d.text("CALENDAR", X, y); y += 14;
  // CPM columns: Start / Finish (" A" = actual) and % complete sit between the name and the float.
  const idW = 52, nameW = 124, stW = 58, fnW = 58, pcW = 26, flW = 30, cx0 = X + idW + nameW, gx = cx0 + stW + fnW + pcW + flW, dayW = (W - X - gx) / Math.max(m.days.length, 1);
  d.setFontSize(7); color(G1);
  m.days.forEach((day, i) => { if (i === 0 || i === 5) d.text(i === 0 ? "WEEK 1" : "WEEK 2", gx + i * dayW + 2, y - 2); d.text(pdfText(dayHead(day)), gx + i * dayW + 2, y + 8); });
  d.text("Start", cx0, y + 8); d.text("Finish", cx0 + stW, y + 8); d.text("%", cx0 + stW + fnW, y + 8); d.text("Float", cx0 + stW + fnW + pcW, y + 8); y += 14;
  if (!m.rows.length) { d.setFontSize(9); d.text("No saved schedule activities fall in this window.", X, y + 10); y += 20; }
  for (const r of m.rows) {
    newPageIfNeeded(18);
    d.setDrawColor(243, 244, 246); d.line(X, y, W - X, y);
    d.setFont("helvetica", "bold"); d.setFontSize(8); color(NAVY); d.text(pdfText(r.a.id), X, y + 11);
    d.setFont("helvetica", "normal"); d.text(d.splitTextToSize(pdfText(r.a.name), nameW - 6)[0] ?? "", X + idW, y + 11);
    const dt = lookaheadDates(r.a);
    color(G1); d.text(pdfText(dt.start), cx0, y + 11); d.text(pdfText(dt.finish), cx0 + stW, y + 11); d.text(pdfText(dt.pct), cx0 + stW + fnW, y + 11);
    color(Number(r.a.total_float) === 0 ? BLUE : G1); d.text(dt.float, cx0 + stW + fnW + pcW, y + 11);
    // 0.8.21: ONE continuous rounded bar per run of bar days (Marshall: the per-day blocks looked cut into pieces).
    for (let i = 0; i < r.cells.length; i++) {
      const k = r.cells[i].kind;
      if (k !== "crit" && k !== "non") continue;
      let j = i; while (j + 1 < r.cells.length && r.cells[j + 1].kind === k) j++;
      d.setFillColor(...(k === "crit" ? BLUE : GRAY)); d.roundedRect(gx + i * dayW + 1, y + 4, (j - i + 1) * dayW - 2, 9, 3, 3, "F");
      i = j;
    }
    r.cells.forEach((cell, i) => {
      const cx = gx + i * dayW;
      if (cell.kind === "crit" || cell.kind === "non") { /* drawn above as one bar */ }
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
    y += 6; // 0.8.21: room above each heading (RISKS sat on the last OVERDUE line)
    newPageIfNeeded(30);
    d.setFont("helvetica", "bold"); d.setFontSize(11); color(NAVY); d.text(title, X, y); y += 12;
    for (const e of list) {
      const lines = d.splitTextToSize(pdfText(lineOf(e)), W - 2 * X - 14);
      newPageIfNeeded(lines.length * 11 + 10);
      d.setFillColor(...(red ? RED : BLUE)); d.rect(X, y - 2, 3, lines.length * 11 + 4, "F");
      d.setFont("helvetica", "normal"); d.setFontSize(9); color(red && e.overdue ? RED : NAVY); d.text(lines, X + 9, y + 7);
      y += lines.length * 11 + 10;
    }
  };
  const who = (e: (typeof m.entries)[number]) => `Owner: ${e.item.owner ?? "Needed"} - Due ${e.item.due ? shortDate(e.item.due) : "Needed"}`;
  section("OVERDUE", m.overdue, true, (e) => `OVERDUE - ${e.label} - ${who(e)}`);
  section("RISKS", m.risks, true, (e) => `${e.overdue ? "OVERDUE - " : ""}${e.label} - Impact: ${e.a!.id} ${e.a!.name}${e.a!.total_float != null ? ` (float ${e.a!.total_float} WD)` : ""}. ${who(e)}`);
  section("OPEN FOLLOW-UPS", m.callouts, false, (e) => `${e.label} - ${who(e)}`);
  section("DATES TO CHECK", m.flagged, false, (e) => `${e.label.slice(0, 90)}: ${e.flags.map((f) => f.text).join("; ")}`);
  for (let p = 1; p <= d.getNumberOfPages(); p++) { d.setPage(p); drawPoweredByAthena(d, W - X, H - 20); }
  d.setProperties({ title: pdfText(`${v.title} Two-Week Lookahead`), creator: "Athena", author: pdfText(v.brand?.companyName ?? "") || "Athena" });
  return scrubProducer(new Uint8Array(d.output("arraybuffer")));
}

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const mmdd = (t: number) => { const d = new Date(t); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`; };
/** 06/25/26, as on the schedule page and printed schedules. */
const mdy = (t: number) => `${mmdd(t)}/${String(new Date(t).getUTCFullYear()).slice(2)}`;
const WEEK_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six"];
/** "2717 3-Week Lookahead 2026-06-25 to 2026-07-15.pdf" */
export const cpmLookaheadPdfName = (jobNumber: string, weeks: number, start: string, end: string) =>
  `${jobNumber} ${weeks}-Week Lookahead ${start} to ${end}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
const CRIT_C: [number, number, number] = [200, 50, 43], ACT_C: [number, number, number] = [47, 77, 116], POS_C: [number, number, number] = [31, 138, 91], BL_C: [number, number, number] = [195, 204, 216];
const hex = (h: string | null): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h ?? "");
  if (!m) return NAVY;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Marshall (Nov 5): the lookahead goes to the team, the client and subs, printed or attached in chat, so the PDF
 * is the page's lookahead: 1 to 6 weeks from the data date, grouped by total float, start, WBS or any code, the
 * code filters stacked, the data date line on the left and the End of lookahead period line on the right.
 * Bars that run past the window stop at that line with an arrow.
 */
export function cpmLookaheadPdf(v: { title: string; plan: LookaheadPlan; version?: number | null; acts: SAct[]; items: LaItem[]; today?: string | null; brand?: ContractorBrand }): Uint8Array {
  const p = v.plan;
  const start = isoDay(p.dd), end = isoDay(p.t1 - DAY_MS);
  const d = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight(), X = 36;
  const color = (c: [number, number, number]) => d.setTextColor(c[0], c[1], c[2]);
  let y = 44;
  drawContractorBrand(d, v.brand, { x: W - X, y: 24, maxWidth: 170, maxHeight: 28, align: "right" });
  d.setFont("helvetica", "bold"); d.setFontSize(18); color(NAVY);
  d.text(d.splitTextToSize(pdfText(`${WEEK_WORDS[p.weeks]}-Week Lookahead - ${v.title}`), W - 2 * X - 190)[0] ?? "", X, y); y += 18;
  d.setFont("helvetica", "normal"); d.setFontSize(10); color(G1);
  d.text(pdfText(`Data date ${shortDate(start)} - Window ${shortDate(start)} to ${shortDate(end)} - ${p.groupLabel}${v.version ? ` - Schedule v${v.version}` : ""}`), X, y); y += 14;
  if (p.filterLines.length) { d.text(pdfText(`Showing only ${p.filterLines.join("; ")}`), X, y); y += 14; }
  d.text(pdfText(`${p.count} ${p.count === 1 ? "activity" : "activities"} with remaining work in the window`), X, y); y += 22;

  // Open items due in the window lead, as on the two-week lookahead.
  const la = lookaheadModel(start, end, v.acts, v.items, { today: v.today, dataDate: start });
  if (v.items.length) y = drawPriorities(d, la, X, W, y, (yy, need) => { if (yy + need > H - 40) { d.addPage(); return 44; } return yy; });

  // Table on the left, timeline on the right.
  const cols: { k: string; label: string; w: number; right?: boolean }[] = [
    { k: "id", label: "ID", w: 46 },
    { k: "name", label: "Activity", w: p.partyLabel ? 150 : 210 },
    { k: "rd", label: "RD", w: 22, right: true },
    { k: "st", label: "Start", w: 48 },
    { k: "fi", label: "Finish", w: 40 },
    { k: "tf", label: "TF", w: 22, right: true },
    ...(p.partyLabel ? [{ k: "party", label: p.partyLabel, w: 100 }] : []),
  ];
  const gx = X + cols.reduce((n, c) => n + c.w, 0) + 6;
  const t0 = p.dd - DAY_MS; // one day before the data date so its line clears the table
  const days = Math.round((p.t1 - t0) / DAY_MS);
  const pad = 8;
  const dayW = (W - X - gx - pad) / days;
  const tx = (t: number) => gx + ((t - t0) / DAY_MS) * dayW;
  const ROW = 15, HEAD_H = 26;
  let pageTop = 0;
  const head = () => {
    pageTop = y;
    d.setFont("helvetica", "bold"); d.setFontSize(7); color(G1);
    let cx = X;
    for (const c of cols) { d.text(pdfText(c.label), c.right ? cx + c.w - 4 : cx, y + 20, c.right ? { align: "right" } : undefined); cx += c.w; }
    // Week labels above, days below; every day on a 1 or 2 week window, Mondays only past that.
    for (let i = 0; i < days; i++) {
      const t = t0 + i * DAY_MS;
      const dow = new Date(t).getUTCDay();
      if (p.weeks <= 2) { d.setFont("helvetica", "normal"); d.text("SMTWTFS"[dow], tx(t) + dayW / 2, y + 12, { align: "center" }); d.text(String(new Date(t).getUTCDate()), tx(t) + dayW / 2, y + 20, { align: "center" }); }
      else if (dow === 1) { d.setFont("helvetica", "normal"); d.text(mmdd(t), tx(t) + 1, y + 20); d.setDrawColor(...G3); d.line(tx(t), y + 13, tx(t), y + 24); }
    }
    d.setDrawColor(...G3); d.line(X, y + HEAD_H - 1, W - X, y + HEAD_H - 1);
    y += HEAD_H;
  };
  // Non-working days shade each row as it is drawn (jsPDF has no layers); the two blue lines go over each page.
  const shade = (top: number) => {
    for (let i = 0; i < days; i++) {
      const t = t0 + i * DAY_MS;
      if (!p.works(t)) { d.setFillColor(241, 244, 248); d.rect(tx(t), top, dayW, ROW, "F"); }
    }
  };
  const closePage = () => {
    const bot = y;
    d.setDrawColor(...BLUE); d.setLineWidth(1.2);
    const xd = tx(p.dd), xe = tx(p.t1);
    d.line(xd, pageTop + 4, xd, bot); d.line(xe, pageTop + 4, xe, bot);
    d.setLineWidth(0.5);
    d.setFont("helvetica", "bold"); d.setFontSize(6); d.setTextColor(255, 255, 255);
    const tag = (x: number, label: string, align: "left" | "right") => {
      const w = d.getTextWidth(label) + 6;
      const bx = align === "left" ? x : x - w;
      d.setFillColor(...BLUE); d.roundedRect(bx, pageTop - 6, w, 9, 2, 2, "F");
      d.setTextColor(255, 255, 255); d.text(label, bx + 3, pageTop);
    };
    tag(xd, `DD ${mdy(p.dd)}`, "left");
    tag(xe, "End of lookahead period", "right");
  };
  y += 10;
  head();
  if (!p.items.length) { d.setFont("helvetica", "normal"); d.setFontSize(9); color(G1); d.text("No remaining work falls in this window.", X, y + 12); y += 20; }
  for (const it of p.items) {
    if (y + ROW > H - 44) { closePage(); d.addPage(); y = 54; head(); }
    if (it.kind === "group") {
      d.setFillColor(248, 250, 252); d.rect(X, y, W - 2 * X, ROW, "F");
      shade(y);
      d.setFillColor(...hex(it.color)); d.rect(X, y, 3, ROW, "F");
      d.setFont("helvetica", "bold"); d.setFontSize(8); color(it.color ? hex(it.color) : NAVY);
      d.text(pdfText(it.label), X + 7, y + 10.5);
      y += ROW; continue;
    }
    shade(y);
    d.setDrawColor(243, 244, 246); d.line(X, y + ROW, W - X, y + ROW);
    d.setFontSize(7.5);
    let cx = X;
    const cell = (k: string): string =>
      k === "id" ? it.id : k === "name" ? it.name : k === "rd" ? (it.rd ?? "").toString() : k === "st" ? (it.start === null ? "" : `${mdy(it.start)}${it.started ? " A" : ""}`) : k === "fi" ? (it.finish === null ? "" : mdy(it.finish)) : k === "tf" ? (it.tf === null ? "" : String(it.tf)) : (it.party ?? "");
    for (const c of cols) {
      d.setFont("helvetica", c.k === "id" || (c.k === "name" && it.critical) ? "bold" : "normal");
      color(c.k === "tf" && it.tf !== null && it.tf <= 0 ? CRIT_C : c.k === "id" || c.k === "name" ? NAVY : G1);
      const txt = d.splitTextToSize(pdfText(cell(c.k)), c.w - 6)[0] ?? "";
      d.text(txt, c.right ? cx + c.w - 4 : cx, y + 10.5, c.right ? { align: "right" } : undefined);
      cx += c.w;
    }
    // Baseline as a thin grey bar, then the bar: done portion navy, remaining red when critical, green otherwise.
    const clip = (t: number) => Math.min(Math.max(t, t0), p.t1);
    if (it.bs !== null && it.bf !== null && it.bf + DAY_MS > t0 && it.bs < p.t1) {
      d.setFillColor(...BL_C); d.rect(tx(clip(it.bs)), y + 11.5, Math.max(1, tx(clip(it.bf + DAY_MS)) - tx(clip(it.bs))), 1.6, "F");
    }
    if (it.milestone && it.finish !== null) {
      const mx = tx(clip(it.finish)) + dayW / 2, my = y + 7;
      d.setFillColor(...(it.critical ? CRIT_C : ACT_C));
      d.triangle(mx - 4, my, mx, my - 4, mx + 4, my, "F"); d.triangle(mx - 4, my, mx, my + 4, mx + 4, my, "F");
    } else if (it.start !== null && it.finish !== null) {
      const a = clip(it.start), b = clip(it.finish + DAY_MS);
      if (b > a) {
        const remainColor = it.critical ? CRIT_C : POS_C;
        const split = it.started ? clip(p.dd) : a;
        if (split > a) { d.setFillColor(...ACT_C); d.rect(tx(a), y + 3.5, tx(split) - tx(a), 7, "F"); }
        if (b > split) { d.setFillColor(...remainColor); d.rect(tx(split), y + 3.5, tx(b) - tx(split), 7, "F"); }
        if (it.finish + DAY_MS > p.t1) {
          // Continues past the window: a small arrow at the end line.
          const ex = tx(p.t1);
          d.setFillColor(...remainColor); d.triangle(ex, y + 2.5, ex + 5, y + 7, ex, y + 11.5, "F");
        }
      }
    }
    y += ROW;
  }
  closePage();
  y += 14;
  if (y > H - 60) { d.addPage(); y = 54; }
  d.setFont("helvetica", "normal"); d.setFontSize(7); color(G1);
  d.setFillColor(...ACT_C); d.rect(X, y - 5, 10, 5, "F"); d.text("Done", X + 13, y);
  d.setFillColor(...CRIT_C); d.rect(X + 42, y - 5, 10, 5, "F"); d.text("Critical", X + 55, y);
  d.setFillColor(...POS_C); d.rect(X + 92, y - 5, 10, 5, "F"); d.text("Has float", X + 105, y);
  d.setFillColor(...BL_C); d.rect(X + 145, y - 3, 10, 1.6, "F"); d.text("Baseline", X + 158, y);
  y += 12;
  const note = d.splitTextToSize(pdfText(`The blue line on the left is the data date, ${shortDate(start)}; the one on the right ends the lookahead period, and bars with an arrow continue past it. Shaded days are non-working on the project calendar. RD is remaining duration and TF total float, in working days.`), W - 2 * X);
  d.text(note, X, y);
  for (let pg = 1; pg <= d.getNumberOfPages(); pg++) { d.setPage(pg); drawPoweredByAthena(d, W - X, H - 20); }
  d.setProperties({ title: pdfText(`${v.title} ${p.weeks}-Week Lookahead`), creator: "Athena", author: pdfText(v.brand?.companyName ?? "") || "Athena" });
  return scrubProducer(new Uint8Array(d.output("arraybuffer")));
}

/** 0.8.22: the PDF library writes its own name into /Producer. Overwrite it in place with "Athena" padded to the
 * same byte length, so every xref offset stays valid. */
export function scrubProducer(bytes: Uint8Array): Uint8Array {
  const key = [...new TextEncoder().encode("/Producer (")];
  outer: for (let i = 0; i + key.length < bytes.length; i++) {
    for (let k = 0; k < key.length; k++) if (bytes[i + k] !== key[k]) continue outer;
    const start = i + key.length;
    let end = start;
    while (end < bytes.length && bytes[end] !== 0x29) end++;
    const name = new TextEncoder().encode("Athena");
    for (let p = start; p < end; p++) bytes[p] = p - start < name.length ? name[p - start] : 0x20;
    break;
  }
  return bytes;
}
