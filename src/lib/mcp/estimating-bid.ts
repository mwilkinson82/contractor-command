// Bid walkthrough. Rates are the contractor's figures or a PLACEHOLDER they confirm.
// RSMeans and NECA labor units are licensed: this file has no published tables and no city indexes.
import type { Doc, DocReview, GapIn, Setup } from "./estimating";
import { money } from "./sov";

export class BidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BidError";
  }
}

export const METROS = [
  "NYC",
  "Chicago",
  "Miami",
  "Austin",
  "Dallas",
  "LA",
  "SF",
  "Boston",
  "Philly",
  "DC",
] as const;
export const WORK_TYPES = ["commercial", "residential", "industrial", "healthcare"] as const;
export const RATE_SOURCE_IDS = ["rsmeans", "neca", "smacna", "mcaa"] as const;
export type RateSourceId = (typeof RATE_SOURCE_IDS)[number];

export const RATE_SOURCE_LABEL: Record<RateSourceId, string> = {
  rsmeans: "RSMeans",
  neca: "NECA labor units",
  smacna: "SMACNA",
  mcaa: "MCAA",
};

const cents = (n: number) => Math.round(n * 100) / 100;

export type LaborIn = {
  ref: string;
  production_per_man_hour?: number | null;
  man_hours?: number | null;
  man_days?: number | null;
  crew_size?: number | null;
  hours_per_day?: number | null;
  hourly_rate?: number | null;
  crew_rate?: number | null;
  confirmed?: boolean;
  apply_factor?: boolean;
  source?: RateSourceId | null;
};

export type LaborOut = {
  ref: string;
  manHours: number | null;
  manDays: number | null;
  labor: number | null;
  math: string;
  missing: string | null;
  placeholder: boolean;
};

function pos(n: number | null | undefined, label: string): number | null {
  if (n == null) return null;
  if (!Number.isFinite(n) || n < 0)
    throw new BidError(`${label} can't be negative. Nothing was saved.`);
  return n;
}

/** Labor dollars from the contractor's production and rates. No assumed day length. */
export function priceLabor(qty: number | null, unit: string | null, input: LaborIn): LaborOut {
  const production = pos(input.production_per_man_hour, "Production");
  const enteredHours = pos(input.man_hours, "Man-hours");
  const enteredDays = pos(input.man_days, "Man-days");
  const crew = pos(input.crew_size, "Crew size");
  const dayHours = pos(input.hours_per_day, "Hours in a day");
  const hourly = pos(input.hourly_rate, "Hourly rate");
  const crewRate = pos(input.crew_rate, "Crew rate");
  if (production === 0)
    throw new BidError("Production per man-hour can't be zero. Nothing was saved.");
  if (dayHours === 0) throw new BidError("Hours in a day can't be zero. Nothing was saved.");
  if (crew === 0) throw new BidError("Crew size can't be zero. Nothing was saved.");

  let manHours: number | null = enteredHours;
  let hoursMath = "";
  if (manHours == null && qty != null && production != null) {
    manHours = cents(qty / production);
    hoursMath =
      `Man-hours: ${qty} ${unit ?? ""} / ${production} per man-hour = ${manHours}.`.replace(
        /\s+/g,
        " ",
      );
  } else if (manHours != null) {
    hoursMath = `Man-hours: ${manHours} entered by the contractor.`;
  }

  let manDays: number | null = enteredDays;
  let daysMath = "";
  if (manDays == null && manHours != null && crew != null && dayHours != null) {
    manDays = cents(manHours / (crew * dayHours));
    daysMath = `Man-days: ${manHours} / (${crew} × ${dayHours}) = ${manDays}.`;
  } else if (manDays != null) {
    daysMath = `Man-days: ${manDays} entered by the contractor.`;
  }

  let labor: number | null = null;
  let payMath = "";
  if (manHours != null && hourly != null) {
    labor = cents(manHours * hourly);
    payMath = `Labor: ${manHours} × ${money(hourly)} = ${money(labor)}.`;
  } else if (manHours != null && crewRate != null && crew != null) {
    const crewHours = cents(manHours / crew);
    labor = cents(crewHours * crewRate);
    payMath = `Labor: ${manHours} man-hours / crew of ${crew} = ${crewHours} crew-hours × ${money(crewRate)} = ${money(labor)}.`;
  }

  const missing =
    qty == null && manHours == null
      ? "quantity"
      : manHours == null
        ? "production per man-hour"
        : labor == null
          ? "hourly rate or blended crew rate"
          : null;
  const placeholder = !input.confirmed && (hourly != null || crewRate != null);
  const stamp = placeholder
    ? " PLACEHOLDER until the contractor confirms it. Not a published rate."
    : input.confirmed
      ? " Confirmed by the contractor."
      : "";
  const math =
    [hoursMath, daysMath, payMath].filter(Boolean).join(" ") +
    (missing ? ` Missing: ${missing}.` : "") +
    stamp;
  return { ref: input.ref, manHours, manDays, labor, math: math.trim(), missing, placeholder };
}

export function priceMaterial(
  qty: number | null,
  unitPrice: number | null,
  confirmed: boolean,
): { material: number | null; math: string; missing: string | null; placeholder: boolean } {
  const price = pos(unitPrice, "Material price");
  if (qty == null)
    return {
      material: null,
      math: "Material needs a quantity.",
      missing: "quantity",
      placeholder: false,
    };
  if (price == null)
    return {
      material: null,
      math: "Material price was not sent.",
      missing: "material price",
      placeholder: false,
    };
  const material = cents(qty * price);
  const placeholder = !confirmed;
  return {
    material,
    math: `Material: ${qty} × ${money(price)} = ${money(material)}.${placeholder ? " PLACEHOLDER until the contractor confirms it. Not a published price." : " Confirmed by the contractor."}`,
    missing: null,
    placeholder,
  };
}

export function basisCheck(
  labor: number | null,
  material: number | null,
  quote: number | null,
): { basis: number | null; flag: "high" | "low" | "even" | "open"; line: string } {
  if (labor == null || material == null) {
    return {
      basis: null,
      flag: "open",
      line: "The labor plus material basis is incomplete, so this quote is not marked high or low.",
    };
  }
  const basis = cents(labor + material);
  if (quote == null)
    return { basis, flag: "open", line: `Basis ${money(basis)}. No sub quote was sent.` };
  const delta = cents(quote - basis);
  if (delta === 0)
    return {
      basis,
      flag: "even",
      line: `Quote ${money(quote)} matches the basis ${money(basis)}.`,
    };
  if (delta > 0)
    return {
      basis,
      flag: "high",
      line: `High against the basis by ${money(delta)}. Quote ${money(quote)}. Basis ${money(basis)}. Holds the bid.`,
    };
  return {
    basis,
    flag: "low",
    line: `Low against the basis by ${money(Math.abs(delta))}. Quote ${money(quote)}. Basis ${money(basis)}.`,
  };
}

export type RateChoice = {
  source: RateSourceId;
  carry: boolean;
  metro?: string | null;
  location_factor?: number | null;
  work_type?: string | null;
  work_factor?: number | null;
  confirmed?: boolean;
};

export function describeRateChoice(c: RateChoice): string {
  const label = RATE_SOURCE_LABEL[c.source];
  if (!c.carry) return `${label}: not carried.`;
  const bits = [label];
  if (c.metro) bits.push(c.metro);
  if (c.work_type) bits.push(c.work_type);
  const factor =
    c.location_factor == null && c.work_factor == null
      ? "No factor was sent, so none is applied."
      : `Factor ${c.location_factor ?? "none"} location, ${c.work_factor ?? "none"} work type.`;
  const stamp = c.confirmed
    ? "Confirmed by the contractor."
    : "PLACEHOLDER until the contractor confirms the factor. Not a published index.";
  return `${bits.join(", ")}. ${factor} ${stamp}`;
}

export function applyFactors(
  amount: number,
  choice: RateChoice | null,
): { amount: number; note: string } {
  if (!choice?.carry) return { amount, note: "" };
  let out = amount;
  const parts: string[] = [];
  if (choice.location_factor != null) {
    out = cents(out * choice.location_factor);
    parts.push(`× ${choice.location_factor} location`);
  }
  if (choice.work_factor != null) {
    out = cents(out * choice.work_factor);
    parts.push(`× ${choice.work_factor} work type`);
  }
  if (!parts.length) return { amount, note: "" };
  const stamp = choice.confirmed
    ? "Confirmed by the contractor."
    : "PLACEHOLDER. Not a published index.";
  return { amount: out, note: `${parts.join(" ")} = ${money(out)}. ${stamp}` };
}

export const GC_ITEMS = [
  { key: "trailer", label: "Trailer" },
  { key: "office", label: "Office staff and assistants" },
  { key: "cad", label: "CAD" },
  { key: "water", label: "Water" },
  { key: "supplies", label: "Printer, desk and supplies" },
  { key: "supervision", label: "Supervision" },
] as const;

export function calendarDays(start: string, finish: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${finish}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
    throw new BidError("The finish date is before the start. Nothing was saved.");
  return Math.round((b - a) / 86400000) + 1;
}

export function gcLineAmount(input: {
  key: string;
  amount?: number | null;
  qty?: number | null;
  rate?: number | null;
  duration?: number | null;
  confirmed?: boolean;
}): { amount: number | null; math: string; missing: string | null; placeholder: boolean } {
  const label = GC_ITEMS.find((g) => g.key === input.key)?.label ?? input.key;
  const amount = pos(input.amount, label);
  const qty = pos(input.qty, label);
  const rate = pos(input.rate, label);
  const duration = pos(input.duration, "Schedule duration");
  if (input.key === "supervision") {
    if (duration == null)
      return {
        amount: null,
        math: `${label} needs the schedule duration.`,
        missing: "schedule duration",
        placeholder: false,
      };
    if (rate == null && amount == null)
      return {
        amount: null,
        math: `${label} needs a rate for that duration.`,
        missing: "supervision rate",
        placeholder: false,
      };
    const value = amount ?? cents(duration * (rate as number));
    const placeholder = !input.confirmed;
    return {
      amount: value,
      math:
        amount != null
          ? `${label}: ${money(value)} entered for ${duration} days.${placeholder ? " PLACEHOLDER." : " Confirmed by the contractor."}`
          : `${label}: ${duration} days × ${money(rate as number)} = ${money(value)}.${placeholder ? " PLACEHOLDER until the contractor confirms it." : " Confirmed by the contractor."}`,
      missing: null,
      placeholder,
    };
  }
  if (amount != null) {
    return {
      amount,
      math: `${label}: ${money(amount)}.${!input.confirmed ? " PLACEHOLDER until the contractor confirms it." : " Confirmed by the contractor."}`,
      missing: null,
      placeholder: !input.confirmed,
    };
  }
  if (qty != null && rate != null) {
    const value = cents(qty * rate);
    return {
      amount: value,
      math: `${label}: ${qty} × ${money(rate)} = ${money(value)}.${!input.confirmed ? " PLACEHOLDER until the contractor confirms it." : " Confirmed by the contractor."}`,
      missing: null,
      placeholder: !input.confirmed,
    };
  }
  return {
    amount: null,
    math: `${label} needs a figure from the contractor.`,
    missing: label,
    placeholder: false,
  };
}

/** Examples the scan recognizes. Not a closed set. */
export const REQUIREMENT_KINDS = [
  "consultants",
  "testing",
  "arborist",
  "specialty_report",
  "permits",
  "special_safety",
  "site_safety",
  "scheduler",
  "security",
] as const;
export type RequirementKind = string;

const REQUIREMENT_RULES: { kind: string; label: string; re: RegExp; gcOnly?: boolean }[] = [
  { kind: "consultants", label: "Consultants", re: /\bconsultants?\b|third[- ]party/i },
  {
    kind: "testing",
    label: "Testing and special inspections",
    re: /special inspections?|testing laboratory|inspection agency|material testing/i,
  },
  { kind: "arborist", label: "Arborist", re: /\barborists?\b/i },
  {
    kind: "specialty_report",
    label: "Specialty testing or reports",
    re: /specialty (testing|report)/i,
  },
  { kind: "permits", label: "Permits", re: /\bpermits?\b/i },
  {
    kind: "special_safety",
    label: "Special safety requirements",
    re: /special safety|site safety plan/i,
  },
  {
    kind: "site_safety",
    label: "Full-time site safety person",
    re: /full[- ]time site safety|site safety (person|officer|manager)/i,
  },
  {
    kind: "scheduler",
    label: "Full-time CPM scheduler",
    re: /full[- ]time\s+(cpm\s+)?scheduler|cpm scheduler/i,
  },
  { kind: "security", label: "Security", re: /\bsecurity\b/i, gcOnly: true },
];

export type RequirementHit = {
  kind: string;
  label: string;
  description: string | null;
  sourceType: "sheet" | "spec" | "contract";
  sourceRef: string;
  citation: string;
  gcOnly: boolean;
};

/** A free-form category, or other plus a description. The example list is not required. */
export function normalizeRequirement(input: {
  kind: string;
  title?: string | null;
  description?: string | null;
}): { kind: string; label: string; description: string | null } {
  const raw = input.kind
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  const description = (input.description ?? "").trim() || null;
  const title = (input.title ?? "").trim();
  if (!raw || raw === "other") {
    if (!description)
      throw new BidError("A requirement marked other needs a description. Nothing was saved.");
    return { kind: "other", label: description.slice(0, 200), description };
  }
  const rule = REQUIREMENT_RULES.find((r) => r.kind === raw);
  return {
    kind: raw,
    label: (title || description || rule?.label || input.kind.trim()).slice(0, 200),
    description,
  };
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    0,
    text.lastIndexOf(".", index - 1) + 1,
    text.lastIndexOf("\n", index - 1) + 1,
  );
  let end = text.indexOf(".", index + 1);
  if (end < 0) end = Math.min(text.length, index + 180);
  else end += 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 240);
}

export function scanText(
  text: string,
  sourceType: RequirementHit["sourceType"],
  sourceRef: string,
): RequirementHit[] {
  const hits: RequirementHit[] = [];
  const seen = new Set<string>();
  for (const rule of REQUIREMENT_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const key = `${rule.kind}|${sourceType}|${sourceRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      kind: rule.kind,
      label: rule.label,
      description: null,
      sourceType,
      sourceRef,
      citation: sentenceAround(text, m.index),
      gcOnly: Boolean(rule.gcOnly),
    });
  }
  return hits;
}

export function scanProject(input: {
  setup: Setup | null;
  clauses?: { section: string; verbatim_text: string }[];
  findings?: {
    title: string;
    kind: string;
    description?: string | null;
    source_type: RequirementHit["sourceType"];
    source_ref: string;
    citation: string;
  }[];
}): RequirementHit[] {
  const hits: RequirementHit[] = [];
  const review: DocReview | null = input.setup?.doc_review ?? null;
  for (const sheet of review?.sheets ?? []) {
    const text = [sheet.title, ...(sheet.notes ?? []), ...(sheet.schedules ?? [])].join(". ");
    hits.push(...scanText(text, "sheet", sheet.sheet));
  }
  for (const spec of review?.specs ?? []) {
    const text = [spec.title, spec.part1, spec.part2, spec.part3].filter(Boolean).join(". ");
    hits.push(...scanText(text, "spec", spec.section));
  }
  for (const pair of review?.pairs ?? []) {
    hits.push(
      ...scanText(`${pair.requirement}. ${pair.drawing_shows ?? ""}`, "spec", pair.spec_section),
    );
  }
  for (const doc of input.setup?.documents ?? []) {
    hits.push(...scanText(doc.name, doc.kind === "spec" ? "spec" : "sheet", doc.name.slice(0, 80)));
  }
  for (const clause of input.clauses ?? []) {
    hits.push(...scanText(clause.verbatim_text, "contract", clause.section));
  }
  for (const f of input.findings ?? []) {
    const named = normalizeRequirement(f);
    const rule = REQUIREMENT_RULES.find((r) => r.kind === named.kind);
    hits.push({
      kind: named.kind,
      label: named.label,
      description: named.description,
      sourceType: f.source_type,
      sourceRef: f.source_ref,
      citation: f.citation,
      gcOnly: Boolean(rule?.gcOnly),
    });
  }
  const uniq = new Map<string, RequirementHit>();
  for (const h of hits) uniq.set(`${h.kind}|${h.sourceType}|${h.sourceRef}`, h);
  return [...uniq.values()];
}

export function requirementGaps(hits: RequirementHit[], role: Setup["role"]): GapIn[] {
  return hits.map((h) => {
    const where =
      h.sourceType === "contract"
        ? `Contract clause ${h.sourceRef}`
        : h.sourceType === "spec"
          ? `Spec ${h.sourceRef}`
          : `Sheet ${h.sourceRef}`;
    const gcNote =
      h.gcOnly && role === "self_performer"
        ? " Security is a general-contractor item unless you confirm you carry it."
        : "";
    const sheet =
      h.sourceType === "sheet" ? h.sourceRef.slice(0, 80) : `Clause ${h.sourceRef}`.slice(0, 80);
    const spec =
      h.sourceType === "spec"
        ? h.sourceRef.slice(0, 80)
        : h.sourceType === "contract"
          ? h.sourceRef.slice(0, 80)
          : "not in a spec section";
    return {
      kind: "verify" as const,
      category: "scope_seam" as const,
      severity:
        h.kind === "permits" || h.kind === "special_safety" || h.kind === "site_safety"
          ? ("hard" as const)
          : ("soft" as const),
      title: h.label,
      reasoning: `${h.label} is separate from installation labor and material. ${where}. ${h.citation}${gcNote} Price it or confirm it. Sheet ${sheet}. Spec ${spec}.`,
      sheet,
      spec_section: spec,
      holds_bid: h.kind === "permits" || h.kind === "special_safety",
      element: "Special requirements",
    };
  });
}

export type RequirementPrice = {
  ref: string;
  kind: string;
  description: string | null;
  label: string;
  sourceType: RequirementHit["sourceType"];
  sourceRef: string;
  citation: string;
  placement: "gc" | "own_line";
  amount: number | null;
  confirmed: boolean;
  excluded: boolean;
};

export function priceRequirement(
  hit: RequirementHit,
  entered:
    | {
        amount?: number | null;
        confirmed?: boolean;
        placement?: "gc" | "own_line";
        excluded?: boolean;
      }
    | undefined,
  index: number,
): RequirementPrice {
  const amount = pos(entered?.amount, hit.label);
  return {
    ref: `R-${index}`,
    kind: hit.kind,
    description: hit.description,
    label: hit.label,
    sourceType: hit.sourceType,
    sourceRef: hit.sourceRef,
    citation: hit.citation,
    placement: entered?.placement ?? "own_line",
    amount,
    confirmed: Boolean(entered?.confirmed) && amount != null,
    excluded: Boolean(entered?.excluded),
  };
}

export function compoundOhp(
  base: number,
  overheadPct: number,
  profitPct: number,
): { overhead: number; profit: number; total: number; effectivePct: number; math: string } {
  if (overheadPct < 0 || profitPct < 0)
    throw new BidError("Overhead and profit can't be negative. Nothing was saved.");
  const overhead = cents(base * (overheadPct / 100));
  const after = cents(base + overhead);
  const profit = cents(after * (profitPct / 100));
  const total = cents(after + profit);
  const effectivePct = base === 0 ? 0 : cents(((total - base) / base) * 100);
  return {
    overhead,
    profit,
    total,
    effectivePct,
    math: `Overhead ${overheadPct}% of ${money(base)} = ${money(overhead)}. Profit ${profitPct}% of ${money(after)} = ${money(profit)}. Total ${money(total)}. Combined ${effectivePct}%.`,
  };
}

export type BidPiece = {
  label: string;
  amount: number | null;
  placeholder: boolean;
  risk: boolean;
  note: string;
};

const sourceLabel = (t: "sheet" | "spec" | "contract") =>
  t === "contract" ? "Contract clause" : t === "spec" ? "Spec" : "Sheet";

export function assembleBid(input: {
  direct: number;
  directPlaceholder: boolean;
  gc: BidPiece[];
  requirements: RequirementPrice[];
  overheadPct: number | null;
  profitPct: number | null;
  settled: boolean;
}): { lines: string[]; total: number | null; ready: boolean; math: string } {
  const gcPriced = input.gc.filter((g) => g.amount != null);
  const reqInGc = input.requirements.filter(
    (r) => !r.excluded && r.placement === "gc" && r.amount != null,
  );
  const reqOwn = input.requirements.filter((r) => !r.excluded && r.placement === "own_line");
  const gcTotal = cents(
    gcPriced.reduce((s, g) => s + (g.amount ?? 0), 0) +
      reqInGc.reduce((s, r) => s + (r.amount ?? 0), 0),
  );
  const ownPriced = reqOwn.filter((r) => r.amount != null);
  const ownTotal = cents(ownPriced.reduce((s, r) => s + (r.amount ?? 0), 0));
  const unpriced = [
    ...input.gc.filter((g) => g.amount == null).map((g) => g.label),
    ...input.requirements.filter((r) => !r.excluded && r.amount == null).map((r) => r.ref),
  ];
  const placeholder =
    input.directPlaceholder ||
    input.gc.some((g) => g.placeholder) ||
    input.requirements.some((r) => !r.excluded && r.amount != null && !r.confirmed);
  const base = cents(input.direct + gcTotal + ownTotal);
  const lines = [
    `Direct cost (labor and material): ${money(input.direct)}.${input.directPlaceholder ? " Includes a PLACEHOLDER." : ""}`,
    `General conditions: ${money(gcTotal)}.`,
    ...input.gc.map(
      (g) =>
        `- ${g.label}: ${g.amount == null ? "unpriced" : money(g.amount)}.${g.placeholder ? " PLACEHOLDER." : ""}${g.risk ? " Holds the bid." : ""}`,
    ),
    `Special requirements on their own line: ${money(ownTotal)}.`,
    ...reqOwn.map(
      (r) =>
        `- ${r.label} (${r.ref}). ${sourceLabel(r.sourceType)} ${r.sourceRef}. ${r.amount == null ? "Unpriced. Price or confirm it." : money(r.amount) + (r.confirmed ? " Confirmed." : " PLACEHOLDER.")}${r.amount == null ? " Holds the bid." : ""}`,
    ),
    ...reqInGc.map(
      (r) =>
        `- ${r.label} (${r.ref}) is carried in general conditions. ${sourceLabel(r.sourceType)} ${r.sourceRef}. ${money(r.amount ?? 0)}.${r.confirmed ? "" : " PLACEHOLDER."}`,
    ),
  ];
  if (input.overheadPct == null || input.profitPct == null) {
    lines.push(
      "Overhead and profit are not set. Send the contractor's percents. Overhead is applied first, then profit on top.",
    );
    lines.push(
      unpriced.length
        ? `Not a bid yet. Still open: ${unpriced.join(", ")}.`
        : "Not a bid yet. Overhead and profit are still open.",
    );
    return { lines, total: null, ready: false, math: lines.join("\n") };
  }
  const ohp = compoundOhp(base, input.overheadPct, input.profitPct);
  lines.push(ohp.math);
  const ready = input.settled && unpriced.length === 0 && !placeholder;
  lines.push(
    ready
      ? `Bid total ${money(ohp.total)}.`
      : `Priced total ${money(ohp.total)}. Not a bid yet.${unpriced.length ? ` Still open: ${unpriced.join(", ")}.` : ""}${placeholder ? " A PLACEHOLDER is still unconfirmed." : ""}${input.settled ? "" : " The takeoff is not settled."}`,
  );
  return { lines, total: ohp.total, ready, math: ohp.math };
}

export function nextMove(
  step: "takeoff" | "pricing" | "rates" | "gc" | "requirements" | "bid",
): string {
  const map = {
    takeoff: "Next move: settle open lines, then send production and rates for labor.",
    pricing: "Next move: choose which rate references to carry, using only figures you supply.",
    rates:
      "Next move: price the general conditions adder, including supervision from the schedule duration.",
    gc: "Next move: price or confirm each special requirement. They stay out of labor and material.",
    requirements:
      "Next move: send overhead and profit percents. Overhead is applied first, then profit on top.",
    bid: "Next move: review the bid total with the estimator. Questions stay here.",
  };
  return map[step];
}

export function sourceAsk(): string[] {
  return [
    "Which rate references should this bid carry?",
    "- RSMeans, with a location you name (NYC, Chicago, Miami, Austin, Dallas, LA, SF, Boston, Philly or DC) and a work type (commercial, residential, industrial or healthcare).",
    "- NECA labor units for electrical.",
    "- SMACNA for sheet metal.",
    "- MCAA for plumbing.",
    "Send the factor or the labor unit yourself. A number stays PLACEHOLDER until you confirm it. Athena does not look up or reproduce those tables.",
  ];
}

export const docList = (docs: Doc[]) => docs.map((d) => d.name).join("; ");
