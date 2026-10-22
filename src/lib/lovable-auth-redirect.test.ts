import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { athenaAppOrigin } from "@/lib/athena-host";
import {
  isLovableAuthPath,
  lovableAuthRedirectResponse,
  lovableAuthRedirectTarget,
} from "@/lib/lovable-auth-redirect";

const ATHENA = "https://app.meetathena.io";
const ID = "auth_req_abc-123";

describe("lovable.app auth host redirect", () => {
  const prev = process.env.ATHENA_APP_ORIGIN;
  afterEach(() => {
    if (prev === undefined) delete process.env.ATHENA_APP_ORIGIN;
    else process.env.ATHENA_APP_ORIGIN = prev;
  });

  it("keeps the query string and hash when consent lands on contractor-command.lovable.app", () => {
    delete process.env.ATHENA_APP_ORIGIN;
    expect(athenaAppOrigin()).toBe(ATHENA);
    expect(
      lovableAuthRedirectTarget({
        hostname: "contractor-command.lovable.app",
        pathname: "/oauth/consent",
        search: `?authorization_id=${ID}&next=1`,
        hash: "#approve",
      }),
    ).toBe(`${ATHENA}/oauth/consent?authorization_id=${ID}&next=1#approve`);
  });

  it("redirects OAuth consent on any *.lovable.app host, and leaves a Hub login there", () => {
    const preview = "id-preview--362c776b-68ab-4871-bedb-c42cb9843c1b.lovable.app";
    expect(
      lovableAuthRedirectTarget({
        hostname: preview,
        pathname: "/login",
        search: "?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc",
      }),
    ).toBe(`${ATHENA}/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc`);
    expect(
      lovableAuthRedirectTarget({
        hostname: "contractor-command.lovable.app",
        pathname: "/login",
        search: "",
      }),
    ).toBeNull();
    expect(
      lovableAuthRedirectTarget({
        hostname: "Contractor-Command.Lovable.App:443",
        pathname: "/login",
        search: "redirect=%2F",
        hash: "done",
      }),
    ).toBeNull();
    expect(isLovableAuthPath("/oauth/consent")).toBe(true);
    expect(isLovableAuthPath("/login")).toBe(true);
    for (const pathname of ["/", "/account", "/calls", "/admin/topics", "/logistics", "/oauthx", "/welcome"]) {
      expect(
        lovableAuthRedirectTarget({
          hostname: "contractor-command.lovable.app",
          pathname,
          search: "?authorization_id=abc",
        }),
        pathname,
      ).toBeNull();
    }
  });

  it("leaves Hub pages on app.alpcontractorcircle.com alone, including /login and /oauth/consent", () => {
    for (const pathname of ["/", "/login", "/oauth/consent", "/calls", "/account"]) {
      expect(
        lovableAuthRedirectTarget({
          hostname: "app.alpcontractorcircle.com",
          pathname,
          search: `?authorization_id=${ID}`,
          hash: "#x",
        }),
        pathname,
      ).toBeNull();
    }
    expect(
      lovableAuthRedirectTarget({
        hostname: "app.meetathena.io",
        pathname: "/oauth/consent",
        search: `?authorization_id=${ID}`,
      }),
    ).toBeNull();
    expect(
      lovableAuthRedirectTarget({
        hostname: "evil.lovable.app.attacker.com",
        pathname: "/oauth/consent",
        search: `?authorization_id=${ID}`,
      }),
    ).toBeNull();
  });

  it("answers a lovable.app consent hit with a 302 that keeps the query, and ignores the Hub", () => {
    const consent = lovableAuthRedirectResponse(
      new Request(`https://contractor-command.lovable.app/oauth/consent?authorization_id=${ID}`),
    );
    expect(consent?.status).toBe(302);
    expect(consent?.headers.get("location")).toBe(`${ATHENA}/oauth/consent?authorization_id=${ID}`);
    expect(consent?.headers.get("cache-control")).toBe("no-store");

    const forwarded = lovableAuthRedirectResponse(
      new Request("http://internal/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc", {
        headers: { "x-forwarded-host": "contractor-command.lovable.app" },
      }),
    );
    expect(forwarded?.status).toBe(302);
    expect(forwarded?.headers.get("location")).toBe(
      `${ATHENA}/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc`,
    );

    expect(
      lovableAuthRedirectResponse(
        new Request(`https://app.alpcontractorcircle.com/oauth/consent?authorization_id=${ID}`),
      ),
    ).toBeNull();
    expect(
      lovableAuthRedirectResponse(new Request("https://contractor-command.lovable.app/calls")),
    ).toBeNull();
    expect(
      lovableAuthRedirectResponse(new Request(`https://app.meetathena.io/login?authorization_id=${ID}`)),
    ).toBeNull();
  });

  it("is wired before render: server fetch, router module, root beforeLoad, and the head script", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    expect(server).toContain("lovableAuthRedirectResponse(request)");
    const router = readFileSync(new URL("../router.tsx", import.meta.url), "utf8");
    expect(router).toContain("applyBrowserLovableAuthRedirect()");
    const root = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");
    expect(root).toContain("lovableAuthRedirectTarget(");
    expect(root).toContain("LOVABLE_AUTH_REDIRECT_BOOT");
    expect(root).toContain("throw redirect({ href: target, statusCode: 302 })");
  });
});
