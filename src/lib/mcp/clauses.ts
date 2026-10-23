/** Typed answers that mean "this clause is not in the contract" ("No LDs", "None.", "N/A", "0%", "not included"). "No later than 7 days" is a real term, not an absence. */
export const CLAUSE_ABSENT =
  /^(?:none|no|n\/?a|nil|zero|0\s*%?|not (?:included|applicable|in (?:the )?(?:sub)?contract)|(?:none|nothing|no clause|no provision)\s+(?:in|under|within|stated in|found in|listed in|provided in)\s+(?:the |this )?(?:sub)?contract\b.*|there (?:is|are) no\b.*|no(?:\s+\S+){0,3}?\s+(?:clause|clauses|lds?|liquidated damages?|beneficial use|retainage|retention|notice requirements?)\b.*)\.?$/i;

/** "Not specified", "unknown", "TBD": the term is unknown. No fact value, no flag. */
export const CLAUSE_UNKNOWN =
  /^(?:not specified|unspecified|not stated|not (?:provided|given|known|sure)|unknown|unsure|unclear|tbd|tbc|n\/s|to be (?:confirmed|determined)|don'?t know|do not know|no idea)\b/i;


/** Strip the provenance notes clients append to typed terms ("None (user-typed; no contract document provided)", "N/A - user typed") so the term itself is tested. */
export function clauseCore(v: string): string {
  let t = v.trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(/\s*\([^()]*\)\s*\.?$/, "").replace(/\s*[;,\u2014\u2013-]\s*(?:user[- ]typed|typed|member[- ]typed|reported by|no (?:contract )?document|per (?:the )?member|manual)\b.*$/i, "").trim();
    if (t === before) break;
  }
  return t || v.trim();
}

/** "yes" / "no" for a typed clause, undefined when blank or unknown. "None", "N/A", "Not applicable", "None in the subcontract." read "no". */
export function clauseFlag(v: string | undefined | null): "yes" | "no" | undefined {
  if (v === undefined || v === null || !v.trim()) return undefined;
  const t = clauseCore(v);
  if (CLAUSE_UNKNOWN.test(t)) return undefined;
  return CLAUSE_ABSENT.test(t) ? "no" : "yes";
}

/** Contract clause that each applicability flag is read from. */
export const FLAG_CLAUSE: Record<string, string> = {
  has_lds: "liquidated_damages",
  beneficial_use: "beneficial_use_clause",
  has_retainage: "retainage",
  notice_requirements: "notice_timing",
};

/**
 * The applicability value to show: the flag's current state, except that a flag still ON
 * while its clause is typed as None / N/A / Not applicable reads OFF. An unknown clause
 * does not override the flag (retainage can apply while its percentage is unknown).
 */
export function effectiveFlag(flag: string, clause: { value: unknown; status: string } | undefined): string {
  if (flag !== "yes" || !clause || clause.status !== "known" || typeof clause.value !== "string") return flag;
  return clauseFlag(clause.value) === "no" ? "no" : flag;
}
