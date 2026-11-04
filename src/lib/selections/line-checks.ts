/**
 * Checks that keep a Good, Better, Best selection on the takeoff line it is
 * about, and that surface an open drawing conflict on that line before
 * anyone sources or prices against one reading of it.
 */

export type CheckLine = {
  line_no: number;
  item?: string | null;
  qty?: number | null;
  unit?: string | null;
};
export type CheckGap = {
  ref: string;
  title: string;
  reasoning: string;
  category: string;
  severity: string;
  holds_bid: boolean;
  line_no: number | null;
};
export type CheckVerdict = { item_kind: string; gap_ref: string | null };

const TYPE_RE = /\btype\s+([a-z]{1,2}\d{0,2}(?:\s*(?:\/|,|&|and)\s*[a-z]{1,2}\d{0,2}\b)*)/gi;

/** Fixture or equipment type codes named in a text: "Type A / A1 track" gives A and A1. */
export function typeCodes(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of (text ?? "").matchAll(TYPE_RE))
    for (const code of m[1].split(/\s*(?:\/|,|&|\band\b)\s*/i))
      if (code.trim()) out.add(code.trim().toUpperCase());
  return out;
}

/**
 * True when the selection names fixture types and the takeoff line names other
 * types only: "Type A / A1 Track Lighting" on "Type E 24x48 lay-in" is wrong.
 */
export function lineMismatch(
  title: string | null | undefined,
  lineItem: string | null | undefined,
) {
  const want = typeCodes(title);
  const have = typeCodes(lineItem);
  if (!want.size || !have.size) return false;
  return ![...want].some((c) => have.has(c));
}

/** Takeoff lines whose item names one of the selection's type codes. */
export function matchingLines<L extends CheckLine>(
  title: string | null | undefined,
  lines: L[],
): L[] {
  const want = typeCodes(title);
  if (!want.size) return [];
  return lines.filter((l) => [...typeCodes(l.item)].some((c) => want.has(c)));
}

export const lineLabel = (l: CheckLine) =>
  `T-${l.line_no} ${l.item ?? "(no item)"}${l.qty != null ? `, ${l.qty} ${l.unit ?? ""}`.trimEnd() : ""}`;

const mentionsType = (text: string, code: string) =>
  new RegExp(`\\btype\\s+${code.replace(/[^A-Z0-9]/gi, "")}(?![a-z0-9])`, "i").test(text);

/**
 * Open conflicts that bear on a takeoff line: a gap tied to the line, or one
 * whose text names the line's fixture type, that holds the bid or is a
 * drawing conflict, and that no verdict has settled yet.
 */
export function openLineConflicts(
  line: CheckLine,
  gaps: CheckGap[],
  verdicts: CheckVerdict[],
): CheckGap[] {
  const settled = new Set(
    verdicts.filter((v) => v.item_kind === "gap" && v.gap_ref).map((v) => v.gap_ref!.toUpperCase()),
  );
  const codes = [...typeCodes(line.item)];
  return gaps.filter((g) => {
    if (settled.has(g.ref.toUpperCase())) return false;
    if (!(g.category === "conflict" || g.holds_bid)) return false;
    if (g.line_no === line.line_no) return true;
    const text = `${g.title} ${g.reasoning}`;
    return codes.some((c) => mentionsType(text, c));
  });
}

/** One plain line per conflict, for the member and the host. */
export const conflictLine = (g: CheckGap) =>
  `${g.ref} ${g.title}${g.holds_bid ? " (holds the bid)" : ""}: ${g.reasoning.slice(0, 600)}`;

export const PROVISIONAL_PREFIX = "PROVISIONAL";

// Words that only make sense to the contractor: an RFI number, provisional
// status, or where a price came from. They belong in the selection notes or the
// option's assumptions, which the customer never sees.
const INTERNAL_NOTE_RES = [
  /\bRFI[\s#-]*\d+\b/i,
  /\bpending\s+RFI\b/i,
  /\bprovisional\b(?!\s+sums?\b)/i,
  /\bprice\s+leads?\b/i,
  /\bfound\s+price\b/i,
  /\bprice\s+(?:taken|read)\s+from\b/i,
  /\b(?:price|cost)\s+(?:is\s+)?to\s+be\s+confirmed\b/i,
  /\bconfirm(?:ed)?\s+(?:the\s+)?(?:price|cost)\s+with\s+(?:the\s+)?supplier\b/i,
];
/** The first internal note in text the customer would see, or null. */
export function internalNote(text: string): string | null {
  for (const re of INTERNAL_NOTE_RES) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
export const isProvisional = (notes: string) =>
  notes.trimStart().toUpperCase().startsWith(PROVISIONAL_PREFIX);
export const provisionalNote = (basis: string, refs: string[], notes: string) => {
  const head = `${PROVISIONAL_PREFIX}. Basis: ${basis.trim()}. Open: ${refs.join(", ")}.`;
  const rest = notes.trim();
  return (
    rest && !isProvisional(rest) ? `${head} ${rest}` : rest && isProvisional(rest) ? rest : head
  ).slice(0, 2000);
};
