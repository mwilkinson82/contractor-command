import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listUsers: vi.fn(),
  generateLink: vi.fn(),
  send: vi.fn(),
  from: vi.fn(),
  createUser: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: (parse: (data: unknown) => unknown) => ({
      handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
        fn({ data: parse(input.data) }),
    }),
  }),
}));
const req = vi.hoisted(() => ({ url: "https://app.alpcontractorcircle.com/login" }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request(req.url),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      admin: { listUsers: m.listUsers, generateLink: m.generateLink, createUser: m.createUser },
    },
    from: m.from,
  },
}));
vi.mock("@/lib/email/send-login-nudge-now", () => ({ sendLoginNudgeNow: m.send }));
import { requestMemberMagicLink } from "./magic-link.functions";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.createUser.mockResolvedValue({ error: null });
  m.listUsers.mockResolvedValue({
    data: { users: [{ email: "member@example.test" }] },
    error: null,
  });
  m.generateLink.mockResolvedValue({
    data: { user: { id: "test-user" }, properties: { hashed_token: "inert-test-token" } },
    error: null,
  });
  m.send.mockResolvedValue({ status: "sent" });
  m.from.mockImplementation(() => {
    const chain = {
      select: () => chain,
      ilike: () => chain,
      or: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return chain;
  });
});
afterEach(() => {
  req.url = "https://app.alpcontractorcircle.com/login";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it.each(["sent", "suppressed", "send_failed", "not_a_live_member", "link_failed", "error"])(
  "does not expose %s through the unauthenticated response",
  async (outcome) => {
    if (outcome === "not_a_live_member")
      m.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    if (outcome === "link_failed")
      m.generateLink.mockResolvedValue({ data: null, error: { message: "internal detail" } });
    if (outcome === "error") m.listUsers.mockRejectedValue(new Error("internal account detail"));
    if (outcome === "suppressed" || outcome === "send_failed")
      m.send.mockResolvedValue({ status: outcome });
    const result = requestMemberMagicLink({ data: { email: "member@example.test" } });
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(599);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true, action: "accepted" });
    if (["not_a_live_member", "link_failed", "error"].includes(outcome))
      expect(m.send).not.toHaveBeenCalled();
  },
);

it("existing passwordless members receive a bound consent link without account/password creation", async () => {
  process.env.OAUTH_CONTINUATION_SECRET = "synthetic-test-secret-at-least-32-characters";
  const promise = requestMemberMagicLink({
    data: {
      email: "member@example.test",
      continuation: "/oauth/consent?authorization_id=test-request",
    },
  });
  await vi.advanceTimersByTimeAsync(600);
  expect(await promise).toEqual({ ok: true, action: "accepted" });
  expect(m.createUser).not.toHaveBeenCalled();
  expect(new URL(m.send.mock.calls[0][0].confirmationUrl).searchParams.has("continuation")).toBe(
    true,
  );
  delete process.env.OAUTH_CONTINUATION_SECRET;
});

it.each(["", "short"])(
  "reports configuration failure before any account lookup for secret %s",
  async (secret) => {
    vi.stubEnv("OAUTH_CONTINUATION_SECRET", secret);
    const promise = requestMemberMagicLink({
      data: {
        email: "unknown@example.invalid",
        continuation: "/oauth/consent?authorization_id=test-request",
      },
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(await promise).toEqual({ ok: true, action: "accepted" });
    expect(m.listUsers).not.toHaveBeenCalled();
    expect(m.generateLink).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[oauth-continuation] configuration_error", {
      code: "OAUTH_CONTINUATION_NOT_CONFIGURED",
      action:
        "Configure OAUTH_CONTINUATION_SECRET in this project's Lovable Cloud Secrets before releasing connector sign-in.",
    });
  },
);
it("ordinary member magic links remain available without the continuation secret", async () => {
  vi.stubEnv("OAUTH_CONTINUATION_SECRET", "");
  const promise = requestMemberMagicLink({ data: { email: "member@example.test" } });
  await vi.advanceTimersByTimeAsync(600);
  expect(await promise).toEqual({ ok: true, action: "accepted" });
  expect(m.send).toHaveBeenCalledOnce();
  expect(console.error).not.toHaveBeenCalled();
});

it("selects the Athena variant only for a validated consent continuation, URL untouched", async () => {
  vi.stubEnv("OAUTH_CONTINUATION_SECRET", "synthetic-test-secret-at-least-32-characters");
  const promise = requestMemberMagicLink({
    data: {
      email: "member@example.test",
      continuation: "/oauth/consent?authorization_id=test-request",
    },
  });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  const args = m.send.mock.calls[0][0];
  expect(args.variant).toBe("athena");
  const url = new URL(args.confirmationUrl);
  expect(url.pathname).toBe("/auth/callback");
  expect(url.searchParams.get("token_hash")).toBe("inert-test-token");
  expect(url.searchParams.get("continuation")).toBeTruthy();
});

it("ordinary sign-in keeps the default Circle variant", async () => {
  const promise = requestMemberMagicLink({ data: { email: "member@example.test" } });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  expect(m.send.mock.calls[0][0].variant).toBeUndefined();
});

it.each(["/hub", "https://evil.example/oauth/consent?authorization_id=x", "/oauth/consent"])(
  "invalid continuation %s sends nothing",
  async (continuation) => {
    vi.stubEnv("OAUTH_CONTINUATION_SECRET", "synthetic-test-secret-at-least-32-characters");
    const promise = requestMemberMagicLink({ data: { email: "member@example.test", continuation } });
    await vi.advanceTimersByTimeAsync(600);
    expect(await promise).toEqual({ ok: true, action: "accepted" });
    expect(m.send).not.toHaveBeenCalled();
  },
);

it("a sign-in started on app.meetathena.io gets the Athena email and lands on the Athena host", async () => {
  req.url = "https://app.meetathena.io/login";
  const promise = requestMemberMagicLink({ data: { email: "member@example.test" } });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  const args = m.send.mock.calls[0][0];
  expect(args.variant).toBe("athena");
  expect(args.connecting).toBeUndefined();
  expect(new URL(args.confirmationUrl).origin).toBe("https://app.meetathena.io");
  expect(m.generateLink.mock.calls[0][0].options.redirectTo).toBe("https://app.meetathena.io/auth/callback");
});

it("a job board return drops the token and utm params", async () => {
  req.url = "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/items";
  const back = "/r/job/11111111-1111-4111-8111-111111111111/items";
  const promise = requestMemberMagicLink({
    data: { email: "member@example.test", return_to: `${back}?t=expired&utm_source=chatgpt.com&utm_medium=email#item-3` },
  });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  expect(new URL(m.send.mock.calls[0][0].confirmationUrl).searchParams.get("redirect")).toBe(`${back}#item-3`);
});

it("an off-site return is not attached to the sign-in link", async () => {
  req.url = "https://app.meetathena.io/login";
  const promise = requestMemberMagicLink({
    data: { email: "member@example.test", return_to: "https://evil.example/r/job/11111111-1111-4111-8111-111111111111/items" },
  });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  const url = new URL(m.send.mock.calls[0][0].confirmationUrl);
  expect(url.searchParams.get("redirect")).toBeNull();
  expect(url.toString()).not.toContain("evil.example");
});

it("a submittal record return retains its existing key and upload target in the fallback email link", async () => {
  m.listUsers.mockResolvedValue({ data: { users: [{ email: "pm@example.com" }] }, error: null });
  req.url = "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/submittal/05%2012%2000-001";
  const back = "/r/job/11111111-1111-4111-8111-111111111111/submittal/05%2012%2000-001?t=fictional-key&upload=1#upload";
  const promise = requestMemberMagicLink({
    data: { email: "pm@example.com", return_to: back.replace("#upload", "&utm_source=chatgpt.com#upload") },
  });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  expect(new URL(m.send.mock.calls[0][0].confirmationUrl).searchParams.get("redirect")).toBe(back);
});

it("an Athena report return rides on the callback and stays off the account page", async () => {
  req.url = "https://app.meetathena.io/login?redirect=%2Fr%2Fjob%2F1";
  const back = "/r/job/11111111-1111-4111-8111-111111111111/field#activity-A2000";
  const promise = requestMemberMagicLink({ data: { email: "member@example.test", return_to: back } });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  const url = new URL(m.send.mock.calls[0][0].confirmationUrl);
  expect(url.searchParams.get("redirect")).toBe(back);
  expect(url.searchParams.get("redirect")).not.toBe("/account");
  expect(m.generateLink.mock.calls[0][0].options.redirectTo).toBe("https://app.meetathena.io/auth/callback");
});

it("a consent continuation marks the Athena email as connecting", async () => {
  vi.stubEnv("OAUTH_CONTINUATION_SECRET", "synthetic-test-secret-at-least-32-characters");
  const promise = requestMemberMagicLink({
    data: { email: "member@example.test", continuation: "/oauth/consent?authorization_id=test-request" },
  });
  await vi.advanceTimersByTimeAsync(600);
  await promise;
  expect(m.send.mock.calls[0][0].connecting).toBe(true);
});
