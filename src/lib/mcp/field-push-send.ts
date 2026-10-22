// Sends one Web Push message. Keys are read from the environment at call time and are not logged.
import {
  VAPID_MISSING_STATUS,
  VAPID_SUBJECT,
  pushErrorText,
  pushHttpCode,
  pushIsDue,
  pushIsGone,
  pushPayload,
  vapidConfig,
  type PushCandidate,
} from "./field-push";
import { zonedClock } from "./field-reminder";

export type PushMessage = { title: string; body: string; url: string };

export type FieldPushResult =
  | { status: "sent"; httpCode: number }
  | { status: "unconfigured" }
  | { status: "failed"; httpCode: number | null; errorText: string; dead: boolean };

export type PushSendLog = {
  subscriptionId: string | null;
  userId: string | null;
  jobId: string | null;
  status: "success" | "failure" | "unconfigured";
  httpCode: number | null;
  errorText: string | null;
  payloadKind: "daily" | "test" | "brief";
};

export type PushSendTarget = {
  id: string | null;
  userId: string | null;
  jobId: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type Env = Record<string, string | undefined>;
type SendPush = (
  row: Pick<PushCandidate, "endpoint" | "p256dh" | "auth">,
  message: PushMessage,
  env: Env,
) => Promise<FieldPushResult>;

function secretsFor(env: Env, row: { p256dh: string; auth: string }): string[] {
  const keys = vapidConfig(env);
  return [keys?.publicKey, keys?.privateKey, row.p256dh, row.auth].filter(
    (value): value is string => typeof value === "string",
  );
}

function failedFrom(
  error: unknown,
  env: Env,
  row: { p256dh: string; auth: string },
): FieldPushResult {
  const httpCode = pushHttpCode(error);
  return {
    status: "failed",
    httpCode,
    errorText: pushErrorText(error, secretsFor(env, row)),
    dead: pushIsGone(httpCode),
  };
}

export async function sendFieldPush(
  row: Pick<PushCandidate, "endpoint" | "p256dh" | "auth">,
  message: PushMessage,
  env: Env = process.env,
): Promise<FieldPushResult> {
  const keys = vapidConfig(env);
  if (!keys) return { status: "unconfigured" };
  try {
    const webpush = await import("web-push");
    webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
    const response = await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(message),
    );
    const httpCode = typeof response?.statusCode === "number" ? response.statusCode : 201;
    return { status: "sent", httpCode };
  } catch (error) {
    return failedFrom(error, env, row);
  }
}

function logEntry(
  target: PushSendTarget,
  kind: PushSendLog["payloadKind"],
  result: FieldPushResult,
): PushSendLog {
  if (result.status === "sent") {
    return {
      subscriptionId: target.id,
      userId: target.userId,
      jobId: target.jobId,
      status: "success",
      httpCode: result.httpCode,
      errorText: null,
      payloadKind: kind,
    };
  }
  if (result.status === "unconfigured") {
    return {
      subscriptionId: target.id,
      userId: target.userId,
      jobId: target.jobId,
      status: "unconfigured",
      httpCode: null,
      errorText: VAPID_MISSING_STATUS,
      payloadKind: kind,
    };
  }
  return {
    subscriptionId: target.id,
    userId: target.userId,
    jobId: target.jobId,
    status: "failure",
    httpCode: result.httpCode,
    errorText: result.errorText,
    payloadKind: kind,
  };
}

/** One subscription. A thrown endpoint, a log write, or a dead mark stays inside this call. */
export async function recordFieldPush(input: {
  target: PushSendTarget;
  message: PushMessage;
  payloadKind: PushSendLog["payloadKind"];
  env?: Env;
  logSend: (entry: PushSendLog) => Promise<void>;
  markDead: (id: string) => Promise<void>;
  send?: SendPush;
}): Promise<"sent" | "failed" | "unconfigured"> {
  const env = input.env ?? process.env;
  const send = input.send ?? sendFieldPush;
  let result: FieldPushResult;
  try {
    result = await send(input.target, input.message, env);
  } catch (error) {
    result = failedFrom(error, env, input.target);
  }
  try {
    await input.logSend(logEntry(input.target, input.payloadKind, result));
  } catch {
    // The send result still counts. A log failure must not fail the run.
  }
  if (result.status === "failed" && result.dead && input.target.id) {
    try {
      await input.markDead(input.target.id);
    } catch {
      // The next dispatch can mark it again.
    }
  }
  if (result.status === "sent") return "sent";
  if (result.status === "unconfigured") return "unconfigured";
  return "failed";
}

type DueRow = PushCandidate & { userId: string | null; jobId: string };

function dueCandidate(raw: Record<string, unknown>): DueRow | null {
  if (typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    userId: typeof raw.user_id === "string" ? raw.user_id : null,
    jobId: raw.job_id == null ? "" : String(raw.job_id),
    jobNumber: String(raw.job_number ?? ""),
    jobName: raw.job_name == null ? null : String(raw.job_name),
    endpoint: String(raw.endpoint ?? ""),
    p256dh: String(raw.p256dh ?? ""),
    auth: String(raw.auth ?? ""),
    enabled: raw.enabled === true,
    sendLocal: String(raw.send_local ?? "14:30"),
    timeZone: String(raw.time_zone ?? "America/New_York"),
    dailyToday: raw.daily_today === true,
    lastSentOn: raw.last_sent_on ? String(raw.last_sent_on).slice(0, 10) : null,
  };
}

/**
 * Send every due subscription. One bad endpoint cannot fail the run.
 * Missing VAPID keys log one unconfigured status and do not throw.
 */
export async function dispatchFieldPushes(input: {
  rows: readonly Record<string, unknown>[];
  origin: string;
  now?: Date;
  env?: Env;
  markSent: (id: string, day: string) => Promise<boolean>;
  logSend: (entry: PushSendLog) => Promise<void>;
  markDead: (id: string) => Promise<void>;
  send?: SendPush;
}): Promise<{ sent: number; failed: number }> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const due: DueRow[] = [];
  for (const raw of input.rows) {
    const row = dueCandidate(raw);
    if (!row || !pushIsDue(row, now)) continue;
    due.push(row);
  }
  if (due.length === 0) return { sent: 0, failed: 0 };
  if (!vapidConfig(env)) {
    console.error(VAPID_MISSING_STATUS);
    try {
      await input.logSend({
        subscriptionId: null,
        userId: null,
        jobId: null,
        status: "unconfigured",
        httpCode: null,
        errorText: VAPID_MISSING_STATUS,
        payloadKind: "daily",
      });
    } catch {
      // The cron result is still returned.
    }
    return { sent: 0, failed: due.length };
  }
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    let outcome: "sent" | "failed" | "skip" = "skip";
    try {
      const day = zonedClock(row.timeZone, now).date;
      const marked = await input.markSent(row.id, day);
      if (!marked) continue;
      const result = await recordFieldPush({
        target: {
          id: row.id,
          userId: row.userId,
          jobId: row.jobId || null,
          endpoint: row.endpoint,
          p256dh: row.p256dh,
          auth: row.auth,
        },
        message: pushPayload(row.jobId, row.jobNumber, input.origin),
        payloadKind: "daily",
        env,
        logSend: input.logSend,
        markDead: input.markDead,
        send: input.send,
      });
      outcome = result === "sent" ? "sent" : "failed";
    } catch {
      outcome = "failed";
    }
    if (outcome === "sent") sent += 1;
    else if (outcome === "failed") failed += 1;
  }
  return { sent, failed };
}
