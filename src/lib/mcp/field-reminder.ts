// Daily reminder for superintendents. Off unless the job turns it on AND the send flag is on.
// Mail, when it sends, comes from support@meetathena.io through the same Resend path as team invites.
// It never uses a marshall@ or office@ address.
import { outboundEmailDisabled } from "./email-safety";

export const FIELD_REMINDER_FROM = "Athena <support@meetathena.io>";
export const FIELD_REMINDER_ADDRESS = "support@meetathena.io";
export const FIELD_REMINDER_LINE = "Start your daily report and progress photos.";
export const FIELD_REMINDER_FLAG = "ATHENA_FIELD_REMINDER_EMAIL_ENABLED";
/** Default local time. The send window is this minute through the following 59 minutes (about 2–3 PM). */
export const FIELD_REMINDER_DEFAULT_TIME = "14:30";

const BLOCKED = /marshall@|office@/i;

export function reminderAddress(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

/** Refuses anything except the support address, including marshall@ and office@. */
export function assertReminderFrom(from: string): void {
  const addr = reminderAddress(from);
  if (BLOCKED.test(from) || BLOCKED.test(addr) || addr !== FIELD_REMINDER_ADDRESS)
    throw new Error("Daily reminders send only from support@meetathena.io.");
}

export function reminderEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[FIELD_REMINDER_FLAG] === "true" && !outboundEmailDisabled(env);
}

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

export function reminderDue(
  job: { enabled: boolean; send_local: string; last_sent_on: string | null; time_zone: string },
  now: Date,
): boolean {
  if (!job.enabled) return false;
  const send = parseSendTime(job.send_local);
  if (send == null) return false;
  let clock: { date: string; minutes: number };
  try {
    clock = zonedClock(job.time_zone, now);
  } catch {
    return false;
  }
  if (job.last_sent_on === clock.date) return false;
  return clock.minutes >= send && clock.minutes < send + 60;
}

export type ReminderEmail = { to: string; from: string; subject: string; text: string; html: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function buildReminderEmail(a: { to: string; jobNumber: string; jobName: string }): ReminderEmail {
  const from = FIELD_REMINDER_FROM;
  assertReminderFrom(from);
  const subject = `${a.jobNumber}: start your daily report and progress photos`;
  const text = [`Job ${a.jobNumber} — ${a.jobName}`, "", FIELD_REMINDER_LINE].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;color:#1E3A5F;max-width:420px">
<p style="margin:0 0 8px;font-size:13px;color:#6B7280">${esc(a.jobNumber)} — ${esc(a.jobName)}</p>
<p style="margin:0;font-size:16px;font-weight:600;color:#1E3A5F">${esc(FIELD_REMINDER_LINE)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#6B7280">Athena powered by ALP</p></div>`;
  return { to: a.to, from, subject, text, html };
}

export type ReminderJob = {
  enabled: boolean;
  send_local: string;
  last_sent_on: string | null;
  time_zone: string;
  jobNumber: string;
  jobName: string;
  recipients: string[];
};

export type ReminderSender = (m: ReminderEmail) => Promise<void>;

/** Sends nothing when the flag is off, the job is off, or it is outside the local window. */
export async function dispatchReminders(
  jobs: ReminderJob[],
  opts: { env?: Record<string, string | undefined>; sender: ReminderSender; now?: Date },
): Promise<{ status: "off" | "none" | "sent"; sent: number }> {
  if (!reminderEnabled(opts.env)) return { status: "off", sent: 0 };
  const now = opts.now ?? new Date();
  let sent = 0;
  for (const job of jobs) {
    if (!reminderDue(job, now)) continue;
    for (const to of job.recipients) {
      const msg = buildReminderEmail({ to, jobNumber: job.jobNumber, jobName: job.jobName });
      assertReminderFrom(msg.from);
      await opts.sender(msg);
      sent++;
    }
  }
  return { status: sent ? "sent" : "none", sent };
}

/** Real sender. Only reached when dispatchReminders has already decided to send. */
export const resendReminderSender: ReminderSender = async (m) => {
  assertReminderFrom(m.from);
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
  });
  if (!r.ok) throw new Error(`reminder email failed (${r.status})`);
};
