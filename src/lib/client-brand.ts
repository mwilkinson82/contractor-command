/*
 * Branding on what a contractor's own clients see (approved Nov 4 2026): the contractor leads with
 * their logo or name, and Athena is one small line in a bottom corner, the Athena A icon and
 * "Powered by Athena". Inside the app Athena leads instead (see components/athena/AthenaBrand).
 */
import type { jsPDF } from "jspdf";

export const POWERED_BY_ATHENA = "Powered by Athena";

/** Athena blue, the A icon's one color at small sizes. The two-tone mark loses its light crossbar on white. */
export const ATHENA_BLUE = "#2563EB";

/** The A icon's three pieces, in the blue lockup's coordinates (viewBox 100 132 630 458). */
const MARK_PIECES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [395, 140],
    [540, 140],
    [260, 582],
    [108, 582],
  ],
  [
    [459, 288],
    [562, 288],
    [721, 582],
    [586, 582],
  ],
  [
    [393, 404],
    [499, 404],
    [517, 443],
    [337, 493],
  ],
];
const MARK_BOX = { x: 100, y: 132, w: 630, h: 458 } as const;

const markPath = MARK_PIECES.map(
  (piece) => `M${piece.map(([x, y]) => `${x} ${y}`).join("L")}Z`,
).join("");

/** Inline SVG of the A icon, sized by height in CSS pixels. Needs no image host, so it passes strict CSPs. */
export function athenaMarkSvg(height = 16): string {
  const width = Math.round((height * MARK_BOX.w) / MARK_BOX.h);
  return `<svg class="ath-cb-mark" xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_BOX.x} ${MARK_BOX.y} ${MARK_BOX.w} ${MARK_BOX.h}" width="${width}" height="${height}" aria-hidden="true" focusable="false" style="display:block;flex:none;overflow:visible"><path fill="${ATHENA_BLUE}" d="${markPath}"/></svg>`;
}

/** Google Fonts for client pages: Inter for the contractor's name and headers, Archivo for the body. */
export const CLIENT_BRAND_FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Inter:wght@500;600;700&display=swap">';

/** The font stack for the contractor's name: sharp at every size on Windows and Mac screens. */
export const CLIENT_BRAND_NAME_FONT = '"Inter","Segoe UI",system-ui,-apple-system,sans-serif';

/** One small line: the A icon and "Powered by Athena", for the bottom corner of a client page. */
export function poweredByAthenaHtml(): string {
  return `<span class="ath-cb-powered" style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font:500 12px/20px ${CLIENT_BRAND_NAME_FONT};color:#6B7280">${athenaMarkSvg(16)}${POWERED_BY_ATHENA}</span>`;
}

type Rgb = readonly [number, number, number];
const PDF_GRAY: Rgb = [107, 114, 128];
const PDF_INK: Rgb = [17, 24, 39];
const PDF_BLUE: Rgb = [37, 99, 235];

/** Draws the A icon as vector shapes, `height` points tall, with its top-left corner at (x, y). */
export function drawAthenaMark(d: jsPDF, x: number, y: number, height: number): number {
  const s = height / MARK_BOX.h;
  d.setFillColor(PDF_BLUE[0], PDF_BLUE[1], PDF_BLUE[2]);
  for (const piece of MARK_PIECES) {
    const pts = piece.map(([px, py]) => [x + (px - MARK_BOX.x) * s, y + (py - MARK_BOX.y) * s]);
    const rel = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
    d.lines(rel, pts[0][0], pts[0][1], [1, 1], "F", true);
  }
  return MARK_BOX.w * s;
}

/** The A icon and "Powered by Athena", right-aligned so the line ends at `right`, text baseline at `baseline`. */
export function drawPoweredByAthena(d: jsPDF, right: number, baseline: number, fontSize = 7): void {
  d.setFont("helvetica", "normal");
  d.setFontSize(fontSize);
  d.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
  d.text(POWERED_BY_ATHENA, right, baseline, { align: "right" });
  const textWidth = d.getTextWidth(POWERED_BY_ATHENA);
  const markHeight = fontSize * 1.25;
  const markWidth = (markHeight * MARK_BOX.w) / MARK_BOX.h;
  // Center the icon on the capital height of the text.
  const top = baseline - fontSize * 0.36 - markHeight / 2;
  drawAthenaMark(d, right - textWidth - fontSize * 0.6 - markWidth, top, markHeight);
}

export type ContractorBrand = {
  companyName?: string;
  logo?: Uint8Array;
  logoFormat?: "PNG" | "JPEG";
};

/**
 * The contractor's logo, or their name in bold type when no logo is saved, in a box at the given
 * corner. Returns the height used (0 when there is nothing to draw).
 */
export function drawContractorBrand(
  d: jsPDF,
  brand: ContractorBrand | undefined,
  box: { x: number; y: number; maxWidth: number; maxHeight: number; align: "left" | "right" },
): number {
  if (!brand) return 0;
  if (brand.logo && brand.logoFormat) {
    try {
      const image = d.getImageProperties(brand.logo);
      const scale = Math.min(box.maxWidth / image.width, box.maxHeight / image.height);
      const w = image.width * scale,
        h = image.height * scale;
      const x = box.align === "right" ? box.x - w : box.x;
      d.addImage(brand.logo, brand.logoFormat, x, box.y, w, h, undefined, "FAST");
      return h;
    } catch {
      /* An unreadable logo falls back to the name below. */
    }
  }
  const name = brand.companyName?.trim();
  if (!name) return 0;
  const size = Math.min(12, box.maxHeight);
  d.setFont("helvetica", "bold");
  d.setFontSize(size);
  d.setTextColor(PDF_INK[0], PDF_INK[1], PDF_INK[2]);
  const line = (d.splitTextToSize(pdfSafe(name), box.maxWidth) as string[])[0] ?? "";
  d.text(line, box.x, box.y + size * 0.8, { align: box.align });
  return size;
}

/** jsPDF's built-in fonts carry WinAnsi only; drop what they can't draw rather than print garbage. */
function pdfSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}
