// Sheet index from title blocks, and the contractor's own trade sheets first.
// Athena reads the PDF's own vector text; nothing is saved until the member confirms
// the list. Scanned sheets have no vector text and are left for the member or the
// host AI to name. A sheet name is never guessed between two candidates.

/** A run of text on one page. Coordinates are 0..1 from the displayed top-left. */
export type TextRun = { text: string; x: number; y: number; w: number; h: number };
export type TitleBlockPage = { page: number; runs: TextRun[] };

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

/** The discipline a sheet number names, from its letter prefix. */
export function sheetDiscipline(name: string): Discipline | null {
  const prefix = /^\s*([A-Za-z]{1,3})(?=[\s._-]?\d)/.exec(name)?.[1]?.toUpperCase();
  if (!prefix) return null;
  if (prefix.length >= 2 && TWO_LETTER[prefix.slice(0, 2)])
    return { code: prefix.slice(0, 2), label: TWO_LETTER[prefix.slice(0, 2)] };
  const label = ONE_LETTER[prefix[0]];
  return label ? { code: prefix[0], label } : null;
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
  /\b(PLANS?|SCHEDULES?|DETAILS?|NOTES|ELEVATIONS?|SECTIONS?|DIAGRAMS?|LEGENDS?|COVER|TITLE SHEET|RISERS?|SPECIFICATIONS|LAYOUT|SITE|ROOF|FLOOR|CEILING|LIGHTING|POWER|SYMBOLS|ABBREVIATIONS|DEMOLITION|DEMO|FOUNDATION|FRAMING|ONE-LINE|SINGLE LINE|PANEL|FIRE ALARM|GENERAL)\b/;
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

function sheetTitle(runs: TextRun[], sheet: string | null, anchor: TextRun | null): string | null {
  const best = runs
    .filter((r) => zoneWeight(r) > 0)
    .map((r) => ({
      r,
      text: r.text.trim().toUpperCase().replace(TITLE_LABEL, "").replace(/\s+/g, " "),
    }))
    .filter(
      ({ text }) =>
        text.length >= 4 &&
        text.length <= 80 &&
        TITLE_WORDS.test(text) &&
        (!sheet || text.replace(/\s+/g, "") !== sheet) &&
        !REFERENCE_WORDS.test(text.replace(/\bGENERAL NOTES\b|\bNOTES\b/g, "")) &&
        !/\d+\/\d+|SCALE|=|'|"/.test(text),
    )
    .sort(
      (a, b) =>
        (anchor ? Number(near(b.r, anchor)) - Number(near(a.r, anchor)) : 0) || b.r.h - a.r.h,
    )[0];
  return best ? best.text.slice(0, 80) : null;
}

/** Proposes one sheet name per page from its title block. Nothing is saved. */
export function proposeSheetIndex(pages: TitleBlockPage[]): SheetIndexProposal {
  const proposed: ProposedSheet[] = pages.map(({ page, runs }) => {
    const candidates = sheetCandidates(runs);
    const best = candidates[0];
    if (!best)
      return {
        page,
        sheet: null,
        title: sheetTitle(runs, null, null),
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
        title: sheetTitle(runs, null, null),
        discipline: null,
        confidence: "none",
        note: `Two possible sheet numbers: ${best.name} or ${rival!.name}.`,
      };
    return {
      page,
      sheet: best.name,
      title: sheetTitle(runs, best.name, best.run),
      discipline: sheetDiscipline(best.name)?.label ?? null,
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
