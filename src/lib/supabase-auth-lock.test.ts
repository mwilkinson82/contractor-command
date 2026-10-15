// Causal test for the consent "Checking your sign-in took too long" failure.
//
// Runs the real generated client (src/integrations/supabase/client.ts) and the
// real installed auth SDK against a synthetic stored session and a Web Locks
// fake. No network, no real credentials.
//
// Mechanism under test: the SDK coordinates tabs with a navigator lock named
// "lock:<storageKey>". supabase-js forwards `lockAcquireTimeout: undefined`
// when the app does not set it, which overrides the auth SDK's own 5000 ms
// default, so the lock request never times out and the SDK's orphaned-lock
// recovery (steal after timeout) never runs. If any other same-origin tab or
// window holds that lock, initialization — and therefore every getSession() —
// waits forever without sending a request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REF = "qcbbjjjxcacrscfhgfmf";
const STORAGE_KEY = `sb-${REF}-auth-token`;
const LOCK_NAME = `lock:${STORAGE_KEY}`;
const USER_ID = "00000000-0000-4000-8000-000000000001";

function b64(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function syntheticSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64({ alg: "ES256", typ: "JWT" })}.${b64({ sub: USER_ID, exp, role: "authenticated" })}.sig`;
  return {
    access_token: token,
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

type Waiter = {
  steal: boolean;
  signal?: AbortSignal;
  grant: () => void;
  reject: (e: unknown) => void;
};

// Minimal Web Locks fake: exclusive mode, ifAvailable, signal abort, steal.
class FakeLockManager {
  held = new Map<string, { abort: (e: unknown) => void }>();
  queue = new Map<string, Waiter[]>();

  holdForever(name: string) {
    this.held.set(name, { abort: () => undefined });
  }

  request(
    name: string,
    opts: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal },
    cb: (lock: unknown) => Promise<unknown>,
  ) {
    return new Promise((resolve, reject) => {
      const run = () => {
        let abortHolder: (e: unknown) => void = () => undefined;
        const stolen = new Promise<never>((_, rej) => (abortHolder = rej));
        this.held.set(name, { abort: abortHolder });
        Promise.race([Promise.resolve().then(() => cb({ name })), stolen])
          .then(resolve, reject)
          .finally(() => {
            if (this.held.get(name)?.abort === abortHolder) {
              this.held.delete(name);
              this.next(name);
            }
          });
      };
      if (opts.steal) {
        this.held.get(name)?.abort(new DOMException("stolen", "AbortError"));
        this.held.delete(name);
        return run();
      }
      if (!this.held.has(name)) return run();
      if (opts.ifAvailable) return Promise.resolve(cb(null)).then(resolve, reject);
      const w: Waiter = { steal: false, signal: opts.signal, grant: run, reject };
      opts.signal?.addEventListener("abort", () => {
        const q = this.queue.get(name) ?? [];
        this.queue.set(
          name,
          q.filter((x) => x !== w),
        );
        reject(new DOMException("aborted", "AbortError"));
      });
      this.queue.set(name, [...(this.queue.get(name) ?? []), w]);
    });
  }

  next(name: string) {
    const q = this.queue.get(name) ?? [];
    const w = q.shift();
    this.queue.set(name, q);
    w?.grant();
  }

  async query() {
    return { held: [...this.held.keys()].map((name) => ({ name })), pending: [] };
  }
}

function memoryStorage(seed: Record<string, string>) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

let locks: FakeLockManager;

beforeEach(() => {
  vi.resetModules();
  locks = new FakeLockManager();
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(syntheticSession()) });
  vi.stubEnv("VITE_SUPABASE_URL", `https://${REF}.supabase.co`);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", { visibilityState: "hidden" });
  vi.stubGlobal("location", {
    hostname: "app.alpcontractorcircle.com",
    href: "https://app.alpcontractorcircle.com/oauth/consent?authorization_id=synthetic",
  });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", { locks });
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("synthetic test: no network")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function settleWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ settled: false }>(
    (r) => (timer = setTimeout(() => r({ settled: false }), ms)),
  );
  try {
    return await Promise.race([p.then((value) => ({ settled: true as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe("generated client + auth SDK cross-tab lock", () => {
  it("control: with no other holder, getSession returns the stored session", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const r = await settleWithin(supabase.auth.getSession(), 2_000);
    expect(r.settled).toBe(true);
    if (r.settled) expect(r.value.data.session?.user.id).toBe(USER_ID);
  });

  it("recovers when another tab holds the auth lock and never releases it", async () => {
    locks.holdForever(LOCK_NAME);
    const { supabase } = await import("@/integrations/supabase/client");
    // The consent page gives this step 15 s. The SDK's intended orphan
    // recovery steals the lock after its 5 s acquire timeout.
    const r = await settleWithin(supabase.auth.getSession(), 8_000);
    expect(r.settled).toBe(true);
    if (r.settled) expect(r.value.data.session?.user.id).toBe(USER_ID);
  }, 15_000);
});
