// 0.8.12: required styled views for text-heavy results (lookahead, pay app, reminders, supplier/sub emails, IOR, portfolio).
// Same pattern as CPM_GANTT_SPEC (living.ts): each block rides in its matching tool result so every host draws
// the same view. Colors come from one place (alert-color.ts): navy/blue/gray, plus the alert color only for
// delays, risks and overdue items.
import { ALERT_COLOR } from "./alert-color";

const SHARED = `White cards, blue #2563EB accent, gray #9CA3AF secondary, ${ALERT_COLOR} only for risks, delays and overdue items, no orange. The visual comes first; no technical notes and one caveat line at most.`;

export const LOOKAHEAD_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – LOOKAHEAD: When the user asks for a lookahead, build ONE styled artifact or canvas, never plain text or a markdown table. In Claude this is always an artifact built from this result with no tool calls inside it, exactly like the schedule Gantt. Spec:",
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

export const IOR_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – IOR DASHBOARD: When the user asks for the IOR, indicated outcome or job health, always build ONE styled artifact or canvas, never plain text. Spec:",
  "1. Header: the job name, the as-of date, the contract, and the \"Forecast total $X = contract $X\" tie line word for word.",
  `2. KPI tiles: Indicated revenue, Indicated cost, Indicated GP $ and %, Budgeted GP $ and %, and GP change vs budget (${ALERT_COLOR} if down).`,
  "3. Waterfall chart: from Budgeted GP, through each pending CO (weighted), each risk hold (E-Hold/C-Hold) and cost variances, to Indicated GP.",
  `4. Risk register table: risk, exposure $, probability %, weighted $, owner, next action, due date. ${ALERT_COLOR} flags on the top 3 by weighted $.`,
  "5. Change order table: CO, status, revenue, cost, probability, weighted margin.",
  "6. Billing strip: billed, % billed, retainage held, paid, and left to bill.",
  "7. Use Athena's numbers exactly; never recompute them with other math.",
  `8. ${SHARED}`,
];

export const PORTFOLIO_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – COMPANY PORTFOLIO DASHBOARD: When the user asks for the company, portfolio or all-jobs dashboard, always build ONE styled artifact. Spec:",
  "1. Access: only for owner/leadership roles. A PM sees only their own jobs, with no other jobs' dollars or billing; say so in one line. Use only the jobs and dollars Athena returns for this user.",
  "2. KPI tiles across the top: active jobs, total contract value, total indicated GP $ and %, GP change vs budget, billed to date, left to bill, and retainage held.",
  `3. Job cards grid, one per job: job number and name, PM, contract, % complete, indicated GP %, GP change (${ALERT_COLOR} if down), schedule status chip (On track / At risk / Delayed +X WD (Y CD), always both units, ${ALERT_COLOR} only when delayed or at risk), and the next deadline with a countdown.`,
  "4. Bar chart of GP % by job (budgeted in gray #9CA3AF, indicated in blue #2563EB).",
  `5. \"Needs attention\" list: overdue notices, delays and top risks across jobs, each with job, owner and due date, ${ALERT_COLOR} flagged.`,
  "6. Monthly billing forecast chart across all jobs for the next 6 months.",
  `7. ${SHARED}`,
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

/** 0.8.18: Claude showed the email_draft card as a plain markdown block. Same pattern as the schedule: a REQUIRED VIEW in the result text. */
export const EMAIL_DRAFT_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – EMAIL DRAFT: show this draft as ONE styled email card, never a plain text or markdown block. In Claude: an artifact built only from this result (no tool calls inside it). In ChatGPT: a canvas or the host's email card. Spec:",
  "1. Header bar in navy with the title \"Email draft\" and a gray \"Not sent\" status pill.",
  "2. Rows: From (the suggested From, if given), To, Cc (only if any) and Subject, labels in gray #6B7280, values in navy.",
  "3. The full body exactly as written, on a light-gray #F3F4F6 panel, with the signature.",
  "4. Under the body: an attachment chip (PDF icon and the file name) only when an attachment is listed; otherwise a link row with the download link. Never show an attachment chip without a real attachment.",
  "5. Footer: the confirm question word for word, with a blue #2563EB \"Yes, send\" button and a gray \"No\" button. The buttons are for show; the member answers yes or no in chat.",
  `6. White card, navy, blue #2563EB and gray only; ${ALERT_COLOR} only if the email itself is about a delay, risk or overdue item, and then only for that one flag. No technical notes.`,
  "7. After the card, ask the confirm question as the last line of the reply and stop. Send nothing.",
];
