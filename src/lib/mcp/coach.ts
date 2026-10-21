// 0.8.13: Athena coaches and leads the PM. After every completed step: ONE "Next move" card with a one-line
// "Why it matters", and after the CPM the six-item job cadence setup (one question at a time, with defaults).
// Athena directs; the host's AI does the work. Nothing is created, sent or saved without a clear yes.
import { ALERT_COLOR } from "./alert-color";
import { MORNING_CHECKIN_RULE } from "./morning";

export type CoachStep = "setup" | "cpm" | "sov" | "notice" | "pay_app" | "ior" | "tia" | "briefing";

export type NextMove = { step: CoachStep; action: string; why: string };

export const NEXT_MOVES: Record<CoachStep, NextMove> = {
  setup: { step: "setup", action: "build the schedule (CPM) for this job from the contract dates and scope", why: "we should build the CPM now so we can set the job cadence, cost-load it and track every delay with a fragnet" },
  cpm: { step: "cpm", action: "set up the job cadence: PM meeting, lookahead, daily updates, morning briefing, pay app dates and the schedule update cycle", why: "we should lock the cadence now so the meeting, lookahead, pay app and schedule update stay in sync and nothing slips" },
  sov: { step: "sov", action: "cost-load the schedule from this SOV", why: "we should cost-load now so the billing forecast and pay apps tie to the contract" },
  notice: { step: "notice", action: "set a reminder for the response deadline and log it in open items", why: "we should track it now so the contract clock is tracked and our rights are protected" },
  pay_app: { step: "pay_app", action: "update the billing forecast and the schedule to the same data date", why: "we should line them up so cash flow and progress match before the owner reviews it" },
  ior: { step: "ior", action: "assign an owner and due date to the top 3 risks", why: "we should assign them now so the margin at risk gets worked, not just reported" },
  briefing: { step: "briefing", action: "knock out today's top 3, starting with anything overdue", why: "we should clear the top 3 first so the critical path and the contract clock stay protected today" },
  tia: { step: "tia", action: "draft the delay notice with the +X WD (Y CD) result and reservation of rights", why: "we should draft it now so the time extension request lands inside the contract notice window" },
};

export const NEXT_MOVE_CHOICES = ["Yes, let's do it", "Not now"] as const;

/** Server-instruction rule (also quoted in each tool result). */
export const NEXT_MOVE_RULE =
  `REQUIRED NEXT MOVE: Athena coaches and leads the PM like a seasoned PM coach: short, direct, says "we". After every completed step (job setup, CPM, SOV, notice, pay app, IOR, TIA), end the reply with ONE styled "Next move" card: a single recommended action, one line "Why it matters: we should X so we can Y", and two choices: "${NEXT_MOVE_CHOICES[0]}" and "${NEXT_MOVE_CHOICES[1]}". Use the next_move given in the tool result. Ask one thing at a time. If the PM says "Not now", give a one-line recommendation and the reason, offer to help later, and move on. Never create reminders, send emails or save anything without a clear yes. Athena directs; your AI does the work. Card style: white card, navy title, blue #2563EB accent and buttons, gray #6B7280 text; ${ALERT_COLOR} only when the move is about a delay, risk or overdue item. No technical notes.`;

/** The six cadence items, asked in this order, one short question each, with a suggested default. */
export const CADENCE_ITEMS = [
  { key: "pm_meeting", label: "Weekly PM/OAC meeting", ask: "What day and time is the weekly PM/OAC meeting?", default: "Tue 10:00" },
  { key: "lookahead_day", label: "Two-week lookahead", ask: "What day do we build the two-week lookahead?", default: "Thu, issued to subs Fri" },
  { key: "daily_update_time", label: "Daily updates from the field", ask: "When are daily updates due from the field?", default: "4:00 PM daily" },
  { key: "morning_briefing_time", label: "Morning briefing", ask: "What time do you want your morning briefing?", default: "7:00 AM workdays" },
  { key: "pay_app_dates", label: "Pay app dates", ask: "What are the pay app dates: pencil draft day, cutoff and submission day?", default: "From the contract (pencil draft day, cutoff, submission day)" },
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
  "Pay app dates come from the contract when Athena has them; otherwise suggest the default and ask. Save each answer with job_cadence action save as you go.",
  `Then show a styled "Job cadence" card listing all six (white card, navy title, blue #2563EB labels, gray values), and ask: "${CADENCE_REMINDER_ASK}" Create the reminders with job_cadence_reminders only after a clear yes.`,
];

export function cadenceCardLines(c: Cadence): string[] {
  return ["Job cadence", ...CADENCE_ITEMS.map((i) => `- ${i.label}: ${c[i.key]?.trim() || "not set"}`)];
}

/** Guidance lines for a tool result: the next move card for this step (and the cadence setup after the CPM). */
export function nextMoveGuidance(step: CoachStep): string[] {
  const m = NEXT_MOVES[step];
  const lines = [NEXT_MOVE_RULE, `Next move: ${m.action}. Why it matters: ${m.why}.`];
  if (step === "cpm") lines.push(...CADENCE_SETUP_SPEC);
  return lines;
}

/** structuredContent.next_move for hosts that read data, not text. */
export function nextMoveData(step: CoachStep) {
  const m = NEXT_MOVES[step];
  return { step, action: m.action, why_it_matters: m.why, choices: [...NEXT_MOVE_CHOICES] };
}

type Res = { content?: unknown[]; structuredContent?: Record<string, unknown> };
/** Adds the next-move card (guidance + structured data) to a tool result. Composes with guide(). */
export function withNextMove<R>(r: R, step: CoachStep, guideFn: (r: R, ...lines: string[]) => R): R {
  const res = r as unknown as Res;
  const withData = { ...res, structuredContent: { ...(res.structuredContent ?? {}), next_move: nextMoveData(step) } } as unknown as R;
  return guideFn(withData, ...nextMoveGuidance(step));
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
