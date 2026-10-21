import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  details: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/lib/oauth-consent-api", () => ({
  getAuthorizationDetails: (id: string, t: string) => m.details(id, t),
  getAuthUser: (t: string) => m.user(t),
  decideAuthorization: vi.fn(),
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
      signOut: vi.fn().mockResolvedValue({}),
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
const ctx = { consentUser: { id: "u1", email: "a@b.c" }, accessToken: "tok" };
const load = (context: unknown = ctx) => route.loader({ location: { search: `?authorization_id=${ID}` }, context });

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
  it("passes for a signed-in session via a direct /user check (no auth lock)", async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
    m.user.mockResolvedValue({ data: { id: "u", email: null }, error: null });
    await expect(before()).resolves.toEqual({ consentUser: { id: "u", email: null }, accessToken: "tok" });
    expect(m.getUser).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a stale token sends the member to sign in again", async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: "old" } }, error: null });
    m.user.mockResolvedValue({ data: null, error: { message: "bad", status: 401 } });
    expect(((await before().catch((e) => e)) as E).__redirect).toBeTruthy();
  });
  it("a hung /user check shows a timeout, not a spinner", async () => {
    m.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
    m.user.mockResolvedValue({ data: null, error: { message: "timeout", status: 408 } });
    expect(((await before().catch((e) => e)) as E).stage).toBe("identity");
  });
});

describe("consent loader", () => {
  const client = { client: { name: "Test client" }, scope: "openid" };
  it("a timed-out details request is a details timeout", async () => {
    m.details.mockResolvedValue({ data: null, error: { message: "timeout", status: 408 } });
    const err = (await load().catch((e) => e)) as E;
    expect(err.stage).toBe("details");
    expect(err.kind).toBe("timeout");
  });
  it("hides raw details errors", async () => {
    m.details.mockResolvedValue({ data: null, error: { message: `raw ${ID} https://x/y?token=z`, status: 400 } });
    const err = (await load().catch((e) => e)) as E;
    expect(err.stage).toBe("details");
    expect(err.message).not.toContain("token");
  });
  it("fails closed without a confirmed identity", async () => {
    expect(((await load({}).catch((e) => e)) as E).stage).toBe("identity");
    expect(m.details).not.toHaveBeenCalled();
  });
  it("returns details and identity on success with no timers left", async () => {
    m.details.mockResolvedValue({ data: client, error: null });
    m.rpc.mockResolvedValue({ data: true, error: null });
    await expect(load()).resolves.toEqual({ details: client, email: "a@b.c", userId: "u1", entitled: true, accessToken: "tok" });
    expect(m.details).toHaveBeenCalledWith(ID, "tok");
    expect(m.rpc).toHaveBeenCalledWith("mcp_gate");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("marks an account without membership entitlement as not entitled", async () => {
    m.details.mockResolvedValue({ data: client, error: null });
    m.rpc.mockResolvedValue({ data: false, error: null });
    await expect(load()).resolves.toMatchObject({ userId: "u1", entitled: false });
  });
});

describe("v0.8.12 consent load speed", () => {
  it("loader reuses the identity from beforeLoad and starts entitlement in parallel with details", () => {
    const s = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../routes/oauth.consent.tsx"), "utf8") as string;
    expect(s).toContain("return { consentUser, accessToken };");
    expect(s.indexOf("const entP =")).toBeLessThan(s.indexOf("getAuthorizationDetails(id, accessToken)"));
    expect(s).toContain("throw redirect({ to: \"/login\", search: { redirect: consentReturnPath(search.authorization_id) } });");
  });
});
