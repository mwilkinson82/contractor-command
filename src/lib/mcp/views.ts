// 0.8.12: required styled views for text-heavy results (lookahead, pay app, reminders, supplier/sub emails).
// Same pattern as CPM_GANTT_SPEC (living.ts): each block rides in its matching tool result so every host draws
// the same view. Colors come from one place (alert-color.ts): navy/blue/gray, plus the alert color only for
// delays, risks and overdue items.
import { ALERT_COLOR } from "./alert-color";

const SHARED = `White cards, blue #2563EB accent, gray #9CA3AF secondary, ${ALERT_COLOR} only for risks, delays and overdue items, no orange. The visual comes first; no technical notes and one caveat line at most.`;

export const LOOKAHEAD_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – LOOKAHEAD: When the user asks for a lookahead, build ONE styled artifact or canvas, never plain text. Spec:",
  "1. Header: the job name, the window (start to end date), the data date, and counts (activities, inspections, deliveries, risks).",
  "2. Top-3 priorities box first: three numbered cards, each with the action, owner and due date.",
  "3. Two-week calendar strip: 10 workday columns grouped Week 1 / Week 2, with the \"Highlight:\" date given above highlighted (today, or the data date when it is later), and weekends shaded or omitted.",
  "4. One row per activity, using the ID and name exactly as given. Critical activities (float 0) get solid blue #2563EB bars, others gray #9CA3AF, spanning their days in the window.",
  "5. Icons on the day they fall: inspection/hold point = clipboard-check icon, material delivery = truck icon, milestone = diamond. Each has a small label.",
  `6. Risk flags: a ${ALERT_COLOR} flag on the bar or day for any risk (late submittal, long lead, open RFI, an inspection that isn't scheduled yet, low float).`,
  "7. Risk cards below the strip, one per risk: what's at risk, its impact (activity and float), owner, due date, and the next action.",
  "8. Legend: Critical, Non-critical, Inspection, Delivery, Milestone, Risk.",
  `9. ${SHARED}`,
];

export const PAY_APP_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – PAY APP: when the user asks for a pay app or billing, build ONE styled card, never plain text. Spec:",
  "1. The \"Forecast total $X = contract $X\" tie line goes on top, word for word, then the period.",
  "2. KPI tiles: this period's gross, retainage, net due, % complete, contract balance left to bill.",
  "3. SOV table: line, description, scheduled value, previous, this period, stored, total, %, balance, with the totals row tying to the contract. Money with cents exactly as given.",
  "4. Offer Excel or PDF.",
  `5. ${SHARED}`,
];

export const REMINDERS_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – REMINDERS: build a styled list of cards, never plain bullets. Spec:",
  `1. Groups: Overdue (${ALERT_COLOR} flag), Due this week, Later.`,
  "2. Each card: the item, the job, the owner, the due date with a countdown chip (\"in 3 days\" / \"2 days late\"), and the source exactly as given (contract §, notice or RFI).",
  `3. ${SHARED}`,
];

export const EMAIL_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – SUPPLIER / SUB EMAILS: one email card per message with labeled To:, Cc:, Subject: and Body fields, then a chip row (job, PO or sub, the delivery or due date asked for).",
  "Never send; show a \"Ready for your review\" note on each card. With several emails, show a summary strip first (recipient, purpose, date asked for).",
  SHARED,
];

/** Lookahead highlight: today, or the data date when that is later. */
export function lookaheadHighlight(today: string, dataDate: string | null | undefined): { date: string; basis: "today" | "data date" } {
  if (dataDate && /^\d{4}-\d{2}-\d{2}/.test(dataDate) && dataDate.slice(0, 10) > today) return { date: dataDate.slice(0, 10), basis: "data date" };
  return { date: today, basis: "today" };
}
export const highlightLine = (h: { date: string; basis: string }) => `Highlight: ${h.date} (${h.basis})`;

/** Reminder source: the real source (contract §, RFI, notice, document) when the data has one, instead of "manual" / "setup check". */
export type SourceFields = {
  source?: string | null; clause_source?: string | null; action?: string | null; check_key?: string | null;
  waiting_on_document?: string | null; category?: string | null;
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
