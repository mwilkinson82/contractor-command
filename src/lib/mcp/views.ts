// 0.8.12: required styled views. Full v0.8.22 render specs ride in the tool result.
// The label lines are render instructions, not an internal-guidance section.
import { ALERT_COLOR } from "./alert-color";

const SHARED = `White cards, blue #2563EB accent, gray #9CA3AF secondary, ${ALERT_COLOR} only for risks, delays and overdue items, no orange. The visual comes first; no technical notes and one caveat line at most.`;

export const LOOKAHEAD_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – LOOKAHEAD: When the user asks for a lookahead, build ONE styled artifact or canvas, never plain text or a markdown table. In Claude this is always an artifact built from this result with no tool calls inside it, exactly like the schedule Gantt. Spec:",
  "1. Header: the job name, the window (start to end date), the data date, and counts (activities, inspections, deliveries, risks).",
  "2. Top-3 priorities box first: three numbered cards, each with the action, owner and due date.",
  "3. Two-week calendar strip: 10 workday columns grouped Week 1 / Week 2, with the \"Highlight:\" date given above highlighted (today, or the data date when it is later), and weekends shaded or omitted.",
  "4. One row per activity, using the ID and name exactly as given. Critical activities (float 0) get ONE continuous rounded blue #1E5FED bar, others ONE continuous rounded gray #9CA3AF bar, from the first to the last of their workdays in the window with no gaps or breaks between days (never one block per day). Short inspections and deliveries (2 WD or less) keep their INSP/DLV marker instead of a bar.",
  "5. Icons on the day they fall: inspection/hold point = clipboard-check icon, material delivery = truck icon, milestone = diamond. Each has a small label.",
  `6. Risk flags: a ${ALERT_COLOR} flag on the bar or day only for an item explicitly marked high severity, risk, delay, delay notice, or overdue in this result. An ordinary open RFI, follow-up, low float or date check alone is not a red risk. Ordinary callouts use navy text and a blue #1E5FED line.`,
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
  "1. Header: job name and the saved report version and data date.",
  `2. Lead with contract value, planned GP dollars and margin, and indicated GP dollars and margin (${ALERT_COLOR} if down). Use the provided owner-confirmed outcome only when present; show unavailable for missing values.`,
  "3. Put the contract, planned GP and indicated GP with their margins first. Show the stated basis and as-of date; show unavailable when a verified value is missing.",
  `4. Show E-holds and C-holds as dollar risk × probability = held, with owner, response and next move. ${ALERT_COLOR} flags apply to stated risks.`,
  "5. Weight pending change orders by their stated probability and show face value beside it; never invent an amount or a probability.",
  "6. Billing strip: billed, % billed, retainage held, paid, and left to bill.",
  "7. Use Athena's numbers exactly; never recompute them with other math.",
  "8. Save the IOR as details.ior_model on living_report_save so the IOR page shows it: original_contract, original_cost_budget (null if none), cost_growth, actual_cost_to_date, phase (Early, Middle or Late), percent_complete, baseline_completion, forecast_completion, last_forecast_completion, change_orders [{number, description, status Approved, Pending or Denied, contract_amount, cost_amount, probability 0-100}], exposures [{title, short, category (procurement, owner_decision, design_drift, trade_performance, schedule_compression, allowance_overrun, field_change, closeout_punch or other), response eliminate, recover, offset or accept, hold E or C, dollar_risk, probability 0-100, owner, opened, next_review, next_move}]. Ask the PM for any cost amount or probability you don't have; never guess one.",
  `9. ${SHARED}`,
];

export const PORTFOLIO_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – COMPANY PORTFOLIO DASHBOARD: When the user asks for the company, portfolio or all-jobs dashboard, always build ONE styled artifact. Spec:",
  "1. Access: only for owner/leadership roles. A PM sees only their own jobs, with no other jobs' dollars or billing; say so in one line. Use only the jobs and dollars Athena returns for this user.",
  "2. KPI tiles across the top: active jobs, total contract value, total indicated GP $ and %, GP change vs budget, billed to date, left to bill, and retainage held.",
  `3. Job cards grid, one per job: job number and name, PM, contract, % complete, indicated GP %, GP change (${ALERT_COLOR} if down), schedule status chip (On track / At risk / Delayed +X WD (Y CD), always both units, ${ALERT_COLOR} only when delayed or at risk), and the next deadline with a countdown.`,
  "4. Bar chart of GP % by job (budgeted in gray #9CA3AF, indicated in blue #2563EB).",
  `5. "Needs attention" list: overdue notices, delays and top risks across jobs, each with job, owner and due date, ${ALERT_COLOR} flagged.`,
  "6. Monthly billing forecast chart across all jobs for the next 6 months.",
  `7. ${SHARED}`,
];

export const EMAIL_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – SUPPLIER / SUB EMAILS: one email card per message with labeled To:, Cc:, Subject: and Body fields, then a chip row (job, PO or sub, the delivery or due date asked for).",
  "Never send; show a \"Ready for your review\" note on each card. With several emails, show a summary strip first (recipient, purpose, date asked for).",
  "White background, compact heading, readable dark text and subtle gray dividers. No dark banner or bright-blue table header.",
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
export const EMAIL_DRAFT_ARTIFACT_LINE =
  "REQUIRED VIEW: use the native email review card when available, without a second draft artifact or approval controls. Only when that card is unavailable, show one static draft from this result (In Claude: an artifact built only from these facts, with no tool calls inside it) and ask for confirmation once in ordinary chat.";
export const EMAIL_DRAFT_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – EMAIL DRAFT: prefer the native email review card. This static fallback specification applies only when the native card is unavailable. Spec:",
  "1. Compact white header with the title \"Email draft\" and a quiet gray \"Not sent\" status pill. No dark banner.",
  "2. Rows: From (the suggested From, if given), To, Cc (only if any) and Subject, labels in gray, values in dark readable text.",
  "3. The full body exactly as written, with the signature.",
  "4. Under the body: an attachment chip naming the PDF only for a real reviewed attachment; otherwise a clearly labeled link with the exact destination. Never show an attachment chip without a real attachment.",
  "5. The native card's enabled Approve and send action is the Athena confirmation surface; do not also ask its confirm question. In a static fallback, show the confirm question word for word and ask once in ordinary chat. No buttons of any kind in that static fallback. Answer yes or no in chat.",
  `6. White card, dark readable text and restrained gray dividers only; ${ALERT_COLOR} only for an actual risk, delay or overdue flag. No technical notes.`,
  "7. After the native card do not repeat the confirmation question or generate approval controls. After a static fallback, ask once and stop. Send nothing until the exact draft is approved; required provider permissions remain in force.",
];
