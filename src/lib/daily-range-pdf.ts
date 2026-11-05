// Daily reports for a date range as one PDF: a cover summary, then each day's daily on its own page with its
// work lines and progress photos. Built with the same jsPDF setup as the lookahead PDF, so it runs in the browser
// (download button) and on the server (Athena tool) from the same code.
import { jsPDF } from "jspdf";
import { pdfText, scrubProducer } from "./mcp/lookahead-pdf";
import { drawContractorBrand, drawPoweredByAthena, type ContractorBrand } from "./client-brand";
import {
  DAILY_SECTIONS,
  PHOTO_MODE_LABEL,
  dateRuns,
  longDate,
  mediumDate,
  numberText,
  photoCaption,
  photoFacts,
  reported,
  stamp,
  type DailyRangePhoto,
  type DailyRangeReport,
} from "./daily-range-report";

type RGB = [number, number, number];
const NAVY: RGB = [24, 52, 83],
  BLUE: RGB = [30, 95, 237],
  G1: RGB = [100, 116, 139],
  G2: RGB = [148, 163, 184],
  RULE: RGB = [220, 227, 236],
  FILL: RGB = [246, 248, 251];

/** A photo ready to place: JPEG or PNG bytes (or a data URL), with its pixel size when already known. */
export type PdfPhoto = {
  data: Uint8Array | string;
  format: "JPEG" | "PNG";
  width?: number;
  height?: number;
};
/** Why a photo on file is not drawn in this PDF. It is still listed with its facts. */
export type PdfPhotoSkip = { reason: string };

/** Keeps line breaks (the field writes lists), but each line is Latin-1 safe like the other PDFs. */
const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => pdfText(l))
    .filter((l, i, all) => l || (i > 0 && all[i - 1]));

export function dailyRangePdf(
  r: DailyRangeReport,
  photos: Map<string, PdfPhoto | PdfPhotoSkip> = new Map(),
  brand?: ContractorBrand,
): Uint8Array {
  const d = new jsPDF({ unit: "pt", format: "letter" });
  const W = d.internal.pageSize.getWidth(),
    H = d.internal.pageSize.getHeight(),
    X = 40,
    CW = W - 2 * X,
    TOP = 48,
    BOTTOM = H - 52;
  let y = TOP;
  const color = (c: RGB) => d.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, bold = false, c: RGB = NAVY) => {
    d.setFont("helvetica", bold ? "bold" : "normal");
    d.setFontSize(size);
    color(c);
  };
  const page = () => {
    d.addPage();
    y = TOP;
  };
  const room = (need: number) => {
    if (y + need > BOTTOM) {
      page();
      return true;
    }
    return false;
  };
  const wrap = (s: string, width: number) =>
    lines(s).flatMap((l) => (l ? (d.splitTextToSize(l, width) as string[]) : [""]));
  // Text wraps in full. Only a field far longer than any real daily entry is cut, and then
  // visibly, with an ellipsis, so a printed record never stops mid-sentence without a mark.
  const clip = (ls: string[], max: number) =>
    ls.length <= max ? ls : [...ls.slice(0, max - 1), `${ls[max - 1].replace(/\s*\S*$/, "")} ...`];
  const title = `${r.job_number}${r.job_name ? ` - ${r.job_name}` : ""}`;
  const span =
    r.period.from === r.period.to
      ? mediumDate(r.period.from)
      : `${mediumDate(r.period.from)} - ${mediumDate(r.period.to)}`;

  // ---------- cover summary ----------
  // Client branding: the contractor leads (their saved logo, else their name); Athena is one small
  // line in the bottom corner.
  const companyName = brand?.companyName || r.company || undefined;
  const brandHeight = drawContractorBrand(
    d,
    { companyName, logo: brand?.logo, logoFormat: brand?.logoFormat },
    { x: X, y: y - 12, maxWidth: 200, maxHeight: 30, align: "left" },
  );
  if (brandHeight) y += brandHeight + 14;
  font(22, true);
  d.text("Daily Reports", X, y);
  y += 22;
  font(12, false);
  const titleLines = wrap(title, CW);
  d.text(titleLines, X, y, { lineHeightFactor: 1.3 });
  y += 16 * titleLines.length;
  font(10, false, G1);
  d.text(pdfText(`Report period ${span}`), X, y);
  y += 22;

  const facts: [string, string][] = [
    ["Saved dailies", String(r.dailies_count)],
    ["Days without a daily", String(r.no_daily_dates.length)],
    ["Progress photos", r.photos_mode === "none" ? "Not included" : String(r.photos_count)],
    ["Generated", stamp(r.captured_at, r.time_zone_used)],
  ];
  const fw = CW / facts.length;
  d.setDrawColor(...RULE);
  d.setFillColor(...FILL);
  d.roundedRect(X, y, CW, 44, 4, 4, "FD");
  facts.forEach(([k, v], i) => {
    font(7.5, true, G1);
    d.text(k.toUpperCase(), X + 10 + i * fw, y + 15);
    font(i === 3 ? 9 : 13, true);
    d.text(pdfText(v), X + 10 + i * fw, y + 33);
  });
  y += 60;

  // Summary table
  const cols = [
    { k: "Date", w: 82 },
    { k: "Weather", w: 118 },
    { k: "Crews & hours", w: CW - 82 - 118 - 44 - 48 - 74 },
    { k: "Lines", w: 44 },
    { k: "Photos", w: 48 },
    { k: "Issues / delays", w: 74 },
  ];
  const header = () => {
    d.setFillColor(...NAVY);
    d.rect(X, y, CW, 18, "F");
    font(7.5, true, [255, 255, 255]);
    let cx = X;
    for (const c of cols) {
      d.text(c.k.toUpperCase(), cx + 5, y + 12);
      cx += c.w;
    }
    y += 18;
  };
  font(11, true);
  d.text("SUMMARY", X, y);
  y += 10;
  header();
  if (!r.days.length) {
    font(9, false, G1);
    d.text("No dailies or progress photos are saved for this period.", X + 5, y + 14);
    y += 24;
  }
  r.days.forEach((day, i) => {
    const daily = day.daily;
    const cells = [
      mediumDate(day.date),
      daily ? daily.weather || "Not recorded" : "No daily saved",
      daily ? daily.manpower || "Not recorded" : "",
      daily ? String(daily.lines.length) : "",
      r.photos_mode === "none" ? "-" : String(day.photos.length),
      daily ? (reported(daily.issues) || reported(daily.delays) ? "See daily" : "None") : "",
    ];
    font(8, false);
    const wrapped = cells.map((c, j) => clip(wrap(c, cols[j].w - 10), 30));
    const h = Math.max(...wrapped.map((w) => w.length)) * 10 + 8;
    if (room(h)) header();
    if (i % 2) {
      d.setFillColor(...FILL);
      d.rect(X, y, CW, h, "F");
    }
    let cx = X;
    wrapped.forEach((w, j) => {
      font(8, j === 0, !daily && j === 1 ? G1 : j === 5 && cells[5] === "See daily" ? BLUE : NAVY);
      d.text(w, cx + 5, y + 11, { lineHeightFactor: 1.25 });
      cx += cols[j].w;
    });
    y += h;
    d.setDrawColor(...RULE);
    d.line(X, y, X + CW, y);
  });
  y += 16;

  const note = (head: string, body: string) => {
    const w = wrap(body, CW);
    room(14 + w.length * 11);
    font(8.5, true);
    d.text(head, X, y);
    y += 11;
    font(8.5, false, G1);
    d.text(w, X, y, { lineHeightFactor: 1.3 });
    y += w.length * 11 + 8;
  };
  if (r.no_daily_dates.length)
    note(
      "Dates with no saved daily",
      `${dateRuns(r.no_daily_dates)}. Nothing is inferred for these dates.`,
    );
  note(
    "Basis",
    `Generated from the dailies saved in Athena as of ${stamp(r.captured_at, r.time_zone_used)} (${r.time_zone_used}). ` +
      "Each daily shows its current saved content with the time it was first saved and last updated. " +
      "Quantities, crews, hours and SOV or CPM references are as reported from the field. " +
      `Photos: ${PHOTO_MODE_LABEL[r.photos_mode].toLowerCase()}, grouped by the date each photo was taken.`,
  );

  // ---------- one daily per page ----------
  const section = (label: string, value: string) => {
    font(9.5, false);
    const w = wrap(value || "Not recorded", CW);
    room(12 + Math.min(w.length, 2) * 11.5);
    font(8, true, G1);
    d.text(label.toUpperCase(), X, y);
    y += 12;
    for (const line of w) {
      if (y + 4 > BOTTOM) page();
      font(9.5, false, value ? NAVY : G2);
      d.text(line, X, y);
      y += 11.5;
    }
    y += 9;
  };
  const workCols: { k: string; w: number; right?: boolean; pad?: number }[] = [
    { k: "#", w: 18 },
    { k: "Work performed", w: CW - 18 - 46 - 34 - 34 - 46 - 50 - 56 },
    { k: "Qty", w: 46, right: true },
    { k: "Unit", w: 34 },
    { k: "Crew", w: 34, right: true },
    { k: "Hrs each", w: 46, right: true },
    { k: "SOV", w: 50, pad: 12 },
    { k: "CPM", w: 56 },
  ];
  const workHeader = () => {
    d.setFillColor(...FILL);
    d.setDrawColor(...RULE);
    d.rect(X, y, CW, 16, "FD");
    font(7, true, G1);
    let cx = X;
    for (const c of workCols) {
      d.text(c.k.toUpperCase(), c.right ? cx + c.w - 4 : cx + (c.pad ?? 4), y + 11, {
        align: c.right ? "right" : "left",
      });
      cx += c.w;
    }
    y += 16;
  };
  const photoGrid = (list: DailyRangePhoto[]) => {
    const gap = 14,
      pw = (CW - gap) / 2,
      ph = pw * 0.75;
    for (let i = 0; i < list.length; i += 2) {
      const pair = list.slice(i, i + 2);
      const caps = pair.map((p) => {
        font(8, true);
        const title = clip(wrap(photoCaption(p), pw), 20);
        font(7, false);
        return { title, facts: clip(wrap(photoFacts(p, r.time_zone_used).join(" - "), pw), 6) };
      });
      const capH = Math.max(...caps.map((c) => c.title.length * 10 + c.facts.length * 9)) + 6;
      room(ph + capH + 10);
      pair.forEach((p, j) => {
        const px = X + j * (pw + gap);
        d.setDrawColor(...RULE);
        d.setFillColor(...FILL);
        d.rect(px, y, pw, ph, "FD");
        const img = photos.get(p.id);
        if (img && "data" in img) {
          try {
            let iw = img.width,
              ih = img.height;
            if (!iw || !ih) {
              const props = d.getImageProperties(img.data);
              iw = props.width;
              ih = props.height;
            }
            const s = Math.min(pw / iw, ph / ih);
            const w = iw * s,
              h = ih * s;
            d.addImage(
              img.data,
              img.format,
              px + (pw - w) / 2,
              y + (ph - h) / 2,
              w,
              h,
              `p-${p.id}`,
              "FAST",
            );
          } catch {
            font(8, false, G1);
            d.text(
              "Photo on file in Athena. It could not be drawn in this PDF.",
              px + pw / 2,
              y + ph / 2,
              { align: "center", maxWidth: pw - 20 },
            );
          }
        } else {
          font(8, false, G1);
          const why =
            img && "reason" in img
              ? img.reason
              : "Photo on file in Athena. Not included in this PDF.";
          d.text(
            d.splitTextToSize(pdfText(why), pw - 24) as string[],
            px + pw / 2,
            y + ph / 2 - 4,
            { align: "center" },
          );
        }
        let cy = y + ph + 11;
        font(8, true);
        d.text(caps[j].title, px, cy, { lineHeightFactor: 1.25 });
        cy += caps[j].title.length * 10;
        font(7, false, G1);
        d.text(caps[j].facts, px, cy, { lineHeightFactor: 1.25 });
      });
      y += ph + capH + 10;
    }
  };

  for (const day of r.days) {
    page();
    const daily = day.daily;
    font(8, true, BLUE);
    d.text(daily ? "DAILY REPORT" : "PROGRESS PHOTOS - NO DAILY SAVED", X, y);
    y += 16;
    font(16, true);
    d.text(pdfText(longDate(day.date)), X, y);
    y += 14;
    font(9, false, G1);
    d.text(wrap(title, CW)[0] ?? "", X, y);
    y += 8;
    d.setDrawColor(...NAVY);
    d.setLineWidth(1.2);
    d.line(X, y, X + CW, y);
    d.setLineWidth(0.5);
    y += 18;
    if (daily) {
      for (const [key, label] of DAILY_SECTIONS.slice(0, 4)) section(label, daily[key]);
      room(48);
      font(8, true, G1);
      d.text("WORK & PRODUCTION", X, y);
      y += 6;
      workHeader();
      if (!daily.lines.length) {
        font(9, false, G2);
        d.text("Work lines not recorded.", X + 4, y + 12);
        y += 18;
      }
      for (const l of daily.lines) {
        const cells = [
          String(l.line_no),
          l.work || "Not recorded",
          numberText(l.qty),
          l.unit ?? "",
          numberText(l.crew),
          numberText(l.hours),
          l.sov_item ?? "-",
          l.activity_id ?? "-",
        ];
        font(8.5, false);
        const wrapped = cells.map((c, j) => wrap(c, workCols[j].w - 4 - (workCols[j].pad ?? 4)));
        const h = Math.max(...wrapped.map((w) => w.length)) * 10.5 + 8;
        if (room(h)) workHeader();
        let cx = X;
        wrapped.forEach((w, j) => {
          const c = workCols[j];
          font(8.5, j === 1, NAVY);
          d.text(w, c.right ? cx + c.w - 4 : cx + (c.pad ?? 4), y + 11, {
            align: c.right ? "right" : "left",
            lineHeightFactor: 1.24,
          });
          cx += c.w;
        });
        y += h;
        d.setDrawColor(...RULE);
        d.line(X, y, X + CW, y);
      }
      y += 16;
      for (const [key, label] of DAILY_SECTIONS.slice(4)) section(label, daily[key]);
    } else {
      section(
        "Daily report",
        "No daily is saved for this date. The photos below were taken on this date.",
      );
    }
    if (r.photos_mode !== "none" && day.photos.length) {
      // Keep the heading with the first row of photos.
      room(10 + ((CW - 14) / 2) * 0.75 + 60);
      font(8, true, G1);
      d.text(`PROGRESS PHOTOS (${day.photos.length})`, X, y);
      y += 10;
      photoGrid(day.photos);
    }
    if (daily) {
      const rec = `Record ${daily.id.slice(0, 8)} - first saved ${stamp(daily.created_at, r.time_zone_used)} - last updated ${stamp(daily.updated_at, r.time_zone_used)}`;
      room(18);
      font(7, false, G2);
      d.text(pdfText(rec), X, y + 4);
      y += 14;
    }
  }

  // ---------- running footer with page numbers ----------
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    d.setDrawColor(...RULE);
    d.line(X, H - 36, X + CW, H - 36);
    font(7, false, G1);
    d.text(pdfText(`${r.job_number} Daily Reports ${r.period.from} to ${r.period.to}`), X, H - 24);
    d.text(`Page ${i} of ${n}`, X + CW / 2, H - 24, { align: "center" });
    drawPoweredByAthena(d, X + CW, H - 24);
  }
  d.setProperties({
    title: pdfText(`${title} Daily Reports ${r.period.from} to ${r.period.to}`),
    subject: "Daily reports",
    creator: "Athena",
    author: pdfText(companyName ?? "") || "Athena",
  });
  return scrubProducer(new Uint8Array(d.output("arraybuffer")));
}
