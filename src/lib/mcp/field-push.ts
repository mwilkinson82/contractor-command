// Web push for the field page. No email. VAPID keys come from the environment and are never written here.
import { parseSendTime, zonedClock } from "./field-reminder";

export const VAPID_PUBLIC_ENV = "ATHENA_VAPID_PUBLIC_KEY";
export const VAPID_PRIVATE_ENV = "ATHENA_VAPID_PRIVATE_KEY";
export const VAPID_SUBJECT = "mailto:support@meetathena.io";
export const FIELD_PUSH_TITLE = "Today's daily isn't in yet";
export const TEST_PUSH_JOB = "2701";

export function vapidConfig(env: Record<string, string | undefined> = process.env): { publicKey: string; privateKey: string } | null {
  const publicKey = env[VAPID_PUBLIC_ENV]?.trim() ?? "";
  const privateKey = env[VAPID_PRIVATE_ENV]?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
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

export function pushPayload(jobId: string, jobNumber: string, origin: string): { title: string; body: string; url: string } {
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
    icons: [{ src: `${root}/brand/athena/athena-primary-512.png`, sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}

/** iPhone and iPad need the page on the Home Screen before push works (iOS 16.4 or later). */
export function iosPushHint(userAgent: string, standalone: boolean): string | null {
  if (standalone) return null;
  if (!/iPhone|iPad|iPod/i.test(userAgent)) return null;
  return "Add Athena to your Home Screen first. In Safari, tap Share, then Add to Home Screen. Daily reminders on iPhone need iOS 16.4 or later.";
}
