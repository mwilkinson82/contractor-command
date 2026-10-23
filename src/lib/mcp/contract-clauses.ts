// Contract clauses, verbatim. One row per clause (mcp_contract_clauses, migration 0021). The server never
// rewrites clause text: it stores what the host passed, verifies it against the stored contract text in the
// database (mcp_clauses_save), and parses days / day type / trigger from that clause's own words.
import type { DayType } from "./deadlines";

export const CLAUSE_CATEGORIES = ["delay_notice", "claim_notice", "nonpayment_notice", "cure_notice", "schedule_disagreement", "other"] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

/** The notice checklist: every job should have each of these, or an open item asking for it. */
export const NOTICE_CHECKLIST: { category: Exclude<ClauseCategory, "other">; label: string }[] = [
  { category: "delay_notice", label: "delay notice" },
  { category: "claim_notice", label: "claim notice" },
  { category: "nonpayment_notice", label: "notice of non-payment" },
  { category: "cure_notice", label: "notice to cure (termination for cause)" },
  { category: "schedule_disagreement", label: "notice of schedule disagreement" },
];

export type ClauseRow = {
  section: string; heading: string | null; category: ClauseCategory; verbatim_text: string;
  n_days: number | null; day_type: DayType | null; trigger_desc: string | null; source: "document" | "unverified";
};

/** "§ 6.4", "Section 6.4", "6.4" -> "6.4". */
export function normSection(s: string): string {
  return s.trim().replace(/^(?:§+|section|sec\.|article|art\.|clause)\s*/i, "").replace(/\.$/, "").trim();
}

/** Category from the heading first, then the clause's own words. Unclear clauses stay "other". */
export function classifyClause(heading: string | null | undefined, text: string): ClauseCategory {
  const h = (heading ?? "").toLowerCase();
  const t = text.toLowerCase();
  if (/non-?payment/.test(h) || /notice of non-?payment/.test(t)) return "nonpayment_notice";
  if (/claim notice|notice of claim/.test(h) || (/^claims?\b/.test(h) && /notice|writing/.test(t)) || /any claim for additional (time|money)/.test(t)) return "claim_notice";
  if (/delay notice|notice of delay/.test(h) || /notice of any delay/.test(t)) return "delay_notice";
  if (/for cause|cure/.test(h) || /\bcure\b.*after written notice/.test(t)) return "cure_notice";
  if (/notify contractor of any disagreement|notice of (any )?disagreement/.test(t)) return "schedule_disagreement";
  return "other";
}

/** Days, day type and trigger from the clause's own words; nothing is filled in that the text doesn't say. */
export function parseClause(text: string): { n_days: number | null; day_type: DayType | null; trigger_desc: string | null } {
  const m = text.match(/\(?(\d{1,3})\)?\s*(calendar|business|working)?\s*days?\b/i);
  const n_days = m ? Number(m[1]) : null;
  const day_type = (m?.[2]?.toLowerCase() as DayType | undefined) ?? null;
  let trigger_desc: string | null = null;
  if (m) {
    const after = text.slice((m.index ?? 0) + m[0].length).match(/^\s*\**\s*((?:after|of|from|following|before)\b[^.;]*)/i);
    trigger_desc = after ? after[1].replace(/\*+/g, "").trim() : null;
  } else if (/\bpromptly\b/i.test(text)) trigger_desc = "promptly (no day count stated)";
  return { n_days, day_type, trigger_desc };
}

/** "§6.4 Delay Notice: ‹exact text›" plus its verification tag. */
export function clauseLine(c: Pick<ClauseRow, "section" | "heading" | "verbatim_text" | "source">): string {
  const tag = c.source === "document" ? "(document)" : "(UNVERIFIED — not found exactly in the contract text; check it)";
  return `§${c.section}${c.heading ? ` ${c.heading}` : ""}: ‹${c.verbatim_text}› ${tag}`;
}

/** Claim clauses are internal strategy: client output drops them whole. */
export const isClaimClause = (c: Pick<ClauseRow, "category">) => c.category === "claim_notice";

export function missingNotices(rows: Pick<ClauseRow, "category">[]) {
  const have = new Set(rows.map((r) => r.category));
  return NOTICE_CHECKLIST.filter((n) => !have.has(n.category));
}

export const CLAUSE_HOST_RULE =
  "Contract clauses: pass each clause's text exactly as written in the contract (copy it, never summarize, shorten or merge), one clause per entry with its section number and heading, and pass the full contract text as contract_text so Athena can verify it. If a clause isn't in the contract, leave it out; Athena opens an item to confirm it.";

/**
 * Tag for a document-sourced summary-field contract term (saved with the contract document named).
 * It was read from the contract, so it never reads "not verified" or "manual"; it is still a summary,
 * not exact clause text, so it never reads plain "document" either (only exact clause rows carry that).
 */
export const LEGACY_SUMMARY_TAG = "from the contract, summary";
/** Closing offer when summaries are left out (include_summary off). */
export const SUMMARY_OFFER = "Do you want me to summarize this legal text so you know what it means in plain English?";
/** Heading for summary blocks shown on request (include_summary on). */
export const SUMMARY_HEADING = "Summary — the clause text above governs";
/** The pre-0.7.2 tag. Still stripped from client copy in case older text passes through. */
export const OLD_SUMMARY_TAG = "summary, not verified against the contract text";
/** Source label for a contract summary field: never "document" (only exact clause rows carry that). */
export function legacySourceLabel(source: string): string {
  if (source === "document") return LEGACY_SUMMARY_TAG;
  return source === "member_answer" ? "manual" : source.replace(/_/g, " ");
}
/** Honest Missing line: confirm items exist only after clauses are recorded. */
export function missingNoticeNote(hasClauses: boolean): string {
  return hasClauses ? "open item asks to confirm it" : "a confirm item opens once the contract clauses are recorded";
}
