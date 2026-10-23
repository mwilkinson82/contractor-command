// Web push for the field page. No email. VAPID keys come from the environment and are never written here.
import { parseSendTime, zonedClock } from "./field-reminder";

export const VAPID_PUBLIC_ENV = "ATHENA_VAPID_PUBLIC_KEY";
export const VAPID_PRIVATE_ENV = "ATHENA_VAPID_PRIVATE_KEY";
export const VAPID_SUBJECT = "mailto:support@meetathena.io";
export const FIELD_PUSH_TITLE = "Today's daily isn't in yet";
export const TEST_PUSH_JOB = "2701";

export function vapidConfig(
  env: Record<string, string | undefined> = process.env,
): { publicKey: string; privateKey: string } | null {
  const publicKey = env[VAPID_PUBLIC_ENV]?.trim() ?? "";
  const privateKey = env[VAPID_PRIVATE_ENV]?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

/** Logged when either VAPID env var is missing. Names the variables and never includes their values. */
export const VAPID_MISSING_STATUS =
  "Athena field push did not send. ATHENA_VAPID_PUBLIC_KEY and ATHENA_VAPID_PRIVATE_KEY are not set.";

export function pushHttpCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { statusCode?: unknown; status?: unknown };
  const code = record.statusCode ?? record.status;
  return typeof code === "number" && Number.isInteger(code) ? code : null;
}

/** 404 and 410 mean the browser subscription is gone. */
export function pushIsGone(httpCode: number | null): boolean {
  return httpCode === 404 || httpCode === 410;
}

/** Short failure text. Drops any configured key material that a library error might echo. */
export function pushErrorText(error: unknown, secrets: readonly string[] = []): string {
  const raw = error instanceof Error && error.message.trim() ? error.message : "Push send failed.";
  let text = raw.replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length < 8) continue;
    text = text.split(value).join("[redacted]");
  }
  return (text.trim() || "Push send failed.").slice(0, 500);
}

export type PushCandidate = {
  id: string;
  jobNumber: string;
  jobName?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
  sendLocal: string;
  timeZone: string;
  dailyToday: boolean;
  lastSentOn: string | null;
};

/** Due once the local clock is at or after the reminder time, and not already sent today. */
export function pushIsDue(row: PushCandidate, now: Date): boolean {
  if (!row.enabled || row.dailyToday) return false;
  const send = parseSendTime(row.sendLocal);
  if (send == null) return false;
  let clock: { date: string; minutes: number };
  try {
    clock = zonedClock(row.timeZone, now);
  } catch {
    return false;
  }
  if (row.lastSentOn === clock.date) return false;
  return clock.minutes >= send;
}

export function pushPayload(
  jobId: string,
  jobNumber: string,
  origin: string,
): { title: string; body: string; url: string } {
  return {
    title: FIELD_PUSH_TITLE,
    body: `Job ${jobNumber}: start your daily report and progress photos.`,
    url: `${origin.replace(/\/$/, "")}/r/job/${jobId}/field`,
  };
}

export function fieldManifest(jobId: string, origin: string) {
  const root = origin.replace(/\/$/, "");
  return {
    name: "Athena field",
    short_name: "Athena",
    description: "Athena field board and daily reminders.",
    start_url: `${root}/r/job/${jobId}/field`,
    scope: `${root}/r/job/${jobId}/`,
    display: "standalone",
    background_color: "#F3F4F6",
    theme_color: "#1E3A5F",
    icons: [
      {
        src: `${root}/brand/athena/athena-primary-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}

/** iPhone and iPad need the page on the Home Screen before push works (iOS 16.4 or later). */
export function iosPushHint(userAgent: string, standalone: boolean): string | null {
  if (standalone) return null;
  if (!/iPhone|iPad|iPod/i.test(userAgent)) return null;
  return "Add Athena to your Home Screen first. In Safari, tap Share, then Add to Home Screen. Daily reminders on iPhone need iOS 16.4 or later.";
}
