import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fieldManifest, iosPushHint, pushIsDue, pushPayload, vapidConfig, type PushCandidate } from "./field-push";

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
    expect(vapidConfig({ ATHENA_VAPID_PUBLIC_KEY: "pub", ATHENA_VAPID_PRIVATE_KEY: "sec" })).toEqual({ publicKey: "pub", privateKey: "sec" });
  });

  it("uses Athena branding on the field manifest and tells iPhone to install first", () => {
    const manifest = fieldManifest("11111111-1111-4111-8111-111111111111", "https://app.meetathena.io");
    expect(manifest.name).toBe("Athena field");
    expect(JSON.stringify(manifest)).not.toMatch(/circle/i);
    expect(manifest.icons[0].src).toContain("/brand/athena/athena-primary-512.png");
    expect(manifest.start_url).toBe("https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/field");
    expect(iosPushHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", false)).toMatch(/Home Screen/);
    expect(iosPushHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", false)).toMatch(/16\.4/);
    expect(iosPushHint("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", true)).toBeNull();
    expect(iosPushHint("Mozilla/5.0 (Windows NT 10.0)", false)).toBeNull();
    expect(pushPayload("11111111-1111-4111-8111-111111111111", "2701", "https://app.meetathena.io").title).toBe("Today's daily isn't in yet");
  });

  it("migration stores subscriptions and does not schedule with a secret", () => {
    const sql = readFileSync("supabase/migrations/20261023040000_athena_daily_reminder_card.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_push_subscriptions");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mcp_push_due() TO service_role");
    expect(sql).not.toMatch(/ATHENA_VAPID_PRIVATE_KEY\s*=|BEGIN PRIVATE/);
    expect(sql).not.toMatch(/cron\.schedule\(/);
    expect(readFileSync("public/athena-field-sw.js", "utf8")).not.toMatch(/circle/i);
  });
});