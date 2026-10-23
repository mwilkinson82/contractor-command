import { describe, expect, it } from "vitest";
import { render } from "@react-email/components";
import { athenaHookEmail } from "./athena-hook-email";
import { emailSiteFor } from "@/lib/auth-origins";
import { ATHENA_FROM } from "./athena-sender";

const athenaUrl = (rt: string) =>
  `https://qcbbjjjxcacrscfhgfmf.supabase.co/auth/v1/verify?token=x&type=magiclink&redirect_to=${encodeURIComponent(rt)}`;

const visible = (t: string) => t.replace(/https?:\/\/[^\s"')\]]+/g, "");

describe("Athena auth-hook emails", () => {
  it("interim sender is the single Athena constant", () => {
    expect(ATHENA_FROM).toBe("Athena <no-reply@notify.mail.alpcontractorcircle.com>");
  });

  it("an Athena redirect_to selects Athena; a Hub one does not", () => {
    expect(emailSiteFor(athenaUrl("https://app.meetathena.io/auth/callback")).athena).toBe(true);
    expect(emailSiteFor(athenaUrl("https://app.alpcontractorcircle.com/auth/callback")).athena).toBe(false);
  });

  it.each([
    ["magiclink", "Sign in to Athena"],
    ["reauthentication", "Your Athena sign-in code"],
    ["invite", "You're invited to Athena"],
    ["signup", "Confirm your email for Athena"],
    ["recovery", "Reset your Athena password"],
    ["email_change", "Confirm your new email for Athena"],
  ])("%s renders Athena-branded with no Circle copy, orange or red", async (type, subject) => {
    const url = athenaUrl("https://app.meetathena.io/auth/callback");
    const r = athenaHookEmail(type, { url, token: "123456", new_email: "new@example.test" })!;
    expect(r.subject).toBe(subject);
    const html = await render(r.element);
    const text = await render(r.element, { plainText: true });
    expect(html).toContain("Athena powered by ALP");
    expect(html).toContain("#1E5FED");
    expect(visible(html)).not.toMatch(/Circle|Contractor|Build the company/i);
    expect(visible(text)).not.toMatch(/Circle|Contractor/i);
    expect(html).not.toMatch(/#B9512C|#E8|#F97316|#EA580C|#DC2626|#EF4444|orange|red;/i);
    if (type === "reauthentication") {
      expect(html).toContain("123456");
      expect(html).not.toContain("<a ");
    } else {
      expect(html.replace(/&amp;/g, "&")).toContain(`href="${url}"`);
    }
  });

  it("unknown types fall through (Circle path unchanged)", () => {
    expect(athenaHookEmail("something_else", {})).toBeNull();
  });
});
