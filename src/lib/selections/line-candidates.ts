/**
 * Which estimate lines are worth offering the customer Good, Better and Best
 * options on. A line qualifies when it is a product the customer sees or lives
 * with and could reasonably choose (a fixture, a finish, a control or a piece of
 * equipment), with a real quantity. Rough-in, wiring, gear, connections,
 * code-required life-safety items and allowances never qualify: the customer
 * has no choice to make on them.
 */

export type CandidateLine = {
  line_no: number;
  item?: string | null;
  qty?: number | null;
  unit?: string | null;
  exclusion?: unknown;
};

export type LineCandidate = {
  estimate_line_ref: string;
  line_no: number;
  item: string;
  qty: number;
  unit: string;
  kind: CandidateKind;
  why: string;
};

export type CandidateKind =
  | "finish"
  | "decorative_lighting"
  | "lighting"
  | "controls"
  | "equipment";

export type SkipReason =
  | "code_required"
  | "rough_in"
  | "no_quantity"
  | "accessory"
  | "not_a_choice";

type Rule = { kind: CandidateKind; weight: number; re: RegExp; why: string };

// Most visible first: a customer chooses a pendant or a faucet before a sensor.
const RULES: Rule[] = [
  {
    kind: "decorative_lighting",
    weight: 5,
    re: /\b(pendants?|chandeliers?|sconces?|track\s+(?:heads?|lights?|lighting|fixtures?)|decorative|vanity\s+lights?|ceiling\s+fans?|landscape\s+lights?)\b/i,
    why: "Decorative lighting the customer sees every day. The tiers can differ in look, finish and light quality.",
  },
  {
    kind: "finish",
    weight: 5,
    re: /\b(faucets?|sinks?|lavator(?:y|ies)|toilets?|water\s+closets?|showers?|tubs?|bathtubs?|floor(?:ing)?|tiles?|carpet|lvp|vinyl\s+plank|hardwood|laminate|counter\s?tops?|cabinets?|cabinetry|vanit(?:y|ies)|appliances?|ranges?|refrigerators?|dishwashers?|cooktops?|ovens?|door\s+hardware|locksets?|hardware|windows?|doors?|siding|shingles?|roofing|paint|decking|fenc(?:e|ing)|garage\s+doors?|backsplash|mirrors?|blinds|shades)\b/i,
    why: "A finish the customer picks by look and quality, the classic place for Good, Better and Best.",
  },
  {
    kind: "lighting",
    weight: 4,
    re: /\b(fixtures?|luminaires?|troffers?|lay-in|downlights?|recessed|can\s+lights?|wafer\s+lights?|strip\s+lights?|wrap\s+lights?|high\s?bays?|flood\s?lights?|wall\s?packs?|cylinders?)\b/i,
    why: "Lighting fixtures. Better and Best can add dimming, colour tuning, a nicer look or higher efficiency.",
  },
  {
    kind: "equipment",
    weight: 3,
    re: /\b(heaters?|water\s+heaters?|ev\s+chargers?|chargers?|generators?|solar|batter(?:y|ies)\s+storage|heat\s+pumps?|furnaces?|air\s+handlers?|condensers?|mini[-\s]?splits?|boilers?|range\s+hoods?|bath\s+fans?)\b/i,
    why: "Equipment the customer lives with. The tiers can differ in efficiency, noise, warranty or controls.",
  },
  {
    kind: "controls",
    weight: 2,
    re: /\b(occupancy\s+sensors?|vacancy\s+sensors?|dimmers?|thermostats?|smart\s+\w+|lighting\s+controls?|keypads?|scene\s+controls?|doorbells?|security\s+cameras?|cameras?)\b/i,
    why: "Controls. Better and Best can add smart, app-based or energy-saving features.",
  },
];

// Checked before the rules: the customer has no real choice on these.
const CODE_RE =
  /\b(exit|emergency|egress|fire[-\s]?alarm|fire[-\s]?suppression|smoke|carbon\s+monoxide|co\s+detectors?|life[-\s]?safety|gfci|afci|override)\b/i;
const ROUGH_RE =
  /\b(wire|wiring|conduit|feeders?|cables?|breakers?|panels?|transformers?|disconnects?|splitters?|contactors?|enclosures?|connections?|terminations?|interfaces?|grounding|bonding|labels?|supports?|backboards?|penetrations?|receptacles?|outlets?|rough[-\s]?in|sleeves?|j-?boxes|junction\s+boxes|meters?|services?|timeclocks?|power\s+and\s+interconnection|installation\/wiring|supply\/install\s+only)\b/i;
const ACCESSORY_RE =
  /\b(lamps?\s+for|bulbs?|rails?|track\s+rail|adapters?|trims?\s+only|canopies)\b/i;
const NON_PRODUCT_UNITS = new Set([
  "connection",
  "connections",
  "system",
  "systems",
  "lot",
  "lots",
  "allowance",
  "excluded",
  "run",
  "runs",
  "point",
  "points",
  "location",
  "locations",
  "ls",
  "lump sum",
]);

export type CandidateResult = {
  suggested: LineCandidate[];
  on_board: LineCandidate[];
  skipped: Record<SkipReason, number>;
};

const excluded = (v: unknown) =>
  v !== null && v !== undefined && v !== false && !(typeof v === "string" && v.trim() === "");

/** Classifies one takeoff line, or says why it was skipped. */
export function classifyLine(
  l: CandidateLine,
): { candidate: LineCandidate; weight: number } | { skip: SkipReason } {
  const item = (l.item ?? "").trim();
  const unit = (l.unit ?? "").trim().toLowerCase();
  if (!item || excluded(l.exclusion)) return { skip: "not_a_choice" };
  if (CODE_RE.test(item)) return { skip: "code_required" };
  if (ROUGH_RE.test(item) || NON_PRODUCT_UNITS.has(unit)) return { skip: "rough_in" };
  if (ACCESSORY_RE.test(item)) return { skip: "accessory" };
  const rule = RULES.find((r) => r.re.test(item));
  if (!rule) return { skip: "not_a_choice" };
  if (typeof l.qty !== "number" || !(l.qty > 0)) return { skip: "no_quantity" };
  return {
    weight: rule.weight,
    candidate: {
      estimate_line_ref: `T-${l.line_no}`,
      line_no: l.line_no,
      item,
      qty: l.qty,
      unit: l.unit?.trim() || "ea",
      kind: rule.kind,
      why: rule.why,
    },
  };
}

/**
 * Lines worth offering Good, Better and Best on, most customer-visible first,
 * then by quantity. Lines that already have a selection come back separately.
 */
export function suggestLines(
  lines: CandidateLine[],
  onBoardRefs: Iterable<string>,
  limit = 8,
): CandidateResult {
  const board = new Set(onBoardRefs);
  const skipped: Record<SkipReason, number> = {
    code_required: 0,
    rough_in: 0,
    no_quantity: 0,
    accessory: 0,
    not_a_choice: 0,
  };
  const ranked: { candidate: LineCandidate; weight: number }[] = [];
  const onBoard: LineCandidate[] = [];
  for (const l of lines) {
    const c = classifyLine(l);
    if ("skip" in c) {
      skipped[c.skip] += 1;
      continue;
    }
    if (board.has(c.candidate.estimate_line_ref)) onBoard.push(c.candidate);
    else ranked.push(c);
  }
  ranked.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.candidate.qty - a.candidate.qty ||
      a.candidate.line_no - b.candidate.line_no,
  );
  return {
    suggested: ranked.slice(0, Math.max(0, limit)).map((r) => r.candidate),
    on_board: onBoard.sort((a, b) => a.line_no - b.line_no),
    skipped,
  };
}
