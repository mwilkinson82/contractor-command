import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  details: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => config,
  redirect: (opts: unknown) => ({ __redirect: opts }),
  useNavigate: () => vi.fn(),
}));
vi.mock("react", () => ({ useState: (v: unknown) => [v, vi.fn()] }));
vi.mock("@/components/auth/auth-card", () => ({ AuthCard: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => m.rpc(fn),
    auth: {
      getSession: m.getSession,
      getUser: m.getUser,
      oauth: { getAuthorizationDetails: m.details },
    },
  },
}));
import { Route } from "@/routes/oauth.consent";
import { CONSENT_STEP_TIMEOUT_MS } from "@/lib/consent-loading";

type Cfg = {
  beforeLoad: (a: unknown) => Promise<unknown>;
  loader: (a: unknown) => Promise<unknown>;
};
type E = { stage?: string; kind?: string; message: string; __redirect?: unknown };
const route = Route as unknown as Cfg;
const ID = "synthetic-auth-id";
const never = () => new Promise<never>(() => {});
const before = () =>
  route.beforeLoad({
    search: { authorization_id: ID },
    location: { pathname: "/oauth/consent", searchStr: `?authorization_id=${ID}&x=1` },
  });
const load = () => route.loader({ location: { search: `?authorization_id=${ID}` } });

async function rejectsAfterTimeout(p: Promise<unknown>) {
  const caught = p.catch((e) => e);
  await vi.advanceTimersByTimeAsync(CONSENT_STEP_TIMEOUT_MS);
  const err = (await caught) as Error & { stage?: string; kind?: string };
  expect(err).toBeInstanceOf(Error);
  expect(String(err.message)).not.toContain(ID);
  return err as Error & { stage?: string; kind?: string };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { href: "" } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("consent beforeLoad", () => {
  it("times out a never-resolving getSession with a session-stage error", async () => {
    m.getSession.mockImplementation(never);
    const err = await rejectsAfterTimeout(before());
    expect(err.stage).toBe("session");
    expect(err.kind).toBe("timeout");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("redirects signed-out callers with the canonical authorization_id only", async () => {
    m.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const thrown = (await before().catch((e) => e)) as E;
    expect(thrown.__redirect).toEqual({
      to: "/login",
      search: { redirect: `/oauth/consent?authorization_id=${ID}` },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails closed on a session error", async () => {
    m.getSession.mockResolvedValue({ data: { session: null }, error: { message: "raw" } });
    const err = (await before().catch((e) => e)) as E;
    expect(err.stage).toBe("session");
    expect(err.__redirect).toBeUndefined();
  });
  it("passes for a signed-in session and clears its timer", async () => {
    m.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } }, error: null });
    m.getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    await expect(before()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("consent loader", () => {
  const client = { client: { name: "Test client" }, scope: "openid" };
  it("times out never-resolving details", async () => {
    m.details.mockImplementation(never);
    const err = await rejectsAfterTimeout(load());
    expect(err.stage).toBe("details");
    expect(m.getUser).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out a never-resolving getUser", async () => {
    m.details.mockResolvedValue({ data: client, error: null });
    m.getUser.mockImplementation(never);
    const err = await rejectsAfterTimeout(load());
    expect(err.stage).toBe("identity");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("hides raw details errors", async () => {
    m.details.mockResolvedValue({
      data: null,
      error: { message: `raw ${ID} https://x/y?token=z` },
    });
    const err = (await load().catch((e) => e)) as E;
    expect(err.stage).toBe("details");
    expect(err.message).not.toContain("token");
  });
  it("fails closed when identity is missing or errors", async () => {
    m.details.mockResolvedValue({ data: client, error: null });
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(((await load().catch((e) => e)) as E).stage).toBe("identity");
    m.getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: { message: "x" } });
    expect(((await load().catch((e) => e)) as E).stage).toBe("identity");
  });
  it("returns details and identity on success with no timers left", async () => {
    m.details.mockResolvedValue({ data: client, error: null });
    m.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } }, error: null });
    m.rpc.mockResolvedValue({ data: true, error: null });
    await expect(load()).resolves.toEqual({ details: client, email: "a@b.c", userId: "u1", entitled: true });
    expect(m.rpc).toHaveBeenCalledWith("mcp_gate");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks an account without membership entitlement as not entitled", async () => {
    m.details.mockResolvedValue({ data: client, error: null });
    m.getUser.mockResolvedValue({ data: { user: { id: "u2", email: "x@y.z" } }, error: null });
    m.rpc.mockResolvedValue({ data: false, error: null });
    await expect(load()).resolves.toMatchObject({ userId: "u2", entitled: false });
  });
});
