// Estimating method. Quantities come from the drawings. The estimator's number is never the source.

export type OpenQuestion = {
  title: string;
  sheet: string;
  detail: string | null;
  low: number | null;
  high: number | null;
  unit: string;
  reasoning: string;
  qty: null;
};

const SCOPE_RE = /\bby\s+g\.?\s*c\.?\b|\bby others\b|\bn\.?i\.?c\.?\b|\bnot in contract\b/i;

/** A sheet or note callout that puts the work outside this contractor's number. */
export function scopeCallout(text: string): string | null {
  const hit = text.match(SCOPE_RE);
  return hit ? hit[0].replace(/\s+/g, " ").trim() : null;
}

export function splitScope<T extends { text: string; sheet?: string | null }>(
  items: T[],
): { inScope: T[]; outOfScope: { item: T; sheet: string; callout: string }[] } {
  const inScope: T[] = [];
  const outOfScope: { item: T; sheet: string; callout: string }[] = [];
  for (const item of items) {
    const callout = scopeCallout(item.text);
    if (callout) outOfScope.push({ item, sheet: item.sheet?.trim() || "sheet not cited", callout });
    else inScope.push(item);
  }
  return { inScope, outOfScope };
}

/**
 * A quantity the drawings do not fix. The result quantity stays blank.
 * The estimator's figure is not copied in.
 */
export function openQuestion(input: {
  item: string;
  sheet: string;
  detail?: string | null;
  low?: number | null;
  high?: number | null;
  unit: string;
  reasoning: string;
  estimatorQty?: number | null;
}): OpenQuestion {
  const low = input.low ?? null;
  const high = input.high ?? null;
  const range =
    low != null && high != null
      ? `Low ${low} ${input.unit}, high ${high} ${input.unit}.`
      : "The drawings do not state a low or a high, so the range stays open.";
  const where = `Sheet ${input.sheet}${input.detail ? " " + input.detail : ""}.`;
  return {
    title: `OPEN QUESTION: ${input.item}`,
    sheet: input.sheet,
    detail: input.detail ?? null,
    low,
    high,
    unit: input.unit,
    qty: null,
    reasoning: `${input.reasoning} ${range} ${where} The estimator's figure is not used.`.replace(/\s+/g, " "),
  };
}

export type BasisRead = {
  explained: boolean;
  formula: string;
  computed: number | null;
  unit: string | null;
};

/** Read a basis formula out of an estimator note, such as 263 LF x 4" = 87 SFCA. */
export function parseBasis(note: string): BasisRead {
  const text = note.replace(/[×xX]/g, "x");
  const factors = text.match(/(\d+(?:\.\d+)?)\s*LF\b[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*(?:"|in(?:ch|ches)?\b)/i);
  if (!factors) return { explained: false, formula: "", computed: null, unit: null };
  const lf = Number(factors[1]);
  const inches = Number(factors[2]);
  if (!Number.isFinite(lf) || !Number.isFinite(inches) || inches <= 0) {
    return { explained: false, formula: "", computed: null, unit: null };
  }
  const computed = Math.round(lf * (inches / 12) * 100) / 100;
  const formula = `${lf} LF x ${inches} in = ${computed} SFCA`;
  return { explained: true, formula, computed, unit: "SFCA" };
}

/** True when the note's formula accounts for the quantity. A missing note does not. */
export function basisExplains(note: string, qty: number, unit: string): BasisRead {
  const read = parseBasis(note);
  if (!read.explained || read.computed == null) return { ...read, explained: false };
  const family = unit.toUpperCase();
  if (family !== "SFCA" && family !== "SF") return { ...read, explained: false };
  const band = Math.max(1, Math.abs(read.computed) * 0.02);
  const stated = note.match(/=\s*(\d+(?:\.\d+)?)/);
  const claim = stated ? Number(stated[1]) : qty;
  const ok = Math.abs(claim - read.computed) <= band && Math.abs(qty - read.computed) <= band;
  return { ...read, explained: ok };
}

export type EstimatorLine = {
  item: string;
  qty: number | null;
  unit: string;
  note?: string | null;
  sheet?: string | null;
  detail?: string | null;
  callout?: string | null;
  /** Set when the drawings give a range or no count, not a single quantity. */
  drawingLow?: number | null;
  drawingHigh?: number | null;
  drawingDefined?: number | null;
};

export type LineReview =
  | { kind: "out"; item: string; sheet: string; callout: string }
  | { kind: "explained"; item: string; formula: string }
  | { kind: "open"; question: OpenQuestion }
  | { kind: "gap"; item: string; sheet: string; reason: string };

export function reviewEstimatorLine(line: EstimatorLine): LineReview {
  const blob = `${line.item} ${line.note ?? ""} ${line.callout ?? ""}`;
  const callout = scopeCallout(blob);
  if (callout) {
    return { kind: "out", item: line.item, sheet: line.sheet?.trim() || "sheet not cited", callout };
  }
  const rangeOpen =
    line.drawingDefined === null ||
    (line.drawingLow != null && line.drawingHigh != null && line.drawingLow !== line.drawingHigh);
  if (rangeOpen) {
    const question = openQuestion({
      item: line.item,
      sheet: line.sheet?.trim() || "sheet not cited",
      detail: line.detail ?? null,
      low: line.drawingLow,
      high: line.drawingHigh,
      unit: line.unit,
      reasoning: "The drawings do not define a single quantity.",
      estimatorQty: line.qty,
    });
    return { kind: "open", question };
  }
  if (line.qty != null && line.note?.trim()) {
    const basis = basisExplains(line.note, line.qty, line.unit);
    if (basis.explained && basis.formula) return { kind: "explained", item: line.item, formula: basis.formula };
    if (basis.computed != null && !basis.explained) {
      return {
        kind: "gap",
        item: line.item,
        sheet: line.sheet?.trim() || "sheet not cited",
        reason: `The note's basis (${basis.formula}) does not match ${line.qty} ${line.unit}.`,
      };
    }
  }
  if (!line.note?.trim() || /no geometric basis/i.test(line.note)) {
    return {
      kind: "gap",
      item: line.item,
      sheet: line.sheet?.trim() || "sheet not cited",
      reason: "The estimator's note has no basis formula, so this stays a gap.",
    };
  }
  return {
    kind: "gap",
    item: line.item,
    sheet: line.sheet?.trim() || "sheet not cited",
    reason: "The basis in the note is missing or does not tie to the drawings.",
  };
}

export function reviewEstimatorLines(lines: EstimatorLine[]): {
  explained: { item: string; formula: string }[];
  openQuestions: OpenQuestion[];
  gaps: { item: string; sheet: string; reason: string }[];
  outOfScope: { item: string; sheet: string; callout: string }[];
} {
  const explained: { item: string; formula: string }[] = [];
  const openQuestions: OpenQuestion[] = [];
  const gaps: { item: string; sheet: string; reason: string }[] = [];
  const outOfScope: { item: string; sheet: string; callout: string }[] = [];
  for (const line of lines) {
    const review = reviewEstimatorLine(line);
    if (review.kind === "explained") explained.push({ item: review.item, formula: review.formula });
    else if (review.kind === "open") openQuestions.push(review.question);
    else if (review.kind === "gap") gaps.push({ item: review.item, sheet: review.sheet, reason: review.reason });
    else outOfScope.push({ item: review.item, sheet: review.sheet, callout: review.callout });
  }
  return { explained, openQuestions, gaps, outOfScope };
}

/** A "no geometric basis" gap is dropped when the estimator's note already states the formula. */
export function keepUnexplainedGaps<T extends { title: string; reasoning: string }>(
  gaps: T[],
  explained: { item: string; formula: string }[],
): T[] {
  if (!explained.length) return gaps;
  return gaps.filter((gap) => {
    const blob = `${gap.title} ${gap.reasoning}`.toLowerCase();
    if (!/no geometric basis/.test(blob)) return true;
    return !explained.some((row) => blob.includes(row.item.toLowerCase()) || blob.includes(row.formula.toLowerCase()));
  });
}
