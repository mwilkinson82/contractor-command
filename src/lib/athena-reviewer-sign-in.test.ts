import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATHENA_REVIEWER_EMAIL,
  REVIEWER_REJECTED_MESSAGE,
  REVIEWER_USE_CODE_MESSAGE,
  attemptAthenaReviewerPassword,
  athenaReviewerRequestAllowed,
  configuredReviewerEmail,
  installReviewerSession,
  isAthenaReviewerEmail,
  memberCodeSignInHref,
  reviewerSearchFlag,
  reviewerSessionRecord,
  reviewerSignInHref,
  submitAthenaReviewerPassword,
  supabaseAuthStorageKey,
  type ReviewerSession,
} from "./athena-reviewer-sign-in";

const CONSENT = "/oauth/consent?authorization_id=synthetic";
const PASSWORD = "synthetic-reviewer-secret";

const session: ReviewerSession = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  expires_in: 3600,
  expires_at: 1_800_000_000,
  token_type: "bearer",
  user: {
    id: "user-1",
    aud: "authenticated",
    role: "authenticated",
    email: ATHENA_REVIEWER_EMAIL,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: null },
  },
};

function signInOk() {
  return vi.fn().mockResolvedValue({ error: null, session });
}

describe("reviewer allowlist", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows only the one configured address", () => {
    const env = {};
    expect(isAthenaReviewerEmail(`  ${ATHENA_REVIEWER_EMAIL.toUpperCase()}  `, env)).toBe(true);
    expect(isAthenaReviewerEmail("member@meetathena.io", env)).toBe(false);
    expect(isAthenaReviewerEmail("athena-reviewer@meetathena.com", env)).toBe(false);
    expect(isAthenaReviewerEmail("athena-reviewer@meetathena.io.evil", env)).toBe(false);
    expect(configuredReviewerEmail({})).toBe(ATHENA_REVIEWER_EMAIL);
    expect(configuredReviewerEmail({ ATHENA_REVIEWER_EMAIL })).toBe(ATHENA_REVIEWER_EMAIL);
    expect(configuredReviewerEmail({ ATHENA_REVIEWER_EMAIL: "other@meetathena.io" })).toBeNull();
    expect(
      isAthenaReviewerEmail(ATHENA_REVIEWER_EMAIL, {
        ATHENA_REVIEWER_EMAIL: "other@meetathena.io",
      }),
    ).toBe(false);
  });

  it("accepts only ?reviewer=1 and keeps the consent return on that link", () => {
    expect(reviewerSearchFlag("1")).toBe(1);
    expect(reviewerSearchFlag(1)).toBe(1);
    expect(reviewerSearchFlag("true")).toBeUndefined();
    expect(reviewerSearchFlag("0")).toBeUndefined();
    const href = reviewerSignInHref(CONSENT);
    const url = new URL(href, "https://app.meetathena.io");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("reviewer")).toBe("1");
    expect(url.searchParams.get("redirect")).toBe(CONSENT);
    expect(memberCodeSignInHref(CONSENT)).not.toContain("reviewer");
    expect(
      new URL(memberCodeSignInHref(CONSENT), "https://app.meetathena.io").searchParams.get(
        "redirect",
      ),
    ).toBe(CONSENT);
    expect(reviewerSignInHref("https://evil.example/oauth/consent")).toBe("/login?reviewer=1");
    expect(memberCodeSignInHref("//evil.example")).toBe("/login");
  });

  it("treats the Hub host as not Athena and an Athena origin as Athena", () => {
    expect(athenaReviewerRequestAllowed({ origin: "https://app.meetathena.io" })).toBe(true);
    expect(
      athenaReviewerRequestAllowed({
        origin: "https://app.alpcontractorcircle.com",
        url: "https://app.meetathena.io/login",
      }),
    ).toBe(false);
    expect(athenaReviewerRequestAllowed({ forwardedHost: "app.meetathena.io" })).toBe(true);
    expect(athenaReviewerRequestAllowed({ url: "https://app.alpcontractorcircle.com/login" })).toBe(
      false,
    );
    expect(athenaReviewerRequestAllowed({})).toBe(false);
  });
});

describe("attemptAthenaReviewerPassword", () => {
  it("checks the password only for the allowlisted email", async () => {
    const signIn = signInOk();
    const ok = await attemptAthenaReviewerPassword({
      email: ` ${ATHENA_REVIEWER_EMAIL.toUpperCase()} `,
      password: PASSWORD,
      onAthenaHost: true,
      signIn,
      env: {},
    });
    expect(ok.ok).toBe(true);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith(ATHENA_REVIEWER_EMAIL, PASSWORD);
    if (ok.ok) {
      expect(ok.access_token).toBe("access-token");
      expect(JSON.stringify(ok)).not.toContain(PASSWORD);
    }
  });

  it("rejects every other email before signInWithPassword and sends them to the code flow", async () => {
    const signIn = signInOk();
    const rejected = await attemptAthenaReviewerPassword({
      email: "member@meetathena.io",
      password: PASSWORD,
      onAthenaHost: true,
      signIn,
      env: {},
    });
    expect(rejected).toEqual({ ok: false, code: "use_email_code" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not check a password from the Hub host, including the reviewer address", async () => {
    const signIn = signInOk();
    const rejected = await attemptAthenaReviewerPassword({
      email: ATHENA_REVIEWER_EMAIL,
      password: PASSWORD,
      onAthenaHost: false,
      signIn,
      env: {},
    });
    expect(rejected).toEqual({ ok: false, code: "use_email_code" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not call signIn when the env lock names a different address", async () => {
    const signIn = signInOk();
    const rejected = await attemptAthenaReviewerPassword({
      email: ATHENA_REVIEWER_EMAIL,
      password: PASSWORD,
      onAthenaHost: true,
      signIn,
      env: { ATHENA_REVIEWER_EMAIL: "other@meetathena.io" },
    });
    expect(rejected).toEqual({ ok: false, code: "use_email_code" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("keeps a wrong password on the password form and does not echo it", async () => {
    const signIn = vi.fn().mockResolvedValue({
      error: { message: `invalid ${PASSWORD}` },
      session: null,
    });
    const rejected = await attemptAthenaReviewerPassword({
      email: ATHENA_REVIEWER_EMAIL,
      password: PASSWORD,
      onAthenaHost: true,
      signIn,
      env: {},
    });
    expect(rejected).toEqual({ ok: false, code: "rejected" });
    expect(JSON.stringify(rejected)).not.toContain(PASSWORD);
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("does not send an empty password to signIn", async () => {
    const signIn = signInOk();
    const rejected = await attemptAthenaReviewerPassword({
      email: ATHENA_REVIEWER_EMAIL,
      password: "",
      onAthenaHost: true,
      signIn,
      env: {},
    });
    expect(rejected).toEqual({ ok: false, code: "rejected" });
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("submitAthenaReviewerPassword", () => {
  it("stores the session and returns to OAuth consent", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, ...session });
    const install = vi.fn();
    const assign = vi.fn();
    const result = await submitAthenaReviewerPassword({
      email: ATHENA_REVIEWER_EMAIL,
      password: PASSWORD,
      redirectTo: CONSENT,
      onAthenaHost: true,
      request,
      install,
      assign,
    });
    expect(result).toEqual({ ok: true, destination: CONSENT });
    expect(install).toHaveBeenCalledWith(session);
    expect(assign).toHaveBeenCalledWith(CONSENT);
    expect(JSON.stringify(install.mock.calls)).not.toContain(PASSWORD);
  });

  it("sends a non-allowlisted email back to the code flow without storing a session", async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, code: "use_email_code" });
    const install = vi.fn();
    const assign = vi.fn();
    const result = await submitAthenaReviewerPassword({
      email: "member@example.test",
      password: PASSWORD,
      redirectTo: CONSENT,
      onAthenaHost: true,
      request,
      install,
      assign,
    });
    expect(result).toEqual({ ok: false, showCode: true, message: REVIEWER_USE_CODE_MESSAGE });
    expect(install).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("stays on the password form when the password is rejected", async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, code: "rejected" });
    const assign = vi.fn();
    const result = await submitAthenaReviewerPassword({
      email: ATHENA_REVIEWER_EMAIL,
      password: PASSWORD,
      redirectTo: CONSENT,
      onAthenaHost: true,
      request,
      install: vi.fn(),
      assign,
    });
    expect(result).toEqual({ ok: false, showCode: false, message: REVIEWER_REJECTED_MESSAGE });
    expect(assign).not.toHaveBeenCalled();
  });

  it("refuses an off-site redirect after a good password", async () => {
    const assign = vi.fn();
    const result = await submitAthenaReviewerPassword({
      email: ATHENA_REVIEWER_EMAIL,
      password: PASSWORD,
      redirectTo: "https://evil.example/oauth/consent?authorization_id=synthetic",
      onAthenaHost: true,
      request: vi.fn().mockResolvedValue({ ok: true, ...session }),
      install: vi.fn(),
      assign,
    });
    expect(result).toEqual({ ok: true, destination: "/account" });
    expect(assign).toHaveBeenCalledWith("/account");
  });
});

describe("stored session", () => {
  it("uses the auth client's storage key and leaves the password out", () => {
    expect(supabaseAuthStorageKey("https://qcbbjjjxcacrscfhgfmf.supabase.co")).toBe(
      "sb-qcbbjjjxcacrscfhgfmf-auth-token",
    );
    const store = new Map<string, string>();
    installReviewerSession(session, {
      supabaseUrl: "https://qcbbjjjxcacrscfhgfmf.supabase.co",
      setItem: (key, value) => store.set(key, value),
    });
    const raw = store.get("sb-qcbbjjjxcacrscfhgfmf-auth-token");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as ReviewerSession;
    expect(parsed.access_token).toBe("access-token");
    expect(parsed.refresh_token).toBe("refresh-token");
    expect(parsed.user.id).toBe("user-1");
    expect(parsed.expires_at).toBe(1_800_000_000);
    expect(raw).not.toContain(PASSWORD);
    expect(reviewerSessionRecord(session)).not.toContain(PASSWORD);
  });
});
