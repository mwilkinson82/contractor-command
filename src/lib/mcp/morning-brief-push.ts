// Morning brief web push. No email. One short note per user per local day.
// VAPID keys are read by the field push sender and are never written here.
import { zonedClock, parseSendTime } from "./field-reminder";
import { vapidConfig } from "./field-push";
import {
  recordFieldPush,
  type FieldPushResult,
  type PushMessage,
  type PushSendLog,
} from "./field-push-send";
import { briefView, buildMorningBrief, type BriefJob, type BriefSettings, type BuiltBrief } from "./morning-brief";

export const MORNING_BRIEF_CRON = "*/5 * * * *";
export const MORNING_BRIEF_PATH = "/today";
export const MORNING_BRIEF_UNCONFIGURED =
  "Athena morning brief did not send (unconfigured). ATHENA_VAPID_PUBLIC_KEY and ATHENA_VAPID_PRIVATE_KEY are not set.";

export type BriefSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type BriefCandidate = {
  userId: string;
  enabled: boolean;
  sendLocal: string;
  timeZone: string;
  lastSentOn: string | null;
  subscriptions: BriefSubscription[];
};

type Env = Record<string, string | undefined>;
type SendPush = (
  row: { endpoint: string; p256dh: string; auth: string },
  message: PushMessage,
  env: Env,
) => Promise<FieldPushResult>;

/** Due once the member's local clock is at or after the briefing time, and not already sent that local day. */
export function briefIsDue(
  row: Pick<BriefCandidate, "enabled" | "sendLocal" | "timeZone" | "lastSentOn">,
  now: Date,
): boolean {
  if (!row.enabled) return false;
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

export function briefHidesMoney(jobs: readonly BriefJob[]): boolean {
  return jobs.length > 0 && jobs.every((job) => briefView(job.seat, job.scope) === "superintendent");
}

function withoutMoney(value: string): string {
  return value.replace(/\$\d[\d,]*(?:\.\d+)?/g, "").replace(/\s+/g, " ").trim();
}

/** Short lock-screen line. Superintendents never get a dollar amount. */
export function morningBriefPush(built: BuiltBrief, jobs: readonly BriefJob[]): { title: string; body: string } {
  const hideMoney = briefHidesMoney(jobs);
  const row = built.card.sections?.find((section) => section.heading === "Don't forget")?.rows[0];
  let forget = (row?.cells[1] || row?.cells[0] || "").split(" · ")[0].trim();
  if (hideMoney) forget = withoutMoney(forget);
  const tail = forget ? ` Don't forget: ${forget}` : "";
  let body = `Good morning. ${built.counts.overdue} overdue, ${built.counts.today} today.${tail}`;
  if (hideMoney) body = withoutMoney(body);
  return { title: "Good morning", body: body.slice(0, 240) };
}

export function briefPageMarkup(documentHtml: string): string {
  const style = documentHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const article = documentHtml.match(/<article[\s\S]*<\/article>/)?.[0] ?? "";
  return `<style>${style}</style>${article}`;
}

function subscriptionOf(raw: unknown): BriefSubscription | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.endpoint !== "string" || !row.endpoint.startsWith("https://")) return null;
  return {
    id: row.id,
    endpoint: row.endpoint,
    p256dh: String(row.p256dh ?? ""),
    auth: String(row.auth ?? ""),
  };
}

export function briefCandidate(raw: Record<string, unknown>): BriefCandidate | null {
  if (typeof raw.user_id !== "string" || !raw.user_id) return null;
  const list = Array.isArray(raw.subscriptions) ? raw.subscriptions : [];
  const subscriptions = list.map(subscriptionOf).filter((row): row is BriefSubscription => row != null);
  if (!subscriptions.length) return null;
  return {
    userId: raw.user_id,
    enabled: raw.enabled !== false,
    sendLocal: String(raw.send_local ?? "06:30").slice(0, 5),
    timeZone: String(raw.time_zone ?? "America/New_York"),
    lastSentOn: raw.last_sent_on ? String(raw.last_sent_on).slice(0, 10) : null,
    subscriptions,
  };
}

export type BriefLoad = { jobs: BriefJob[]; hasCompany: boolean; settings?: BriefSettings };

/**
 * Send the morning brief to every due member. One bad endpoint cannot fail the run.
 * Missing VAPID keys log unconfigured and do not throw. A second pass the same local day is a no-op.
 */
export async function dispatchMorningBriefs(input: {
  rows: readonly Record<string, unknown>[];
  origin: string;
  now?: Date;
  env?: Env;
  loadBrief: (userId: string) => Promise<BriefLoad>;
  markSent: (userId: string, day: string, body: string) => Promise<boolean>;
  logSend: (entry: PushSendLog) => Promise<void>;
  markDead: (id: string) => Promise<void>;
  send?: SendPush;
}): Promise<{ sent: number; failed: number }> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const due: { row: BriefCandidate; day: string }[] = [];
  for (const raw of input.rows) {
    const row = briefCandidate(raw);
    if (!row || !briefIsDue(row, now)) continue;
    let day: string;
    try {
      day = zonedClock(row.timeZone, now).date;
    } catch {
      continue;
    }
    due.push({ row, day });
  }
  if (due.length === 0) return { sent: 0, failed: 0 };
  if (!vapidConfig(env)) {
    console.error(MORNING_BRIEF_UNCONFIGURED);
    try {
      await input.logSend({
        subscriptionId: null,
        userId: null,
        jobId: null,
        status: "unconfigured",
        httpCode: null,
        errorText: MORNING_BRIEF_UNCONFIGURED,
        payloadKind: "brief",
      });
    } catch {
      // The cron result is still returned.
    }
    return { sent: 0, failed: due.length };
  }
  const origin = input.origin.replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const { row, day } of due) {
    let outcome: "sent" | "failed" | "skip" = "skip";
    try {
      const loaded = await input.loadBrief(row.userId);
      const settings: BriefSettings = loaded.settings ?? {
        enabled: row.enabled,
        send_local: row.sendLocal,
        time_zone: row.timeZone,
      };
      const built = buildMorningBrief({
        jobs: loaded.jobs,
        hasCompany: loaded.hasCompany,
        settings,
        now,
      });
      const push = morningBriefPush(built, loaded.jobs);
      const marked = await input.markSent(row.userId, day, push.body);
      if (!marked) continue;
      const message: PushMessage = { title: push.title, body: push.body, url: `${origin}${MORNING_BRIEF_PATH}` };
      let anySent = false;
      let anyFailed = false;
      for (const sub of row.subscriptions) {
        const result = await recordFieldPush({
          target: {
            id: sub.id,
            userId: row.userId,
            jobId: null,
            endpoint: sub.endpoint,
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
          message,
          payloadKind: "brief",
          env,
          logSend: input.logSend,
          markDead: input.markDead,
          send: input.send,
        });
        if (result === "sent") anySent = true;
        else anyFailed = true;
      }
      outcome = anySent ? "sent" : anyFailed ? "failed" : "skip";
    } catch {
      outcome = "failed";
    }
    if (outcome === "sent") sent += 1;
    else if (outcome === "failed") failed += 1;
  }
  return { sent, failed };
}
