// Short, human item references for chat ("A1", "D9", or "#36c310"). The full id stays in structured content only.

const LABEL = /^(?:[A-Za-z][\w ]{0,30}:\s*)?([A-Z]{1,2}\d{1,2})\b/;

export const shortRef = (id: string) => `#${id.replace(/-/g, "").slice(0, 6)}`;

/** Checklist label (A1, D9) for setup items when the action starts with one, else #<first 6 of the id>. */
export function itemRef(it: { id: string; action?: string | null; check_key?: string | null }): string {
  if (it.check_key?.startsWith("setup:")) {
    const m = (it.action ?? "").match(LABEL);
    if (m) return m[1];
  }
  return shortRef(it.id);
}

/** What a PM reads on an item line: "Ref A1" or "Ref 36C31". Plain-text hosts pass it straight back to resolve_item. */
export function displayRef(it: { id: string; action?: string | null; check_key?: string | null }): string {
  const r = itemRef(it);
  return `Ref ${r.startsWith("#") ? r.slice(1, 6).toUpperCase() : r}`;
}

/** Setup-question key as a PM sees it: gate_role_gc -> gate-role-gc, warranty:term_months -> warranty-term-months. */
export const questionRef = (key: string) => key.replace(/^warranty:/, "warranty-").replace(/_/g, "-");

/** Accepts a question ref as shown ("gate-role-gc", "Ref: gate-role-gc", "Question ref gate-role-gc") or the raw key. */
export function parseQuestionRef(input: string): string {
  const t = input.trim().replace(/^(?:question\s+)?ref\s*:?\s*/i, "");
  if (/^warranty:/i.test(t)) return t;
  const k = t.toLowerCase().replace(/[\s-]+/g, "_");
  return k.startsWith("warranty_") ? `warranty:${k.slice(9)}` : k;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s.trim());

/** Find the item a ref points at among a job's open items. Returns the id, or an error message. */
export function matchRef(ref: string, items: { id: string; action: string | null; check_key: string | null }[]): { id: string } | { error: string } {
  const r = ref.trim().replace(/^(?:item|ref)\s*:?\s*/i, "").replace(/^(?:item|ref)\s*:?\s*/i, "");
  if (isUuid(r)) return items.some((i) => i.id === r.toLowerCase()) ? { id: r.toLowerCase() } : { error: "not_found" };
  // "36C31" (as shown on the line) means the same as "#36c31".
  const want = r.startsWith("#") ? r.toLowerCase() : /^[0-9a-f]{5,32}$/i.test(r) ? `#${r.toLowerCase()}` : r.toUpperCase();
  const hits = items.filter((i) => {
    const ref = itemRef(i);
    return ref.startsWith("#") ? ref === want.toLowerCase() || i.id.replace(/-/g, "").startsWith(want.replace(/^#/, "").toLowerCase()) && want.length >= 5 : ref === want;
  });
  if (hits.length === 1) return { id: hits[0].id };
  return { error: hits.length ? "ambiguous" : "not_found" };
}

/** Lookahead ref as printed for plain-text hosts: "LA-3F2A1" (first 5 hex of the id). The full id stays in structured content. */
export const lookaheadRef = (id: string) => `LA-${id.replace(/-/g, "").slice(0, 5).toUpperCase()}`;

/** Parse a lookahead ref as shown ("LA-3F2A1", "Lookahead ref LA-3F2A1", "la3f2a1") to its hex prefix, or null. */
export function parseLookaheadRef(input: string): string | null {
  const t = input.trim().replace(/^(?:look-?ahead\s*)?(?:ref\s*:?\s*)?/i, "");
  const m = t.match(/^LA-?([0-9a-f]{5,32})$/i);
  return m ? m[1].toLowerCase() : null;
}
