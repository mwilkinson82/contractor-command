// 0.8.13: Athena coaches and leads the PM. After every completed step: ONE "Next move" card with a one-line
// "Why it matters", and after the CPM the six-item job cadence setup (one question at a time, with defaults).
// Athena directs; the host's AI does the work. Nothing is created, sent or saved without a clear yes.
import { ALERT_COLOR } from "./alert-color";
import { MORNING_CHECKIN_RULE } from "./morning";

export type CoachStep = "setup" | "cpm" | "sov" | "notice" | "pay_app" | "ior" | "tia" | "briefing";

export type NextMove = { step: CoachStep; action: string; why: string };

const PAY_APP_NEXT_MOVES_DEFAULT = "update the billing forecast and the schedule to the same data date";

export const NEXT_MOVES: Record<CoachStep, NextMove> = {
  setup: { step: "setup", action: "build the schedule (CPM) for this job from the contract dates and scope", why: "we should build the CPM now so we can set the job cadence, cost-load it and track every delay with a fragnet" },
  cpm: { step: "cpm", action: "set up the job cadence: PM meeting, lookahead, daily updates, morning briefing, pay app dates and the schedule update cycle", why: "we should lock the cadence now so the meeting, lookahead, pay app and schedule update stay in sync and nothing slips" },
  sov: { step: "sov", action: "cost-load the schedule from this SOV", why: "we should cost-load now so the billing forecast and pay apps tie to the contract" },
  notice: { step: "notice", action: "set a reminder for the response deadline and log it in open items", why: "we should track it now so the contract clock is tracked and our rights are protected" },
  pay_app: { step: "pay_app", action: PAY_APP_NEXT_MOVES_DEFAULT, why: "we should line them up so cash flow and progress match before the owner reviews it" },
  ior: { step: "ior", action: "assign an owner and due date to the top 3 risks", why: "we should assign them now so the margin at risk gets worked, not just reported" },
  briefing: { step: "briefing", action: "knock out today's top 3, starting with anything overdue", why: "we should clear the top 3 first so the critical path and the contract clock stay protected today" },
  tia: { step: "tia", action: "draft the delay notice with the +X WD (Y CD) result and reservation of rights", why: "we should draft it now so the time extension request lands inside the contract notice window" },
};

export const NEXT_MOVE_CHOICES = ["Yes, let's do it", "Not now"] as const;

/** 0.8.13 dry-run fix: every IOR top-3 item carries an owner and a due date. */
export const PROPOSED_MARK = "(proposed)";
export const IOR_TOP3_RULE =
  `REQUIRED IOR TOP 3: each of the top 3 risks shows an owner and a due date. If Athena has no owner or no due date for one, propose one (owner: the job's PM; due: 7 days out, or sooner if the risk ties to a contract deadline) and mark it "${PROPOSED_MARK}", e.g. "Owner: J. Smith ${PROPOSED_MARK} · Due 2026-10-28 ${PROPOSED_MARK}", then ask the PM in one question to confirm or change them. Never leave an owner or due date blank and never present a proposed one as confirmed.`;

/** Server-instruction rule (also quoted in each tool result). */
export const WHY_LABEL = "Why it matters:" as const;

/** 0.8.13 dry-run fix: the two allowed next moves after a pay app or SOV billing reply. Never anything else. */
export const PAY_APP_NEXT_MOVES = [
  PAY_APP_NEXT_MOVES_DEFAULT,
  "the next billing step: build next period's pencil draft from the saved forecast before the cutoff",
] as const;
export const PAY_APP_NEXT_MOVE_RULE =
  `REQUIRED PAY APP NEXT MOVE: every pay app or SOV billing reply (preview, draft, pencil draft, billing forecast or billing drill-down, in every host including Claude) ends with the Next move card, never without it. The action is one of exactly two: "${PAY_APP_NEXT_MOVES[0]}" (the default) or "${PAY_APP_NEXT_MOVES[1]}". Never make up a different pay app move (not "Confirm October billable work", not a question about the period's quantities).`;

/** Server-instruction rule (also quoted in each tool result). */
export const NEXT_MOVE_RULE =
  `REQUIRED NEXT MOVE: Athena coaches and leads the PM like a seasoned PM coach: short, direct, says "we". After every completed step (job setup, CPM, SOV, notice, pay app, IOR, TIA), end the reply with ONE styled "Next move" card: a single recommended action, then a line that starts with the literal label "${WHY_LABEL}" followed by "we should X so we can Y" (the label "${WHY_LABEL}" is required word for word on every card, in every host; never drop or rename it), and two choices: "${NEXT_MOVE_CHOICES[0]}" and "${NEXT_MOVE_CHOICES[1]}". Use the next_move given in the tool result word for word. Ask one thing at a time. If the PM says "Not now", give a one-line recommendation and the reason, offer to help later, and move on. Never create reminders, send emails or save anything without a clear yes. Athena directs; your AI does the work. Card style: white card, navy title, blue #2563EB accent and buttons, gray #6B7280 text; ${ALERT_COLOR} only when the move is about a delay, risk or overdue item. No technical notes. ${PAY_APP_NEXT_MOVE_RULE} ${IOR_TOP3_RULE}`;



/** 0.8.13 dry-run fix: pay app cadence is ONE yes/no question with defaults, never a multi-step exchange. */
export const PAY_APP_CADENCE_DEFAULT = "Pay apps due the 25th; billing period ends the last day of the month";
export const PAY_APP_CADENCE_ASK = "Pay apps due the 25th, billing period ends the last day of the month, OK?";
export const PAY_APP_CADENCE_RULE =
  `Pay app dates (item e) are ONE question with the defaults filled in: "${PAY_APP_CADENCE_ASK}" When the contract gives other dates, put those into the same one sentence instead (e.g. "Pay apps due the 20th, billing period ends the 15th, OK?"). A yes saves it as given; if they change one part, save their version. Never split it into separate questions about the pencil draft, cutoff or submission day.`;

/** The six cadence items, asked in this order, one short question each, with a suggested default. */
export const CADENCE_ITEMS = [
  { key: "pm_meeting", label: "Weekly PM/OAC meeting", ask: "What day and time is the weekly PM/OAC meeting?", default: "Tue 10:00" },
  { key: "lookahead_day", label: "Two-week lookahead", ask: "What day do we build the two-week lookahead?", default: "Thu, issued to subs Fri" },
  { key: "daily_update_time", label: "Daily updates from the field", ask: "When are daily updates due from the field?", default: "4:00 PM daily" },
  { key: "morning_briefing_time", label: "Morning briefing", ask: "What time do you want your morning briefing?", default: "7:00 AM workdays" },
  { key: "pay_app_dates", label: "Pay app dates", ask: PAY_APP_CADENCE_ASK, default: PAY_APP_CADENCE_DEFAULT },
  { key: "update_cycle", label: "Schedule update cycle", ask: "How often do we update the schedule?", default: "Monthly, data date = pay app cutoff" },
] as const;

export type CadenceKey = (typeof CADENCE_ITEMS)[number]["key"];
export type Cadence = Partial<Record<CadenceKey, string>>;

/** Stored on the job as one known fact (module scope, this key). No new table or column. */
export const CADENCE_FACT_KEY = "job_cadence";
export const CADENCE_REMINDER_ASK = "Want me to set these up as reminders?";

export function nextCadenceItem(c: Cadence) {
  return CADENCE_ITEMS.find((i) => !c[i.key]?.trim()) ?? null;
}

export const CADENCE_SETUP_SPEC: string[] = [
  "REQUIRED: JOB CADENCE SETUP, after the CPM is built or approved. Ask the six items in order, ONE short question per reply, each with its suggested default the PM can accept with a yes:",
  ...CADENCE_ITEMS.map((i, n) => `${String.fromCharCode(97 + n)}. ${i.ask} (default ${i.default})`),
  `After item d (morning briefing time): ${MORNING_CHECKIN_RULE}`,
  PAY_APP_CADENCE_RULE,
  "Save each answer with job_cadence action save as you go.",
  `Then show a styled "Job cadence" card listing all six (white card, navy title, blue #2563EB labels, gray values), and ask: "${CADENCE_REMINDER_ASK}" Create the reminders with job_cadence_reminders only after a clear yes.`,
];

export function cadenceCardLines(c: Cadence): string[] {
  return ["Job cadence", ...CADENCE_ITEMS.map((i) => `- ${i.label}: ${c[i.key]?.trim() || "not set"}`)];
}

/** Guidance lines for a tool result: the next move card for this step (and the cadence setup after the CPM). */
export function nextMoveGuidance(step: CoachStep): string[] {
  const m = NEXT_MOVES[step];
  const lines = [NEXT_MOVE_RULE, `Next move: ${m.action}. ${WHY_LABEL} ${m.why}.`];
  if (step === "pay_app") lines.push(PAY_APP_NEXT_MOVE_RULE);
  if (step === "sov") lines.push(`If this SOV reply is for billing (a pay app, a billing period or SOV billing), the card is the pay app next move instead. ${PAY_APP_NEXT_MOVE_RULE}`);
  if (step === "ior") lines.push(IOR_TOP3_RULE);
  if (step === "cpm") lines.push(...CADENCE_SETUP_SPEC);
  return lines;
}

/** structuredContent.next_move for hosts that read data, not text. */
export function nextMoveData(step: CoachStep) {
  const m = NEXT_MOVES[step];
  return {
    step, action: m.action, why_it_matters: m.why, why_label: WHY_LABEL, card_lines: nextMoveCardLines(step), choices: [...NEXT_MOVE_CHOICES], required: true,
    ...(step === "pay_app" ? { allowed_actions: [...PAY_APP_NEXT_MOVES] } : {}),
  };
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** The card exactly as the member sees it (title line, the literal "Why it matters:" line, the two choices). */
export function nextMoveCardLines(step: CoachStep): string[] {
  const m = NEXT_MOVES[step];
  return [`Next move: ${cap(m.action)}.`, `${WHY_LABEL} ${cap(m.why)}.`, `${NEXT_MOVE_CHOICES[0]} | ${NEXT_MOVE_CHOICES[1]}`];
}

type Res = { content?: unknown[]; structuredContent?: Record<string, unknown> };
/** Adds the next-move card (guidance + structured data) to a tool result. Composes with guide(). */
export function withNextMove<R>(r: R, step: CoachStep, guideFn: (r: R, ...lines: string[]) => R): R {
  const res = r as unknown as Res;
  const withData = { ...res, structuredContent: { ...(res.structuredContent ?? {}), next_move: nextMoveData(step) } } as unknown as Res;
  // Pay app replies carry the card in the visible text too, so a host that reads only the text still ends with it.
  if (step === "pay_app") withData.content = withCardText(withData.content, nextMoveCardLines(step));
  return guideFn(withData as unknown as R, ...nextMoveGuidance(step));
}

const FOOTER_MARK = "\n\n---\nAthena powered by ALP";
function withCardText(content: unknown[] | undefined, lines: string[]): unknown[] | undefined {
  if (!content?.length) return content;
  let done = false;
  return content.map((c) => {
    const t = c as { type?: string; text?: unknown };
    if (done || t.type !== "text" || typeof t.text !== "string" || t.text.includes(lines[0])) return c;
    done = true;
    const i = t.text.lastIndexOf(FOOTER_MARK);
    const card = `\n\n${lines.join("\n")}`;
    return { ...t, text: i >= 0 ? `${t.text.slice(0, i)}${card}${t.text.slice(i)}` : `${t.text}${card}` };
  });
}

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** The next date (YYYY-MM-DD, after today) for a cadence value that starts with a weekday; else the next workday. */
export function nextCadenceDate(value: string, today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  const m = value.trim().toLowerCase().match(/^(sun|mon|tue|wed|thu|fri|sat)/);
  for (let i = 1; i <= 7; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const w = x.getUTCDay();
    if (m ? DOW[w] === m[1] : w >= 1 && w <= 5) return x.toISOString().slice(0, 10);
  }
  return today;
}

// 0.8.13: connect check before any calendar or email step, and real report attachments.
export const CONNECT_CHECK_RULE =
  "REQUIRED CONNECT CHECK: before any step that needs the member's calendar or email (cadence reminders or events, the morning briefing's overnight-email summary, drafting or sending an email, sending a report), check that this app has that connector. If it doesn't, stop and say in one line what's missing and why, e.g. \"To put this on your calendar, connect your Google or Outlook calendar first. Here's how in this app.\" Pause until they connect it, then pick up exactly where you left off. If they skip, keep going without that part and say so once. Never pretend it was done.";

export const REMINDER_DELIVERY_OPTIONS = ["calendar", "ai_reminders", "both"] as const;
export type ReminderDelivery = (typeof REMINDER_DELIVERY_OPTIONS)[number];
export const REMINDER_DELIVERY_DEFAULT: ReminderDelivery = "calendar";
export const REMINDER_DELIVERY_ASK = "Calendar events, AI reminders, or both? (Default: calendar.)";
export const REMINDER_DELIVERY_RULE =
  `Cadence reminders: ask "${REMINDER_DELIVERY_ASK}" Calendar = real recurring events with alerts on the member's calendar (connect check first). AI reminders = this app's own scheduled task, if it has one; if it has none, say so and use the calendar. Athena also keeps each one as a reminder on the job.`;

export const REPORT_ATTACHMENT_RULE =
  "REQUIRED ATTACHMENT: when the member says to send or share a report (schedule, lookahead, pay app, IOR, dashboard, billing forecast, SOV) with someone: 1) build it as a real file first, PDF by default (Excel for pay apps and SOVs if asked), named \"<Job#> <Report> <date>.pdf\"; 2) connect check for email; 3) attach that file to the email draft and show the email card with To:, Cc:, Subject:, Body and an \"Attachment: <filename>\" chip; never paste a summary instead and never say \"attached\" unless the file is on the draft; 4) if this app can't attach files, say so plainly and offer the downloadable file plus a draft to attach it to, and put the file_share link (app.meetathena.io/f/, opens for anyone with it) in the body; 5) send only on the member's clear yes.";

export const REPORT_SEND_GUIDANCE: string[] = [CONNECT_CHECK_RULE, REPORT_ATTACHMENT_RULE];

CADENCE_SETUP_SPEC.push(REMINDER_DELIVERY_RULE, CONNECT_CHECK_RULE);
