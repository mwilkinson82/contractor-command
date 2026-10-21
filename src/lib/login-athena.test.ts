import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ATHENA_LOGIN_COLORS, loginCopy } from "@/lib/login-copy";

const state = vi.hoisted(() => ({ athena: true, host: "app.alpcontractorcircle.com" }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({ ...config, useSearch: () => ({ redirect: undefined }) }),
  Link: () => null,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
vi.mock("@/lib/athena-host-current", () => ({ onAthenaHost: () => state.athena, currentHostname: () => state.host }));
import { Route } from "@/routes/login";

const render = () => renderToStaticMarkup(createElement((Route as unknown as { component: () => React.ReactNode }).component));

describe("0.8.10 /login on Athena domains", () => {
  it("reads Sign in to Athena, in the Athena blue brand with the blue lockup, and shows no Hub wording", () => {
    state.athena = true;
    const html = render();
    expect(html).toContain("Sign in to Athena");
    expect(html).not.toMatch(/hub/i);
    expect(html).not.toMatch(/lovable/i);
    expect(html).toContain('data-brand="athena"');
    expect(html).toContain("/brand/athena/athena-lockup-blue.svg");
    expect(html).toMatch(/background-color:#DBEAFE/i);
    expect(html).toMatch(/color:#1F2329/i);
    expect(html).toContain("#2563EB");
    expect(html).toContain("#1D4ED8");
  });

  it("leaves the Hub domain unchanged", () => {
    state.athena = false;
    const html = render();
    expect(html).toContain("Sign in to the Hub.");
    expect(html).toContain("The Contractor Circle Hub");
    expect(html).not.toContain('data-brand="athena"');
    expect(html).not.toContain("Sign in to Athena");
  });

  it("0.8.19: the lovable.app host (where connects land) shows Athena, not the Hub", () => {
    state.athena = false;
    state.host = "contractor-command.lovable.app";
    const html = render();
    state.host = "app.alpcontractorcircle.com";
    expect(html).toContain("Sign in to Athena");
    expect(html).toContain('data-brand="athena"');
    expect(html).not.toContain("The Contractor Circle Hub");
  });

  it("copy and palette", () => {
    expect(loginCopy({ athena: true, fromConnect: false, magicRequested: false }).title).toBe("Sign in to Athena");
    expect(loginCopy({ athena: true, fromConnect: false, magicRequested: false }).subtitle).not.toMatch(/hub|membership/i);
    expect(loginCopy({ athena: false, fromConnect: false, magicRequested: false }).title).toBe("Sign in to the Hub.");
    expect(ATHENA_LOGIN_COLORS).toEqual({ blue: "#2563EB", deepBlue: "#1D4ED8", paleBlue: "#DBEAFE", ink: "#1F2329", white: "#FFFFFF" });
  });
});
