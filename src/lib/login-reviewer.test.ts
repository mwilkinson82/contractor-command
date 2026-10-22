import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONSENT = "/oauth/consent?authorization_id=synthetic";

const state = vi.hoisted(() => ({
  athena: true,
  host: "app.meetathena.io",
  redirect: "/oauth/consent?authorization_id=synthetic" as string | undefined,
  reviewer: undefined as 1 | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => ({ redirect: state.redirect, reviewer: state.reviewer }),
  }),
  Link: () => null,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: vi.fn() }));
vi.mock("@/lib/athena-reviewer-sign-in.functions", () => ({ reviewerPasswordSignIn: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
vi.mock("@/lib/athena-host-current", () => ({
  onAthenaHost: () => state.athena,
  currentHostname: () => state.host,
}));

import type { FunctionComponent } from "react";
import { LoginForm, Route } from "@/routes/login";

const LoginView: FunctionComponent<{
  initialCodeSent?: boolean;
  initialReviewer?: boolean;
}> = LoginForm;

const route = Route as unknown as {
  component: () => React.ReactNode;
  validateSearch: (search: Record<string, unknown>) => { redirect?: string; reviewer?: 1 };
};

function page(props?: { initialCodeSent?: boolean; initialReviewer?: boolean }) {
  const node = props ? createElement(LoginView, props) : createElement(route.component);
  return renderToStaticMarkup(node);
}

function hrefFor(html: string, marker: string): URL {
  const tag = (html.match(/<a\b[^>]*>/g) ?? []).find((anchor) =>
    anchor.includes(`data-signin-alt="${marker}"`),
  );
  const raw = tag?.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, "&") ?? "";
  return new URL(raw, "https://app.meetathena.io");
}

beforeEach(() => {
  state.athena = true;
  state.host = "app.meetathena.io";
  state.redirect = CONSENT;
  state.reviewer = undefined;
});

describe("Athena reviewer password sign-in", () => {
  it("leaves the default member page on the emailed code", () => {
    const html = page();
    expect(html).toContain("Sign in to approve the connection.");
    expect(html).toContain("No password required");
    expect(html).toContain('data-signin="email-code"');
    expect(html).toContain("Email me a sign-in code");
    expect(html).toContain("Reviewer sign-in");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('data-signin="reviewer-password"');
    expect(html).not.toContain("Use password instead");
    expect(html).not.toContain("Enter the command center");
    expect(html).not.toMatch(/lovable/i);
    const link = hrefFor(html, "reviewer");
    expect(link.searchParams.get("reviewer")).toBe("1");
    expect(link.searchParams.get("redirect")).toBe(CONSENT);
  });

  it("?reviewer=1 shows the password form and keeps the consent return", () => {
    state.reviewer = 1;
    const html = page();
    expect(html).toContain('data-signin="reviewer-password"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Password");
    expect(html).toContain("Password sign-in for the reviewer account.");
    expect(html).toContain("Sign in to approve the connection.");
    expect(html).not.toContain("No password required");
    expect(html).not.toContain('data-signin="email-code"');
    expect(html).not.toContain("Use password instead");
    expect(html).not.toContain("Forgot password");
    expect(html).not.toMatch(/lovable/i);
    expect(html).not.toMatch(/hub/i);
    expect(html).toContain("#6B7280");
    expect(html).toContain("#1E5FED");
    const back = hrefFor(html, "member-code");
    expect(back.searchParams.get("reviewer")).toBeNull();
    expect(back.searchParams.get("redirect")).toBe(CONSENT);
    expect(route.validateSearch({ redirect: CONSENT, reviewer: "1" })).toEqual({
      redirect: CONSENT,
      reviewer: 1,
    });
  });

  it("does not add the reviewer form to the Hub sign-in", () => {
    state.athena = false;
    state.host = "app.alpcontractorcircle.com";
    state.redirect = undefined;
    state.reviewer = 1;
    const html = page();
    expect(html).toContain("Sign in to the Hub.");
    expect(html).toContain("Use password instead");
    expect(html).not.toContain("Reviewer sign-in");
    expect(html).not.toContain('data-signin="reviewer-password"');
    expect(html).not.toContain("Email me a sign-in code");
  });

  it("the Athena page calls the server gate, and the Hub page still calls signInWithPassword", () => {
    const src = readFileSync("src/routes/login.tsx", "utf8");
    expect(src).toContain("submitAthenaReviewerPassword");
    expect(src).toContain("reviewerPasswordSignIn");
    expect(src.match(/signInWithPassword/g)).toEqual(["signInWithPassword"]);
    const server = readFileSync("src/lib/athena-reviewer-sign-in.functions.ts", "utf8");
    expect(server).toContain("signInWithPassword");
    expect(server).not.toContain(ATHENA_PASSWORD_PLACEHOLDER);
  });
});

const ATHENA_PASSWORD_PLACEHOLDER = "synthetic-reviewer-secret";
