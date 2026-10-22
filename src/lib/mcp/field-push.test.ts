import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  fieldManifest,
  iosPushHint,
  pushErrorText,
  pushHttpCode,
  pushIsDue,
  pushIsGone,
  pushPayload,
  vapidConfig,
  VAPID_MISSING_STATUS,
  type PushCandidate,
} from "./field-push";

const row = (over: Partial<PushCandidate> = {}): PushCandidate => ({
  id: "s1",
  jobNumber: "2701",
  endpoint: "https://push.example/1",
  p256dh: "key",
  auth: "auth",
  enabled: true,
  sendLocal: "14:30",
  timeZone: "America/New_York",
  dailyToday: false,
  lastSentOn: null,
  ...over,
});

describe("field web push", () => {
  const due = new Date("2026-10-21T18:30:00Z");

  it("sends after the local reminder time, once, and only when the daily is missing", () => {
    expect(pushIsDue(row(), due)).toBe(true);
    expect(pushIsDue(row(), new Date("2026-10-21T18:00:00Z"))).toBe(false);
    expect(pushIsDue(row({ enabled: false }), due)).toBe(false);
    expect(pushIsDue(row({ dailyToday: true }), due)).toBe(false);
    expect(pushIsDue(row({ lastSentOn: "2026-10-21" }), due)).toBe(false);
  });

  it("reads VAPID keys from env and never invents them", () => {
    expect(vapidConfig({})).toBeNull();
    expect(
      vapidConfig({ ATHENA_VAPID_PUBLIC_KEY: "pub", ATHENA_VAPID_PRIVATE_KEY: "sec" }),
    ).toEqual({ publicKey: "pub", privateKey: "sec" });
  });

  it("uses Athena branding on the field manifest and tells iPhone to install first", () => {
    const manifest = fieldManifest(
      "11111111-1111-4111-8111-111111111111",
      "https://app.meetathena.io",
    );
    expect(manifest.name).toBe("Athena field");
    expect(JSON.stringify(manifest)).not.toMatch(/circle/i);
    expect(manifest.icons[0].src).toContain("/brand/athena/athena-primary-512.png");
    expect(manifest.start_url).toBe(
      "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/field",
    );
    expect(iosPushHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", false)).toMatch(
      /Home Screen/,
    );
    expect(iosPushHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", false)).toMatch(
      /16\.4/,
    );
    expect(iosPushHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", true)).toBeNull();
    expect(iosPushHint("Mozilla/5.0 (Windows NT 10.0)", false)).toBeNull();
    const payload = pushPayload(
      "11111111-1111-4111-8111-111111111111",
      "2701",
      "https://app.meetathena.io",
    );
    expect(payload.title).toBe("Today's daily isn't in yet");
    expect(payload.body).toBe("Job 2701: start your daily report and progress photos.");
  });

  it("migration stores subscriptions and does not schedule with a secret", () => {
    const sql = readFileSync(
      "supabase/migrations/20261023040000_athena_daily_reminder_card.sql",
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_push_subscriptions");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mcp_push_due() TO service_role");
    expect(sql).not.toMatch(/ATHENA_VAPID_PRIVATE_KEY\s*=|BEGIN PRIVATE/);
    expect(sql).not.toMatch(/cron\.schedule\(/);
    expect(readFileSync("public/athena-field-sw.js", "utf8")).not.toMatch(/circle/i);
  });

  it("migration logs each send with no client access and can mark a subscription dead", () => {
    const sql = readFileSync("supabase/migrations/20261023130000_athena_push_send_log.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_push_send_log");
    expect(sql).toContain("subscription_id uuid");
    expect(sql).toContain("user_id uuid");
    expect(sql).toContain("job_id uuid");
    expect(sql).toContain(
      "status text NOT NULL CHECK (status IN ('success', 'failure', 'unconfigured'))",
    );
    expect(sql).toContain("http_code int");
    expect(sql).toContain("error_text text");
    expect(sql).toContain("payload_kind text NOT NULL CHECK (payload_kind IN ('daily', 'test'))");
    expect(sql).toContain("created_at timestamptz NOT NULL DEFAULT now()");
    expect(sql).toContain("ALTER TABLE public.mcp_push_send_log ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "REVOKE ALL ON public.mcp_push_send_log FROM anon, authenticated, public",
    );
    expect(sql).toContain("GRANT ALL ON public.mcp_push_send_log TO service_role");
    expect(sql).not.toContain("CREATE POLICY");
    expect(sql).not.toMatch(/GRANT [^;]*mcp_push_send_log TO authenticated/);
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.mcp_push_log_send(uuid, uuid, uuid, text, int, text, text) TO service_role",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.mcp_push_log_send(uuid, uuid, uuid, text, int, text, text) FROM anon, authenticated, public",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS dead_at timestamptz");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.mcp_push_mark_dead(_id uuid)");
    expect(sql).toContain("WHERE s.dead_at IS NULL");
    expect(sql).toContain("dead_at = NULL");
    expect(sql).not.toMatch(
      /ATHENA_VAPID_PUBLIC_KEY\s*=|ATHENA_VAPID_PRIVATE_KEY\s*=|BEGIN PRIVATE/,
    );
    expect(sql).not.toMatch(/cron\.schedule\(/);
  });

  it("reads an HTTP status and redacts key material from a failure", () => {
    const secret = "planted-private-key-value";
    const error = Object.assign(new Error(`push failed with ${secret} at the endpoint`), {
      statusCode: 410,
    });
    expect(pushHttpCode(error)).toBe(410);
    expect(pushIsGone(410)).toBe(true);
    expect(pushIsGone(404)).toBe(true);
    expect(pushIsGone(500)).toBe(false);
    const text = pushErrorText(error, [secret, "ab"]);
    expect(text).toBe("push failed with [redacted] at the endpoint");
    expect(text).not.toContain(secret);
    expect(VAPID_MISSING_STATUS).not.toContain(secret);
    expect(VAPID_MISSING_STATUS).toContain("ATHENA_VAPID_PUBLIC_KEY");
    expect(VAPID_MISSING_STATUS).toContain("ATHENA_VAPID_PRIVATE_KEY");
  });
});
