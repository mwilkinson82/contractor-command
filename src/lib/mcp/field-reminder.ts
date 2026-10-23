// In-chat daily reminder. No email and no web push.
// After the job's local reminder time, the first tool call of the day can prepend one card.
import { htmlBlock, renderMarkdown } from "./cards/markdown";
import { renderHtml } from "./cards/html";
import type { CardModel } from "./cards/model";
import { addDays, DEFAULT_TZ } from "./deadlines";

export const FIELD_REMINDER_DEFAULT_TIME = "14:30";
export const DAILY_REMINDER_TITLE = "Today's daily isn't in yet";

export function zonedClock(tz: string, now: Date): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute) };
}

export function parseSendTime(value: string): number | null {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function clockLabel(sendLocal: string): string {
  const mins = parseSendTime(sendLocal) ?? parseSendTime(FIELD_REMINDER_DEFAULT_TIME)!;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** True once local time is at or after the reminder time. The card stays available for the rest of that day. */
export function shouldShowDailyCard(input: {
  enabled: boolean;
  localMinutes: number;
  sendLocal: string;
  dailyToday: boolean;
  alreadyShown: boolean;
}): boolean {
  if (!input.enabled || input.dailyToday || input.alreadyShown) return false;
  const send = parseSendTime(input.sendLocal);
  if (send == null) return false;
  return input.localMinutes >= send;
}

/** A previous day is overdue when the last filed daily is older than yesterday. */
export function dailyIsOverdue(lastDaily: string | null | undefined, today: string): boolean {
  if (!lastDaily) return false;
  return lastDaily.slice(0, 10) < addDays(today.slice(0, 10), -1);
}

export function hostScheduleLine(jobNumber: string, sendLocal = FIELD_REMINDER_DEFAULT_TIME): string {
  return `Paste this into a weekday ${clockLabel(sendLocal)} task in ChatGPT or Grok: ask Athena if my daily is in for job ${jobNumber}`;
}

export function dailyReminderCard(input: {
  jobNumber: string;
  jobName: string;
  overdue: boolean;
  lastDaily?: string | null;
  sendLocal?: string;
}): CardModel {
  const sendLocal = input.sendLocal || FIELD_REMINDER_DEFAULT_TIME;
  return {
    state: "ask",
    title: DAILY_REMINDER_TITLE,
    job: `${input.jobNumber} – ${input.jobName}`,
    alerts: input.overdue
      ? [{ level: "overdue", text: input.lastDaily ? `No daily since ${input.lastDaily}.` : "A previous daily is still missing." }]
      : [],
    sections: [{ heading: "Optional host schedule", kind: "list", rows: [{ cells: [hostScheduleLine(input.jobNumber, sendLocal)], tone: "action" }] }],
    next_move: "Start today's daily.",
  };
}

export function renderDailyReminder(card: CardModel): string {
  return `${renderMarkdown(card)}\n\n${htmlBlock(renderHtml(card))}`;
}

type TextBlock = { type: string; text?: string };
type TextRes = { content?: TextBlock[]; structuredContent?: Record<string, unknown> };

export function prependDailyReminderCard<R>(result: R, card: CardModel): R {
  const res = result as unknown as TextRes;
  const first = res.content?.find((c) => c.type === "text" && typeof c.text === "string");
  if (!first?.text) return result;
  const block = renderDailyReminder(card);
  const content = res.content!.map((c) => (c === first ? { ...c, text: `${block}\n\n${first.text}` } : c));
  return {
    ...res,
    content,
    structuredContent: { ...(res.structuredContent ?? {}), daily_reminder_card: card, daily_reminder_action: "daily_report_draft" },
  } as unknown as R;
}

export type ReminderStatus = {
  found?: boolean;
  job_id?: string;
  job_number?: string;
  job_name?: string;
  enabled?: boolean;
  send_local?: string;
  time_zone?: string;
  local_date?: string;
  local_minutes?: number;
  daily_today?: boolean;
  last_daily?: string | null;
  already_shown?: boolean;
};

type Rpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

async function reminderStatus(sb: Rpc, jobNumber: string): Promise<ReminderStatus | null> {
  try {
    const { data, error } = await sb.rpc("mcp_daily_reminder_status", { _job_number: jobNumber });
    if (error || !data || typeof data !== "object") return null;
    const row = data as ReminderStatus;
    return row.found ? row : null;
  } catch {
    return null;
  }
}

/** Prepends the card once, after the reminder time, when today's daily is missing. Fails open. */
export async function attachDailyReminder<R>(sb: Rpc, jobNumber: string | null | undefined, result: R): Promise<R> {
  const job = jobNumber?.trim();
  if (!job) return result;
  const existing = (result as unknown as TextRes).structuredContent;
  if (existing && "daily_reminder_card" in existing) return result;
  const row = await reminderStatus(sb, job);
  if (!row?.job_id || !row.local_date) return result;
  const show = shouldShowDailyCard({
    enabled: row.enabled === true,
    localMinutes: Number(row.local_minutes ?? -1),
    sendLocal: row.send_local || FIELD_REMINDER_DEFAULT_TIME,
    dailyToday: row.daily_today === true,
    alreadyShown: row.already_shown === true,
  });
  if (!show) return result;
  try {
    const marked = await sb.rpc("mcp_daily_reminder_mark_shown", { _job: row.job_id, _day: row.local_date });
    const recorded = !!marked.data && typeof marked.data === "object" && (marked.data as { recorded?: boolean }).recorded === true;
    if (marked.error || !recorded) return result;
  } catch {
    return result;
  }
  const card = dailyReminderCard({
    jobNumber: row.job_number || job,
    jobName: row.job_name || "",
    overdue: dailyIsOverdue(row.last_daily, row.local_date),
    lastDaily: row.last_daily,
    sendLocal: row.send_local,
  });
  return prependDailyReminderCard(result, card);
}

export function previewDailyReminderCard(input: { jobNumber: string; jobName: string; status?: ReminderStatus | null }): { card: CardModel; text: string } {
  const today = input.status?.local_date || zonedClock(input.status?.time_zone || DEFAULT_TZ, new Date()).date;
  const card = dailyReminderCard({
    jobNumber: input.jobNumber,
    jobName: input.jobName,
    overdue: dailyIsOverdue(input.status?.last_daily, today),
    lastDaily: input.status?.last_daily,
    sendLocal: input.status?.send_local,
  });
  return { card, text: renderDailyReminder(card) };
}
