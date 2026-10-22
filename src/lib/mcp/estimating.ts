// Estimating tools. Athena keeps the record and the math. The host reads the sheets.
// Quantity labels are MEASURED (spec READ: straight off a sheet) and DEDUCED (spec DERIVED: computed here).
import { ALERT_COLOR, ALERT_HEX } from "./alert-color";
import {
  bytesToBase64,
  groupedCsv,
  takeoffCard,
  takeoffXlsx,
  type SheetRow,
} from "./estimating-sheet";
import { ATHENA_SERVER_ICONS } from "./server-info-branding";
import { money } from "./sov";

/** Same navy as the sign-in email. Blue and gray match the house palette. */
export const ESTIMATE_NAVY = "#0F1E3D";
export const ESTIMATE_LOGO_URL =
  ATHENA_SERVER_ICONS.find((i) => i.sizes.includes("256x256"))?.src ??
  "https://app.meetathena.io/brand/athena/athena-mono-blue-256.png";

/** Server instructions. No hex: the instruction source check rejects a color code there. */
/** Examples only. Any non-installation requirement belongs in the same bucket. */
export const REQUIREMENT_OPEN_LIST =
  "Look beyond the examples. Consultants, testing, an arborist, permits, safety, a scheduler, and security are examples only. Any requirement that is not installation labor or material belongs in this bucket. Give it a category, or mark it other and describe it.";

export const ESTIMATE_SERVER_RULE =
  " Takeoff quantities are MEASURED or DEDUCED. MEASURED is straight off a sheet (READ). DEDUCED is computed (DERIVED): multiply the MEASURED inputs, show the math, and cite the sheet and the detail or grid. Leave a quantity blank only when one named input is missing on every sheet. A vendor or shop-drawing note is not a reason for a blank. Addenda override the base documents. Do not invent quantities, dimensions, unit prices or vendor numbers. Every estimating report (takeoff, Estimate Analysis, estimator loop, Estimate Summary, bid summary) is landscape, 17 by 11 inches, with the Athena logo at the top right. Portrait only if the member asks. Red only for risks and gaps that hold up the bid. Questions go back to the estimator. Do not price a final bid until the takeoff is settled. A rate is the contractor's own figure, or a PLACEHOLDER the contractor supplies and then confirms. Do not attribute a number to RSMeans, NECA, SMACNA or MCAA, and do not reproduce their tables. " +
  REQUIREMENT_OPEN_LIST +
  " Special requirements stay out of installation labor and material. Overhead is applied first, then profit on top. The bid summary shows direct cost, general conditions, special requirements, overhead and profit, and the total. Forms use one face unless the line sets two. The earth side is not formed by default. Rebar is shown in LF and in LB. Termite treatment is gross area plus a separate perimeter in LF. Concrete, fiber, vapor barrier, base and fine grading follow the active profile, net when the drawings are read as drawn. The foundation checklist is perimeter insulation, perimeter termite, fine grading, base course, base under the trench and pits, dowels, keyways, and edge forms. Each one is quantified or marked N/A with a reason. Ask scope, whether the estimator is the general contractor or a self-performer, and which profile applies. Do not assume self-performer, and do not mark intake complete until those are answered. If a job with the same name or number already has a takeoff, ask whether to reuse it or start fresh. A takeoff save either adds or updates lines, or replaces the whole takeoff; say which. Show MEASURED or DEDUCED, the sheet, and the math on each takeoff line.";

export const NOT_RELEVANT_ASK =
  "Why is this not relevant? Send the reason in this same turn. Nothing was changed.";

export const ESTIMATE_QUANTITY_REQUIRED = [
  "REQUIRED: Quantities are MEASURED or DEDUCED. Compute every DEDUCED quantity from the MEASURED inputs and show the math and the sheet. Leave a quantity blank only when one named input is missing on every sheet.",
  "REQUIRED: Do not invent a quantity, a dimension, a unit price or a vendor number. A vendor or shop-drawing note does not leave a line blank.",
  "REQUIRED: Render this report landscape, 17 in by 11 in, with the Athena logo at the top right. Portrait only if the member asks. Red only for a risk or a gap that holds up the bid.",
].join("\n");

export const ESTIMATE_VIEW_SPEC = [
  "REQUIRED VIEW – ESTIMATE: Landscape page, 17 in by 11 in. Portrait only if the member asks.",
  `Logo: Athena mark, top right, every page, ${ESTIMATE_LOGO_URL}.`,
  "Order: a short narrative, then the table or cards, then one-fact bullets.",
  `Colors: navy ${ESTIMATE_NAVY}, blue #2563EB and gray. ${ALERT_COLOR} only on a row marked Holds the bid.`,
  "Contact area first, then concrete, then reinforcing. A DEDUCED row shows its math and its sheet.",
  "A blank stays blank and names the one missing input. Do not fill a unit price that was not sent.",
  "Questions stay with the estimator. Do not claim a markup image unless this result includes one.",
];

export class EstimateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstimateError";
  }
}

/** Published bar weight, pounds per foot. A constant, not a job assumption. */
export const BAR_LB_PER_LF: Record<string, number> = {
  "3": 0.376,
  "4": 0.668,
  "5": 1.043,
  "6": 1.502,
  "7": 2.044,
  "8": 2.67,
  "9": 3.4,
  "10": 4.303,
  "11": 5.313,
  "14": 7.65,
  "18": 13.6,
};

export const CONCRETE_CHECKLIST = [
  { key: "cf", group: "Footings", label: "Continuous footings by type" },
  { key: "if", group: "Footings", label: "Isolated footings by mark" },
  { key: "fs", group: "Footings", label: "Footing steps" },
  { key: "fr", group: "Footings", label: "Footing rebar by bar size" },
  { key: "fd", group: "Footings", label: "Dowels to the stem or wall" },
  { key: "tp", group: "Trench pit", label: "Trench pit" },
  { key: "cp", group: "Correlator pit", label: "Correlator pit" },
  { key: "ts", group: "Tire seal pit", label: "Tire seal drainage pit" },
  { key: "td", group: "Trench drains", label: "Trench drains" },
  { key: "sg", group: "Slab on grade", label: "Slab on grade" },
  { key: "us", group: "Under-slab work", label: "Under-slab work" },
  { key: "ew", group: "Earthwork", label: "Earthwork for footings and pits" },
] as const;

/** Run on every takeoff. Quantified, or N/A with a reason. */
export const FOUNDATION_CHECKLIST = [
  { key: "pi", label: "Perimeter insulation", unit: "LF" },
  { key: "pt", label: "Perimeter termite", unit: "LF" },
  { key: "fg", label: "Fine grading", unit: "SF" },
  { key: "bc", label: "Base course", unit: "SF" },
  { key: "bt", label: "Base under trench and pits", unit: "SF" },
  { key: "dw", label: "Dowels", unit: "EA" },
  { key: "kw", label: "Keyways", unit: "LF" },
  { key: "ef", label: "Edge forms", unit: "LF" },
] as const;

export type AreaKind = "concrete" | "fiber" | "vapor" | "base" | "fine_grade" | "termite";
export type EstimateConvention = {
  profile: "as_drawn" | "estimator";
  forms_faces: 1 | 2;
  areas: Record<AreaKind, "net" | "gross">;
};

/** as_drawn follows the sheets (net slab lines, one form face). estimator follows the key's gross areas. One form face is the default in both. */
export const CONVENTIONS: Record<"as_drawn" | "estimator", EstimateConvention> = {
  as_drawn: {
    profile: "as_drawn",
    forms_faces: 1,
    areas: {
      concrete: "net",
      fiber: "net",
      vapor: "net",
      base: "net",
      fine_grade: "net",
      termite: "gross",
    },
  },
  estimator: {
    profile: "estimator",
    forms_faces: 1,
    areas: {
      concrete: "gross",
      fiber: "gross",
      vapor: "gross",
      base: "gross",
      fine_grade: "gross",
      termite: "gross",
    },
  },
};

export function conventionFor(
  profile: "as_drawn" | "estimator" = "as_drawn",
  faces?: 1 | 2,
): EstimateConvention {
  const base = CONVENTIONS[profile];
  return faces ? { ...base, forms_faces: faces } : base;
}
export const CHECK_KEYS = CONCRETE_CHECKLIST.map((c) => c.key) as unknown as readonly [
  "cf",
  "if",
  "fs",
  "fr",
  "fd",
  "tp",
  "cp",
  "ts",
  "td",
  "sg",
  "us",
  "ew",
];
export type CheckKey = (typeof CONCRETE_CHECKLIST)[number]["key"];

const VENDOR_BLANK = /vendor|shop\s*drawings?/i;
const COORDINATION: Record<string, string[]> = {
  "03": [
    "Sleeves, blockouts and embeds other trades leave in this concrete.",
    "Equipment pads, bollard bases and housekeeping pads if another trade owns them.",
    "Penetrations shown on other sheets.",
  ],
  "26": [
    "Sleeves and blockouts through slabs and walls.",
    "Housekeeping pads and equipment bases someone else pours.",
    "Embeds and grounding another trade carries.",
  ],
};

export type Basis = "measured" | "deduced";
export type BasisLabel = "MEASURED" | "DEDUCED";
export type Confidence = "high" | "medium" | "low";
export type MeasureType = "count" | "linear" | "area" | "volume";
export type Op =
  | "product"
  | "sum"
  | "net"
  | "quotient"
  | "cy_from_area"
  | "rebar_lb"
  | "scale"
  | "as_read";
export type QtyInput = {
  name: string;
  value: number | null;
  unit?: string | null;
  sheet?: string | null;
  detail?: string | null;
};

export type LineIn = {
  line_no?: number;
  item: string;
  material?: string | null;
  unit?: string | null;
  basis: string;
  op?: Op;
  inputs?: QtyInput[];
  divisor?: number | null;
  bar_size?: string | null;
  value?: number | null;
  range?: string | null;
  measure_type?: MeasureType | null;
  sheet: string;
  detail?: string | null;
  spec_section?: string | null;
  confidence?: Confidence | null;
  scale?: string | null;
  method?: string | null;
  markup_ref?: string | null;
  location_text?: string | null;
  missing_input?: string | null;
  exclusion?: string | null;
  checklist_key?: string | null;
  forms_faces?: 1 | 2;
  area_basis?: "net" | "gross";
  element?: string | null;
  trade?: string | null;
  note?: string | null;
};

export type StoredLine = {
  line_no: number;
  item: string;
  material: string | null;
  qty: number | null;
  unit: string | null;
  range_text: string | null;
  measure_type: MeasureType | null;
  sheet: string;
  detail: string | null;
  spec_section: string | null;
  basis: Basis;
  math: string;
  confidence: Confidence;
  markup_ref: string | null;
  location_text: string | null;
  missing_input: string | null;
  exclusion: string | null;
  checklist_key: string | null;
  element: string | null;
  trade: string | null;
  note: string | null;
  inputs: QtyInput[];
};

export type Doc = {
  name: string;
  kind: "base" | "addendum" | "sheet" | "spec";
  revision?: string | null;
  date?: string | null;
  sheets?: string[];
};

export type Setup = {
  role: "gc" | "self_performer" | null;
  trades: string[];
  bid_due: string | null;
  delivery_method: string | null;
  documents: Doc[];
  sub_bids: SubBid[];
  workbook_note: string | null;
  in_scope: string[];
  out_scope: string[];
  assumptions: string[];
  doc_review: DocReview | null;
  summary_version: number | null;
};

export type SheetNote = {
  sheet: string;
  title: string;
  revision?: string | null;
  date?: string | null;
  scale?: string | null;
  notes?: string[];
  schedules?: string[];
};
export type SpecSection = {
  section: string;
  title: string;
  part1?: string | null;
  part2?: string | null;
  part3?: string | null;
};
export type SpecDrawing = {
  spec_section: string;
  requirement: string;
  sheet: string;
  detail?: string | null;
  drawing_shows?: string | null;
};
export type DocReview = {
  sheets: SheetNote[];
  specs: SpecSection[];
  pairs: SpecDrawing[];
  context?: string | null;
};

export type BidLine = {
  description: string;
  qty: number | null;
  unit: string | null;
  amount: number | null;
  exclusion: string | null;
};
export type SubBid = { sub: string; trade: string; total: number | null; lines: BidLine[] };

export type GapIn = {
  ref?: string;
  kind: "seen" | "verify";
  category:
    | "missing_on_drawings"
    | "conflict"
    | "scale_or_dimension"
    | "scope_seam"
    | "allowance_or_alternate";
  severity?: "hard" | "soft" | "cannot_know";
  title: string;
  reasoning: string;
  sheet: string;
  detail?: string | null;
  spec_section: string;
  holds_bid?: boolean;
  qty?: number | null;
  unit?: string | null;
  element?: string | null;
  line_no?: number | null;
};
export type StoredGap = {
  ref: string;
  kind: "seen" | "verify";
  category: GapIn["category"];
  severity: "hard" | "soft" | "cannot_know";
  title: string;
  reasoning: string;
  sheet: string;
  detail: string | null;
  spec_section: string;
  holds_bid: boolean;
  qty: number | null;
  unit: string | null;
  element: string | null;
  line_no: number | null;
};

export type MarkName = "relevant" | "not_relevant" | "good_catch";
export type StoredVerdict = {
  item_kind: "line" | "gap";
  line_no: number | null;
  gap_ref: string | null;
  item_text: string;
  mark: MarkName;
  note: string | null;
  corrected_qty: number | null;
  owner: string | null;
  created_at: string;
};

export type ItemStatus = "open" | "settled" | "dropped";
export type SettledView = {
  ref: string;
  kind: "line" | "gap";
  title: string;
  status: ItemStatus;
  qty: number | null;
  unit: string | null;
  sheet: string;
  detail: string | null;
  spec: string | null;
  element: string;
  trade: string | null;
  basis: BasisLabel | null;
  math: string | null;
  confidence: Confidence | null;
  missing: string | null;
  exclusion: string | null;
  owner: string | null;
  holdsBid: boolean;
  checklistKey: string | null;
  followUp: string | null;
  mark: MarkName | null;
  range: string | null;
  location: string | null;
  markup: string | null;
  material: string | null;
  measure: MeasureType | null;
  note: string | null;
};

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};
const showNum = (n: number) => String(Math.round(n * 100000) / 100000);
export function toBasis(raw: string): Basis {
  const s = raw.trim().toLowerCase();
  if (s === "measured" || s === "read") return "measured";
  if (s === "deduced" || s === "derived") return "deduced";
  throw new EstimateError("Each quantity is MEASURED or DEDUCED. Nothing was saved.");
}
export const basisLabel = (b: Basis): BasisLabel => (b === "measured" ? "MEASURED" : "DEDUCED");

export function formatQty(n: number, unit: string | null): string {
  if (!Number.isFinite(n))
    throw new EstimateError("That quantity is not a number. Nothing was saved.");
  if (n < 0) throw new EstimateError("quantity has to be zero or more. Nothing was saved.");
  const u = (unit ?? "").toUpperCase();
  if (u === "EA") {
    const r = Math.round(n);
    if (Math.abs(n - r) > 1e-6)
      throw new EstimateError("A count has to be a whole number. Nothing was saved.");
    return String(r);
  }
  const decimals = ["CY", "SF", "LF", "LB", "SY", "SFCA"].includes(u) ? 2 : 4;
  return String(Math.round(n * 10 ** decimals) / 10 ** decimals);
}
const qtyNumber = (n: number, unit: string | null) => Number(formatQty(n, unit));

function cite(sheet: string, detail: string | null): string {
  return detail ? `${sheet} ${detail}` : sheet;
}
function measureOf(unit: string | null, given?: string | null): MeasureType | null {
  if (given === "count" || given === "linear" || given === "area" || given === "volume")
    return given;
  const u = (unit ?? "").toUpperCase();
  if (u === "EA") return "count";
  if (u === "LF") return "linear";
  if (u === "CY") return "volume";
  if (u === "SF" || u === "SY" || u === "SFCA") return "area";
  return null;
}
function blankMath(name: string, sheet: string, detail: string | null): string {
  return `Blank. The one missing input is ${name}. It is not on the sheets. ${cite(sheet, detail)}.`;
}
function rejectVendor(name: string | null) {
  if (name && VENDOR_BLANK.test(name))
    throw new EstimateError(
      "A vendor or shop-drawing note is not a reason to leave this blank. Nothing was saved.",
    );
}

function finish(
  partial: Omit<StoredLine, "line_no" | "measure_type" | "inputs"> & { inputs: QtyInput[] },
  raw: LineIn,
): Omit<StoredLine, "line_no"> {
  if (
    raw.checklist_key &&
    !CONCRETE_CHECKLIST.some((c) => c.key === raw.checklist_key) &&
    !FOUNDATION_CHECKLIST.some((c) => c.key === raw.checklist_key)
  )
    throw new EstimateError("That checklist item is not on the list. Nothing was saved.");
  return {
    ...partial,
    measure_type: measureOf(partial.unit, raw.measure_type),
    inputs: raw.inputs ?? partial.inputs,
  };
}

/** Compute one line. DEDUCED quantities are filled only from the inputs. */
export function prepareLine(raw: LineIn): Omit<StoredLine, "line_no"> {
  raw = {
    ...raw,
    inputs: (raw.inputs ?? []).map((input) => ({ ...input, name: normalizeInputName(input.name) })),
  };
  const item = raw.item.trim();
  const sheet = raw.sheet.trim();
  if (!item) throw new EstimateError("Each line needs an item. Nothing was saved.");
  if (!sheet) throw new EstimateError("Each line cites a sheet. Nothing was saved.");
  const detail = clean(raw.detail);
  const unit = clean(raw.unit);
  const exclusion = clean(raw.exclusion);
  const named = clean(raw.missing_input);
  const note = clean(raw.note);
  const where = cite(sheet, detail);
  if (exclusion && named)
    throw new EstimateError("A line is a blank or an exclusion, not both. Nothing was saved.");
  if (exclusion) {
    rejectVendor(named);
    return finish(
      {
        item,
        material: clean(raw.material),
        qty: null,
        unit,
        range_text: clean(raw.range),
        sheet,
        detail,
        spec_section: clean(raw.spec_section),
        basis: "measured",
        math: `Exclusion, not a quantity: ${exclusion}. ${where}.`,
        confidence: "high",
        markup_ref: clean(raw.markup_ref),
        location_text: clean(raw.location_text),
        missing_input: null,
        exclusion,
        checklist_key: raw.checklist_key ?? null,
        element: clean(raw.element),
        trade: clean(raw.trade),
        note,
        inputs: raw.inputs ?? [],
      },
      raw,
    );
  }

  const basis = toBasis(raw.basis);
  const inputs = raw.inputs ?? [];
  const op = raw.op ?? (basis === "measured" ? "as_read" : undefined);
  if (basis === "measured" && op && op !== "as_read")
    throw new EstimateError("That math is DEDUCED, not MEASURED. Nothing was saved.");

  const asBlank = (name: string | null) => {
    const one = clean(name);
    if (!one) throw new EstimateError("Name the one input that is missing. Nothing was saved.");
    rejectVendor(one);
    return finish(
      {
        item,
        material: clean(raw.material),
        qty: null,
        unit,
        range_text: clean(raw.range),
        sheet,
        detail,
        spec_section: clean(raw.spec_section),
        basis,
        math: blankMath(one, sheet, detail),
        confidence: "low",
        markup_ref: clean(raw.markup_ref),
        location_text: clean(raw.location_text),
        missing_input: one,
        exclusion: null,
        checklist_key: raw.checklist_key ?? null,
        element: clean(raw.element),
        trade: clean(raw.trade),
        note,
        inputs,
      },
      raw,
    );
  };

  if (op === "scale") {
    if (raw.value == null) return asBlank(named ?? "scaled measurement");
    if (!clean(raw.scale))
      throw new EstimateError(
        "State the scale from the title block or a dimensioned string. Nothing was saved.",
      );
    if (!clean(raw.method))
      throw new EstimateError("State how this was measured off the scale. Nothing was saved.");
    if (!clean(raw.range))
      throw new EstimateError(
        "State the plus or minus range for this scaled measurement. Nothing was saved.",
      );
    const qty = qtyNumber(raw.value, unit);
    return finish(
      {
        item,
        material: clean(raw.material),
        qty,
        unit,
        range_text: clean(raw.range),
        sheet,
        detail,
        spec_section: clean(raw.spec_section),
        basis: "deduced",
        math: `DEDUCED, low confidence: scaled ${formatQty(qty, unit)} ${unit ?? ""} at ${clean(raw.scale)} by ${clean(raw.method)}, ${clean(raw.range)}. ${where}.`.replace(
          /\s+/g,
          " ",
        ),
        confidence: "low",
        markup_ref: clean(raw.markup_ref),
        location_text: clean(raw.location_text),
        missing_input: null,
        exclusion: null,
        checklist_key: raw.checklist_key ?? null,
        element: clean(raw.element),
        trade: clean(raw.trade),
        note,
        inputs,
      },
      raw,
    );
  }

  if (basis === "measured" || op === "as_read") {
    if (raw.value == null) return asBlank(named);
    const qty = qtyNumber(raw.value, unit);
    return finish(
      {
        item,
        material: clean(raw.material),
        qty,
        unit,
        range_text: clean(raw.range),
        sheet,
        detail,
        spec_section: clean(raw.spec_section),
        basis: "measured",
        math: `MEASURED ${formatQty(qty, unit)} ${unit ?? ""} on ${where}.`.replace(/\s+/g, " "),
        confidence: raw.confidence ?? "high",
        markup_ref: clean(raw.markup_ref),
        location_text: clean(raw.location_text),
        missing_input: null,
        exclusion: null,
        checklist_key: raw.checklist_key ?? null,
        element: clean(raw.element),
        trade: clean(raw.trade),
        note,
        inputs,
      },
      raw,
    );
  }

  if (!op) {
    if (named || inputs.some((i) => i.value == null))
      return asBlank(named ?? inputs.find((i) => i.value == null)?.name ?? null);
    throw new EstimateError("Say how this DEDUCED quantity is computed. Nothing was saved.");
  }

  const holes = inputs
    .filter((i) => i.value == null)
    .map((i) => i.name.trim())
    .filter(Boolean);
  if (op === "cy_from_area") {
    const area = inputs.find((i) => /area|sf|slab/i.test(i.name)) ?? inputs[0];
    const thick = inputs.find((i) => /thick|inch/i.test(i.name)) ?? inputs[1];
    const missing = [area, thick].filter((i) => !i || i.value == null);
    if (missing.length > 1 || (!area && !thick))
      throw new EstimateError("Name the one input that is missing. Nothing was saved.");
    if (!area || area.value == null) return asBlank(area?.name ?? named ?? "area");
    if (!thick || thick.value == null) return asBlank(thick?.name ?? named ?? "thickness");
    const qty = qtyNumber((area.value * thick.value) / 12 / 27, unit ?? "CY");
    return computed(
      raw,
      qty,
      unit ?? "CY",
      `DEDUCED: ${showNum(area.value)} SF × ${showNum(thick.value)} in / 12 / 27 = ${formatQty(qty, unit ?? "CY")} CY. ${where}.`,
      inputs,
    );
  }
  if (op === "rebar_lb") {
    const length = inputs.find((i) => i.value != null) ?? inputs[0];
    if (!length || length.value == null) return asBlank(length?.name ?? named ?? "bar length");
    const size = clean(raw.bar_size);
    if (!size) return asBlank(named ?? "bar size");
    const w = BAR_LB_PER_LF[size.replace(/^#/, "")];
    if (w == null)
      throw new EstimateError(
        "No published weight is on file for that bar size. Nothing was saved.",
      );
    const qty = qtyNumber(length.value * w, unit ?? "LB");
    return computed(
      raw,
      qty,
      unit ?? "LB",
      `DEDUCED: ${showNum(length.value)} LF × ${w} lb/ft (#${size.replace(/^#/, "")}, published bar weight) = ${formatQty(qty, unit ?? "LB")} LB. ${where}.`,
      inputs,
    );
  }
  if (holes.length > 1)
    throw new EstimateError(
      `More than one input is missing (${holes.join(", ")}). A blank can name only one. Nothing was saved.`,
    );
  if (holes.length === 1) return asBlank(holes[0]);
  if (!inputs.length) return asBlank(named);

  const values = inputs.map((i) => i.value as number);
  let rawQty: number;
  let expr: string;
  if (op === "sum") {
    rawQty = values.reduce((a, b) => a + b, 0);
    expr = inputs.map((i) => showNum(i.value as number)).join(" + ");
  } else if (op === "net") {
    rawQty = values[0] - values.slice(1).reduce((a, b) => a + b, 0);
    expr = [
      showNum(values[0]),
      ...inputs.slice(1).map((i) => `${showNum(i.value as number)} (${i.name})`),
    ].join(" − ");
  } else if (op === "quotient") {
    if (values.length !== 2)
      throw new EstimateError("A quotient needs two measured inputs. Nothing was saved.");
    if (values[1] === 0) throw new EstimateError("Can't divide by zero. Nothing was saved.");
    rawQty = values[0] / values[1];
    expr = `${showNum(values[0])} / ${showNum(values[1])}`;
  } else {
    const div = raw.divisor ?? 1;
    if (!Number.isFinite(div) || div === 0)
      throw new EstimateError("The divisor has to be a real number. Nothing was saved.");
    rawQty = values.reduce((a, b) => a * b, 1) / div;
    expr =
      inputs.map((i) => showNum(i.value as number)).join(" × ") +
      (div === 1 ? "" : ` / ${showNum(div)}`);
  }
  const u = unit ?? "";
  const qty = qtyNumber(rawQty, u || null);
  let extra = "";
  if (raw.value != null && Math.abs(raw.value - qty) > Math.max(0.01, Math.abs(qty) * 0.005))
    extra = ` Sent figure ${showNum(raw.value)} does not match the math.`;
  return computed(
    raw,
    qty,
    u || null,
    `DEDUCED: ${expr} = ${formatQty(qty, u || null)}${u ? " " + u : ""}. ${where}.${extra}`,
    inputs,
  );
}

function computed(
  raw: LineIn,
  qty: number,
  unit: string | null,
  math: string,
  inputs: QtyInput[],
): Omit<StoredLine, "line_no"> {
  return finish(
    {
      item: raw.item.trim(),
      material: clean(raw.material),
      qty,
      unit,
      range_text: clean(raw.range),
      sheet: raw.sheet.trim(),
      detail: clean(raw.detail),
      spec_section: clean(raw.spec_section),
      basis: "deduced",
      math: math.slice(0, 1000),
      confidence: raw.confidence ?? "medium",
      markup_ref: clean(raw.markup_ref),
      location_text: clean(raw.location_text),
      missing_input: null,
      exclusion: null,
      checklist_key: raw.checklist_key ?? null,
      element: clean(raw.element),
      trade: clean(raw.trade),
      note: clean(raw.note),
      inputs,
    },
    raw,
  );
}

const VOLUME = new Set(["CY", "CF", "CUFT", "CUYD"]);
const LINEAR = new Set(["LF", "FT"]);
const AREA = new Set(["SF", "SFCA", "SY"]);
const COUNT = new Set(["EA"]);
const WEIGHT = new Set(["LB", "LBS"]);

function unitFamily(unit: string): "volume" | "linear" | "area" | "count" | "weight" | null {
  const u = unit.toUpperCase().replace(/\./g, "");
  if (VOLUME.has(u)) return "volume";
  if (LINEAR.has(u)) return "linear";
  if (AREA.has(u)) return "area";
  if (COUNT.has(u)) return "count";
  if (WEIGHT.has(u)) return "weight";
  return null;
}

/** Reject a linear quantity labeled as a volume, and the reverse. */
export function assertUnitSane(
  item: string,
  unit: string | null,
  measure: MeasureType | null,
): void {
  if (!unit) return;
  const family = unitFamily(unit);
  const u = unit.toUpperCase().replace(/\./g, "");
  if (family && measure && family !== measure && family !== "weight") {
    throw new EstimateError(
      `${item}: ${u} doesn't match a ${measure} quantity. LF can't be given as CF. Nothing was saved.`,
    );
  }
  if ((u === "LF" && family === "volume") || (measure === "linear" && family === "volume"))
    throw new EstimateError(`${item}: LF can't be given as CF. Nothing was saved.`);
}

function areaKind(item: string): AreaKind | null {
  const n = item.toLowerCase();
  if (/termite/.test(n)) return "termite";
  if (/fine grad/.test(n)) return "fine_grade";
  if (/vapor/.test(n)) return "vapor";
  if (/fiber/.test(n)) return "fiber";
  if (/base course|base under|granular base/.test(n)) return "base";
  if (/slab|concrete|neat/.test(n) && !/form|rebar|dowel/.test(n)) return "concrete";
  return null;
}

function isForms(item: string, unit: string | null): boolean {
  return (unit ?? "").toUpperCase() === "SFCA" || /form|contact area|sfca/i.test(item);
}

function isRebar(item: string): boolean {
  return /rebar|reinforc/i.test(item);
}

function expectedUnit(item: string): string | null {
  const n = item.toLowerCase();
  if (/termite/.test(n) && /perim/.test(n)) return "LF";
  if (/termite/.test(n)) return "SF";
  if (/fine grad/.test(n)) return "SF";
  if (/base course|base under/.test(n)) return "SF";
  if (/perimeter insulation/.test(n)) return "LF";
  if (/edge form/.test(n)) return "LF";
  if (/keyway/.test(n)) return "LF";
  if (/dowel/.test(n)) return "EA";
  return null;
}

function applyConvention(
  line: Omit<StoredLine, "line_no">,
  raw: LineIn,
  convention: EstimateConvention,
): Omit<StoredLine, "line_no"> {
  assertUnitSane(line.item, line.unit, line.measure_type);
  const want = expectedUnit(line.item);
  const got = (line.unit ?? "").toUpperCase().replace(/\./g, "");
  if (want && got && got !== want && line.qty != null && !line.exclusion)
    throw new EstimateError(
      `${line.item} is ${want} for this profile. ${got} was sent. Nothing was saved.`,
    );
  let math = line.math;
  if (isForms(line.item, line.unit)) {
    const faces = raw.forms_faces ?? convention.forms_faces;
    math +=
      faces === 1
        ? " Forms faces: 1. One face is the default. The earth side is not formed."
        : " Forms faces: 2, set on this line.";
  }
  const kind = areaKind(line.item);
  if (kind) {
    const rule = convention.areas[kind];
    if (raw.area_basis && raw.area_basis !== rule)
      throw new EstimateError(
        `${line.item} is ${rule} for the ${convention.profile === "as_drawn" ? "as drawn" : "estimator"} profile. Nothing was saved.`,
      );
    math +=
      kind === "termite"
        ? " Termite uses gross area, plus a separate perimeter in LF."
        : ` Area basis: ${rule}.`;
  }
  if (isRebar(line.item) && !line.exclusion) {
    const hasLf = /\bLF\b/.test(math) || got === "LF";
    const hasLb = /\bLB\b/.test(math) || got === "LB" || got === "LBS";
    if (!hasLf)
      throw new EstimateError(
        "Rebar needs the length in LF alongside the pounds. Nothing was saved.",
      );
    if (!hasLb)
      throw new EstimateError(
        "Rebar needs the pounds in LB alongside the length. Send the bar size. Nothing was saved.",
      );
  }
  return { ...line, math: math.slice(0, 1000) };
}

export function normalizeSchedules(value: unknown): string[] {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > 40) throw new EstimateError("Send at most 40 schedules. Nothing was saved.");
  return list.map((item, i) => {
    if (typeof item === "string") {
      const s = item.trim();
      if (!s) throw new EstimateError(`Schedule ${i + 1} is blank. Nothing was saved.`);
      if (s.length > 200)
        throw new EstimateError(`Schedule ${i + 1} is too long. Nothing was saved.`);
      return s;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const name = String(o.name ?? o.title ?? "").trim();
      if (!name) throw new EstimateError(`Schedule ${i + 1} needs a name. Nothing was saved.`);
      const extra = Array.isArray(o.items)
        ? o.items
            .map((x) => String(x).trim())
            .filter(Boolean)
            .join(", ")
        : "";
      const line = extra ? `${name}: ${extra}` : name;
      if (line.length > 200)
        throw new EstimateError(`Schedule ${name} is too long. Nothing was saved.`);
      return line;
    }
    throw new EstimateError(`Schedule ${i + 1} needs a name. Nothing was saved.`);
  });
}

export function normalizeScale(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0)
      throw new EstimateError("The scale has to be a real scale. Nothing was saved.");
    return String(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s)
      throw new EstimateError(
        "State the scale from the title block or a dimensioned string. Nothing was saved.",
      );
    if (s.length > 80) throw new EstimateError("That scale is too long. Nothing was saved.");
    return s;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const v = o.scale ?? o.value ?? o.text;
    if (v == null || (typeof v === "string" && !v.trim()))
      throw new EstimateError(
        "State the scale from the title block or a dimensioned string. Nothing was saved.",
      );
    const unit = typeof o.unit === "string" && o.unit.trim() ? ` ${o.unit.trim()}` : "";
    return normalizeScale(`${v}${unit}`.trim());
  }
  throw new EstimateError(
    "State the scale from the title block or a dimensioned string. Nothing was saved.",
  );
}

export function normalizeInputName(value: unknown): string {
  let s = "";
  if (typeof value === "number" && Number.isFinite(value)) s = String(value);
  else if (typeof value === "string") s = value.trim();
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    s = String(o.name ?? o.label ?? "").trim();
  }
  if (!s) throw new EstimateError("Each measured input needs a name. Nothing was saved.");
  if (s.length > 80) throw new EstimateError("the input name is longer than 80 characters. Nothing was saved.");
  return s;
}

export function cleanCsv(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function prepareLines(
  rows: LineIn[],
  convention: EstimateConvention = CONVENTIONS.as_drawn,
): StoredLine[] {
  const prepared = rows.map((raw, i) => {
    try {
      return applyConvention(prepareLine(raw), raw, convention);
    } catch (e) {
      if (e instanceof EstimateError && !/^Line \d+/.test(e.message)) {
        const n = raw.line_no ?? i + 1;
        const desc = raw.item?.trim() || "this line";
        throw new EstimateError(`Line ${n} (${desc}): ${e.message}`);
      }
      throw e;
    }
  });
  const given = rows.map((r) => r.line_no).filter((n): n is number => typeof n === "number");
  if (given.length && given.length !== rows.length)
    throw new EstimateError(
      "Number every line, or leave the numbers off and Athena will number them. Nothing was saved.",
    );
  const numbers = given.length ? given : prepared.map((_, i) => i + 1);
  if (new Set(numbers).size !== numbers.length)
    throw new EstimateError("Each line number is used once. Nothing was saved.");
  return prepared.map((line, i) => ({ ...line, line_no: numbers[i] }));
}

export function coverageLine(lines: StoredLine[]): string {
  const quantified = lines.filter((l) => l.qty != null);
  const measured = quantified.filter((l) => l.basis === "measured").length;
  const deduced = quantified.filter((l) => l.basis === "deduced").length;
  const low = quantified.filter((l) => l.confidence === "low").length;
  const blanks = lines.filter((l) => l.qty == null && l.missing_input);
  const exclusions = lines.filter((l) => l.qty == null && l.exclusion);
  const named = blanks.map((l) => `${l.item}: ${l.missing_input}`).join("; ");
  return `Quantified ${quantified.length} of ${lines.length} lines (${measured} MEASURED, ${deduced} DEDUCED, of which ${low} low-confidence); ${blanks.length} blank${named ? `, each naming its missing input (${named})` : ""}${exclusions.length ? `; ${exclusions.length} exclusion${exclusions.length === 1 ? "" : "s"} waiting on the estimator` : ""}.`;
}

const CATEGORY_LABEL: Record<StoredGap["category"], string> = {
  missing_on_drawings: "Missing on the drawings",
  conflict: "Conflict",
  scale_or_dimension: "Scale or dimension",
  scope_seam: "Scope seam",
  allowance_or_alternate: "Allowance or alternate",
};
const SEVERITY_LABEL = { hard: "Hard", soft: "Soft", cannot_know: "Cannot-know" } as const;
const defaultSeverity = (c: StoredGap["category"]): StoredGap["severity"] =>
  c === "missing_on_drawings" || c === "conflict"
    ? "hard"
    : c === "allowance_or_alternate"
      ? "soft"
      : "soft";

export function withCitation(
  reasoning: string,
  sheet: string,
  detail: string | null,
  spec: string,
): string {
  const text = reasoning.trim();
  const hasSheet = text.includes(sheet);
  const hasSpec = text.includes(spec);
  if (hasSheet && hasSpec) return text;
  return `${text} Sheet ${cite(sheet, detail)}; spec ${spec}.`.trim();
}

export function prepareGap(raw: GapIn, ref: string): StoredGap {
  const sheet = raw.sheet.trim();
  const spec = raw.spec_section.trim();
  const title = raw.title.trim();
  const reasoning = raw.reasoning.trim();
  if (!sheet || !spec || !title || !reasoning)
    throw new EstimateError(
      "Each gap cites the sheet, the spec section and the reasoning. Nothing was saved.",
    );
  if (raw.kind === "seen" && raw.qty == null && raw.line_no == null)
    throw new EstimateError("A seen item ties to a quantity or a takeoff line. Nothing was saved.");
  const severity = raw.severity ?? defaultSeverity(raw.category);
  const holds =
    severity === "cannot_know"
      ? raw.holds_bid === true
      : raw.holds_bid === true || severity === "hard";
  return {
    ref,
    kind: raw.kind,
    category: raw.category,
    severity,
    title,
    reasoning: withCitation(reasoning, sheet, clean(raw.detail), spec).slice(0, 2000),
    sheet,
    detail: clean(raw.detail),
    spec_section: spec,
    holds_bid: holds,
    qty: raw.qty ?? null,
    unit: clean(raw.unit),
    element: clean(raw.element),
    line_no: raw.line_no ?? null,
  };
}

export function prepareGaps(rows: GapIn[]): StoredGap[] {
  return rows.map((row, i) =>
    prepareGap(row, row.ref && /^G-\d+$/.test(row.ref) ? row.ref : `G-${i + 1}`),
  );
}

/** Keep a gap number when the same sheet, spec and title come back. */
export function assignGapRefs(
  existing: { ref: string; title: string; sheet: string; spec_section: string }[],
  incoming: GapIn[],
): GapIn[] {
  const used = new Set(existing.map((g) => g.ref));
  let n = existing.reduce((m, g) => Math.max(m, Number(g.ref.replace(/^G-/, "")) || 0), 0);
  return incoming.map((g) => {
    const hit = existing.find(
      (e) =>
        e.title === g.title.trim() &&
        e.sheet === g.sheet.trim() &&
        e.spec_section === g.spec_section.trim(),
    );
    if (hit) return { ...g, ref: hit.ref };
    if (g.ref && /^G-\d+$/.test(g.ref) && !used.has(g.ref)) {
      used.add(g.ref);
      return g;
    }
    n += 1;
    const ref = `G-${n}`;
    used.add(ref);
    return { ...g, ref };
  });
}

/** Verification items the takeoff and the spec-versus-drawing list already imply. */
export function autoGaps(lines: StoredLine[], pairs: SpecDrawing[]): GapIn[] {
  const fromLines: GapIn[] = lines
    .filter((l) => l.qty == null)
    .map((l) => ({
      kind: "verify" as const,
      category: l.missing_input ? ("scale_or_dimension" as const) : ("scope_seam" as const),
      severity: l.missing_input ? ("hard" as const) : ("soft" as const),
      title: l.item,
      reasoning: l.missing_input
        ? `The quantity is blank because ${l.missing_input} is not on the sheets. Verify before pricing.`
        : `This line is an exclusion (${l.exclusion ?? "not stated"}) and is not a quantity. Verify the estimator accepts it.`,
      sheet: l.sheet,
      detail: l.detail,
      spec_section: l.spec_section ?? "not on the documents",
      holds_bid: Boolean(l.missing_input),
      line_no: l.line_no,
      element: l.element,
    }));
  const fromPairs: GapIn[] = pairs.map((p) => ({
    kind: "verify" as const,
    category: "missing_on_drawings" as const,
    severity: "hard" as const,
    title: p.requirement,
    reasoning: `Spec ${p.spec_section} calls for ${p.requirement}; ${p.sheet}${p.detail ? " " + p.detail : ""} ${p.drawing_shows ? "shows " + p.drawing_shows : "does not show it"}. Verify.`,
    sheet: p.sheet,
    detail: p.detail,
    spec_section: p.spec_section,
    holds_bid: true,
  }));
  return [...fromLines, ...fromPairs];
}

export function isConcrete(trades: string[]): boolean {
  return trades.some((t) => /\b03\b/.test(t) || /concrete/i.test(t));
}
export function divisionOf(trade: string): string | null {
  const m = trade.match(/\b(\d{2})\b/);
  return m ? m[1] : /concrete/i.test(trade) ? "03" : /electric/i.test(trade) ? "26" : null;
}

export function revisionUsed(docs: Doc[]): string {
  const addenda = docs.filter((d) => d.kind === "addendum");
  const dated = [...addenda].filter((d) => d.date).sort((a, b) => (a.date! < b.date! ? 1 : -1));
  const top = dated[0] ?? addenda[0];
  if (!top) {
    const rev = docs.find((d) => d.revision);
    return rev
      ? `Revision used: ${rev.revision} on ${rev.name}. No addendum is on file.`
      : "Revision used: not stated. No addendum is on file.";
  }
  return `Revision used: ${top.name}${top.date ? `, ${top.date}` : ", date not stated"}${top.revision ? `, ${top.revision}` : ""}. Addenda override the base documents.`;
}

export function coordinationFor(trades: string[]): string[] {
  const out: string[] = [];
  for (const t of trades) {
    const div = divisionOf(t);
    const rows = (div && COORDINATION[div]) || [
      "Work by other trades that touches this scope. Not a quantity.",
    ];
    for (const q of rows) out.push(`${t}: ${q}`);
  }
  return out;
}

function latestVerdict(
  verdicts: StoredVerdict[],
  pred: (v: StoredVerdict) => boolean,
): StoredVerdict | null {
  const hits = verdicts
    .filter(pred)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return hits.length ? hits[hits.length - 1] : null;
}
const markWord = (m: MarkName) =>
  m === "not_relevant" ? "not relevant" : m === "good_catch" ? "good catch" : "relevant";

export function settle(
  lines: StoredLine[],
  gaps: StoredGap[],
  verdicts: StoredVerdict[],
  opts: { role: Setup["role"]; trades: string[] },
): {
  items: SettledView[];
  counts: { open: number; settled: number; dropped: number };
  settled: boolean;
  blockers: string[];
  checklist: { label: string; state: string }[];
  foundation: { label: string; state: string }[];
  stale: string[];
} {
  const stale: string[] = [];
  const items: SettledView[] = [];
  for (const line of lines) {
    const v = latestVerdict(
      verdicts,
      (x) => x.item_kind === "line" && x.line_no === line.line_no && x.item_text === line.item,
    );
    if (
      !v &&
      verdicts.some(
        (x) => x.item_kind === "line" && x.line_no === line.line_no && x.item_text !== line.item,
      )
    )
      stale.push(`T-${line.line_no}`);
    const qty = v?.corrected_qty ?? line.qty;
    const owned = Boolean(v?.owner);
    let status: ItemStatus;
    const foundationNa =
      !v &&
      line.qty == null &&
      Boolean(line.exclusion) &&
      FOUNDATION_CHECKLIST.some((c) => c.key === line.checklist_key);
    if (v?.mark === "not_relevant") status = "dropped";
    else if (v && (v.mark === "relevant" || v.mark === "good_catch") && qty == null && !owned)
      status = "open";
    else if (qty != null || owned || foundationNa) status = "settled";
    else status = "open";
    const follow =
      status === "open"
        ? v
          ? `Still open. Needs a quantity or an owner.`
          : line.missing_input
            ? `The one missing input is ${line.missing_input}.`
            : "Needs a quantity or an accepted exclusion."
        : null;
    items.push({
      ref: `T-${line.line_no}`,
      kind: "line",
      title: line.item,
      status,
      qty,
      unit: line.unit,
      sheet: line.sheet,
      detail: line.detail,
      spec: line.spec_section,
      element: line.element ?? "General",
      trade: line.trade,
      basis: basisLabel(line.basis),
      math:
        v?.corrected_qty != null
          ? `${line.math} Estimator set the quantity to ${showQty(v.corrected_qty, line.unit)}.`
          : line.math,
      confidence: line.confidence,
      missing: qty == null ? line.missing_input : null,
      exclusion: line.exclusion,
      owner: v?.owner ?? null,
      holdsBid: status === "open" && Boolean(line.missing_input),
      checklistKey: line.checklist_key,
      followUp: follow,
      mark: v?.mark ?? null,
      range: line.range_text,
      location: line.location_text,
      markup: line.markup_ref,
      material: line.material,
      measure: line.measure_type,
      note: line.note,
    });
  }
  for (const gap of gaps) {
    const v = latestVerdict(verdicts, (x) => x.item_kind === "gap" && x.gap_ref === gap.ref);
    const qty = v?.corrected_qty ?? gap.qty;
    const owned = Boolean(v?.owner);
    let status: ItemStatus;
    if (v?.mark === "not_relevant") status = "dropped";
    else if (v && (v.mark === "relevant" || v.mark === "good_catch") && qty == null && !owned)
      status = "open";
    else if (gap.kind === "seen" && (qty != null || gap.line_no != null)) status = "settled";
    else if (qty != null || owned) status = "settled";
    else status = "open";
    items.push({
      ref: gap.ref,
      kind: "gap",
      title: gap.title,
      status,
      qty,
      unit: gap.unit,
      sheet: gap.sheet,
      detail: gap.detail,
      spec: gap.spec_section,
      element: gap.element ?? "General",
      trade: null,
      basis: null,
      math: gap.reasoning,
      confidence: null,
      missing: null,
      exclusion: null,
      owner: v?.owner ?? null,
      holdsBid: gap.holds_bid && status !== "dropped",
      checklistKey: null,
      followUp:
        status === "open"
          ? "Needs a quantity or an owner, or a not-relevant call with the reason."
          : null,
      mark: v?.mark ?? null,
      range: null,
      location: null,
      markup: null,
      material: null,
      measure: null,
      note: v?.note ?? null,
    });
  }
  const counts = {
    open: items.filter((i) => i.status === "open").length,
    settled: items.filter((i) => i.status === "settled").length,
    dropped: items.filter((i) => i.status === "dropped").length,
  };
  const requireList =
    (opts.role === "self_performer" && isConcrete(opts.trades)) ||
    lines.some((l) => l.checklist_key);
  const checklist = CONCRETE_CHECKLIST.map((c) => {
    const rows = items.filter((i) => i.kind === "line" && i.checklistKey === c.key);
    if (!rows.length)
      return { label: c.label, state: requireList ? "not on the takeoff" : "not used" };
    if (rows.some((r) => r.status === "open")) return { label: c.label, state: "open" };
    if (rows.every((r) => r.status === "dropped"))
      return { label: c.label, state: "exclusion accepted" };
    if (rows.some((r) => r.qty != null)) return { label: c.label, state: "quantity" };
    return { label: c.label, state: "open" };
  });
  const foundation = FOUNDATION_CHECKLIST.map((c) => {
    const rows = items.filter((i) => i.kind === "line" && i.checklistKey === c.key);
    if (!rows.length) return { label: c.label, state: "not on the takeoff" };
    if (rows.some((r) => r.qty != null && r.status !== "dropped"))
      return { label: c.label, state: "quantity" };
    if (rows.some((r) => r.exclusion)) return { label: c.label, state: "N/A" };
    return { label: c.label, state: "open" };
  });
  const blockers = items
    .filter((i) => i.status === "open")
    .map((i) => `${i.title} (${i.ref})${i.missing ? ` — ${i.missing}` : ""}`);
  if (requireList)
    for (const c of checklist)
      if (c.state === "not on the takeoff" || c.state === "open")
        blockers.push(`${c.label}: ${c.state}.`);
  for (const c of foundation)
    if (c.state !== "quantity" && c.state !== "N/A") blockers.push(`${c.label}: ${c.state}.`);
  return {
    items,
    counts,
    settled: blockers.length === 0 && lines.length > 0,
    blockers,
    checklist,
    foundation,
    stale,
  };
}

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");
function showQty(n: number, unit: string | null): string {
  try {
    return formatQty(n, unit);
  } catch {
    return showNum(n);
  }
}
function rank(line: { unit: string | null; title: string }): number {
  const item = line.title.toLowerCase();
  const unit = (line.unit ?? "").toUpperCase();
  if (unit === "SFCA" || /contact/.test(item)) return 0;
  if (unit === "CY" || /concrete|neat/.test(item)) return 1;
  if (unit === "LB" || /rebar|reinforc/.test(item)) return 2;
  return 3;
}

export function estimateLayout() {
  return {
    orientation: "landscape" as const,
    page: "17x11",
    portrait_only_if_asked: true,
    logo: { url: ESTIMATE_LOGO_URL, position: "top-right" as const, alt: "Athena" },
    colors: {
      navy: ESTIMATE_NAVY,
      blue: "#2563EB",
      gray: "#6B7280",
      alert: ALERT_HEX,
      alert_only_for: "risks and gaps that hold up the bid",
    },
    reports: ["Takeoff", "Estimate Analysis", "Estimator loop", "Estimate Summary"],
  };
}

function frame(report: string, body: string[]): string {
  return [ESTIMATE_QUANTITY_REQUIRED, ...ESTIMATE_VIEW_SPEC, `Report: ${report}`, ...body].join(
    "\n",
  );
}
const countLine = (c: { open: number; settled: number; dropped: number }) =>
  `Open ${c.open}. Settled ${c.settled}. Dropped ${c.dropped}.`;

export function intakeQuestions(s: {
  role: Setup["role"];
  trades: string[];
  in_scope: string[];
  profile?: "as_drawn" | "estimator" | null;
}): string[] {
  const questions: string[] = [];
  if (!s.role) questions.push("Are you the general contractor or a self-performer?");
  if (!s.trades.length && !s.in_scope.length)
    questions.push("What is in your scope, and what is out?");
  if (!s.profile)
    questions.push("Which profile should the quantities follow: as drawn, or the estimator key?");
  return questions;
}

export function reuseWarning(input: {
  jobNumber: string;
  jobName: string;
  lines: number;
  version: number | null;
  sameName: { jobNumber: string; jobName: string }[];
}): string | null {
  const bits: string[] = [];
  if (input.lines > 0)
    bits.push(
      `Job ${input.jobNumber} (${input.jobName}) already has a takeoff${input.version ? `, version ${input.version}` : ""}, ${input.lines} lines.`,
    );
  for (const other of input.sameName)
    bits.push(
      `Job ${other.jobNumber} (${other.jobName}) has the same name and already has a takeoff.`,
    );
  if (!bits.length) return null;
  return `${bits.join(" ")} Reuse that takeoff, or start fresh? Nothing was saved.`;
}

const PLACEHOLDER_LINE = /\b(temp|placeholder|test|do not use)\b/i;

export function rejectPlaceholderLines(items: { item: string }[]): void {
  for (const line of items) {
    if (PLACEHOLDER_LINE.test(line.item))
      throw new EstimateError(
        `"${line.item}" looks like a placeholder or a test line. Nothing was saved.`,
      );
  }
}

/** Upsert by line number when the caller set one, otherwise by item name. Other lines stay. */
export function mergeTakeoffLines(
  prior: StoredLine[],
  incoming: StoredLine[],
  numbered: boolean[],
): StoredLine[] {
  const byNo = new Map(prior.map((l) => [l.line_no, { ...l }]));
  const byItem = new Map(prior.map((l) => [l.item.trim().toLowerCase(), l.line_no]));
  let max = prior.reduce((m, l) => Math.max(m, l.line_no), 0);
  incoming.forEach((line, i) => {
    if (numbered[i] && byNo.has(line.line_no)) {
      byNo.set(line.line_no, { ...line, line_no: line.line_no });
      byItem.set(line.item.trim().toLowerCase(), line.line_no);
      return;
    }
    const existing = byItem.get(line.item.trim().toLowerCase());
    if (!numbered[i] && existing) {
      byNo.set(existing, { ...line, line_no: existing });
      return;
    }
    const no = numbered[i] && !byNo.has(line.line_no) ? line.line_no : ++max;
    if (byNo.has(no) && numbered[i]) {
      byNo.set(no, { ...line, line_no: no });
    } else if (byNo.has(no)) {
      max = Math.max(max, no);
      const fresh = ++max;
      byNo.set(fresh, { ...line, line_no: fresh });
      byItem.set(line.item.trim().toLowerCase(), fresh);
    } else {
      max = Math.max(max, no);
      byNo.set(no, { ...line, line_no: no });
      byItem.set(line.item.trim().toLowerCase(), no);
    }
  });
  return [...byNo.values()].sort((a, b) => a.line_no - b.line_no);
}

export function renderIntake(
  job: string,
  s: Setup,
  profile?: "as_drawn" | "estimator" | null,
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  const questions = intakeQuestions({
    role: s.role,
    trades: s.trades,
    in_scope: s.in_scope,
    profile: profile ?? null,
  });
  const role =
    s.role === "gc"
      ? "General contractor"
      : s.role === "self_performer"
        ? "Self-performer"
        : "Not answered";
  const coord = s.role === "self_performer" ? coordinationFor(s.trades) : [];
  const lines = [
    `${job} · Estimating intake`,
    questions.length ? "Intake is not complete." : "Intake is complete.",
    ...questions.map((q) => `- ${q}`),
    `Role: ${role}`,
    `Profile: ${profile === "as_drawn" ? "As drawn" : profile === "estimator" ? "Estimator key" : "Not answered"}`,
    `Trades: ${s.trades.length ? s.trades.join("; ") : "not stated"}`,
    `Bid due: ${s.bid_due ?? "not stated"}`,
    `Delivery: ${s.delivery_method ?? "not stated"}`,
    revisionUsed(s.documents),
    "",
    "Scope plan",
  ];
  if (s.role === "gc") {
    lines.push(
      "In: the full document set. A general contractor covers every division on the drawings and the specs.",
    );
    lines.push(`Named trades: ${s.trades.length ? s.trades.join("; ") : "none named yet"}.`);
    lines.push(`Out: ${s.out_scope.length ? s.out_scope.join("; ") : "none stated"}.`);
  } else if (s.role === "self_performer") {
    lines.push(
      `In: ${s.in_scope.length ? s.in_scope.join("; ") : "not stated. Name what this trade takes off."}`,
    );
    lines.push(`Out: ${s.out_scope.length ? s.out_scope.join("; ") : "not stated"}.`);
  } else {
    lines.push("In: not answered.");
    lines.push("Out: not answered.");
  }
  lines.push(`Assumed: ${s.assumptions.length ? s.assumptions.join("; ") : "none stated"}.`);
  lines.push("", "Sheets and documents to read");
  if (!s.documents.length) lines.push("- None listed yet.");
  for (const d of s.documents)
    lines.push(
      `- ${d.name} (${d.kind}${d.revision ? `, ${d.revision}` : ""}${d.date ? `, ${d.date}` : ""}${d.sheets?.length ? `; sheets ${d.sheets.join(", ")}` : ""})`,
    );
  if (s.role === "self_performer") {
    lines.push("", "Coordination questions. Not a quantity.");
    coord.forEach((q, i) => lines.push(`- C${i + 1}. ${q}`));
  } else if (s.sub_bids.length) {
    lines.push("", "Sub bids named");
    for (const b of s.sub_bids) lines.push(`- ${b.sub} · ${b.trade} · ${b.lines.length} lines`);
  }
  lines.push("", `Workbook: ${s.workbook_note ?? "none stated"}.`);
  return {
    text: frame("Takeoff", lines),
    structured: {
      report: "Takeoff",
      layout: estimateLayout(),
      role: s.role,
      profile: profile ?? null,
      complete: questions.length === 0,
      trades: s.trades,
      revision: revisionUsed(s.documents),
      coordination: coord,
    },
    guidance: [
      "Ask each missing intake question. Do not assume self-performer, scope, or profile. Do not mark intake complete until role, scope, and profile are answered.",
      "Self-performer coordination stays a question. Do not turn it into a quantity.",
    ],
  };
}

export function renderDocReview(
  job: string,
  review: DocReview,
  docs: Doc[],
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  const lines = [`${job} · Document inventory`, revisionUsed(docs), "", "Sheets"];
  if (!review.sheets.length) lines.push("- No sheet index was sent.");
  for (const s of review.sheets)
    lines.push(
      `- ${s.sheet}: ${s.title}${s.revision ? `, ${s.revision}` : ""}${s.date ? `, ${s.date}` : ""}${s.scale ? `, scale ${s.scale}` : ", scale not stated"}`,
    );
  lines.push("", "Spec sections");
  if (!review.specs.length) lines.push("- No spec section was sent.");
  for (const s of review.specs) {
    lines.push(`- ${s.section} ${s.title}`);
    if (s.part1) lines.push(`  Part 1 submittals: ${s.part1}`);
    if (s.part2) lines.push(`  Part 2 products: ${s.part2}`);
    if (s.part3) lines.push(`  Part 3 execution: ${s.part3}`);
  }
  lines.push("", "Spec requires / drawing shows");
  if (!review.pairs.length)
    lines.push("- No spec-versus-drawing pair was sent. The estimator still has to match them.");
  for (const p of review.pairs)
    lines.push(
      `- Spec ${p.spec_section} requires: ${p.requirement}. Drawing ${p.sheet}${p.detail ? " " + p.detail : ""} shows: ${p.drawing_shows ?? "not shown"}.`,
    );
  const unmatched = review.specs.filter(
    (s) => !review.pairs.some((p) => p.spec_section === s.section),
  );
  for (const s of unmatched)
    lines.push(`- Spec ${s.section} is on file and is not yet matched to a drawing.`);
  lines.push("", `Job context: ${review.context?.trim() || "not stated"}.`);
  return {
    text: frame("Estimate Analysis", lines),
    structured: {
      report: "Estimate Analysis",
      layout: estimateLayout(),
      sheets: review.sheets,
      pairs: review.pairs,
    },
    guidance: ["Use only the pairs in this result. Do not invent a conflict that is not listed."],
  };
}

export function renderTakeoff(
  job: string,
  linesIn: StoredLine[],
  state: ReturnType<typeof settle>,
  revision: string,
  saveMode?: "upsert" | "replace",
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  const ordered = [...linesIn].sort(
    (a, b) =>
      rank({ unit: a.unit, title: a.item }) - rank({ unit: b.unit, title: b.item }) ||
      a.line_no - b.line_no,
  );
  const rows = ordered
    .map((l) => state.items.find((i) => i.ref === `T-${l.line_no}`))
    .filter((r): r is SettledView => Boolean(r));
  const narrative = takeoffNarrative(linesIn, state);
  const table = [
    "| # | Item | Unit | Qty | ± | Basis | Confidence | Math | Sheet / detail |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${cell(r.ref)} | ${cell(r.title)} | ${cell(r.unit ?? "")} | ${r.qty == null ? "" : cell(showQty(r.qty, r.unit))} | ${cell(r.range ?? "")} | ${r.basis ?? ""} | ${r.confidence ?? ""} | ${cell(r.math ?? "")} | ${cell(cite(r.sheet, r.detail))} |`,
    ),
  ];
  const checklist = state.checklist.filter((c) => c.state !== "not used");
  const sheetRows = sheetFrom(rows);
  const grouped = cleanCsv(groupedCsv(sheetRows));
  const text = frame("Takeoff", [
    `${job} · Takeoff`,
    coverageLine(linesIn),
    narrative,
    revision,
    countLine(state.counts),
    ...(saveMode === "upsert"
      ? ["This save added or updated lines. Lines you did not send are still on the takeoff."]
      : saveMode === "replace"
        ? ["This save replaced the takeoff. Only the lines in this call remain."]
        : []),
    "Each line",
    ...rows.map(
      (r) =>
        `- ${r.title} (${r.ref}). ${r.basis ?? "No basis"}. Sheet ${cite(r.sheet, r.detail)}. Math: ${r.math ?? "none"}.`,
    ),
    ...state.stale.map(
      (r) => `An earlier call on ${r} does not match the current item, so it is not applied.`,
    ),
    "",
    ...table,
    "",
    "Foundation scope",
    ...state.foundation.map((c) => `- ${c.label}: ${c.state}.`),
    "",
    "Concrete checklist",
    ...(checklist.length
      ? checklist.map((c) => `- ${c.label}: ${c.state}.`)
      : ["- Not required for this trade."]),
    "",
    "One fact each",
    "- Contact area is listed ahead of concrete and reinforcing.",
    "- A markup image is included only when a line names one.",
    "",
    ...takeoffCard(sheetRows),
    "",
    "Spreadsheet",
    "```",
    grouped,
    "```",
    "Next move: settle open lines, then send production and rates for labor.",
  ]);
  return {
    text,
    structured: {
      report: "Takeoff",
      layout: estimateLayout(),
      coverage: coverageLine(linesIn),
      counts: state.counts,
      lines: rows.map((r) => ({
        ...r,
        basis_label: r.basis,
        spec_term: r.basis === "MEASURED" ? "READ" : r.basis === "DEDUCED" ? "DERIVED" : null,
        verify: r.status === "open" || r.holdsBid || r.confidence === "low" || Boolean(r.missing),
      })),
      checklist: state.checklist,
      settled: state.settled,
      spreadsheet: { grouped_csv: grouped, xlsx_base64: bytesToBase64(takeoffXlsx(sheetRows)) },
    },
    guidance: [
      "Show the takeoff card grouped by trade or system, with MEASURED or DEDUCED and a Verify flag. Offer the CSV and the xlsx from spreadsheet.",
      "Show basis_label. READ means MEASURED. DERIVED means DEDUCED.",
      "Do not price a final bid from this takeoff until settled is true.",
    ],
  };
}

function sheetFrom(rows: SettledView[]): SheetRow[] {
  return rows.map((r) => ({
    group: (r.trade || r.element || "General").trim() || "General",
    ref: r.ref,
    item: r.title,
    unit: r.unit ?? "",
    qty: r.qty == null ? "" : showQty(r.qty, r.unit),
    basis: r.basis ?? "",
    verify:
      r.status === "open" || r.holdsBid || r.confidence === "low" || r.missing ? "Verify" : "",
    math: r.math ?? "",
    sheet: cite(r.sheet, r.detail),
    spec: r.spec ?? "",
  }));
}

function takeoffNarrative(lines: StoredLine[], state: ReturnType<typeof settle>): string {
  const blanks = lines.filter((l) => l.qty == null && l.missing_input).length;
  const low = lines.filter((l) => l.qty != null && l.confidence === "low").length;
  return `This takeoff has ${lines.length} lines and ${blanks} blank${blanks === 1 ? "" : "s"}. ${low} quantified line${low === 1 ? " is" : "s are"} low confidence. ${state.blockers.length ? "The bid is held until the open items close." : "No open item is holding the bid."}`;
}

export function renderGaps(
  job: string,
  gaps: StoredGap[],
  state: ReturnType<typeof settle>,
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  const seen = gaps.filter((g) => g.kind === "seen");
  const verify = gaps.filter((g) => g.kind === "verify");
  const lineFor = (g: StoredGap) => {
    const item = state.items.find((i) => i.ref === g.ref);
    const flag = g.holds_bid ? " Holds the bid." : "";
    const call = item?.mark ? ` Estimator call: ${markWord(item.mark)}.` : "";
    return `- ${g.ref}. ${g.title}. ${SEVERITY_LABEL[g.severity]}. ${CATEGORY_LABEL[g.category]}. Sheet ${cite(g.sheet, g.detail)}. Spec ${g.spec_section}. ${g.reasoning}${flag}${call}`;
  };
  const punch = gaps.filter((g) => g.holds_bid);
  const text = frame("Estimate Analysis", [
    `${job} · Estimate Analysis`,
    "Seen and quantified",
    ...(seen.length ? seen.map(lineFor) : ["- None."]),
    "",
    "Needs estimator verification",
    ...(verify.length ? verify.map(lineFor) : ["- None."]),
    "",
    REQUIREMENT_OPEN_LIST,
    "",
    "Punch list",
    ...(punch.length
      ? punch.map((g, i) => `- P${i + 1}. ${g.title}. Sheet ${g.sheet}. Spec ${g.spec_section}.`)
      : ["- No item holds the bid."]),
    "",
    countLine(state.counts),
  ]);
  return {
    text,
    structured: {
      report: "Estimate Analysis",
      layout: estimateLayout(),
      gaps,
      counts: state.counts,
    },
    guidance: [
      "Cite the sheet and the spec section from this result. Do not add a gap that is not listed.",
    ],
  };
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2),
  );
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}
function qtyClose(unit: string | null, a: number, b: number): boolean {
  const u = (unit ?? "").toUpperCase();
  if (u === "EA") return a === b;
  const band = u === "CY" ? 0.1 : 0.05;
  const base = Math.max(Math.abs(b), 1e-9);
  return Math.abs(a - b) / base <= band;
}

export function checkBids(
  bids: SubBid[],
  lines: StoredLine[],
): {
  rows: {
    sub: string;
    trade: string;
    description: string;
    status: "covered" | "partial" | "missing" | "extra";
    reason: string;
    exclusion: string | null;
  }[];
  totals: { sub: string; line: string }[];
  questions: string[];
} {
  const rows: {
    sub: string;
    trade: string;
    description: string;
    status: "covered" | "partial" | "missing" | "extra";
    reason: string;
    exclusion: string | null;
  }[] = [];
  const totals: { sub: string; line: string }[] = [];
  const questions: string[] = [];
  for (const bid of bids) {
    const pool = lines.filter((l) => inTrade(l, bid.trade));
    const search = pool.length ? pool : lines;
    const used = new Set<number>();
    let sumCents = 0;
    let missingAmt = 0;
    for (const bl of bid.lines) {
      if (bl.amount == null) missingAmt++;
      else sumCents += Math.round(bl.amount * 100);
      let best: StoredLine | null = null;
      let score = 0;
      for (const line of search) {
        const s = overlap(tokens(bl.description), tokens(line.item));
        if (s > score) {
          score = s;
          best = line;
        }
      }
      if (!best || score === 0) {
        rows.push({
          sub: bid.sub,
          trade: bid.trade,
          description: bl.description,
          status: "extra",
          reason: "No takeoff line matches this bid line.",
          exclusion: bl.exclusion,
        });
      } else {
        used.add(best.line_no);
        const unitOk = !bl.unit || !best.unit || bl.unit.toUpperCase() === best.unit.toUpperCase();
        const qtyOk = bl.qty != null && best.qty != null && qtyClose(best.unit, bl.qty, best.qty);
        const status = unitOk && qtyOk ? "covered" : "partial";
        const reason = !unitOk
          ? "Unit does not match the takeoff."
          : bl.qty == null || best.qty == null
            ? "Quantity is missing on one side."
            : qtyOk
              ? "Quantity is inside the band."
              : "Quantity is outside the band (count exact, length and area 5 percent, volume 10 percent).";
        rows.push({
          sub: bid.sub,
          trade: bid.trade,
          description: bl.description,
          status,
          reason:
            `${reason} Takeoff ${best.item} is ${best.qty ?? "blank"} ${best.unit ?? ""}.`.replace(
              /\s+/g,
              " ",
            ),
          exclusion: bl.exclusion,
        });
      }
      if (bl.exclusion)
        questions.push(
          `${bid.sub}: the exclusion "${bl.exclusion}" on ${bl.description} is pushed back. Who carries it?`,
        );
    }
    const sum = sumCents / 100;
    for (const line of pool) {
      if (line.qty == null || used.has(line.line_no)) continue;
      rows.push({
        sub: bid.sub,
        trade: bid.trade,
        description: line.item,
        status: "missing",
        reason: "The takeoff has this quantity and the bid does not.",
        exclusion: null,
      });
      questions.push(
        `${bid.sub}: ${line.item} is on the takeoff and not on the bid. Is it in your number?`,
      );
    }
    if (bid.total == null || missingAmt)
      totals.push({
        sub: bid.sub,
        line: `The total can't be checked. ${missingAmt ? `${missingAmt} line amount${missingAmt === 1 ? " is" : "s are"} missing.` : "No stated total."}`,
      });
    else if (Math.round(sum * 100) === Math.round(bid.total * 100))
      totals.push({ sub: bid.sub, line: `Total ${money(bid.total)} ties to the lines.` });
    else
      totals.push({
        sub: bid.sub,
        line: `Doesn't tie: off by ${money(Math.abs(bid.total - sum))}. Stated ${money(bid.total)}. Lines ${money(sum)}.`,
      });
  }
  return { rows, totals, questions };
}
function inTrade(line: StoredLine, trade: string): boolean {
  if (line.trade && tradeMatch(line.trade, trade)) return true;
  if (line.element && tradeMatch(line.element, trade)) return true;
  return false;
}
function tradeMatch(a: string, b: string): boolean {
  const da = divisionOf(a);
  const db = divisionOf(b);
  if (da && db) return da === db;
  return tokens(a).size > 0 && overlap(tokens(a), tokens(b)) > 0;
}

export function renderBidCheck(
  job: string,
  role: Setup["role"],
  result: ReturnType<typeof checkBids> | null,
  reason: string | null,
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  if (!result) {
    return {
      text: frame("Estimate Analysis", [`${job} · Bid check`, reason ?? "Nothing was checked."]),
      structured: { report: "Estimate Analysis", layout: estimateLayout(), checked: false },
      guidance: ["Bid check is only for a general contractor. Do not invent a sub number."],
    };
  }
  const lines = [
    `${job} · Bid check`,
    ...result.rows.map(
      (r) =>
        `- ${r.sub} · ${r.description}: ${r.status}. ${r.reason}${r.exclusion ? ` Exclusion pushed back: ${r.exclusion}.` : ""}`,
    ),
    "",
    "Totals",
    ...result.totals.map((t) => `- ${t.sub}: ${t.line}`),
    "",
    "Questions for the estimator",
    ...(result.questions.length
      ? result.questions.map((q, i) => `- Q${i + 1}. ${q}`)
      : ["- None."]),
    "",
    "These questions stay with the estimator. Not sent.",
  ];
  return {
    text: frame("Estimate Analysis", lines),
    structured: { report: "Estimate Analysis", layout: estimateLayout(), role, ...result },
    guidance: ["Show the question list to the estimator. Do not send it anywhere."],
  };
}

export type RateIn = {
  line_no?: number | null;
  item?: string | null;
  trade?: string | null;
  system?: string | null;
  cost_type?: "labor" | "material" | "equipment" | "sub" | "other" | null;
  rate?: number | null;
  bought?: boolean | null;
};
const COST_LABEL = {
  labor: "Labor",
  material: "Material",
  equipment: "Equipment",
  sub: "Sub",
  other: "Other",
} as const;

export function buildSummary(
  items: SettledView[],
  rates: RateIn[],
): {
  rows: {
    ref: string;
    title: string;
    trade: string;
    system: string;
    cost: string;
    bought: string;
    qty: string;
    rate: string;
    extension: string | null;
  }[];
  missingFlags: string[];
} {
  const priced = items.filter((i) => i.kind === "line" && i.status !== "dropped");
  const rows = priced.map((item) => {
    const rate = rates.find(
      (r) =>
        (r.line_no != null && r.line_no === Number(item.ref.slice(2))) ||
        (r.item && overlap(tokens(r.item), tokens(item.title)) > 0),
    );
    const qty = item.qty;
    const rateN = rate?.rate ?? null;
    const extension =
      qty != null && rateN != null ? money(Math.round(qty * rateN * 100) / 100) : null;
    return {
      ref: item.ref,
      title: item.title,
      trade: rate?.trade || item.trade || item.element,
      system: rate?.system || item.element,
      cost: rate?.cost_type ? COST_LABEL[rate.cost_type] : "Not stated",
      bought:
        rate?.bought === true ? "Bought" : rate?.bought === false ? "Still to buy" : "Not stated",
      qty: qty == null ? "" : `${showQty(qty, item.unit)} ${item.unit ?? ""}`.trim(),
      rate: rateN == null ? "Rate needed" : money(rateN),
      extension,
    };
  });
  const blob = priced
    .map((i) => `${i.title} ${i.element}`)
    .join(" ")
    .toLowerCase();
  const flags = [
    ["general conditions", "General conditions"],
    ["permit", "Permits"],
    ["temporary", "Temporary work"],
    ["cleanup", "Cleanup"],
  ]
    .filter(([k]) => !blob.includes(k))
    .map(([, label]) => label);
  return { rows, missingFlags: flags };
}

export function renderSummary(
  job: string,
  state: ReturnType<typeof settle>,
  rates: RateIn[],
  revision: string,
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  if (!state.settled) {
    const openGaps = state.items.filter((i) => i.kind === "gap" && i.status === "open");
    return {
      text: frame("Estimate Summary", [
        `${job} · Estimate summary, draft`,
        "The takeoff is not settled. This draft is not a bid.",
        revision,
        "Open gaps",
        ...(openGaps.length
          ? openGaps.map((g) => `- ${g.title} (${g.ref}). Sheet ${g.sheet}.`)
          : ["- No open gap rows."]),
        ...state.blockers.map((b) => `- ${b}`),
      ]),
      structured: {
        report: "Estimate Summary",
        draft: true,
        settled: false,
        open: state.blockers,
        layout: estimateLayout(),
      },
      guidance: ["Do not treat this draft as a bid. List every open gap."],
    };
  }
  const built = buildSummary(state.items, rates);
  const byTrade = new Map<string, typeof built.rows>();
  for (const row of built.rows) {
    const list = byTrade.get(row.trade) ?? [];
    list.push(row);
    byTrade.set(row.trade, list);
  }
  const lines = [
    `${job} · Estimate Summary`,
    revision,
    countLine(state.counts),
    "Quantities below are the settled takeoff. An extension is shown only where a rate was sent.",
    "",
  ];
  for (const [trade, rows] of byTrade) {
    lines.push(trade);
    for (const r of rows)
      lines.push(
        `- ${r.title} (${r.ref}). ${r.system}. ${r.cost}. ${r.bought}. Qty ${r.qty || "none"}. Rate ${r.rate}.${r.extension ? ` Extension ${r.extension}.` : ""}`,
      );
    lines.push("");
  }
  lines.push("Still to flag");
  if (built.missingFlags.length)
    for (const f of built.missingFlags) lines.push(`- ${f} is not on the takeoff.`);
  else
    lines.push(
      "- General conditions, permits, temporary work and cleanup are named on the takeoff.",
    );
  const risks = state.items.filter((i) => i.holdsBid);
  if (risks.length) {
    lines.push("", "Holds the bid");
    for (const r of risks) lines.push(`- ${r.title} (${r.ref}). Sheet ${r.sheet}.`);
  }
  return {
    text: frame("Estimate Summary", lines),
    structured: {
      report: "Estimate Summary",
      layout: estimateLayout(),
      rows: built.rows,
      missing: built.missingFlags,
      counts: state.counts,
    },
    guidance: [
      "Do not add a unit price. Use extension only when this result includes one. Landscape, logo top right.",
    ],
  };
}

export function renderStatus(
  job: string,
  state: ReturnType<typeof settle>,
  accuracy: { relevant: number; not_relevant: number; good_catch: number; calls: number },
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  const text = frame("Estimator loop", [
    `${job} · Estimator loop`,
    countLine(state.counts),
    state.settled ? "The takeoff is settled." : "The takeoff is not settled.",
    `Estimator calls on file for this company: ${accuracy.calls} (relevant ${accuracy.relevant}, not relevant ${accuracy.not_relevant}, good catch ${accuracy.good_catch}).`,
    "",
    "Open items",
    ...state.items
      .filter((i) => i.status === "open")
      .map((i) => `- ${i.title} (${i.ref}). ${i.followUp ?? ""}`),
    ...(state.items.some((i) => i.status === "open") ? [] : ["- None."]),
  ]);
  return {
    text,
    structured: {
      report: "Estimator loop",
      layout: estimateLayout(),
      counts: state.counts,
      settled: state.settled,
      accuracy,
      blockers: state.blockers,
    },
    guidance: [
      "Follow up on every open relevant or good-catch item until it has a quantity or an owner.",
    ],
  };
}

export function renderMark(
  job: string,
  item: SettledView | null,
  accuracy: { relevant: number; not_relevant: number; good_catch: number; calls: number },
  state: ReturnType<typeof settle>,
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  const lines = [
    NOT_RELEVANT_ASK,
    `${job} · Estimator loop`,
    item
      ? `${item.ref} ${item.title}: ${item.status}. ${item.followUp ?? item.note ?? ""}`
      : "That item is not on this estimate. Nothing was changed.",
    countLine(state.counts),
    `Estimator calls on file for this company: ${accuracy.calls} (relevant ${accuracy.relevant}, not relevant ${accuracy.not_relevant}, good catch ${accuracy.good_catch}).`,
  ];
  return {
    text: frame("Estimator loop", lines),
    structured: {
      report: "Estimator loop",
      layout: estimateLayout(),
      item,
      counts: state.counts,
      accuracy,
    },
    guidance: [
      "A not-relevant mark stays dropped only with the reason that was saved. Keep asking on relevant and good-catch items that have no quantity and no owner.",
    ],
  };
}

function csvCell(v: string): string {
  const flat = v.replace(/\r?\n/g, " ").trim();
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}
export function renderExport(
  job: string,
  lines: StoredLine[],
  format: "csv" | "workbook",
): { text: string; structured: Record<string, unknown>; guidance: string[] } {
  const ordered = [...lines].sort(
    (a, b) =>
      rank({ unit: a.unit, title: a.item }) - rank({ unit: b.unit, title: b.item }) ||
      a.line_no - b.line_no,
  );
  const simple = [
    "item,unit,qty",
    ...ordered.map((l) =>
      [l.item, l.unit ?? "", l.qty == null ? "" : showQty(l.qty, l.unit)].map(csvCell).join(","),
    ),
  ].join("\n");
  const book = [
    "item,material,qty,unit,range,basis,confidence,math,sheet,detail,spec,markup",
    ...ordered.map((l) =>
      [
        l.item,
        l.material ?? "",
        l.qty == null ? "" : showQty(l.qty, l.unit),
        l.unit ?? "",
        l.range_text ?? "",
        basisLabel(l.basis),
        l.confidence,
        l.math,
        l.sheet,
        l.detail ?? "",
        l.spec_section ?? "",
        l.markup_ref ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
  const body = cleanCsv(format === "csv" ? simple : book);
  const groupedRows: SheetRow[] = ordered.map((l) => ({
    group: (l.trade || l.element || "General").trim() || "General",
    ref: `T-${l.line_no}`,
    item: l.item,
    unit: l.unit ?? "",
    qty: l.qty == null ? "" : showQty(l.qty, l.unit),
    basis: basisLabel(l.basis),
    verify: l.qty == null || l.confidence === "low" || Boolean(l.missing_input) ? "Verify" : "",
    math: l.math,
    sheet: cite(l.sheet, l.detail),
    spec: l.spec_section ?? "",
  }));
  const grouped = cleanCsv(groupedCsv(groupedRows));
  return {
    text: frame("Takeoff", [
      `${job} · Takeoff export`,
      coverageLine(lines),
      ...takeoffCard(groupedRows),
      "",
      "```",
      body,
      "```",
      "",
      "Grouped spreadsheet",
      "```",
      grouped,
      "```",
    ]),
    structured: {
      report: "Takeoff",
      layout: estimateLayout(),
      format,
      csv: simple,
      workbook: book,
      spreadsheet: { grouped_csv: grouped, xlsx_base64: bytesToBase64(takeoffXlsx(groupedRows)) },
    },
    guidance: [
      "Build the sheet from this text. Do not add a quantity that is blank here. The xlsx bytes are on spreadsheet.",
    ],
  };
}

const num = (v: unknown): number | null =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseState(raw: unknown): {
  setup: Setup;
  lines: StoredLine[];
  gaps: StoredGap[];
  verdicts: StoredVerdict[];
  version: number | null;
  revision: string;
  accuracy: { relevant: number; not_relevant: number; good_catch: number; calls: number };
} {
  const o = (raw ?? {}) as Record<string, unknown>;
  const setupRaw = (o.setup ?? null) as Record<string, unknown> | null;
  const setup: Setup = {
    role: setupRaw?.role === "gc" || setupRaw?.role === "self_performer" ? setupRaw.role : null,
    trades: Array.isArray(setupRaw?.trades)
      ? (setupRaw!.trades as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
    bid_due: str(setupRaw?.bid_due),
    delivery_method: str(setupRaw?.delivery_method),
    documents: Array.isArray(setupRaw?.documents) ? (setupRaw!.documents as Doc[]) : [],
    sub_bids: Array.isArray(setupRaw?.sub_bids) ? (setupRaw!.sub_bids as SubBid[]) : [],
    workbook_note: str(setupRaw?.workbook_note),
    in_scope: Array.isArray(setupRaw?.in_scope) ? (setupRaw!.in_scope as string[]) : [],
    out_scope: Array.isArray(setupRaw?.out_scope) ? (setupRaw!.out_scope as string[]) : [],
    assumptions: Array.isArray(setupRaw?.assumptions) ? (setupRaw!.assumptions as string[]) : [],
    doc_review: (setupRaw?.doc_review as DocReview | null) ?? null,
    summary_version: num(setupRaw?.summary_version),
  };
  const takeoff = (o.takeoff ?? null) as {
    version?: number;
    revision?: string | null;
    lines?: Record<string, unknown>[];
  } | null;
  const lines: StoredLine[] = (takeoff?.lines ?? []).map((l) => ({
    line_no: Number(l.line_no),
    item: String(l.item ?? ""),
    material: str(l.material),
    qty: num(l.qty),
    unit: str(l.unit),
    range_text: str(l.range_text),
    measure_type:
      l.measure_type === "count" ||
      l.measure_type === "linear" ||
      l.measure_type === "area" ||
      l.measure_type === "volume"
        ? l.measure_type
        : null,
    sheet: String(l.sheet ?? ""),
    detail: str(l.detail),
    spec_section: str(l.spec_section),
    basis: l.basis === "deduced" ? "deduced" : "measured",
    math: String(l.math ?? ""),
    confidence: l.confidence === "low" || l.confidence === "medium" ? l.confidence : "high",
    markup_ref: str(l.markup_ref),
    location_text: str(l.location_text),
    missing_input: str(l.missing_input),
    exclusion: str(l.exclusion),
    checklist_key: str(l.checklist_key),
    element: str(l.element),
    trade: str(l.trade),
    note: str(l.note),
    inputs: Array.isArray(l.inputs) ? (l.inputs as QtyInput[]) : [],
  }));
  const gaps: StoredGap[] = ((o.gaps as Record<string, unknown>[]) ?? []).map((g) => ({
    ref: String(g.ref),
    kind: g.kind === "seen" ? "seen" : "verify",
    category: (g.category as StoredGap["category"]) ?? "conflict",
    severity: g.severity === "hard" || g.severity === "cannot_know" ? g.severity : "soft",
    title: String(g.title ?? ""),
    reasoning: String(g.reasoning ?? ""),
    sheet: String(g.sheet ?? ""),
    detail: str(g.detail),
    spec_section: String(g.spec_section ?? ""),
    holds_bid: g.holds_bid === true,
    qty: num(g.qty),
    unit: str(g.unit),
    element: str(g.element),
    line_no: num(g.line_no),
  }));
  const verdicts: StoredVerdict[] = ((o.verdicts as Record<string, unknown>[]) ?? []).map((v) => ({
    item_kind: v.item_kind === "gap" ? "gap" : "line",
    line_no: num(v.line_no),
    gap_ref: str(v.gap_ref),
    item_text: String(v.item_text ?? ""),
    mark: v.mark === "not_relevant" || v.mark === "good_catch" ? v.mark : "relevant",
    note: str(v.note),
    corrected_qty: num(v.corrected_qty),
    owner: str(v.owner),
    created_at: String(v.created_at ?? ""),
  }));
  const accuracyRaw = (o.accuracy ?? {}) as Record<string, unknown>;
  return {
    setup,
    lines,
    gaps,
    verdicts,
    version: takeoff?.version ?? null,
    revision: str(takeoff?.revision) ?? revisionUsed(setup.documents),
    accuracy: {
      relevant: Number(accuracyRaw.relevant ?? 0),
      not_relevant: Number(accuracyRaw.not_relevant ?? 0),
      good_catch: Number(accuracyRaw.good_catch ?? 0),
      calls: Number(accuracyRaw.calls ?? 0),
    },
  };
}
