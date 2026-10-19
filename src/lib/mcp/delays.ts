// Delay events: find the contract's delay-notice and claim terms, and compute due dates from the delay start date.
import { computeDue, type DayType } from "./deadlines";

export type ClauseTerm = { label: string; clause_ref: string | null; n_days: number | null; day_type: DayType | null; recipient: string | null; delivery_method: string | null };
export type DeadlineRow = { clause_key: string; label: string; clause_ref: string | null; trigger_desc: string | null; n_days: number | null; day_type: string | null; recipient: string | null; delivery_method: string | null; active?: boolean };

const CLAIM = /\bclaims?\b/i;

/** "§6.4: written notice within 3 calendar days after the delay begins" -> 3 calendar days, §6.4. */
export function parseClauseText(label: string, text: string | null | undefined): ClauseTerm | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const m = t.match(/\(?(\d{1,3})\)?\s*(calendar|business|working)?\s*days?\b/i);
  if (!m) return null;
  const ref = t.match(/(§\s*[\d.]+[a-z]?|(?:Article|Art\.|Section|Sec\.|Clause)\s*[\d.]+[a-z]?)/i)?.[1] ?? null;
  return { label, clause_ref: ref ? ref.replace(/\s+/g, " ") : null, n_days: Number(m[1]), day_type: (m[2]?.toLowerCase() as DayType) ?? null, recipient: null, delivery_method: null };
}

const fromRow = (d: DeadlineRow): ClauseTerm => ({
  label: d.label, clause_ref: d.clause_ref, n_days: d.n_days, day_type: (d.day_type as DayType | null) ?? null, recipient: d.recipient, delivery_method: d.delivery_method,
});

/** Contract deadlines first (most structured), then the typed contract terms (notice_timing, claim_process). */
export function findDelayTerms(deadlines: DeadlineRow[], facts: { notice_timing?: unknown; claim_process?: unknown }) {
  const rows = deadlines.filter((d) => d.active !== false && d.n_days != null);
  const isClaim = (d: DeadlineRow) => CLAIM.test(`${d.label} ${d.trigger_desc ?? ""}`);
  const noticeRow = rows.find((d) => d.clause_key === "notice" && !isClaim(d));
  const claimRow = rows.find((d) => isClaim(d));
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const notice = noticeRow ? fromRow(noticeRow) : parseClauseText("Delay notice", str(facts.notice_timing));
  const claimText = str(facts.claim_process);
  let claim = claimRow ? fromRow(claimRow) : parseClauseText("Claim notice", claimText);
  // A notice_timing text that also states a separate claim period ("...; claims within 7 days") counts for the claim.
  if (!claim) {
    const nt = str(facts.notice_timing) ?? "";
    const part = nt.split(/[;.]\s+/).find((s) => CLAIM.test(s));
    if (part) claim = parseClauseText("Claim notice", part);
  }
  return { notice, claim };
}

/** Due date for a term from the delay start date; null when the start date or day count is unknown. */
export function termDue(term: ClauseTerm | null, startDate: string | null | undefined) {
  if (!term || !startDate || term.n_days == null) return { due: null as string | null, math: "start date or day count unknown", precautions: [] as string[] };
  const c = computeDue({
    id: "", label: term.label, clause_ref: term.clause_ref, trigger_desc: "delay start", trigger_date: startDate, trigger_alternatives: [],
    n_days: term.n_days, day_type: term.day_type, holidays: null, weekend_roll: false, fixed_date: null,
  });
  return { due: c.due, math: c.math, precautions: c.precautions };
}
