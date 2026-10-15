import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ listUsers: vi.fn(), generateLink: vi.fn(), send: vi.fn(), from: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ inputValidator: (parse: (data: unknown) => unknown) => ({
    handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) => fn({ data: parse(input.data) }),
  }) }),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => new Request("https://app.alpcontractorcircle.com/login") }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { admin: { listUsers: m.listUsers, generateLink: m.generateLink } }, from: m.from,
} }));
vi.mock("@/lib/email/send-login-nudge-now", () => ({ sendLoginNudgeNow: m.send }));
import { requestMemberMagicLink } from "./magic-link.functions";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.listUsers.mockResolvedValue({ data: { users: [{ email: "member@example.test" }] }, error: null });
  m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "inert-test-token" } }, error: null });
  m.send.mockResolvedValue({ status: "sent" });
  m.from.mockImplementation(() => {
    const chain = { select: () => chain, ilike: () => chain, or: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }) };
    return chain;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it.each(["sent", "suppressed", "send_failed", "not_a_live_member", "link_failed", "error"])(
  "does not expose %s through the unauthenticated response", async (outcome) => {
    if (outcome === "not_a_live_member") m.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    if (outcome === "link_failed") m.generateLink.mockResolvedValue({ data: null, error: { message: "internal detail" } });
    if (outcome === "error") m.listUsers.mockRejectedValue(new Error("internal account detail"));
    if (outcome === "suppressed" || outcome === "send_failed") m.send.mockResolvedValue({ status: outcome });
    const result = requestMemberMagicLink({ data: { email: "member@example.test" } });
    let settled = false;
    void result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(599);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true, action: "accepted" });
    if (["not_a_live_member", "link_failed", "error"].includes(outcome)) expect(m.send).not.toHaveBeenCalled();
  },
);
