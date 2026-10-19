// What counts as evidence to close an open item. A bare "we're good" keeps the item open.

const VAGUE = /^(?:yes|yep|yeah|ok(?:ay)?|sure|fine|good|done|handled|sorted|covered|resolved|closed|complete|all (?:good|set|done)|we(?:'| a)?re (?:good|fine|ok(?:ay)?|all set|covered|done)|it(?:'|i)?s (?:good|fine|done|handled|covered|taken care of)|taken care of|no (?:issues?|problems?)|n\/?a|none)[.!\s]*$/i;

export function isVagueEvidence(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  if (VAGUE.test(t)) return true;
  return t.split(/\s+/).length < 3 && !/\d/.test(t); // too short to say what, unless it carries a reference number
}

export const EVIDENCE_ASK =
  "Still open. To close it I need real evidence: a document (name or number, e.g. approved submittal 07-210, signed COI dated 10/12), or a dated statement saying who said what (e.g. \"10/18, Jane Ruiz (owner's rep) confirmed by email that LDs don't apply\"), or an explicit waiver by someone with that decision right (kind waive, with a reason).";
