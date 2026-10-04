import { describe, it, expect, vi } from "vitest";
import { reconcileCircleAudience, drainCircleAudienceSync } from "./reconcile.server";
import { circleAnnouncementAllowed } from "./announcement-guard.server";
import { circleDecision, loadCircleIdentities, loadCircleAudience } from "./circle.server";

function fakeDb(state = "eligible") {
  const tables: Record<string, Record<string, unknown>[]> = {
    profiles: [{ id: "user", email: "member@example.test", full_name: "Test Member" }],
    subscriptions: [
      { id: "subscription", user_id: "user", email: "member@example.test", tier: "circle" },
    ],
    circle_owner_grants: [],
    circle_source_aliases: [],
    suppressed_emails: [],
    email_unsubscribe_tokens: [],
  };
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => ({
    error: null,
    data:
      name === "get_circle_entitlement"
        ? {
            state,
            hasAccess: state === "eligible",
            reason: state === "eligible" ? "paid_period" : "expired",
          }
        : name === "claim_circle_audience_sync"
          ? [{ email: "member@example.test", revision: 1, attempts: 1 }]
          : null,
  }));
  const from = vi.fn((table: string) => {
    let email: string | undefined;
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: (_k: string, v: string) => {
        email = v;
        return chain;
      },
      not: () => chain,
      range: async () => ({ error: null, data: tables[table] ?? [] }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          resolve({
            error: null,
            data: (tables[table] ?? []).filter((r) => !email || r.email === email),
          }),
        ),
    };
    return chain;
  });
  return { db: { from, rpc }, tables, rpc };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const segment = (contacts: unknown[] = []) =>
  vi.fn(async (url: unknown) =>
    String(url).includes("/segments/") ? json({ data: contacts, has_more: false }) : json({}, 404),
  );
describe("reconciliation and delivery safety", () => {
  it("keeps explicitly mapped destinations separate and suppresses each destination independently", async () => {
    const { db, tables } = fakeDb();
    tables.profiles.push({
      id: "alias-user",
      email: "second@example.test",
      full_name: "Second Identity",
    });
    tables.circle_source_aliases.push({
      id: "alias",
      target_user_id: "alias-user",
      target_email: "second@example.test",
    });
    expect((await loadCircleAudience(db)).map((i) => i.email)).toEqual([
      "member@example.test",
      "second@example.test",
    ]);
    tables.suppressed_emails.push({ email: "second@example.test" });
    const fetch = vi.fn().mockResolvedValue(json({ id: "contact", unsubscribed: false }));
    expect(
      await circleAnnouncementAllowed(db, "member@example.test", {
        apiKey: "synthetic",
        fetch,
        paceMs: 0,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await circleAnnouncementAllowed(db, "second@example.test", {
        apiKey: "synthetic",
        fetch,
        paceMs: 0,
      }),
    ).toMatchObject({ allowed: false, reason: "hub_suppressed" });
  });
  it("keeps revoked destinations discoverable but uses canonical eligibility for removal", async () => {
    const { db, tables } = fakeDb("ineligible");
    tables.profiles.push({ id: "alias-user", email: "second@example.test" });
    tables.circle_source_aliases.push({
      id: "revoked-alias",
      target_user_id: "alias-user",
      target_email: "second@example.test",
    });
    expect((await loadCircleIdentities(db)).map((i) => i.email)).toContain("second@example.test");
    const preview = await reconcileCircleAudience(db, {
      apiKey: "synthetic",
      fetch: segment([{ id: "contact", email: "second@example.test" }]),
      paceMs: 0,
    });
    expect(preview.plan).toContainEqual({
      email: "second@example.test",
      action: "remove",
      reason: "expired",
    });
  });
  it("a changed alias target is review, even if a stale identity would otherwise resolve as paid", async () => {
    const { db, tables, rpc } = fakeDb();
    tables.profiles.push({ id: "alias-user", email: "new-address@example.test" });
    tables.circle_source_aliases.push({
      id: "alias",
      target_user_id: "alias-user",
      target_email: "second@example.test",
    });
    const identity = (await loadCircleIdentities(db)).find(
      (i) => i.email === "second@example.test",
    )!;
    expect(await circleDecision(db, identity)).toMatchObject({
      state: "review",
      hasAccess: false,
      reason: "circle_alias_target_changed",
    });
    expect(rpc).not.toHaveBeenCalled();
    await expect(loadCircleAudience(db)).rejects.toThrow("membership review");
  });
  it("preview is read-only and returns a stable review hash", async () => {
    const { db, rpc } = fakeDb();
    const fetch = segment();
    const preview = await reconcileCircleAudience(db, { apiKey: "synthetic", fetch, paceMs: 0 });
    expect(preview.plan).toEqual([
      { email: "member@example.test", action: "add", reason: "paid_period" },
    ]);
    expect(preview.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rpc.mock.calls.every(([name]) => name === "get_circle_entitlement")).toBe(true);
  });
  it("Resend-only identities remain explicit review cases", async () => {
    const { db } = fakeDb();
    const preview = await reconcileCircleAudience(db, {
      apiKey: "synthetic",
      fetch: segment([{ id: "unknown", email: "unmapped@example.test" }]),
      paceMs: 0,
    });
    expect(preview.plan).toContainEqual({
      email: "unmapped@example.test",
      action: "review",
      reason: "unmapped_resend_identity",
    });
  });
  it("refuses an apply whose reviewed plan no longer matches", async () => {
    const { db, rpc } = fakeDb();
    await expect(
      reconcileCircleAudience(db, {
        apply: true,
        reviewedPlanHash: "outdated",
        apiKey: "synthetic",
        fetch: segment(),
        paceMs: 0,
      }),
    ).rejects.toThrow("plan changed");
    expect(rpc.mock.calls.some(([name]) => name === "queue_circle_audience_sync")).toBe(false);
  });
  it("records missing credentials as a failed retryable job", async () => {
    const { db, rpc } = fakeDb();
    const result = await drainCircleAudienceSync(db, { apiKey: "", paceMs: 0 });
    expect(result).toMatchObject({ processed: 1, failed: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "finish_circle_audience_sync",
      expect.objectContaining({ _status: "failed", _error: "RESEND_API_KEY is not configured" }),
    );
  });
  it("review jobs never invoke Resend", async () => {
    const { db, rpc } = fakeDb("review");
    const fetch = vi.fn();
    expect(
      await drainCircleAudienceSync(db, { apiKey: "synthetic", fetch, paceMs: 0 }),
    ).toMatchObject({ review: 1, failed: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "finish_circle_audience_sync",
      expect.objectContaining({ _status: "review" }),
    );
  });
  it("rechecks expiry at delivery and skips provider access for former members", async () => {
    const { db } = fakeDb("ineligible");
    const fetch = vi.fn();
    expect(
      await circleAnnouncementAllowed(db, "member@example.test", {
        apiKey: "synthetic",
        fetch,
        paceMs: 0,
      }),
    ).toEqual({ allowed: false, reason: "expired" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a Resend unsubscribe suppresses Lovable announcements without revoking membership", async () => {
    const { db, rpc } = fakeDb();
    const fetch = vi.fn().mockResolvedValue(json({ id: "member", unsubscribed: true }));
    expect(
      await circleAnnouncementAllowed(db, "member@example.test", {
        apiKey: "synthetic",
        fetch,
        paceMs: 0,
      }),
    ).toEqual({ allowed: false, reason: "resend_unsubscribed" });
    expect(rpc.mock.calls.every(([name]) => name === "get_circle_entitlement")).toBe(true);
  });
  it("does not duplicate recipients when an identity has several sources", async () => {
    const { db, tables } = fakeDb();
    tables.subscriptions.push({ ...tables.subscriptions[0], id: "second" });
    tables.circle_owner_grants.push({ id: "grant", user_id: "user", email: "member@example.test" });
    expect(await loadCircleIdentities(db)).toHaveLength(1);
  });
  it("duplicate email bindings require review instead of arbitrarily choosing an account", async () => {
    const { db, tables } = fakeDb();
    tables.profiles.push({ id: "other", email: "member@example.test" });
    tables.subscriptions.push({
      id: "second",
      user_id: "other",
      email: "member@example.test",
      tier: "circle",
    });
    await expect(loadCircleIdentities(db)).rejects.toThrow("identity requires review");
  });
});
