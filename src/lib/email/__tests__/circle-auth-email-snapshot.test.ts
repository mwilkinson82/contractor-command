// Circle auth emails must stay byte-identical when Athena branding is added.
// The snapshot files were generated from the base branch (a385b35f) before any
// Athena change, so any drift in a Circle template or prop fails here.
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@react-email/components";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";
import { TEMPLATES } from "@/lib/email-templates/registry";

const CIRCLE_PROPS = {
  siteName: "Contractor Circle",
  siteUrl: "https://mail.alpcontractorcircle.com",
  recipient: "member@example.test",
  confirmationUrl:
    "https://qcbbjjjxcacrscfhgfmf.supabase.co/auth/v1/verify?token=inert&type=magiclink&redirect_to=https%3A%2F%2Fapp.alpcontractorcircle.com%2Fauth%2Fcallback",
  token: "123456",
  email: "member@example.test",
  oldEmail: "old@example.test",
  newEmail: "new@example.test",
};

const HOOK_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

describe("Circle auth emails are byte-identical to the base branch", () => {
  it.each(Object.keys(HOOK_TEMPLATES))("hook %s", async (type) => {
    const el = React.createElement(HOOK_TEMPLATES[type], CIRCLE_PROPS);
    await expect(await render(el)).toMatchFileSnapshot(`./__snapshots__/circle-hook-${type}.html`);
    await expect(await render(el, { plainText: true })).toMatchFileSnapshot(
      `./__snapshots__/circle-hook-${type}.txt`,
    );
  });

  it("direct login email (magic-link registry entry)", async () => {
    const entry = TEMPLATES["magic-link"];
    const props = {
      firstName: "Pat",
      siteName: "Contractor Circle",
      siteUrl: "https://app.alpcontractorcircle.com",
      confirmationUrl: "https://app.alpcontractorcircle.com/auth/callback?token_hash=inert&type=email",
    };
    const el = React.createElement(entry.component, props);
    await expect(await render(el)).toMatchFileSnapshot("./__snapshots__/circle-direct-magic-link.html");
    const subject = typeof entry.subject === "function" ? entry.subject(props as never) : entry.subject;
    expect(subject).toBe("Pat, your login link");
  });
});
