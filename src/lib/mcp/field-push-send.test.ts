import { afterEach, describe, expect, it, vi } from "vitest";
import { VAPID_MISSING_STATUS } from "./field-push";
import {
  dispatchFieldPushes,
  sendFieldPush,
  type FieldPushResult,
  type PushSendLog,
} from "./field-push-send";

const JOB = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const DUE = new Date("2026-10-21T18:30:00Z");
const KEYS = {
  ATHENA_VAPID_PUBLIC_KEY: "planted-public-key-value",
  ATHENA_VAPID_PRIVATE_KEY: "planted-private-key-value",
};

function raw(over: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: USER,
    job_id: JOB,
    job_number: "2701",
    job_name: "River shop",
    endpoint: "https://push.example/1",
    p256dh: "p256dh-key-material",
    auth: "auth-key-material",
    enabled: true,
    send_local: "14:30",
    time_zone: "America/New_York",
    daily_today: false,
    last_sent_on: null,
    ...over,
  };
}

const sendNotification = vi.hoisted(() => vi.fn());
const setVapidDetails = vi.hoisted(() => vi.fn());

vi.mock("web-push", () => ({
  setVapidDetails,
  sendNotification,
}));

afterEach(() => {
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  vi.restoreAllMocks();
});

describe("field push dispatch", () => {
  it("returns sent and failed, and one bad endpoint does not stop the run", async () => {
    const logs: PushSendLog[] = [];
    const dead: string[] = [];
    const marked: string[] = [];
    const messages: unknown[] = [];
    const gone = "44444444-4444-4444-8444-444444444444";
    const missing = "55555555-5555-4555-8555-555555555555";
    const ok = "66666666-6666-4666-8666-666666666666";
    const send = vi.fn(
      async (row: { endpoint: string }, message: unknown): Promise<FieldPushResult> => {
        messages.push(message);
        if (row.endpoint.endsWith("/500"))
          throw Object.assign(new Error("endpoint down"), { statusCode: 500 });
        if (row.endpoint.endsWith("/404")) {
          throw Object.assign(new Error(`missing ${KEYS.ATHENA_VAPID_PRIVATE_KEY}`), {
            statusCode: 404,
          });
        }
        if (row.endpoint.endsWith("/410"))
          return { status: "failed", httpCode: 410, errorText: "gone", dead: true };
        return { status: "sent", httpCode: 201 };
      },
    );

    const result = await dispatchFieldPushes({
      rows: [
        raw({ id: gone, endpoint: "https://push.example/500" }),
        raw({ endpoint: "https://push.example/early", send_local: "18:00" }),
        raw({ endpoint: "https://push.example/already", last_sent_on: "2026-10-21" }),
        raw({ id: missing, endpoint: "https://push.example/404" }),
        raw({ id: ok, endpoint: "https://push.example/ok" }),
        raw({ id: "77777777-7777-4777-8777-777777777777", endpoint: "https://push.example/410" }),
      ],
      origin: "https://app.meetathena.io",
      now: DUE,
      env: KEYS,
      markSent: async (id) => {
        marked.push(id);
        return true;
      },
      logSend: async (entry) => {
        logs.push(entry);
      },
      markDead: async (id) => {
        dead.push(id);
      },
      send,
    });

    expect(result).toEqual({ sent: 1, failed: 3 });
    expect(marked).toEqual([gone, missing, ok, "77777777-7777-4777-8777-777777777777"]);
    expect(dead).toEqual([missing, "77777777-7777-4777-8777-777777777777"]);
    expect(logs.map((entry) => entry.status)).toEqual(["failure", "failure", "success", "failure"]);
    expect(logs[0]).toMatchObject({
      subscriptionId: gone,
      userId: USER,
      jobId: JOB,
      httpCode: 500,
      payloadKind: "daily",
      errorText: "endpoint down",
    });
    expect(logs[1].errorText).toBe("missing [redacted]");
    expect(logs[1].httpCode).toBe(404);
    expect(JSON.stringify(logs)).not.toContain(KEYS.ATHENA_VAPID_PRIVATE_KEY);
    expect(logs[2]).toMatchObject({
      subscriptionId: ok,
      status: "success",
      httpCode: 201,
      errorText: null,
    });
    expect(logs[3]).toMatchObject({ httpCode: 410, status: "failure" });
    expect(messages[0]).toEqual({
      title: "Today's daily isn't in yet",
      body: "Job 2701: start your daily report and progress photos.",
      url: `https://app.meetathena.io/r/job/${JOB}/field`,
    });
  });

  it("keeps going when the log write or the dead mark throws", async () => {
    const send = vi.fn(async (row: { endpoint: string }): Promise<FieldPushResult> => {
      if (row.endpoint.endsWith("/410"))
        return { status: "failed", httpCode: 410, errorText: "gone", dead: true };
      return { status: "sent", httpCode: 201 };
    });
    const result = await dispatchFieldPushes({
      rows: [
        raw({ endpoint: "https://push.example/410" }),
        raw({ id: "88888888-8888-4888-8888-888888888888", endpoint: "https://push.example/ok" }),
      ],
      origin: "https://app.meetathena.io",
      now: DUE,
      env: KEYS,
      markSent: async () => true,
      logSend: async () => {
        throw new Error("log down");
      },
      markDead: async () => {
        throw new Error("dead mark down");
      },
      send,
    });
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("logs a clear status when VAPID keys are missing and does not throw or print values", async () => {
    const logs: PushSendLog[] = [];
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    let marked = false;
    let sentAttempt = false;
    const result = await dispatchFieldPushes({
      rows: [
        raw(),
        raw({ id: "99999999-9999-4999-8999-999999999999", endpoint: "https://push.example/2" }),
      ],
      origin: "https://app.meetathena.io",
      now: DUE,
      env: { ATHENA_VAPID_PUBLIC_KEY: KEYS.ATHENA_VAPID_PUBLIC_KEY },
      markSent: async () => {
        marked = true;
        return true;
      },
      logSend: async (entry) => {
        logs.push(entry);
      },
      markDead: async () => {
        throw new Error("should not mark dead");
      },
      send: async () => {
        sentAttempt = true;
        return { status: "sent", httpCode: 201 };
      },
    });
    expect(result).toEqual({ sent: 0, failed: 2 });
    expect(marked).toBe(false);
    expect(sentAttempt).toBe(false);
    expect(logs).toEqual([
      {
        subscriptionId: null,
        userId: null,
        jobId: null,
        status: "unconfigured",
        httpCode: null,
        errorText: VAPID_MISSING_STATUS,
        payloadKind: "daily",
      },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([[VAPID_MISSING_STATUS]]);
    const printed = JSON.stringify({ logs, errors });
    expect(printed).not.toContain(KEYS.ATHENA_VAPID_PUBLIC_KEY);
    expect(printed).not.toContain(KEYS.ATHENA_VAPID_PRIVATE_KEY);

    const quiet = await dispatchFieldPushes({
      rows: [raw({ last_sent_on: "2026-10-21" })],
      origin: "https://app.meetathena.io",
      now: DUE,
      env: {},
      markSent: async () => true,
      logSend: async (entry) => {
        logs.push(entry);
      },
      markDead: async () => {},
    });
    expect(quiet).toEqual({ sent: 0, failed: 0 });
    expect(logs).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sends through web-push and turns a 410 into a dead failure", async () => {
    sendNotification.mockResolvedValueOnce({ statusCode: 201 });
    const sent = await sendFieldPush(
      {
        endpoint: "https://push.example/1",
        p256dh: "p256dh-key-material",
        auth: "auth-key-material",
      },
      {
        title: "Today's daily isn't in yet",
        body: "Job 2701: start your daily report and progress photos.",
        url: "https://app.meetathena.io/r/job/1/field",
      },
      KEYS,
    );
    expect(sent).toEqual({ status: "sent", httpCode: 201 });
    expect(setVapidDetails).toHaveBeenCalledWith(
      "mailto:support@meetathena.io",
      KEYS.ATHENA_VAPID_PUBLIC_KEY,
      KEYS.ATHENA_VAPID_PRIVATE_KEY,
    );

    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error(`gone ${KEYS.ATHENA_VAPID_PRIVATE_KEY}`), { statusCode: 410 }),
    );
    const gone = await sendFieldPush(
      {
        endpoint: "https://push.example/1",
        p256dh: "p256dh-key-material",
        auth: "auth-key-material",
      },
      {
        title: "Today's daily isn't in yet",
        body: "Job 2701: start your daily report and progress photos.",
        url: "https://app.meetathena.io/r/job/1/field",
      },
      KEYS,
    );
    expect(gone).toEqual({
      status: "failed",
      httpCode: 410,
      errorText: "gone [redacted]",
      dead: true,
    });

    const missing = await sendFieldPush(
      {
        endpoint: "https://push.example/1",
        p256dh: "p256dh-key-material",
        auth: "auth-key-material",
      },
      { title: "t", body: "b", url: "https://app.meetathena.io/r" },
      {},
    );
    expect(missing).toEqual({ status: "unconfigured" });
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
});
