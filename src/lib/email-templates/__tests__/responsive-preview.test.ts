import React from "react";
import { render } from "@react-email/components";
import { mkdirSync, writeFileSync } from "node:fs";
import { it, expect } from "vitest";
import { TEMPLATES } from "../registry";
import { SignupEmail } from "../signup";
import { InviteEmail } from "../invite";
import { RecoveryEmail } from "../recovery";
import { EmailChangeEmail } from "../email-change";
import { ReauthenticationEmail } from "../reauthentication";
import { CONTROL_BASELINE_CAMPAIGN } from "../../control-activation-campaign";

it("renders every registered and auth template while preserving dynamic actions", async () => {
  const dir = "output/playwright/email";
  mkdirSync(dir, { recursive: true });
  const authProps = {
    siteName: "Contractor Circle",
    siteUrl: "https://example.test",
    recipient: "member@example.test",
    confirmationUrl: "https://example.test/verify?token=synthetic",
    token: "123456",
    oldEmail: "old@example.test",
    newEmail: "new@example.test",
  };
  const variants: Record<string, React.ReactElement> = Object.fromEntries(
    Object.entries(TEMPLATES).map(([name, t]) => [
      name,
      React.createElement(t.component, t.previewData ?? {}),
    ]),
  );
  for (const [name, component] of Object.entries({
    signup: SignupEmail,
    invite: InviteEmail,
    recovery: RecoveryEmail,
    email_change: EmailChangeEmail,
    reauthentication: ReauthenticationEmail,
  }))
    variants[name] = React.createElement(component as React.ComponentType<any>, authProps);
  variants.control_loop = React.createElement(
    TEMPLATES["member-announcement"].component,
    CONTROL_BASELINE_CAMPAIGN,
  );
  variants.general_no_cta = React.createElement(TEMPLATES["member-announcement"].component, {
    headline: "A member note",
    body: "An update for members.",
  });
  variants.call_current_fields = React.createElement(TEMPLATES["member-announcement"].component, {
    headline: "Upcoming working session",
    body: "Your confirmed session details go here.",
    ctaLabel: "Open Calls",
    ctaUrl: "https://app.alpcontractorcircle.com/calls",
  });
  variants.welcome_dynamic = React.createElement(TEMPLATES["circle-welcome"].component, {
    firstName: "Sam",
    loginUrl: "https://example.test/member?token=synthetic",
  });
  for (const [name, element] of Object.entries(variants)) {
    const html = await render(element);
    const text = await render(element, { plainText: true });
    expect(html).toContain("<html");
    expect(text.length).toBeGreaterThan(20);
    expect(html).not.toContain("/email/contractor-circle-mark.png");
    if (name === "signup" || name === "recovery" || name === "invite" || name === "email_change")
      expect(html).toContain('href="https://example.test/verify?token=synthetic"');
    if (name === "reauthentication") expect(text).toContain("123456");
    if (name === "welcome_dynamic")
      expect(html).toContain('href="https://example.test/member?token=synthetic"');
    if (name === "general_no_cta") expect(html).not.toContain("Open Calls");
    if (name === "control_loop")
      expect(html).toContain('href="https://app.alpcontractorcircle.com/start-here"');
    writeFileSync(
      `${dir}/${name}.html`,
      html.replaceAll(
        "https://app.alpcontractorcircle.com/brand/circle-v1/",
        "../../../public/brand/circle-v1/",
      ),
    );
  }
});
