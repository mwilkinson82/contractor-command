import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ATHENA_ORIGIN,
  HUB_ORIGIN,
  emailSiteFor,
  hubOrigin,
  linkDestinationHost,
} from "./auth-origins";

const verify = (rt: string) =>
  `https://qcbbjjjxcacrscfhgfmf.supabase.co/auth/v1/verify?token=x&type=recovery&redirect_to=${encodeURIComponent(rt)}`;

describe("auth links never depend on the Auth Site URL", () => {
  it("hubOrigin defaults to the Hub and ignores a non-Hub env origin", () => {
    expect(hubOrigin({})).toBe(HUB_ORIGIN);
    expect(hubOrigin({ PUBLIC_APP_ORIGIN: "https://app.meetathena.io" })).toBe(HUB_ORIGIN);
    expect(hubOrigin({ APP_ORIGIN: "https://evil.example.com/" })).toBe(HUB_ORIGIN);
    // A lovable.app Site URL must not become a Hub link. Those auth redirects
    // are rewritten to app.meetathena.io at the call sites that mint them.
    expect(hubOrigin({ PUBLIC_APP_ORIGIN: "https://contractor-command.lovable.app/" })).toBe(
      HUB_ORIGIN,
    );
    expect(hubOrigin({ PUBLIC_APP_ORIGIN: "not a url" })).toBe(HUB_ORIGIN);
  });

  it("hook email brand follows the link's redirect_to", () => {
    expect(linkDestinationHost(verify("https://app.alpcontractorcircle.com/reset-password"))).toBe(
      "app.alpcontractorcircle.com",
    );
    expect(emailSiteFor(verify("https://app.alpcontractorcircle.com/welcome"))).toMatchObject({
      siteName: "Contractor Circle",
      athena: false,
    });
    expect(emailSiteFor(verify("https://app.meetathena.io/auth/callback"))).toMatchObject({
      siteName: "Athena",
      siteUrl: ATHENA_ORIGIN,
      athena: true,
    });
    // No redirect_to (Supabase falls back to Site URL) and garbage stay Hub-branded, exactly as today.
    expect(
      emailSiteFor("https://qcbbjjjxcacrscfhgfmf.supabase.co/auth/v1/verify?token=x"),
    ).toMatchObject({ athena: false });
    expect(emailSiteFor(undefined)).toMatchObject({ athena: false });
    expect(emailSiteFor(verify("https://meetathena.io.evil.com/"))).toMatchObject({
      athena: false,
    });
  });

  const HUB_FILES = [
    "src/lib/admin-people.functions.ts",
    "src/lib/admin-users.functions.ts",
    "src/lib/handbook-rollout.functions.ts",
    "src/lib/member-migration.functions.ts",
    "src/lib/password-reset.functions.ts",
    "src/lib/magic-link.functions.ts",
    "src/lib/email/ensure-magic-link.ts",
    "src/lib/email/send-login-nudge-now.ts",
    "src/routes/api/public/stripe/webhook.ts",
  ];
  it.each(HUB_FILES)(
    "%s: every auth email call passes an explicit redirect built from hubOrigin()",
    (f) => {
      const s = readFileSync(f, "utf8");
      expect(s).toContain("hubOrigin()");
      expect(s).not.toMatch(/process\.env\.(PUBLIC_APP_ORIGIN|APP_ORIGIN)/);
      const calls =
        s.match(
          /auth\.(?:admin\.)?(?:inviteUserByEmail|generateLink|resetPasswordForEmail)\([\s\S]{0,400}?\}\s*\)/g,
        ) ?? [];
      for (const c of calls) expect(c, c.slice(0, 80)).toMatch(/redirectTo/);
    },
  );

  it("the auth hook takes brand and site link from the redirect, not a fixed Site URL", () => {
    const s = readFileSync("src/routes/lovable/email/auth/webhook.ts", "utf8");
    expect(s).toContain("emailSiteFor(payload.data.url)");
    expect(s).not.toMatch(/siteUrl: `https:\/\/\$\{ROOT_DOMAIN\}`/);
  });

  it("signup passes emailRedirectTo explicitly", () => {
    expect(readFileSync("src/routes/signup.tsx", "utf8")).toMatch(/emailRedirectTo: redirectUrl/);
  });

  it("the Athena consent page carries no Hub or Circle wording", () => {
    const s = readFileSync("src/routes/oauth.consent.tsx", "utf8");
    expect(s).not.toMatch(/your Circle account|the Hub's own access rules/);
  });
});
