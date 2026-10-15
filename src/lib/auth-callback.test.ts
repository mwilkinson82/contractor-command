import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  phase: vi.fn(),
  verify: vi.fn(),
  getSession: vi.fn(),
  resolve: vi.fn(),
  replace: vi.fn(),
  exchange: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (fn: () => void) => m.effects.push(fn),
  useState: (value: unknown) => [value, m.phase],
  useRef: () => ({ current: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({ ...config, useSearch: () => ({}) }),
  Link: () => null,
}));
vi.mock("@/components/auth/auth-card", () => ({ AuthCard: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { verifyOtp: m.verify, getSession: m.getSession, exchangeCodeForSession: m.exchange },
  },
}));
vi.mock("@/lib/oauth-continuation.functions", () => ({ resolveOAuthContinuation: m.resolve }));
import { Route } from "@/routes/auth.callback";
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  m.effects = [];
  vi.stubGlobal("window", {
    location: {
      search: "?token_hash=synthetic&type=email&continuation=synthetic",
      hash: "",
      pathname: "/auth/callback",
      replace: m.replace,
    },
    history: { replaceState: vi.fn() },
    setTimeout,
    clearTimeout,
  });
  m.verify.mockResolvedValue({ data: { session: { access_token: "synthetic" } }, error: null });
  m.resolve.mockResolvedValue("/oauth/consent?authorization_id=request_A");
  m.getSession.mockResolvedValue({ data: { session: { user: { id: "unrelated" } } } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function run() {
  (Route as unknown as { component: () => unknown }).component();
  m.effects[0]();
  await vi.advanceTimersByTimeAsync(150);
}
it("verifies the exact email token before resolving consent in a fresh tab", async () => {
  await run();
  expect(m.verify).toHaveBeenCalledWith({ token_hash: "synthetic", type: "email" });
  expect(m.resolve).toHaveBeenCalledOnce();
  expect(m.replace).toHaveBeenCalledWith("/oauth/consent?authorization_id=request_A");
});
it.each(["expired", "reused"])(
  "does not accept an unrelated existing session when link is %s",
  async () => {
    m.verify.mockResolvedValue({ data: {}, error: { message: "invalid" } });
    await run();
    expect(m.phase).toHaveBeenCalledWith("expired");
    expect(m.getSession).not.toHaveBeenCalled();
    expect(m.resolve).not.toHaveBeenCalled();
    expect(m.replace).not.toHaveBeenCalled();
  },
);
it("rejects an account/token/continuation mismatch after verification", async () => {
  m.resolve.mockResolvedValue(null);
  await run();
  expect(m.phase).toHaveBeenCalledWith("expired");
  expect(m.replace).not.toHaveBeenCalled();
});
it("rejects continuation without its one-time email token", async () => {
  window.location.search = "?continuation=synthetic";
  await run();
  expect(m.phase).toHaveBeenCalledWith("expired");
  expect(m.getSession).not.toHaveBeenCalled();
});
it("does not turn a failed PKCE exchange into success from an old session", async () => {
  window.location.search = "?code=synthetic";
  m.exchange.mockResolvedValue({ error: { message: "invalid" } });
  await run();
  expect(m.phase).toHaveBeenCalledWith("expired");
  expect(m.getSession).not.toHaveBeenCalled();
});
