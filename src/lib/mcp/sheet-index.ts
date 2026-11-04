// Sheet index from title blocks, and the contractor's own trade sheets first.
// Athena reads the PDF's own vector text; nothing is saved until the member confirms
// the list. Scanned sheets have no vector text and are left for the member or the
// host AI to name. A sheet name is never guessed between two candidates.

/** A run of text on one page. Coordinates are 0..1 from the displayed top-left. */
export type TextRun = { text: string; x: number; y: number; w: number; h: number };
/** A straight line drawn on the sheet (a title-block border or field divider), same coordinates. */
export type Ruling = { x: number; y: number; w: number; h: number };
export type TitleBlockPage = { page: number; runs: TextRun[]; rulings?: Ruling[] };

export type Discipline = { code: string; label: string };
export type SheetFocus = "trade" | "coordination";

export type ProposedSheet = {
  page: number;
  sheet: string | null;
  title: string | null;
  discipline: string | null;
  confidence: "high" | "medium" | "none";
  note?: string;
};

export type SheetIndexProposal = {
  pages: ProposedSheet[];
  /** Every page has one unique name: the list can be confirmed as is. */
  complete: boolean;
  /** Names in PDF page order; null where Athena could not read one. */
  sheets: (string | null)[];
};

// National CAD Standard discipline designators, two-letter forms first.
const TWO_LETTER: Record<string, string> = {
  FA: "Fire alarm",
  FP: "Fire protection",
  LV: "Low voltage",
  TN: "Telecommunications",
  AD: "Architectural",
  ID: "Interiors",
  ED: "Electrical",
  MD: "Mechanical",
  PD: "Plumbing",
  SD: "Structural",
  CD: "Civil",
  EP: "Electrical",
  EL: "Electrical",
  MH: "Mechanical",
  MP: "Mechanical",
};
const ONE_LETTER: Record<string, string> = {
  G: "General",
  H: "Hazardous materials",
  V: "Survey",
  B: "Geotechnical",
  W: "Civil works",
  C: "Civil",
  L: "Landscape",
  S: "Structural",
  A: "Architectural",
  I: "Interiors",
  Q: "Equipment",
  F: "Fire protection",
  P: "Plumbing",
  D: "Process",
  M: "Mechanical",
  E: "Electrical",
  T: "Telecommunications",
  R: "Resource",
  X: "Other",
  Z: "Contractor",
  O: "Operations",
  K: "Kitchen",
};

// Many architects number the cover, code and finish-schedule sheets C0.x or C1.x. On those
// sheets the C does not mean Civil, and the title says so.
const GENERAL_SHEET_TITLE =
  /\b(COVER|TITLE SHEET|DRAWING (INDEX|LIST)|SHEET (INDEX|LIST)|INDEX|SCHEDULES?|FINISH(ES)?|CODE|ABBREVIATIONS|SYMBOLS|LEGENDS?|GENERAL NOTES|PROJECT (DATA|INFORMATION))\b/;
const CIVIL_SHEET_TITLE =
  /\b(SITE|CIVIL|GRADING|UTILIT(Y|IES)|PAVING|EROSION|SEDIMENT|STORM|DRAINAGE|SANITARY|WATERMAIN|WATER MAIN|SURVEY|ROAD|SERVICING|EXCAVATION)\b/;

/** The discipline a sheet number names, from its letter prefix. Pass the sheet's title when it
 *  is known, so a C-numbered cover or schedule sheet is not read as Civil. */
export function sheetDiscipline(name: string, title?: string | null): Discipline | null {
  const prefix = /^\s*([A-Za-z]{1,3})(?=[\s._-]?\d)/.exec(name)?.[1]?.toUpperCase();
  if (!prefix) return null;
  if (prefix.length >= 2 && TWO_LETTER[prefix.slice(0, 2)])
    return { code: prefix.slice(0, 2), label: TWO_LETTER[prefix.slice(0, 2)] };
  const label = ONE_LETTER[prefix[0]];
  if (!label) return null;
  const upper = title?.toUpperCase() ?? "";
  if (prefix[0] === "C" && GENERAL_SHEET_TITLE.test(upper) && !CIVIL_SHEET_TITLE.test(upper))
    return { code: "C", label: "General" };
  return { code: prefix[0], label };
}

// The trade words a contractor gives at intake, and the disciplines they work from.
const TRADE_DISCIPLINES: [RegExp, string[]][] = [
  [/electric/i, ["Electrical"]],
  [/fire\s*alarm/i, ["Fire alarm"]],
  [/sprinkler|fire\s*(protection|suppression)/i, ["Fire protection"]],
  [
    /low\s*voltage|data|telecom|communication|security|av\b|audio/i,
    ["Telecommunications", "Low voltage"],
  ],
  [/mechanical|hvac|sheet\s*metal|duct/i, ["Mechanical"]],
  [/plumb|piping|pipe\s*fit/i, ["Plumbing"]],
  [/struct|steel|concrete|rebar|masonry|foundation/i, ["Structural"]],
  [/civil|site|earthwork|excavat|paving|utilit/i, ["Civil", "Civil works", "Survey"]],
  [/landscap|irrigation/i, ["Landscape"]],
  [
    /architect|drywall|framing|carpentry|interior|finish|ceiling|paint|floor|glaz|door|roof/i,
    ["Architectural", "Interiors"],
  ],
  [/kitchen|food\s*service/i, ["Kitchen"]],
];

/** The disciplines this contractor works from, or "all" for a general contractor or unknown trades. */
export function tradeDisciplines(
  role: string | null | undefined,
  trades: string[] | null | undefined,
): Set<string> | "all" {
  if (!trades?.length || /general|gc\b/i.test(role ?? "")) return "all";
  const out = new Set<string>();
  for (const trade of trades)
    for (const [pattern, disciplines] of TRADE_DISCIPLINES)
      if (pattern.test(trade)) disciplines.forEach((d) => out.add(d));
  return out.size ? out : "all";
}

/** "trade" for the contractor's own sheets, "coordination" for the others, null when it can't tell. */
export function sheetFocus(
  name: string,
  role: string | null | undefined,
  trades: string[] | null | undefined,
): SheetFocus | null {
  const own = tradeDisciplines(role, trades);
  if (own === "all") return null;
  const discipline = sheetDiscipline(name);
  if (!discipline) return null;
  return own.has(discipline.label) ? "trade" : "coordination";
}

/** One tag per stored sheet, in page order, for the sheet pickers. */
export function sheetTags(
  sheets: string[],
  role: string | null | undefined,
  trades: string[] | null | undefined,
): { discipline: string | null; focus: SheetFocus | null }[] {
  return sheets.map((name) => ({
    discipline: sheetDiscipline(name)?.label ?? null,
    focus: sheetFocus(name, role, trades),
  }));
}

/** Page numbers (1-based) with the contractor's trade sheets first, page order kept within each group. */
export function tradeFirstOrder(
  sheets: string[],
  role: string | null | undefined,
  trades: string[] | null | undefined,
): number[] {
  const tags = sheetTags(sheets, role, trades);
  const rank = (i: number) => (tags[i].focus === "trade" ? 0 : tags[i].focus === null ? 1 : 2);
  return sheets
    .map((_, i) => i)
    .sort((a, b) => rank(a) - rank(b) || a - b)
    .map((i) => i + 1);
}

// A sheet number: one to three letters, an optional separator, then a number such as
// 1, 101, 1.0, 4.1 or 0.01, with an optional letter suffix (E1, E-1, A4.1, FP-101, E2.1A).
const SHEET_TOKEN =
  /(?<![A-Z0-9./-])([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,3})?[A-Z]?)(?![A-Z0-9/]|\.\d)/g;
const SHEET_LABEL = /\b(SHEET|DWG|DRAWING)\s*(NO\b|NUMBER|NUM\b|#)|\bSHEET\s*:?$/;
const REFERENCE_WORDS = /\b(SEE|REFER|REF|SIM|DETAIL|DET|TYP|SECTION|ON SHEET|PER)\b/;
const NOT_SHEETS =
  /^(NO|REV|UL|NEC|NFPA|IBC|ASTM|ANSI|CSI|PO|TEL|FAX|PH|ZIP|LOT|RM|ROOM|UNIT|STE|AWG|KCMIL|SQ|HP|KW|KVA|KV|VA|MCA|MOCP|FLA|LRA|RTU|AHU|EF|VAV|LP|PP|DP|MDP|MSB)$/;
const TITLE_WORDS =
  /\b(PLANS?|SCHEDULES?|DETAILS?|NOTES|ELEVATIONS?|SECTIONS?|DIAGRAMS?|LEGENDS?|COVER|TITLE SHEET|RISERS?|SPECIFICATIONS|LAYOUT|SITE|ROOF|FLOOR|CEILING|LIGHTING|POWER|SYMBOLS|ABBREVIATIONS|DEMOLITION|DEMO|FOUNDATION|FRAMING|ONE-LINE|SINGLE LINE|PANEL|FIRE ALARM|GENERAL|WASHROOMS?|TOILETS?|RESTROOMS?|ENLARGED|TYPES|INTERIOR|EXTERIOR|STAIRS?|ASSEMBLIES|VIEWS?|ISOMETRIC|MILLWORK|PARTITIONS?|FINISH(ES)?|DOORS?|WINDOWS?|KEY PLAN|INDEX|CODE|MATRIX|ANALYSIS)\b/;
const TITLE_LABEL = /^(SHEET|DRAWING|DWG)\s*(TITLE|NAME)\s*:?\s*/;

const zoneWeight = (r: TextRun): number => {
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  if (cx >= 0.8 && cy >= 0.8) return 3;
  if (cx >= 0.85 || cy >= 0.88) return 1.5;
  if (cx >= 0.7 && cy >= 0.6) return 1;
  return 0;
};
const near = (a: TextRun, b: TextRun) =>
  Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) < 0.08;

type Candidate = { name: string; score: number; standalone: boolean; run: TextRun };

function sheetCandidates(runs: TextRun[]): Candidate[] {
  const zone = runs.filter((r) => zoneWeight(r) > 0);
  const labels = zone.filter((r) => SHEET_LABEL.test(r.text.toUpperCase()));
  const out: Candidate[] = [];
  for (const run of zone) {
    const upper = run.text.toUpperCase().trim();
    if (REFERENCE_WORDS.test(upper)) continue;
    for (const match of upper.matchAll(SHEET_TOKEN)) {
      const name = match[1];
      const prefix = /^[A-Z]+/.exec(name)![0];
      if (NOT_SHEETS.test(prefix) || !sheetDiscipline(name)) continue;
      const standalone = upper.replace(/\s+/g, "") === name;
      let score = run.h * zoneWeight(run) * (standalone ? 2 : 1);
      if (
        labels.some((l) => l !== run && near(l, run)) ||
        SHEET_LABEL.test(upper.replace(name, ""))
      )
        score *= 2;
      out.push({ name, score, standalone, run });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// The label over the sheet-number field, alone on its line ("SHEET NO.", "DWG #", "SHEET:").
const SHEET_NO_LABEL = /^(SHEET|DWG|DRAWING)\s*(NO\.?|NUMBER|NUM\.?|#)?\s*:?$/;
// A sheet count printed in or beside the title field ("1 OF 3", "SHEET 2 OF 6", "OF 3").
const SHEET_COUNT = /^(SHEET\s*)?(\d+\s*)?OF\s*\d+$/;
const TRAILING_SHEET_COUNT = /\s+(SHEET\s+)?(\d+\s+)?OF\s+\d+$/;
// A note that points elsewhere ("SEE A4.1", "TYP.", "SIM"). Unlike a sheet-number reference,
// DETAIL and SECTION are ordinary title words here ("MENU SCREEN MOUNT DETAIL").
const TITLE_REFERENCE = /\b(SEE|REFER|REF|SIM|TYP|ON SHEET|PER)\b/;
// A label printed inside a title field ("SHEET TITLE", "DRAWING NAME:"), never part of the title.
const TITLE_FIELD_LABEL = /^(SHEET|DRAWING|DWG)?\s*(TITLE|NAME)\s*:?$/;
// Text that fills other title-block fields and never belongs to a sheet title.
const OTHER_FIELD =
  /^(SCALE|DATE|DRAWN|CHECKED|APPROVED|DESIGNED|PROJECT|JOB|PROJ|REV|REVISION|ISSUED?|SEAL|CLIENT|OWNER|NORTH|NO\.?)\b|\d+\/\d+|=|\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;

const cx = (r: TextRun | Ruling) => r.x + r.w / 2;
const cy = (r: TextRun | Ruling) => r.y + r.h / 2;
const vertical = (l: Ruling) => l.h > l.w;

/** The box the title block occupies, read from the long lines drawn around it: the vertical
 *  line nearest left of the sheet number (a right-hand strip) and the horizontal line nearest
 *  above it (a bottom strip or corner box). Without lines, a fixed area around the number. */
function titleBlockBox(anchor: TextRun, rulings: Ruling[]): { left: number; top: number } {
  const ax = cx(anchor),
    ay = cy(anchor);
  const LONG = 0.15;
  const left = rulings
    .filter((l) => vertical(l) && l.h >= LONG && l.x < anchor.x && l.y <= ay && l.y + l.h >= ay)
    .reduce((best, l) => Math.max(best, l.x), -1);
  const top = rulings
    .filter((l) => !vertical(l) && l.w >= LONG && l.y < anchor.y && l.x <= ax && l.x + l.w >= ax)
    .reduce((best, l) => Math.max(best, l.y), -1);
  // A strip's edge sits in the right or bottom part of the sheet; a line further out is the border.
  const strip = left >= 0.55;
  const band = top >= 0.55;
  if (strip || band)
    return {
      left: strip ? left : band ? 0.4 : anchor.x - 0.1,
      top: band ? top : strip ? 0 : anchor.y - 0.35,
    };
  return { left: anchor.x - 0.1, top: anchor.y - 0.35 };
}

/** The ruled cell around one run: the nearest lines on each side that cross its middle. */
function cellAround(run: TextRun, rulings: Ruling[]) {
  const x = cx(run),
    y = cy(run);
  const verticals = rulings.filter((l) => vertical(l) && l.y <= y && l.y + l.h >= y);
  const horizontals = rulings.filter((l) => !vertical(l) && l.x <= x && l.x + l.w >= x);
  const left = Math.max(-1, ...verticals.filter((l) => l.x <= run.x + 0.002).map((l) => l.x));
  const right = Math.min(
    2,
    ...verticals.filter((l) => l.x >= run.x + run.w - 0.002).map((l) => l.x),
  );
  const top = Math.max(-1, ...horizontals.filter((l) => l.y <= run.y + 0.002).map((l) => l.y));
  const bottom = Math.min(
    2,
    ...horizontals.filter((l) => l.y >= run.y + run.h - 0.002).map((l) => l.y),
  );
  // An open side, or a cell taller than a title field, means the lines don't box this field.
  if (left < 0 || right > 1.5 || top < 0 || bottom > 1.5) return null;
  if (bottom - top > 0.12 || right - left > 0.45) return null;
  return { left, right, top, bottom };
}

/** Lines of text read top to bottom, left to right within a line, joined with spaces. */
function joinLines(runs: TextRun[]): string {
  const sorted = [...runs].sort((a, b) => cy(a) - cy(b) || a.x - b.x);
  const lines: TextRun[][] = [];
  for (const run of sorted) {
    const line = lines.find((l) => Math.abs(cy(l[0]) - cy(run)) < Math.max(l[0].h, run.h) * 0.5);
    if (line) line.push(run);
    else lines.push([run]);
  }
  return lines
    .map((l) =>
      l
        .sort((a, b) => a.x - b.x)
        .map((r) => r.text.trim())
        .join(" "),
    )
    .join(" ")
    .toUpperCase()
    .replace(TITLE_LABEL, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Without ruled fields: the lines that belong with one title line, found by stepping to the
 *  next line of similar size directly above or below and overlapping it, at most four lines. */
function titleLines(seed: TextRun, pool: TextRun[]): TextRun[] {
  const group = [seed];
  const sameSize = (r: TextRun) => r.h >= seed.h * 0.7 && r.h <= seed.h * 1.45;
  for (let grew = true; grew && group.length < 8; ) {
    grew = false;
    const x0 = Math.min(...group.map((r) => r.x)),
      x1 = Math.max(...group.map((r) => r.x + r.w)),
      y0 = Math.min(...group.map((r) => r.y)),
      y1 = Math.max(...group.map((r) => r.y + r.h));
    const lines = new Set(group.map((r) => Math.round(cy(r) / (seed.h * 0.5))));
    for (const r of pool) {
      if (group.includes(r) || !sameSize(r)) continue;
      const sameLine =
        Math.abs(cy(r) - cy(seed)) < seed.h * 0.5 ||
        group.some((g) => Math.abs(cy(g) - cy(r)) < g.h * 0.5);
      const gapX = Math.max(r.x - x1, x0 - (r.x + r.w));
      const gapY = Math.max(r.y - y1, y0 - (r.y + r.h));
      const overlapX = Math.min(x1, r.x + r.w) - Math.max(x0, r.x) > 0;
      const joins = sameLine
        ? gapX <= seed.h * 1.5
        : overlapX && gapY <= seed.h * 0.9 && lines.size < 4;
      if (joins) {
        group.push(r);
        grew = true;
      }
    }
  }
  return group;
}

function sheetTitle(
  runs: TextRun[],
  sheet: string | null,
  anchor: TextRun | null,
  rulings: Ruling[],
): string | null {
  const zone = runs.filter((r) => zoneWeight(r) > 0);
  // Only text inside the title block: the box around the sheet number. A page with no sheet
  // number has no box, so only an explicitly labelled title field is read there.
  const box = anchor ? titleBlockBox(anchor, rulings) : null;
  const inBox = (r: TextRun) => !box || (r.x >= box.left - 0.002 && r.y >= box.top - 0.002);
  const isNumber = (r: TextRun) =>
    !!sheet && r.text.toUpperCase().replace(/\s+/g, "") === sheet.replace(/\s+/g, "");
  const pool = zone.filter(
    (r) =>
      inBox(r) &&
      r !== anchor &&
      !isNumber(r) &&
      !SHEET_NO_LABEL.test(r.text.toUpperCase().trim()) &&
      !OTHER_FIELD.test(r.text.toUpperCase().trim()),
  );
  const fieldLabel = zone.find(
    (r) =>
      inBox(r) &&
      TITLE_FIELD_LABEL.test(r.text.toUpperCase().trim()) &&
      /TITLE|NAME/.test(r.text.toUpperCase()),
  );
  if (!anchor && !fieldLabel) return null;

  const text = (r: TextRun) => r.text.trim().toUpperCase();
  const usable = pool.filter(
    (r) =>
      !TITLE_FIELD_LABEL.test(text(r)) &&
      !SHEET_COUNT.test(text(r)) &&
      !TITLE_REFERENCE.test(text(r)),
  );
  // The title's first line: the run under a title label, or the largest title-like run nearest
  // the sheet number.
  const seed = fieldLabel
    ? usable
        .filter(
          (r) =>
            r.y >= fieldLabel.y - 0.002 &&
            Math.abs(r.x - fieldLabel.x) < 0.12 &&
            r.y - fieldLabel.y < 0.08,
        )
        .sort((a, b) => b.h - a.h || a.y - b.y)[0]
    : usable
        .filter((r) => TITLE_WORDS.test(text(r)) && text(r).length >= 3)
        .sort(
          (a, b) => (anchor ? Number(near(b, anchor)) - Number(near(a, anchor)) : 0) || b.h - a.h,
        )[0];
  if (!seed) return null;

  // The whole title field: every line in the seed's ruled cell, or its neighbouring lines.
  const cell = cellAround(seed, rulings);
  const field = cell
    ? usable.filter(
        (r) =>
          cx(r) > cell.left &&
          cx(r) < cell.right &&
          cy(r) > cell.top &&
          cy(r) < cell.bottom &&
          r.h >= seed.h * 0.6,
      )
    : titleLines(seed, usable);
  const title = joinLines(field.length ? field : [seed]).replace(TRAILING_SHEET_COUNT, "");
  if (title.length < 3 || (sheet && title.replace(/\s+/g, "") === sheet)) return null;
  return title.slice(0, 80);
}

/** Proposes one sheet name per page from its title block. Nothing is saved. */
export function proposeSheetIndex(pages: TitleBlockPage[]): SheetIndexProposal {
  const proposed: ProposedSheet[] = pages.map(({ page, runs, rulings = [] }) => {
    const candidates = sheetCandidates(runs);
    const best = candidates[0];
    if (!best)
      return {
        page,
        sheet: null,
        title: sheetTitle(runs, null, null, rulings),
        discipline: null,
        confidence: "none",
        note: runs.length
          ? "No sheet number found in the title block."
          : "No readable text: likely a scanned sheet.",
      };
    const rival = candidates.find((c) => c.name !== best.name);
    const clear = !rival || best.score >= rival.score * 1.5;
    if (!clear)
      return {
        page,
        sheet: null,
        title: sheetTitle(runs, null, null, rulings),
        discipline: null,
        confidence: "none",
        note: `Two possible sheet numbers: ${best.name} or ${rival!.name}.`,
      };
    const title = sheetTitle(runs, best.name, best.run, rulings);
    return {
      page,
      sheet: best.name,
      title,
      discipline: sheetDiscipline(best.name, title)?.label ?? null,
      confidence: best.standalone ? "high" : "medium",
    };
  });
  // Two pages with one name: neither is used, so no sheet opens the wrong page.
  const counts = new Map<string, number>();
  for (const p of proposed)
    if (p.sheet) counts.set(p.sheet.toLowerCase(), (counts.get(p.sheet.toLowerCase()) ?? 0) + 1);
  for (const p of proposed)
    if (p.sheet && (counts.get(p.sheet.toLowerCase()) ?? 0) > 1) {
      p.note = `${p.sheet} appears on more than one page.`;
      p.sheet = null;
      p.discipline = null;
      p.confidence = "none";
    }
  const sheets = proposed.map((p) => p.sheet);
  return {
    pages: proposed,
    complete: proposed.length > 0 && sheets.every((s) => !!s),
    sheets,
  };
}
