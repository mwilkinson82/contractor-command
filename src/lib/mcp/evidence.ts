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

// A vague phrase anywhere in the text ("Owner confirms ... 'we're good'"). Clients often wrap a bare
// "we're good" in a longer sentence; the wrapping is not evidence.
const VAGUE_INSIDE = /\b(?:we(?:'| a)?re (?:good|fine|ok(?:ay)?|all set|covered)|all good|it(?:'|i)?s (?:good|fine|handled|covered|taken care of)|taken care of|no (?:issues?|problems?)|looks good|should be (?:fine|good))\b/i;
// The text itself says there is no document behind it.
const NO_DOCUMENT = /\bno (?:independent |supporting |actual )?(?:document(?:ation)?|evidence|proof|verification)\b|\bwithout (?:a |any )?(?:document|evidence|proof)\b|\bnot (?:independently )?(?:verified|documented)\b/i;
// A specific document: a document word next to an identifier (number, date, revision, section).
const DOC_WORD = /\b(?:submittal|rfi|coi|certificate|email|e-mail|letter|contract|subcontract|spec(?:ification)?s?|section|drawing|sheet|report|invoice|pay app|log|minutes|change order|co|po|permit|file|pdf|memo|transmittal|approval|insurance|bond|policy|schedule)\b/i;
const IDENT = /(?:#\s?\d|\b\d{2,}[-./]\d+|\b(?:rev|no\.?|number|section|§)\s?[\w.-]*\d|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\.pdf\b)/i;

export function hasSpecificDocument(text: string): boolean {
  return DOC_WORD.test(text) && IDENT.test(text);
}

/** Why this text can't close an item, or null when it is real evidence. */
export function evidenceProblem(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (isVagueEvidence(t)) return "vague";
  if (NO_DOCUMENT.test(t) && !/\bwaiv/i.test(t)) return "says_no_document";
  if (VAGUE_INSIDE.test(t) && !hasSpecificDocument(t.replace(VAGUE_INSIDE, ""))) return "vague_statement";
  return null;
}
