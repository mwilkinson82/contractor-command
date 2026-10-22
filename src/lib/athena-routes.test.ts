import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { athenaHostRedirect, athenaPathAllowed, isHostedReport, isTodayPage, postSignInDefault } from "./athena-routes";

describe("Athena-only route shell", () => {
  it.each([
    "/login",
    "/auth/callback",
    "/account",
    "/oauth/consent",
    "/.lovable/oauth/consent",
    "/reset-password",
    "/forgot-password",
    "/mcp",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/openid-configuration",
    "/r/job/2701/lookahead",
    "/r/s/tok",
    "/f/tok",
    "/brand/athena/email/athena-mark-180.png",
    "/api/public/athena/stripe-webhook",
    "/today",
  ])("allows %s", (p) => {
    expect(athenaPathAllowed(p)).toBe(true);
    expect(athenaHostRedirect(p)).toBeNull();
  });

  it.each(["/", "/ecosystem", "/aos", "/overwatch", "/handbook", "/start-here", "/calls", "/admin", "/onboarding", "/upgrade", "/vault", "/ask", "/scheduler", "/welcome", "/signup"])(
    "redirects Circle route %s to /account",
    (p) => expect(athenaHostRedirect(p)).toBe("/account"),
  );

  it("sends /team to the Team section of /account", () => {
    expect(athenaHostRedirect("/team")).toBe("/account#team");
  });

  it("does not treat look-alike prefixes as allowed", () => {
    expect(athenaPathAllowed("/accountant")).toBe(false);
    expect(athenaPathAllowed("/mcpx")).toBe(false);
    expect(athenaPathAllowed("/oauthx")).toBe(false);
  });

  it("field and items are the same hosted report, so neither is bounced to login on its own", () => {
    const job = "/r/job/11111111-1111-4111-8111-111111111111";
    expect(isHostedReport(`${job}/field`)).toBe(true);
    expect(isHostedReport(`${job}/items`)).toBe(true);
    expect(isHostedReport("/r/s/tok")).toBe(true);
    expect(isHostedReport("/login")).toBe(false);
    const root = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");
    expect(root).toContain("isHostedReport(pathname)");
    expect(root).toContain("isHostedReport(renderedPathname)");
    expect(isTodayPage("/today")).toBe(true);
    expect(isTodayPage("/today/")).toBe(true);
    expect(isTodayPage("/today/extra")).toBe(false);
    expect(root).toContain("isTodayPage(pathname)");
    expect(root).toContain("isTodayPage(renderedPathname)");
  });

  it("post-sign-in default: Athena host /account, Hub unchanged '/'", () => {
    expect(postSignInDefault(true)).toBe("/account");
    expect(postSignInDefault(false)).toBe("/");
  });

  it("every connect-flow route file maps to an allowed path", () => {
    // The OAuth connect flow: discovery (.well-known), MCP, consent, login, callback.
    for (const p of ["/mcp", "/oauth/consent", "/.lovable/oauth/consent", "/login", "/auth/callback"]) {
      expect(athenaPathAllowed(p)).toBe(true);
    }
  });

  it("root gate and callback use the Athena host shell", () => {
    const root = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");
    expect(root).toContain("athenaHostRedirect(pathname)");
    expect(root).toContain("if (athenaHost) return <>{children(false)}</>;");
    const cb = readFileSync(new URL("../routes/auth.callback.tsx", import.meta.url), "utf8");
    expect(cb).toContain("postLoginDestination(window.location.hostname, destination ?? redirect)");
  });
});
