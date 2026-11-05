// Launch review (Nov 5): every screen a new contractor meets tells them the next step.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { render as renderEmail } from "@react-email/components";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => ({ redirect: undefined }),
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
  onAthenaHost: () => true,
  currentHostname: () => "app.meetathena.io",
}));

import { LoginForm } from "@/routes/login";
import { ATHENA_TRIAL_URL } from "@/lib/login-copy";
import {
  AthenaAuthEmail,
  ATHENA_SAME_DEVICE_LINE,
  athenaSignInSubject,
} from "@/lib/email-templates/athena-auth-email";
import { template as magicLink } from "@/lib/email-templates/athena-magic-link";
import { CONNECT_GUIDE_URL, FIRST_JOB_MESSAGE, setupSteps } from "@/lib/account-profile";
import { readSetupProgress } from "@/lib/account-setup";
import {
  FIRST_JOB_QUESTION,
  firstJobCard,
  firstJobGuidance,
  plainGettingStarted,
} from "@/lib/mcp/getting-started";

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("sign-in page", () => {
  it("offers a new contractor a trial on the email step", () => {
    const html = decode(renderToStaticMarkup(createElement(LoginForm)));
    expect(html).toContain("New to Athena?");
    expect(html).toContain(`href="${ATHENA_TRIAL_URL}"`);
    expect(html).toContain("Start your 7-day free trial");
  });

  it("code step counts down to Resend, offers a different email, and explains a missing email", () => {
    const html = decode(
      renderToStaticMarkup(
        createElement(LoginForm as (p: { initialCodeSent?: boolean }) => React.ReactNode, {
          initialCodeSent: true,
        }),
      ),
    );
    expect(html).toContain("Resend code in 0:30");
    expect(html).toMatch(
      /data-signin="resend-code"[^>]*disabled|disabled[^>]*data-signin="resend-code"/,
    );
    expect(html).toContain("Use a different email");
    expect(html).toContain("No email after 2 minutes?");
    expect(html).toContain("may not have an Athena plan yet");
    expect(html).toContain(`href="${ATHENA_TRIAL_URL}"`);
    expect(html).toContain("mailto:support@meetathena.io");
    expect(html).not.toContain("New to Athena?");
  });
});

describe("sign-in email", () => {
  it("leads the subject with the code, digits only", () => {
    expect(athenaSignInSubject("48213907")).toBe("48213907 is your Athena sign-in code");
    expect(athenaSignInSubject(" 4821 3907 ")).toBe("48213907 is your Athena sign-in code");
    expect(athenaSignInSubject("12ab5678")).toBe("Sign in to Athena");
    expect(athenaSignInSubject(undefined)).toBe("Sign in to Athena");
    expect(
      (magicLink.subject as (d: Record<string, unknown>) => string)({ otpCode: "48213907" }),
    ).toBe("48213907 is your Athena sign-in code");
    expect((magicLink.subject as (d: Record<string, unknown>) => string)({})).toBe(
      "Sign in to Athena",
    );
  });

  it("puts the code before the button, and keeps the button for the same device", async () => {
    const url = "https://app.meetathena.io/auth/callback?token_hash=inert";
    const html = decode(
      await renderEmail(
        createElement(AthenaAuthEmail, {
          kind: "magiclink",
          confirmationUrl: url,
          code: "48213907",
        }),
      ),
    );
    expect(html.indexOf("48213907")).toBeGreaterThan(-1);
    expect(html.indexOf("48213907")).toBeLessThan(html.indexOf(`href="${url}"`));
    expect(html).toContain(ATHENA_SAME_DEVICE_LINE);
    expect(html).toContain("Type this code on the Athena page you have open");
    const linkOnly = decode(
      await renderEmail(
        createElement(AthenaAuthEmail, { kind: "magiclink", confirmationUrl: url }),
      ),
    );
    expect(linkOnly).toContain(`href="${url}"`);
    expect(linkOnly).not.toContain(ATHENA_SAME_DEVICE_LINE);
  });
});

describe("approve page", () => {
  const src = readFileSync("src/routes/oauth.consent.tsx", "utf8");
  it("gives an account with no plan a trial button in a new tab and a different-email button", () => {
    const block = src.slice(
      src.indexOf('data-consent="no-plan"'),
      src.indexOf("Use a different email") + 30,
    );
    expect(block).toContain("href={ATHENA_TRIAL_URL}");
    expect(block).toContain('target="_blank"');
    expect(block).toContain("Start 7-day free trial");
    expect(block).toContain("onClick={switchAccount}");
    expect(src).not.toContain("Approve is turned off");
  });
  it("tells an approved member what to send next, the same words as the connect guide", () => {
    expect(src).toContain('data-consent="next-step"');
    expect(src).toContain("{FIRST_JOB_MESSAGE}");
    expect(src).toContain('import { FIRST_JOB_MESSAGE } from "@/lib/account-profile";');
    expect(FIRST_JOB_MESSAGE).toBe("Athena, let's set up my first job.");
  });
});

describe("account setup checklist", () => {
  const base = { profile: null, members: 1, pending: 0 };
  it("leaves connect and first job off until progress is read", () => {
    expect(setupSteps(base).map((s) => s.id)).toEqual(["profile", "team", "payments"]);
  });
  it("puts Connect your AI and the first job first", () => {
    const steps = setupSteps({ ...base, progress: { connected: false, jobs: 0 } });
    expect(steps.map((s) => s.id)).toEqual(["connect", "first-job", "profile", "team", "payments"]);
    expect(steps[0]).toMatchObject({ done: false, href: CONNECT_GUIDE_URL, action: "Show me how" });
    expect(steps[1].detail).toContain(FIRST_JOB_MESSAGE);
    const done = setupSteps({ ...base, progress: { connected: true, jobs: 2 } });
    expect(done[0]).toMatchObject({ done: true, doneLabel: "Connected" });
    expect(done[1]).toMatchObject({ done: true, detail: "2 jobs saved" });
    expect(setupSteps({ ...base, progress: { connected: true, jobs: 1 } })[1].detail).toBe(
      "1 job saved",
    );
  });
  it("reads jobs by company with the member's rights and the AI check by the caller's own id", async () => {
    const seen: string[] = [];
    const member = {
      from: (t: string) => ({
        select: () => ({
          eq: (k: string, v: string) => {
            seen.push(`${t}.${k}=${v}`);
            return Promise.resolve({ count: 3, error: null });
          },
        }),
      }),
    };
    const admin = {
      from: (t: string) => ({
        select: () => ({
          eq: (k: string, v: string) => {
            seen.push(`${t}.${k}=${v}`);
            return { limit: () => Promise.resolve({ data: [{ id: 1 }], error: null }) };
          },
        }),
      }),
    };
    expect(await readSetupProgress(member as never, admin as never, "u1", "c1")).toEqual({
      connected: true,
      jobs: 3,
      // The fake has no company table, as before the work-profile migration runs, so that step stays off.
      work: null,
    });
    expect(seen.sort()).toEqual(["mcp_call_log.user_id=u1", "mcp_companies.id=c1", "mcp_jobs.company_id=c1"]);
    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "x" } }) }),
        }),
      }),
    };
    expect(await readSetupProgress(member as never, failing as never, "u1", "c1")).toBeNull();
  });
});

describe("first chat", () => {
  it("asks one question the member answers by typing", () => {
    expect(plainGettingStarted(firstJobCard(true))).toContain(FIRST_JOB_QUESTION.company);
    expect(plainGettingStarted(firstJobCard(false))).toContain(FIRST_JOB_QUESTION.noCompany);
    expect(plainGettingStarted(firstJobCard(false))).not.toContain("Tell me “start a job”");
    expect(firstJobGuidance(true)).toContain("Ask one question per reply");
  });
});
