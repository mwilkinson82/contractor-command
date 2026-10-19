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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s.trim());

/** Find the item a ref points at among a job's open items. Returns the id, or an error message. */
export function matchRef(ref: string, items: { id: string; action: string | null; check_key: string | null }[]): { id: string } | { error: string } {
  const r = ref.trim().replace(/^item\s+/i, "");
  if (isUuid(r)) return items.some((i) => i.id === r.toLowerCase()) ? { id: r.toLowerCase() } : { error: "not_found" };
  const want = r.toUpperCase().startsWith("#") ? r.toLowerCase() : r.toUpperCase();
  const hits = items.filter((i) => {
    const ref = itemRef(i);
    return ref.startsWith("#") ? ref === want.toLowerCase() || i.id.replace(/-/g, "").startsWith(want.replace(/^#/, "").toLowerCase()) && want.length >= 5 : ref === want;
  });
  if (hits.length === 1) return { id: hits[0].id };
  return { error: hits.length ? "ambiguous" : "not_found" };
}
