// Regression for the consent page's session/identity stall caused by portal
// hooks mounted on public pages.
//
// 1. Real installed auth SDK + injected fetch: getUser() holds the auth lock
//    across its /user request, and the SDK drains every queued in-lock call
//    before returning, so one hung /user leaves a concurrent getSession()
//    pending. Without the concurrent getUser(), getSession() resolves.
// 2. Root structure: the public branch of AuthGate must return before the
//    portal hooks (useAuth/useCompany/useTier/useIsAdmin, vault hydration,
//    presence) are mounted. Those live only in ProtectedGate.
//
// The real-browser root-mount check (old gate dispatches the portal /user and
// consent fails; new gate dispatches none and consent proceeds) is run with
// Playwright against the dev server; vitest here has no DOM.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = "https://synthetic.supabase.co";
const KEY = "synthetic-publishable-key";

function b64(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function storedSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64({ alg: "ES256" })}.${b64({ sub: "u1", exp })}.sig`,
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id: "u1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
  };
}

function makeClient() {
  const m = new Map<string, string>();
  const storageKey = "sb-synthetic-auth-token";
  m.set(storageKey, JSON.stringify(storedSession()));
  const userRequests: string[] = [];
  const hangingFetch: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/auth/v1/user")) {
      userRequests.push(url);
      return new Promise<Response>(() => undefined);
    }
    throw new Error("synthetic test: no other network");
  };
  const client = createClient(URL, KEY, {
    global: { fetch: hangingFetch },
    auth: {
      storageKey,
      storage: {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return { client, userRequests };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function state<T>(p: Promise<T>, ms = 150) {
  return Promise.race([
    p.then(() => "resolved" as const),
    settle(ms).then(() => "pending" as const),
  ]);
}

describe("auth SDK lock: hung getUser blocks concurrent getSession", () => {
  it("getSession resolves when no getUser runs concurrently", async () => {
    const { client } = makeClient();
    await client.auth.initialize();
    await settle(10);
    expect(await state(client.auth.getSession())).toBe("resolved");
  });

  it("getSession stays pending while a concurrent getUser /user request hangs", async () => {
    const { client, userRequests } = makeClient();
    await client.auth.initialize();
    await settle(10);
    const session = client.auth.getSession();
    void client.auth.getUser();
    expect(await state(session)).toBe("pending");
    expect(userRequests.length).toBe(1);
    const auth = client.auth as unknown as { lockAcquired: boolean; pendingInLock: unknown[] };
    expect(auth.lockAcquired).toBe(true);
    expect(auth.pendingInLock.length).toBeGreaterThanOrEqual(1);
  });
});

describe("root AuthGate: public pages never mount portal hooks", () => {
  const src = readFileSync("src/routes/__root.tsx", "utf8");
  const gateStart = src.indexOf("function AuthGate(");
  const protectedStart = src.indexOf("function ProtectedGate(");
  const authGate = src.slice(gateStart, protectedStart);
  const protectedGate = src.slice(protectedStart);

  it("splits the wrapper from the protected component", () => {
    expect(gateStart).toBeGreaterThan(-1);
    expect(protectedStart).toBeGreaterThan(gateStart);
  });

  it("wrapper calls no portal hook and no portal request", () => {
    for (const hook of [
      "useAuth(",
      "useCompany(",
      "useTier(",
      "useIsAdmin(",
      "vault.hydrateFor",
      "supabase.channel",
      "getUser(",
      "getSession(",
    ]) {
      expect(authGate).not.toContain(hook);
    }
  });

  it("wrapper keeps auth-hash forwarding and returns public pages before ProtectedGate", () => {
    expect(authGate).toContain("window.location.replace(");
    const publicReturn = authGate.indexOf("if (PUBLIC_ROUTES.has(pathname)) return");
    const protectedRender = authGate.indexOf("<ProtectedGate");
    expect(publicReturn).toBeGreaterThan(-1);
    expect(protectedRender).toBeGreaterThan(publicReturn);
  });

  it("protected component keeps sign-in, onboarding and tier guards", () => {
    for (const s of [
      "useAuth(",
      "useCompany(",
      "useTier(",
      "useIsAdmin(",
      'to: "/login"',
      'to: "/onboarding"',
      'to: "/upgrade"',
    ]) {
      expect(protectedGate).toContain(s);
    }
  });

  it("consent, login and callback are public routes", () => {
    for (const r of ['"/login"', '"/auth/callback"', '"/oauth/consent"']) {
      expect(src.slice(0, gateStart)).toContain(r);
    }
  });
});
