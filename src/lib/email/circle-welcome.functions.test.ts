import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), enqueue: vi.fn(), magic: vi.fn(), middleware: vi.fn(), auth: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse = (input: unknown) => input;
    const chain = {
      middleware: (items: unknown[]) => { m.middleware(items); return chain; },
      inputValidator: (validator: typeof parse) => { parse = validator; return chain; },
      handler: (handler: (input: unknown) => unknown) => (input: { data: unknown }) =>
        handler({ data: parse(input.data), context: { userId: "admin-id", supabase: { rpc: m.rpc } } }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: m.auth }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/email/enqueue-circle-welcome", () => ({ enqueueCircleWelcome: m.enqueue }));
vi.mock("@/lib/email/ensure-magic-link", () => ({ appOrigin: () => "https://example.test", ensureMagicLinkForMember: m.magic }));
import { sendCircleWelcomeBackfill } from "./circle-welcome.functions";

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: true });
  m.magic.mockReset().mockResolvedValue("https://example.test/sign-in");
  m.enqueue.mockReset().mockResolvedValue({ status: "queued", messageId: "message-test-id" });
});

it("retains authenticated middleware and rejects non-admin callers before any mail work", async () => {
  expect(m.middleware).toHaveBeenCalledWith([m.auth]);
  m.rpc.mockResolvedValue({ data: false });
  await expect(sendCircleWelcomeBackfill({ data: { email: "owner@example.test" } })).rejects.toThrow("Forbidden");
  expect(m.rpc).toHaveBeenCalledWith("has_role", { _user_id: "admin-id", _role: "admin" });
  expect(m.magic).not.toHaveBeenCalled();
  expect(m.enqueue).not.toHaveBeenCalled();
});

it("rejects malformed recipients before any role lookup or send", async () => {
  await expect(async () => sendCircleWelcomeBackfill({ data: { email: "not-an-email" } })).rejects.toThrow();
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.enqueue).not.toHaveBeenCalled();
});

it("keeps the same explicit request key on retry and returns the non-secret queue result", async () => {
  const data = { email: "Owner@example.test", idempotencyKey: "welcome-reviewed-test-1" };
  expect(await sendCircleWelcomeBackfill({ data })).toEqual({ status: "queued", messageId: "message-test-id" });
  m.enqueue.mockResolvedValue({ status: "duplicate" });
  expect(await sendCircleWelcomeBackfill({ data })).toEqual({ status: "duplicate" });
  for (const [args] of m.enqueue.mock.calls) {
    expect(args).toMatchObject({ email: "owner@example.test", idempotencyKey: data.idempotencyKey });
  }
});

it.each(["suppressed", "failed"])("preserves the mailer's %s outcome", async (status) => {
  m.enqueue.mockResolvedValue({ status });
  expect(await sendCircleWelcomeBackfill({ data: { email: "owner@example.test" } })).toEqual({ status });
});
