// Gap check: the estimator answers each gap one at a time, in chat or on the live board.
// Pure logic shared by the MCP tools and the hosted page (/r/job/<id>/gap-check). No Node imports.

export const GAP_ANSWERS = ["carrying", "covered", "understood", "rfi"] as const;
export type GapAnswerKind = (typeof GAP_ANSWERS)[number];
export const COVERED_BY = [
  "takeoff_line",
  "general_conditions",
  "sub_quote",
  "owner_in_writing",
  "other",
] as const;
export type CoveredBy = (typeof COVERED_BY)[number];
export const ANSWER_SOURCES = ["chat", "board", "walkthrough", "excel"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export type GapAnswer = {
  answer: GapAnswerKind;
  amount: number | null;
  covered_by: CoveredBy | null;
  note: string | null;
  qualification: string | null;
  question: string | null;
  source: AnswerSource;
  updated_at: string | null;
};

export type GapVerdictLite = {
  mark: "relevant" | "not_relevant" | "good_catch";
  note: string | null;
  corrected_qty: number | null;
  owner: string | null;
};

export type GapCheckItem = {
  ref: string;
  title: string;
  reasoning: string;
  sheet: string;
  detail: string | null;
  spec_section: string;
  severity: "hard" | "soft" | "cannot_know";
  category: string;
  holds_bid: boolean;
  question: string | null;
  conditional: boolean;
  condition_text: string | null;
  exposure_low: number | null;
  exposure_high: number | null;
  schedule_activity: string | null;
  citations: string[];
  answer: GapAnswer | null;
  verdict: GapVerdictLite | null;
};

export const COLUMNS = ["to_answer", "carrying", "covered", "understood", "rfi"] as const;
export type Column = (typeof COLUMNS)[number];
export const COLUMN_LABEL: Record<Column, string> = {
  to_answer: "To answer",
  carrying: "Carrying it",
  covered: "Covered elsewhere",
  understood: "Understood, qualified",
  rfi: "RFI before bid",
};
export const ANSWER_LABEL: Record<GapAnswerKind, string> = {
  carrying: "I'm carrying it",
  covered: "It's covered elsewhere",
  understood: "I understand, qualify it",
  rfi: "Ask an RFI before bid",
};
export const COVERED_LABEL: Record<CoveredBy, string> = {
  takeoff_line: "A takeoff line",
  general_conditions: "General conditions",
  sub_quote: "A sub quote",
  owner_in_writing: "The owner, in writing",
  other: "Somewhere else",
};

/** Same gap, reworded: strip a leading code like "G01" or "G-12", lowercase, collapse punctuation. */
export function gapKey(title: string): string {
  // Temporary power, temp heat, temp lighting: one decision, one card.
  if (TEMP_UTILITY_RE.test(title)) return "temporary utilities";
  return title
    .trim()
    .replace(/^g-?\d+[\s.:)-]+/i, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const refNo = (ref: string) => Number(ref.replace(/^G-/i, "")) || 0;

export function citationOf(g: { sheet: string; spec_section: string; detail?: string | null }): string {
  const sheet = [g.sheet.trim(), (g.detail ?? "").trim()].filter(Boolean).join(" ");
  return [sheet, g.spec_section.trim()].filter(Boolean).join(" · ").slice(0, 200);
}

/**
 * One card per gap. A repeat (same title once codes and punctuation are stripped) folds into the
 * lowest-numbered copy and adds its citation. A copy the estimator already marked or answered is kept,
 * because its answer is on record.
 */
export function collapseRepeats<
  T extends {
    ref?: string;
    title: string;
    sheet: string;
    spec_section: string;
    detail?: string | null;
    citations?: string[] | null;
  },
>(list: T[], keep: Set<string> = new Set()): (T & { citations: string[] })[] {
  const order = list
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const ra = a.g.ref ? refNo(a.g.ref) : Number.MAX_SAFE_INTEGER;
      const rb = b.g.ref ? refNo(b.g.ref) : Number.MAX_SAFE_INTEGER;
      return ra - rb || a.i - b.i;
    });
  const firstByKey = new Map<string, number>();
  const out: ((T & { citations: string[] }) | null)[] = list.map(() => null);
  for (const { g, i } of order) {
    const key = gapKey(g.title);
    const at = key ? firstByKey.get(key) : undefined;
    const protectedCopy = g.ref ? keep.has(g.ref) : false;
    if (at === undefined || protectedCopy) {
      if (key && at === undefined) firstByKey.set(key, i);
      out[i] = { ...g, citations: mergeCitations(g.citations ?? [], [citationOf(g)]) };
      continue;
    }
    const host = out[at]!;
    out[at] = { ...host, citations: mergeCitations(host.citations, [citationOf(g), ...(g.citations ?? [])]) };
  }
  return out.filter((g): g is T & { citations: string[] } => g !== null);
}

export function mergeCitations(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...a, ...b]) {
    const t = c.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t.slice(0, 200));
  }
  return out.slice(0, 12);
}

/**
 * A note that hands the contractor a utility only "if there's room" or "subject to approval".
 * Estimators read it as covered and carry nothing. The facility can still say no.
 */
export const CONDITIONAL_RE =
  /\b(owner'?s?|facility'?s?|landlord'?s?|building'?s?|existing)\s+(electrical\s+|power\s+)?(panel|panelboard|service|power|switchboard|switchgear|capacity|utilities|breakers?)\b[^.]{0,160}?\b(if|where|when|provided|subject to|as available|space permits|capacity)\b|\b(if|where|provided)\s+(spare\s+|sufficient\s+|adequate\s+)?capacity\s+(allows|permits|is available|exists)\b|\bsubject to (the )?(owner|facility|landlord|utility)'?s? (approval|acceptance|review)\b/i;

export function conditionalSentence(text: string): string | null {
  const m = CONDITIONAL_RE.exec(text);
  if (!m) return null;
  const start = Math.max(text.lastIndexOf(".", m.index - 1) + 1, 0);
  let end = text.indexOf(".", m.index + m[0].length);
  end = end < 0 ? Math.min(text.length, m.index + m[0].length + 160) : end + 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 300);
}

export const TEMP_UTILITY_RE =
  /\btemp(orary|\.)?\s+(power|electric(al)?|lighting|heat(ing)?|utilit(y|ies)|service|generator)\b|\btemp(orary)? heat\b/i;

/** The question Athena asks for a gap with no question of its own. */
export function defaultQuestion(g: { title: string; conditional?: boolean }): string {
  if (g.conditional)
    return `If the owner says no, are you carrying ${g.title.toLowerCase()} for the whole job, delays included?`;
  return `Are you carrying ${g.title.toLowerCase()}, or is it covered somewhere else?`;
}

/** Mark a gap whose own words hand over owner power "if capacity allows". It holds the bid. */
export function flagConditional<
  T extends {
    title: string;
    reasoning: string;
    conditional?: boolean;
    condition_text?: string | null;
    holds_bid?: boolean;
    severity?: "hard" | "soft" | "cannot_know";
    question?: string | null;
  },
>(g: T): T {
  if (g.conditional) return { ...g, holds_bid: true, severity: "hard" };
  const sentence = conditionalSentence(`${g.title}. ${g.reasoning}`);
  if (!sentence) return g;
  return {
    ...g,
    conditional: true,
    condition_text: g.condition_text ?? sentence,
    holds_bid: true,
    severity: "hard",
    question: g.question ?? defaultQuestion({ title: g.title, conditional: true }),
  };
}

export type AnswerInput = {
  answer: GapAnswerKind;
  amount?: number | null;
  covered_by?: CoveredBy | null;
  note?: string | null;
  qualification?: string | null;
  question?: string | null;
};

const filled = (s: string | null | undefined) => Boolean((s ?? "").trim());
/** Owner's panel, spare breaker, "there's room": the trap the conditional note sets. */
export const PANEL_TRAP_RE =
  /owner'?s?\s+(panel|power|service|breaker)|spare\s+breaker|there'?s\s+room|existing\s+(panel|power|service)|(use|tie into|connect to)\s+(their|the owner'?s?|the building'?s?)\s+(panel|power)/i;

/** Same rules the database enforces, worded for the estimator. Null means the answer can be saved. */
export function answerProblem(g: Pick<GapCheckItem, "conditional" | "title">, a: AnswerInput): string | null {
  if (a.answer === "carrying") {
    if (a.amount == null || !Number.isFinite(a.amount) || a.amount < 0)
      return "Say what you're carrying for it, in dollars.";
    return null;
  }
  if (a.answer === "covered") {
    if (!a.covered_by) return "Say where it's covered: a takeoff line, general conditions, a sub quote or the owner in writing.";
    if (!filled(a.note)) return "Name the line, quote or letter that covers it.";
    if (g.conditional && (a.covered_by === "other" || PANEL_TRAP_RE.test(a.note ?? "")) && a.covered_by !== "owner_in_writing")
      return "That's the trap on this one. The note only lets you use the owner's power if they agree, and they can say no on load. Carry the fallback, or get the owner to confirm it in writing.";
    return null;
  }
  if (a.answer === "understood") {
    if (!filled(a.qualification) && !filled(a.note))
      return "Give the line that goes in the proposal as a qualification.";
    return null;
  }
  if (!filled(a.question)) return "Write the RFI question you're sending.";
  return null;
}

export function columnOf(item: Pick<GapCheckItem, "answer" | "verdict">): Column | "dropped" {
  if (item.answer) return item.answer.answer;
  const v = item.verdict;
  if (v?.mark === "not_relevant") return "dropped";
  if (v?.corrected_qty != null) return "carrying";
  if (v?.owner) return "covered";
  return "to_answer";
}

/** Still holds the bid: a gap that holds it and has no answer yet, or is waiting on an RFI. */
export function stillHolds(item: Pick<GapCheckItem, "answer" | "verdict" | "holds_bid">): boolean {
  const col = columnOf(item);
  if (!item.holds_bid || col === "dropped") return false;
  return col === "to_answer" || col === "rfi";
}

export type GapCheckProgress = {
  total: number;
  answered: number;
  open: number;
  holding: number;
  rfi: number;
  carrying: number;
  exposureLow: number;
  exposureHigh: number;
  met: boolean;
};

export function progress(items: GapCheckItem[]): GapCheckProgress {
  const live = items.filter((i) => columnOf(i) !== "dropped");
  const open = live.filter((i) => columnOf(i) === "to_answer");
  const unanswered = open;
  const carrying = live.reduce((s, i) => {
    if (i.answer?.answer === "carrying") return s + (i.answer.amount ?? 0);
    return s;
  }, 0);
  return {
    total: live.length,
    answered: live.length - open.length,
    open: open.length,
    holding: live.filter(stillHolds).length,
    rfi: live.filter((i) => columnOf(i) === "rfi").length,
    carrying,
    exposureLow: unanswered.reduce((s, i) => s + (i.exposure_low ?? 0), 0),
    exposureHigh: unanswered.reduce((s, i) => s + (i.exposure_high ?? 0), 0),
    met: live.length > 0 && open.length === 0 && !live.some(stillHolds),
  };
}

/** Walk order: what holds the bid first, then the biggest money, then conditional notes, then by number. */
export function walkOrder(items: GapCheckItem[]): GapCheckItem[] {
  return items
    .filter((i) => columnOf(i) !== "dropped")
    .slice()
    .sort((a, b) => {
      const oa = columnOf(a) === "to_answer" ? 0 : 1;
      const ob = columnOf(b) === "to_answer" ? 0 : 1;
      if (oa !== ob) return oa - ob;
      if (a.holds_bid !== b.holds_bid) return a.holds_bid ? -1 : 1;
      const ea = a.exposure_high ?? a.exposure_low ?? 0;
      const eb = b.exposure_high ?? b.exposure_low ?? 0;
      if (ea !== eb) return eb - ea;
      if (a.conditional !== b.conditional) return a.conditional ? -1 : 1;
      return refNo(a.ref) - refNo(b.ref);
    });
}

export function nextGap(items: GapCheckItem[]): GapCheckItem | null {
  const first = walkOrder(items)[0];
  return first && columnOf(first) === "to_answer" ? first : null;
}

export const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "" : `$${Math.round(n).toLocaleString("en-US")}`;

export function exposureText(g: Pick<GapCheckItem, "exposure_low" | "exposure_high">): string | null {
  const lo = g.exposure_low;
  const hi = g.exposure_high;
  if (lo == null && hi == null) return null;
  if (lo != null && hi != null && lo !== hi) return `${money(lo)} to ${money(hi)}`;
  return money(hi ?? lo);
}

export function answerSummary(a: GapAnswer): string {
  if (a.answer === "carrying") return `Carrying ${money(a.amount)}`;
  if (a.answer === "covered")
    return `Covered by ${COVERED_LABEL[a.covered_by ?? "other"].toLowerCase()}${a.note ? `: ${a.note}` : ""}`;
  if (a.answer === "understood") return `Qualified: ${a.qualification ?? a.note ?? ""}`.trim();
  return `RFI: ${a.question ?? ""}`.trim();
}

const asNum = (v: unknown): number | null =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseAnswer(raw: unknown): GapAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!GAP_ANSWERS.includes(o.answer as GapAnswerKind)) return null;
  return {
    answer: o.answer as GapAnswerKind,
    amount: asNum(o.amount),
    covered_by: COVERED_BY.includes(o.covered_by as CoveredBy) ? (o.covered_by as CoveredBy) : null,
    note: asStr(o.note),
    qualification: asStr(o.qualification),
    question: asStr(o.question),
    source: ANSWER_SOURCES.includes(o.source as AnswerSource) ? (o.source as AnswerSource) : "chat",
    updated_at: asStr(o.updated_at),
  };
}

export function parseCitations(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string" && !!c.trim()) : [];
}

/** The board payload from mcp_estimate_gap_board. */
export function parseBoard(raw: unknown): {
  jobNumber: string;
  jobName: string | null;
  company: string | null;
  items: GapCheckItem[];
  stamp: string;
} {
  const o = (raw ?? {}) as Record<string, unknown>;
  const items = ((o.gaps as Record<string, unknown>[]) ?? []).map((g): GapCheckItem => {
    const v = g.verdict as Record<string, unknown> | null | undefined;
    return {
      ref: String(g.ref),
      title: String(g.title ?? ""),
      reasoning: String(g.reasoning ?? ""),
      sheet: String(g.sheet ?? ""),
      detail: asStr(g.detail),
      spec_section: String(g.spec_section ?? ""),
      severity: g.severity === "hard" || g.severity === "cannot_know" ? g.severity : "soft",
      category: String(g.category ?? ""),
      holds_bid: g.holds_bid === true,
      question: asStr(g.question),
      conditional: g.conditional === true,
      condition_text: asStr(g.condition_text),
      exposure_low: asNum(g.exposure_low),
      exposure_high: asNum(g.exposure_high),
      schedule_activity: asStr(g.schedule_activity),
      citations: parseCitations(g.citations),
      answer: parseAnswer(g.answer),
      verdict:
        v && typeof v === "object"
          ? {
              mark: v.mark === "not_relevant" || v.mark === "good_catch" ? v.mark : "relevant",
              note: asStr(v.note),
              corrected_qty: asNum(v.corrected_qty),
              owner: asStr(v.owner),
            }
          : null,
    };
  });
  return {
    jobNumber: String(o.job_number ?? ""),
    jobName: asStr(o.job_name),
    company: asStr(o.company),
    items: items.sort((a, b) => refNo(a.ref) - refNo(b.ref)),
    stamp: String(o.stamp ?? ""),
  };
}
