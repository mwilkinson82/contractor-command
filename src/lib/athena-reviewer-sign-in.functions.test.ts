import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  createClient: vi.fn(),
}));

const req = vi.hoisted(() => ({
  url: "https://app.meetathena.io/login?reviewer=1",
  origin: "https://app.meetathena.io" as string | null,
  forwarded: null as string | null,
  host: "app.meetathena.io" as string | null,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
        fn(input),
    }),
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({
    url: req.url,
    headers: {
      get(name: string) {
        const key = name.toLowerCase();
        if (key === "origin") return req.origin;
        if (key === "x-forwarded-host") return req.forwarded;
        if (key === "host") return req.host;
        return null;
      },
    },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => m.createClient(...args),
}));

import { ATHENA_REVIEWER_EMAIL } from "./athena-reviewer-sign-in";
import { reviewerPasswordSignIn } from "./athena-reviewer-sign-in.functions";

const PASSWORD = "synthetic-reviewer-secret";

const signedIn = {
  data: {
    session: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      expires_at: 1_800_000_000,
      token_type: "bearer",
      user: { id: "user-1", email: ATHENA_REVIEWER_EMAIL },
    },
  },
  error: null,
};

const logs = vi.hoisted(() => ({
  log: [] as unknown[][],
  info: [] as unknown[][],
  error: [] as unknown[][],
}));

beforeEach(() => {
  req.url = "https://app.meetathena.io/login?reviewer=1";
  req.origin = "https://app.meetathena.io";
  req.forwarded = null;
  req.host = "app.meetathena.io";
  logs.log = [];
  logs.info = [];
  logs.error = [];
  vi.stubEnv("SUPABASE_URL", "https://qcbbjjjxcacrscfhgfmf.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
  vi.stubEnv("ATHENA_REVIEWER_EMAIL", "");
  m.createClient.mockImplementation(() => ({ auth: { signInWithPassword: m.signInWithPassword } }));
  m.signInWithPassword.mockResolvedValue(signedIn);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.error.push(args);
  });
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    logs.info.push(args);
  });
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.log.push(args);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("reviewerPasswordSignIn", () => {
  it("signs in the allowlisted email with signInWithPassword and returns no password", async () => {
    const result = await reviewerPasswordSignIn({
      data: { email: ` ${ATHENA_REVIEWER_EMAIL.toUpperCase()} `, password: PASSWORD },
    });
    expect(m.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(m.signInWithPassword).toHaveBeenCalledWith({
      email: ATHENA_REVIEWER_EMAIL,
      password: PASSWORD,
    });
    expect(m.createClient).toHaveBeenCalledWith(
      "https://qcbbjjjxcacrscfhgfmf.supabase.co",
      "synthetic-publishable-key",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    expect(result).toMatchObject({
      ok: true,
      access_token: "access-token",
      refresh_token: "refresh-token",
      user: { id: "user-1", email: ATHENA_REVIEWER_EMAIL },
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(logs.log)).not.toContain(PASSWORD);
    expect(JSON.stringify(logs.info)).not.toContain(PASSWORD);
    expect(JSON.stringify(logs.error)).not.toContain(PASSWORD);
  });

  it("rejects a non-allowlisted email before signInWithPassword", async () => {
    const result = await reviewerPasswordSignIn({
      data: { email: "member@meetathena.io", password: PASSWORD },
    });
    expect(result).toEqual({ ok: false, code: "use_email_code" });
    expect(m.signInWithPassword).not.toHaveBeenCalled();
    expect(m.createClient).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("rejects the reviewer email when the request is from the Hub", async () => {
    req.origin = "https://app.alpcontractorcircle.com";
    req.url = "https://app.alpcontractorcircle.com/login";
    req.host = "app.alpcontractorcircle.com";
    const result = await reviewerPasswordSignIn({
      data: { email: ATHENA_REVIEWER_EMAIL, password: PASSWORD },
    });
    expect(result).toEqual({ ok: false, code: "use_email_code" });
    expect(m.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not echo a failed password grant", async () => {
    m.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: `bad ${PASSWORD}` },
    });
    const result = await reviewerPasswordSignIn({
      data: { email: ATHENA_REVIEWER_EMAIL, password: PASSWORD },
    });
    expect(result).toEqual({ ok: false, code: "rejected" });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });
});
