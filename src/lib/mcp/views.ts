// 0.8.12: required styled views for text-heavy results (lookahead, pay app, reminders, supplier/sub emails, IOR, portfolio).
// Same pattern as CPM_GANTT_SPEC (living.ts): each block rides in its matching tool result so every host draws
// the same view. Colors come from one place (alert-color.ts): navy/blue/gray, plus the alert color only for
// delays, risks and overdue items.
export const LOOKAHEAD_VIEW_SPEC: string[] = [
  "Show this lookahead from the activities and dates in this result.",
];

export const PAY_APP_VIEW_SPEC: string[] = [
  "Show the pay app from this result.",
  'Show the tie line "Forecast total $X = contract $X" word for word.',
];

export const REMINDERS_VIEW_SPEC: string[] = ["Show these reminders from this result."];

export const IOR_VIEW_SPEC: string[] = [
  "Show the IOR from this result. Use the amounts exactly as given.",
];

export const PORTFOLIO_VIEW_SPEC: string[] = [
  "Show the portfolio from this result. Use only the jobs in this result.",
];

export const EMAIL_VIEW_SPEC: string[] = [
  "Show one email card per message with To, Cc, Subject, and Body.",
  "Show a Ready for your review note. Do not send.",
];

/** Lookahead highlight: today, or the data date when that is later. */
export function lookaheadHighlight(
  today: string,
  dataDate: string | null | undefined,
): { date: string; basis: "today" | "data date" } {
  if (dataDate && /^\d{4}-\d{2}-\d{2}/.test(dataDate) && dataDate.slice(0, 10) > today)
    return { date: dataDate.slice(0, 10), basis: "data date" };
  return { date: today, basis: "today" };
}
export const highlightLine = (h: { date: string; basis: string }) =>
  `Highlight: ${h.date} (${h.basis})`;

/** Reminder source: the real source (contract §, RFI, notice, document) when the data has one, instead of "manual" / "setup check". */
export type SourceFields = {
  source?: string | null;
  clause_source?: string | null;
  action?: string | null;
  check_key?: string | null;
  waiting_on_document?: string | null;
  category?: string | null;
};
const RFI_RE = /\bRFI[\s#-]*(\d+[A-Za-z]?)\b/i;
const SEC_RE = /§\s*[\d.]+[a-z]?/i;
const GENERIC = /^(member[_ ]answer|manual|setup[_ ]check|setup|unknown|)$/i;
export function reminderSource(it: SourceFields): string | null {
  const cs = (it.clause_source ?? "").trim();
  if (cs && SEC_RE.test(cs)) return `Contract ${cs.match(SEC_RE)![0].replace(/\s+/, " ")}`;
  const act = it.action ?? "";
  const rfi = act.match(RFI_RE) ?? cs.match(RFI_RE);
  if (rfi) return `RFI ${rfi[1]}`;
  const sec = act.match(SEC_RE);
  if (sec) return `Contract ${sec[0].replace(/\s+/, " ")}`;
  if (cs && !/due date set by member/i.test(cs)) return cs;
  if (it.waiting_on_document) return `Waiting on ${it.waiting_on_document}`;
  if (/^(delay_notice|delay_claim):/i.test(it.check_key ?? "")) return "Delay notice";
  const src = (it.source ?? "").trim();
  if (src && !GENERIC.test(src)) return src.replace(/_/g, " ");
  return null;
}

/** 0.8.18: Claude showed the email_draft card as a plain markdown block. Same pattern as the schedule: a REQUIRED VIEW in the result text. */
/** 0.8.20: first line of the email_draft result, same pattern as the schedule Gantt and the lookahead (artifact ask first). */
export const EMAIL_DRAFT_ARTIFACT_LINE = "Show this email draft as a card. Do not send it.";
export const EMAIL_DRAFT_VIEW_SPEC: string[] = [
  "Show this draft as one email card with To, Cc, Subject, and the full body.",
  "Never show an attachment chip without a real attachment.",
  "Ask the confirm question word for word. Answer yes or no in chat. No buttons of any kind.",
  "Send nothing.",
];
