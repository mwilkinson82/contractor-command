import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOARD_SIGN_IN_TITLE, signInReturn, todaySignInReturn } from "@/lib/board-sign-in";
import { job2701BriefJob } from "./morning-brief-2701";
import { buildMorningBrief, type BriefJob, type BuiltBrief } from "./morning-brief";
import type { FieldPushResult, PushSendLog } from "./field-push-send";
import {
  MORNING_BRIEF_CRON,
  MORNING_BRIEF_UNCONFIGURED,
  briefIsDue,
  dispatchMorningBriefs,
  morningBriefPush,
  type BriefCandidate,
} from "./morning-brief-push";

const USER = "22222222-2222-4222-8222-222222222222";
const KEYS = {
  ATHENA_VAPID_PUBLIC_KEY: "planted-public-key-value",
  ATHENA_VAPID_PRIVATE_KEY: "planted-private-key-value",
};
const NOW = new Date("2026-10-26T15:00:00Z");

function clock(over: Partial<BriefCandidate> = {}): BriefCandidate {
  return {
    userId: USER,
    enabled: true,
    sendLocal: "06:30",
    timeZone: "America/New_York",
    lastSentOn: null,
    subscriptions: [
      { id: "33333333-3333-4333-8333-333333333333", endpoint: "https://push.example/1", p256dh: "p256", auth: "auth" },
    ],
    ...over,
  };
}

function raw(over: Record<string, unknown> = {}) {
  const row = clock();
  return {
    user_id: row.userId,
    enabled: row.enabled,
    send_local: row.sendLocal,
    time_zone: row.timeZone,
    last_sent_on: row.lastSentOn,
    subscriptions: row.subscriptions,
    ...over,
  };
}

describe("morning brief due time across DST", () => {
  it("uses the local offset on both sides of the spring-forward and fall-back days", () => {
    const beforeSpring = clock();
    expect(briefIsDue(beforeSpring, new Date("2026-03-07T11:29:00Z"))).toBe(false);
    expect(briefIsDue(beforeSpring, new Date("2026-03-07T11:30:00Z"))).toBe(true);
    const spring = clock();
    expect(briefIsDue(spring, new Date("2026-03-08T10:29:00Z"))).toBe(false);
    expect(briefIsDue(spring, new Date("2026-03-08T10:30:00Z"))).toBe(true);
    const beforeFall = clock();
    expect(briefIsDue(beforeFall, new Date("2026-10-31T10:29:00Z"))).toBe(false);
    expect(briefIsDue(beforeFall, new Date("2026-10-31T10:30:00Z"))).toBe(true);
    const fall = clock();
    expect(briefIsDue(fall, new Date("2026-11-01T11:29:00Z"))).toBe(false);
    expect(briefIsDue(fall, new Date("2026-11-01T11:30:00Z"))).toBe(true);
    const phoenix = clock({ timeZone: "America/Phoenix" });
    expect(briefIsDue(phoenix, new Date("2026-03-08T13:29:00Z"))).toBe(false);
    expect(briefIsDue(phoenix, new Date("2026-03-08T13:30:00Z"))).toBe(true);
    expect(briefIsDue(phoenix, new Date("2026-11-01T13:29:00Z"))).toBe(false);
    expect(briefIsDue(phoenix, new Date("2026-11-01T13:30:00Z"))).toBe(true);
    const la = clock({ timeZone: "America/Los_Angeles" });
    expect(briefIsDue(la, new Date("2026-03-08T10:30:00Z"))).toBe(false);
    expect(briefIsDue(la, new Date("2026-03-08T13:30:00Z"))).toBe(true);
  });

  it("sends once per local day, including the repeated hour of the fall-back day", () => {
    const fallMorning = new Date("2026-11-01T11:30:00Z");
    expect(briefIsDue(clock({ lastSentOn: "2026-11-01" }), fallMorning)).toBe(false);
    expect(briefIsDue(clock({ lastSentOn: "2026-11-01" }), new Date("2026-11-01T16:00:00Z"))).toBe(false);
    expect(briefIsDue(clock({ lastSentOn: "2026-10-31" }), fallMorning)).toBe(true);
    expect(briefIsDue(clock({ enabled: false }), fallMorning)).toBe(false);
    expect(briefIsDue(clock({ timeZone: "Not/AZone" }), fallMorning)).toBe(false);
  });
});

describe("morning brief push text", () => {
  const settings = { enabled: true, send_local: "06:30", time_zone: "America/Chicago" };

  it("is role-aware and keeps dollars off the superintendent line", () => {
    const superJobs = [job2701BriefJob("superintendent")];
    const pmJobs = [job2701BriefJob("pm")];
    const superBuilt = buildMorningBrief({ jobs: superJobs, hasCompany: true, now: NOW, settings });
    const pmBuilt = buildMorningBrief({ jobs: pmJobs, hasCompany: true, now: NOW, settings });
    const superPush = morningBriefPush(superBuilt, superJobs);
    const pmPush = morningBriefPush(pmBuilt, pmJobs);
    expect(superPush.body).toMatch(/^Good morning\. \d+ overdue, \d+ today\. Don't forget: /);
    expect(superPush.body).not.toMatch(/\$/);
    expect(superPush.body).not.toMatch(/pay app|\bIOR\b/i);
    expect(pmPush.body).not.toBe(superPush.body);
    expect(pmPush.body).toMatch(/Good morning\. \d+ overdue, \d+ today\./);

    const poisoned: BuiltBrief = {
      ...superBuilt,
      counts: { open: 4, overdue: 3, due_in_7_days: 0, today: 5 },
      card: {
        ...superBuilt.card,
        sections: [{ heading: "Don't forget", kind: "list", rows: [{ cells: ["2701 Harbor", "Credit $9,999.00"] }] }],
      },
    };
    expect(morningBriefPush(poisoned, superJobs).body).toBe("Good morning. 3 overdue, 5 today. Don't forget: Credit");
    expect(morningBriefPush(poisoned, superJobs).body).not.toContain("$");
    expect(morningBriefPush(poisoned, pmJobs).body).toContain("$9,999.00");
  });
});

describe("morning brief dispatch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fall = new Date("2026-11-01T11:30:00Z");

  function jobsFor(role: "pm" | "superintendent"): BriefJob[] {
    return [job2701BriefJob(role)];
  }

  it("sends once per user per day and marks a dead subscription without stopping the other device", async () => {
    const logs: PushSendLog[] = [];
    const dead: string[] = [];
    const claimed: string[] = [];
    const messages: { body: string; url: string }[] = [];
    const gone = "44444444-4444-4444-8444-444444444444";
    const live = "55555555-5555-4555-8555-555555555555";
    const send = vi.fn(async (row: { endpoint: string }, message: { body: string; url: string }): Promise<FieldPushResult> => {
      messages.push(message);
      if (row.endpoint.endsWith("/410")) return { status: "failed", httpCode: 410, errorText: "gone", dead: true };
      return { status: "sent", httpCode: 201 };
    });
    const input = {
      rows: [
        raw({
          subscriptions: [
            { id: gone, endpoint: "https://push.example/410", p256dh: "p", auth: "a" },
            { id: live, endpoint: "https://push.example/ok", p256dh: "p", auth: "a" },
          ],
        }),
        raw({ user_id: "66666666-6666-4666-8666-666666666666", enabled: false, subscriptions: [{ id: "77777777-7777-4777-8777-777777777777", endpoint: "https://push.example/off", p256dh: "p", auth: "a" }] }),
      ],
      origin: "https://app.meetathena.io",
      now: fall,
      env: KEYS,
      loadBrief: async () => ({ jobs: jobsFor("superintendent"), hasCompany: true }),
      markSent: async (userId: string, day: string) => {
        const key = `${userId}:${day}`;
        if (claimed.includes(key)) return false;
        claimed.push(key);
        return true;
      },
      logSend: async (entry: PushSendLog) => {
        logs.push(entry);
      },
      markDead: async (id: string) => {
        dead.push(id);
      },
      send,
    };
    const first = await dispatchMorningBriefs(input);
    const second = await dispatchMorningBriefs(input);
    expect(first).toEqual({ sent: 1, failed: 0 });
    expect(second).toEqual({ sent: 0, failed: 0 });
    expect(claimed).toEqual([`${USER}:2026-11-01`]);
    expect(dead).toEqual([gone]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(messages[0].url).toBe("https://app.meetathena.io/today");
    expect(messages[0].body).toMatch(/^Good morning\. \d+ overdue, \d+ today\./);
    expect(messages[0].body).not.toMatch(/\$/);
    expect(messages.every((message) => message.body === messages[0].body)).toBe(true);
    expect(logs.map((entry) => entry.status)).toEqual(["failure", "success"]);
    expect(logs[0]).toMatchObject({ subscriptionId: gone, userId: USER, jobId: null, payloadKind: "brief", httpCode: 410 });
  });

  it("marks a dead subscription and does not send that user again the same day", async () => {
    const dead: string[] = [];
    const claimed: string[] = [];
    const send = vi.fn(async (): Promise<FieldPushResult> => ({
      status: "failed",
      httpCode: 410,
      errorText: "gone",
      dead: true,
    }));
    const input = {
      rows: [raw()],
      origin: "https://app.meetathena.io",
      now: fall,
      env: KEYS,
      loadBrief: async () => ({ jobs: jobsFor("pm"), hasCompany: true }),
      markSent: async (userId: string, day: string) => {
        const key = `${userId}:${day}`;
        if (claimed.includes(key)) return false;
        claimed.push(key);
        return true;
      },
      logSend: async () => {},
      markDead: async (id: string) => {
        dead.push(id);
      },
      send,
    };
    expect(await dispatchMorningBriefs(input)).toEqual({ sent: 0, failed: 1 });
    expect(await dispatchMorningBriefs(input)).toEqual({ sent: 0, failed: 0 });
    expect(dead).toEqual(["33333333-3333-4333-8333-333333333333"]);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][1] as { body: string; url: string };
    expect(message.url).toBe("https://app.meetathena.io/today");
    expect(message.body).toMatch(/^Good morning\. \d+ overdue, \d+ today\. Don't forget: /);
    expect(message.body).toContain("delay notice");
  });

  it("logs unconfigured and does not throw when VAPID keys are missing", async () => {
    const logs: PushSendLog[] = [];
    const errors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    let marked = false;
    const result = await dispatchMorningBriefs({
      rows: [raw(), raw({ user_id: "88888888-8888-4888-8888-888888888888" })],
      origin: "https://app.meetathena.io",
      now: fall,
      env: {},
      loadBrief: async () => {
        throw new Error("should not load");
      },
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
        throw new Error("should not send");
      },
    });
    expect(result).toEqual({ sent: 0, failed: 2 });
    expect(marked).toBe(false);
    expect(logs).toEqual([
      {
        subscriptionId: null,
        userId: null,
        jobId: null,
        status: "unconfigured",
        httpCode: null,
        errorText: MORNING_BRIEF_UNCONFIGURED,
        payloadKind: "brief",
      },
    ]);
    expect(errors).toEqual([[MORNING_BRIEF_UNCONFIGURED]]);
    expect(JSON.stringify(logs)).not.toContain(KEYS.ATHENA_VAPID_PRIVATE_KEY);
  });
});

describe("morning brief migration", () => {
  const sql = readFileSync("supabase/migrations/20261023210000_athena_morning_brief_push.sql", "utf8");

  it("adds user subscriptions and a once-per-day log without touching job subscriptions", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_user_push_subscriptions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_sends");
    expect(sql).toContain("PRIMARY KEY (user_id, sent_on)");
    expect(sql).toContain("ON CONFLICT (user_id, sent_on) DO NOTHING");
    expect(sql).toContain("mcp_user_push_mark_dead");
    expect(sql).toContain("dead_at = NULL");
    expect(sql).toContain("payload_kind IN ('daily', 'test', 'brief')");
    expect(sql).toContain(MORNING_BRIEF_CRON);
    expect(sql).toContain("athena-morning-brief");
    expect(sql).not.toContain("mcp_push_subscription_save");
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/ATHENA_VAPID_PUBLIC_KEY\s*=|ATHENA_VAPID_PRIVATE_KEY\s*=|BEGIN PRIVATE|eyJ/);
    expect(sql).not.toMatch(/resend|sendTransactional|mailto:/i);
    const route = readFileSync("src/routes/api/athena/morning-brief.ts", "utf8");
    const push = readFileSync("src/lib/mcp/morning-brief-push.ts", "utf8");
    expect(route).not.toMatch(/resend|sendTransactional|mailto:/i);
    expect(push).not.toMatch(/resend|sendTransactional|mailto:/i);
    expect(route).toContain('body.action === "dispatch"');
  });
});

const authState = vi.hoisted(() => ({ session: null as { access_token: string } | null, loading: false }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: () => unknown }) => config,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ session: authState.session, loading: authState.loading, user: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: vi.fn() }));

import { Route as TodayRoute } from "@/routes/today";

describe("today board sign-in", () => {
  afterEach(() => {
    authState.session = null;
    authState.loading = false;
  });

  it("sends a signed-out visitor through the email-code sign-in and back to /today", () => {
    expect(todaySignInReturn("/today?utm_source=push&t=abc")).toBe("/today");
    expect(todaySignInReturn("/today#brief")).toBe("/today#brief");
    expect(todaySignInReturn("/account")).toBeUndefined();
    expect(todaySignInReturn("https://evil.example/today")).toBeUndefined();
    expect(todaySignInReturn("//evil.example/today")).toBeUndefined();
    expect(signInReturn("/today")).toBe("/today");
    const html = renderToStaticMarkup(createElement((TodayRoute as { component: () => ReactNode }).component));
    expect(html).toContain(BOARD_SIGN_IN_TITLE);
    expect(html).toContain("No password required");
    expect(html).toContain("Email me a sign-in code");
    expect(html).toContain('data-return-to="/today"');
    expect(html).not.toContain('type="password"');
  });
});
