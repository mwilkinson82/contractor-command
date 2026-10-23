// Notice requirements in plain language for the PM (Athena chat and the internal report; never the client report).
// For each event type: how many days to give notice and who it goes to, read only from the contract's own clauses.
// Nothing is filled in: anything the contract doesn't state is named as missing. Clauses are quoted verbatim with section.
import type { ClauseRow } from "./contract-clauses";

type C = Pick<ClauseRow, "section" | "heading" | "category" | "verbatim_text" | "n_days" | "day_type" | "trigger_desc" | "source">;

export type NoticeEvent = "delay" | "change" | "claim" | "differing_site_conditions" | "nonpayment" | "schedule_disagreement" | "cure";

/** Core events every contract is checked for, then the others shown only when the contract has them. */
const CORE: NoticeEvent[] = ["delay", "change", "claim", "differing_site_conditions"];
const EXTRA: NoticeEvent[] = ["nonpayment", "schedule_disagreement", "cure"];
const LABEL: Record<NoticeEvent, string> = {
  delay: "Delays", change: "Changes", claim: "Claims", differing_site_conditions: "Differing site conditions",
  nonpayment: "Non-payment", schedule_disagreement: "Schedule disagreements", cure: "Notice to cure (termination for cause)",
};
const NOUN: Record<NoticeEvent, string> = {
  delay: "delays", change: "changes", claim: "claims", differing_site_conditions: "differing site conditions",
  nonpayment: "non-payment", schedule_disagreement: "schedule disagreements", cure: "a notice to cure",
};

const strip = (s: string) => s.replace(/\*+/g, "");
const NOTICE_WORDS = /\b(notice|notif(?:y|ication)|in writing|written)\b/i;

/** Which event a clause gives notice for, from its category, then its heading and own words. Null when it isn't a notice clause. */
export function noticeEventOf(c: Pick<C, "category" | "heading" | "verbatim_text">): NoticeEvent | null {
  const map: Partial<Record<string, NoticeEvent>> = { delay_notice: "delay", claim_notice: "claim", nonpayment_notice: "nonpayment", cure_notice: "cure", schedule_disagreement: "schedule_disagreement" };
  if (map[c.category]) return map[c.category]!;
  const h = (c.heading ?? "").toLowerCase();
  const t = strip(c.verbatim_text).toLowerCase();
  if (/differing|concealed|unforeseen|unknown (physical )?(site )?conditions/.test(h) || /differing (site )?conditions|concealed (or unknown )?(physical )?conditions/.test(t)) return "differing_site_conditions";
  if (/change/.test(h) || /\b(change order|change directive|change in the work|changes in the work|requested change)\b/.test(t)) return "change";
  return null;
}

/** A general "where notices go" clause (a Notices article), not tied to one event. */
export function isNoticeAddressClause(c: Pick<C, "heading" | "verbatim_text">): boolean {
  const h = (c.heading ?? "").trim().toLowerCase();
  const t = strip(c.verbatim_text);
  return /^(notices?|notice address(es)?|giving of notices?|written notices?)$/.test(h) || /\b(all|any) notices?\b[^.]{0,80}\b(shall|must|will) be (given|sent|delivered|addressed|mailed|made)\b[^.]{0,40}\bto\b/i.test(t);
}

const PARTY = "(Owner's Representative|Construction Manager|Contractor|Subcontractor|Owner|Architect|Engineer|Design Professional)";
/** A role named after the party's possessive, as written: "Contractor's Project Manager". */
const ROLE = "(?:'s|’s)\\s+((?:[A-Z][A-Za-z]*\\s+){0,3}(?:Manager|Representative|Superintendent|Officer|Director|Engineer|Administrator|Coordinator|Agent))";

/** Who the notice goes to, only when the clause's own words name the party. Returns the party word as written. */
export function recipientIn(text: string): string | null {
  const t = strip(text);
  // "delivered by email to Contractor's Project Manager": the delivery verb names who receives it, however long the sentence before it.
  const deliv = t.match(new RegExp(`\\b(?:delivered|sent|given|submitted|addressed|directed|served|mailed|emailed|provided)\\s+(?:(?:by|via)\\s+(?:e-?mail|certified mail|hand|courier|[a-z]+ mail)(?:\\s+(?:and|or)\\s+(?:e-?mail|certified mail|hand|courier|[a-z]+ mail))?\\s+)?to\\s+(?:the\\s+)?${PARTY}(?:${ROLE})?`));
  if (deliv) return deliv[2] ? `${deliv[1]}'s ${deliv[2]}` : deliv[1];
  const pats = [
    new RegExp(`\\b(?:give|gives|deliver|send|provide|furnish|serve|submit)\\s+(?:the\\s+)?${PARTY}\\s+(?:with\\s+)?(?:prompt\\s+)?(?:written\\s+)?notice`),
    new RegExp(`\\bnotify\\s+(?:the\\s+)?${PARTY}\\b`),
    new RegExp(`\\b(?:notice|notices|notification)\\b[^.;]{0,80}?\\b(?:to|upon|on)\\s+(?:the\\s+)?${PARTY}\\b`),
  ];
  for (const p of pats) {
    const m = t.match(new RegExp(`${p.source}(?:${ROLE})?`));
    if (m) return m[2] ? `${m[1]}'s ${m[2]}` : m[1];
  }
  return null;
}

const quote = (c: C) => `§${c.section}${c.heading ? ` ${c.heading}` : ""}: ‹${c.verbatim_text}›${c.source === "document" ? "" : " (UNVERIFIED — not found exactly in the contract text; check it)"}`;

function timing(c: C): string | null {
  if (c.n_days != null) {
    const dt = c.day_type ? `${c.day_type} ` : "";
    const trig = c.trigger_desc ? ` ${c.trigger_desc.replace(/,.*$/, "")}` : "";
    return `within ${c.n_days} ${dt}days${trig}`;
  }
  if (/\bpromptly\b/i.test(c.verbatim_text)) return "promptly (no number of days stated)";
  return null;
}

export type NoticeSummary = { lines: string[]; status: "none" | "partial" | "complete" | "not_recorded"; missing: string[] };

/**
 * Plain-language notice requirements.
 * clausesRecorded: the contract's clauses have been read in (an empty list then means the contract has no notice terms).
 * noticeFlagNo: the member recorded that the contract has no notice requirements.
 */
export function noticeRequirements(clauses: C[], o: { noticeFlagNo?: boolean } = {}): NoticeSummary {
  const address = clauses.filter(isNoticeAddressClause);
  const byEvent = new Map<NoticeEvent, C[]>();
  for (const c of clauses) {
    if (isNoticeAddressClause(c)) continue;
    const e = noticeEventOf(c);
    if (!e) continue;
    // A change clause only counts as a notice term if it speaks of notice/writing; otherwise it's shown as "covers changes, no notice terms".
    byEvent.set(e, [...(byEvent.get(e) ?? []), c]);
  }
  const head = "Notice requirements (plain language, from the contract clauses):";
  if (!clauses.length && !o.noticeFlagNo)
    return { status: "not_recorded", missing: [], lines: [head, "- No contract clauses are recorded yet, so Athena can't say what the notice requirements are. Record them with intake section clauses, copied exactly from the contract."] };
  const anyNotice = address.length > 0 || [...byEvent.values()].flat().some((c) => NOTICE_WORDS.test(c.verbatim_text) || c.n_days != null);
  if (!anyNotice)
    return { status: "none", missing: CORE.map((e) => NOUN[e]), lines: [head, "- In the contract we notice there are no specific notice requirements: it doesn't say how many days you have to give notice, or who notices go to, for delays, changes, claims, differing site conditions or anything else."] };

  const generalTo = address.map((c) => ({ c, who: recipientIn(c.verbatim_text) }));
  const lines = [head];
  if (address.length) lines.push(...address.map((c) => `- Where notices go: ${quote(c)}`));
  const noWhen: string[] = [];
  const noWho: string[] = [];
  const events = [...CORE, ...EXTRA.filter((e) => byEvent.has(e))];
  for (const e of events) {
    const cs = byEvent.get(e) ?? [];
    if (!cs.length) {
      noWhen.push(NOUN[e]);
      if (!address.length) noWho.push(NOUN[e]);
      lines.push(`- ${LABEL[e]}: the contract has no notice requirement for ${NOUN[e]} (no number of days and no one named to receive it).`);
      continue;
    }
    const withTiming = cs.find((c) => timing(c) && (NOTICE_WORDS.test(c.verbatim_text) || e !== "change"));
    const whoClause = cs.map((c) => ({ c, who: recipientIn(c.verbatim_text) })).find((x) => x.who);
    const when = withTiming ? `${timing(withTiming)} (§${withTiming.section})${withTiming.n_days != null && !withTiming.day_type ? " — the contract doesn't say calendar or business days" : ""}` : null;
    const who = whoClause ? `${whoClause.who} (§${whoClause.c.section})` : generalTo.find((g) => g.who) ? `${generalTo.find((g) => g.who)!.who} (§${generalTo.find((g) => g.who)!.c.section})` : address.length ? `see the notices clause (§${address.map((a) => a.section).join(", §")})` : null;
    if (!when && e !== "cure") noWhen.push(NOUN[e]);
    if (!who && e !== "cure") noWho.push(NOUN[e]);
    const whenTxt = when ? `notice ${when}` : "the contract doesn't say when notice must be given";
    const whoTxt = who ? `it goes to ${who}` : when ? "the contract doesn't say who it goes to" : "or who it goes to";
    if (e === "cure") lines.push(`- ${LABEL[e]}: this is a notice you receive; ${withTiming ? `you must cure ${timing(withTiming)} (§${withTiming.section})` : "the contract doesn't say how long you have to cure"}.`);
    else lines.push(`- ${LABEL[e]}: ${whenTxt}${!when && !who ? ` ${whoTxt}` : `; ${whoTxt}`}.${!when ? ` The clause${cs.length > 1 ? "s" : ""} below cover${cs.length > 1 ? "" : "s"} ${NOUN[e]} but set${cs.length > 1 ? "" : "s"} no notice deadline.` : ""}`);
    cs.forEach((c) => lines.push(`    ${quote(c)}`));
  }
  const missing: string[] = [];
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
  if (noWho.length || noWhen.length) {
    const parts: string[] = [];
    if (generalTo.length && noWhen.length) {
      const g = generalTo.find((x) => x.who);
      parts.push(`Notices should go to ${g ? `${g.who} (§${g.c.section})` : `the address in §${address[0].section}`}, but the contract doesn't outline when notices must be sent for ${list(noWhen)}.`);
    } else {
      if (noWhen.length) parts.push(`the contract doesn't outline when notice must be sent for ${list(noWhen)}`);
      if (noWho.length) parts.push(`it doesn't say who notice goes to for ${list(noWho)}`);
    }
    noWhen.forEach((x) => missing.push(`when: ${x}`));
    noWho.forEach((x) => missing.push(`who: ${x}`));
    const s = parts.join("; and ");
    lines.push(`- Missing: ${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.]$/.test(s) ? "" : "."} Nothing was filled in; confirm these with the contract or the GC.`);
  }
  return { status: missing.length ? "partial" : "complete", missing, lines };
}
