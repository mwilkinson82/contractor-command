import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { athenaCodeSignInDestination, completeAthenaCodeSignIn } from "./athena-code-sign-in";

const CONSENT = "/oauth/consent?authorization_id=synthetic";
const CONSENT_WITH_QUERY = "/oauth/consent?authorization_id=synthetic&next=approve";

const state = vi.hoisted(() => ({
  athena: true,
  host: "app.meetathena.io",
  redirect: "/oauth/consent?authorization_id=synthetic" as string | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => ({ redirect: state.redirect }),
  }),
  Link: () => null,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
vi.mock("@/lib/athena-host-current", () => ({
  onAthenaHost: () => state.athena,
  currentHostname: () => state.host,
}));

import { LoginForm, Route } from "@/routes/login";

const route = Route as unknown as {
  component: () => React.ReactNode;
  validateSearch: (search: Record<string, unknown>) => { redirect?: string };
};

function page(props?: { initialCodeSent?: boolean }) {
  const node = props ? createElement<{ initialCodeSent?: boolean }>(LoginForm, props) : createElement(route.component);
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  state.athena = true;
  state.host = "app.meetathena.io";
  state.redirect = CONSENT;
});

describe("consent login uses the emailed code", () => {
  it("shows the send-code step and never a magic-link button", () => {
    const html = page();
    expect(html).toContain("Sign in to approve the connection.");
    expect(html).toContain('data-signin="email-code"');
    expect(html).toContain("Email me a sign-in code");
    expect(html).toContain('type="email"');
    expect(html).not.toContain("Email me a secure sign-in link");
    expect(html).not.toContain("secure sign-in link");
    expect(html).not.toContain("Sending secure link");
    expect(html).not.toContain("Use password instead");
    expect(html).not.toContain('type="password"');
    expect(html).not.toMatch(/magic link/i);
  });

  it("shows the 8-digit code entry and still no magic-link button", () => {
    const html = page({ initialCodeSent: true });
    expect(html).toContain("Sign in to approve the connection.");
    expect(html).toContain('data-signin="email-code"');
    expect(html).toContain("8-digit code");
    expect(html).toContain('id="otp"');
    expect(html).toContain('placeholder="12345678"');
    expect(html).toContain("one-time-code");
    expect(html).toContain("numeric");
    expect(html).toContain("Continue");
    expect(html).not.toContain("Email me a secure sign-in link");
    expect(html).not.toContain("secure sign-in link");
    expect(html).not.toContain("Or type the code from the email");
    expect(html).not.toContain("tap the link");
    expect(html).not.toContain("Use password instead");
    expect(html).not.toMatch(/magic link/i);
  });

  it("uses the code flow for an Athena host login that is not a consent return", () => {
    state.redirect = undefined;
    const html = page();
    expect(html).toContain("Sign in to Athena");
    expect(html).toContain("Email me a sign-in code");
    expect(html).not.toContain("Email me a secure sign-in link");
  });

  it("keeps the Hub sign-in on the magic link when there is no consent return", () => {
    state.athena = false;
    state.host = "app.alpcontractorcircle.com";
    state.redirect = undefined;
    const html = page();
    expect(html).toContain("Sign in to the Hub.");
    expect(html).toContain("Use password instead");
    expect(html).not.toContain("Email me a sign-in code");
    expect(html).not.toContain('data-signin="email-code"');
  });
});

describe("consent redirect after the code verifies", () => {
  it("keeps the consent path and its query string", () => {
    expect(route.validateSearch({ redirect: CONSENT }).redirect).toBe(CONSENT);
    expect(route.validateSearch({ redirect: CONSENT_WITH_QUERY }).redirect).toBe(
      CONSENT_WITH_QUERY,
    );
    expect(athenaCodeSignInDestination(CONSENT, true)).toBe(CONSENT);
    expect(athenaCodeSignInDestination(CONSENT_WITH_QUERY, true)).toBe(CONSENT_WITH_QUERY);
    expect(athenaCodeSignInDestination(`${CONSENT}#approve`, true)).toBe(`${CONSENT}#approve`);
  });

  it("rejects off-site redirects", () => {
    expect(
      route.validateSearch({
        redirect: "https://evil.example/oauth/consent?authorization_id=synthetic",
      }).redirect,
    ).toBe("/");
    expect(
      route.validateSearch({ redirect: "//evil.example/oauth/consent?authorization_id=synthetic" })
        .redirect,
    ).toBe("/");
    expect(
      athenaCodeSignInDestination(
        "https://evil.example/oauth/consent?authorization_id=synthetic",
        true,
      ),
    ).toBe("/account");
    expect(
      athenaCodeSignInDestination("//evil.example/oauth/consent?authorization_id=synthetic", false),
    ).toBe("/");
    expect(athenaCodeSignInDestination("/\\evil.example", true)).toBe("/account");
  });

  it("the login page verifies with verifyOtp and assigns the redirect", () => {
    const src = readFileSync("src/routes/login.tsx", "utf8");
    expect(src).toMatch(
      /completeAthenaCodeSignIn\(\{[\s\S]*redirectTo,[\s\S]*supabase\.auth\.verifyOtp\(input\)/,
    );
  });

  it("calls verifyOtp and then assigns the consent redirect", async () => {
    const verify = vi.fn().mockResolvedValue({ error: null });
    const assign = vi.fn();
    const result = await completeAthenaCodeSignIn({
      email: " member@example.test ",
      code: "1234 5678",
      redirectTo: CONSENT_WITH_QUERY,
      onAthenaHost: true,
      verify,
      assign,
    });
    expect(result).toEqual({ ok: true, destination: CONSENT_WITH_QUERY });
    expect(verify).toHaveBeenCalledWith({
      email: "member@example.test",
      token: "12345678",
      type: "email",
    });
    expect(assign).toHaveBeenCalledWith(CONSENT_WITH_QUERY);
  });

  it("does not navigate when the code is rejected or the wrong length", async () => {
    const verify = vi.fn().mockResolvedValue({ error: { message: "bad" } });
    const assign = vi.fn();
    const rejected = await completeAthenaCodeSignIn({
      email: "member@example.test",
      code: "12345678",
      redirectTo: CONSENT,
      onAthenaHost: true,
      verify,
      assign,
    });
    expect(rejected.ok).toBe(false);
    expect(assign).not.toHaveBeenCalled();

    const skipped = await completeAthenaCodeSignIn({
      email: "member@example.test",
      code: "123456",
      redirectTo: "https://evil.example",
      onAthenaHost: true,
      verify,
      assign,
    });
    expect(skipped.ok).toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });
});
