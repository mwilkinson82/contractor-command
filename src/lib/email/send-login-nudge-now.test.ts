import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn(), inserts: [] as unknown[] }));
vi.mock("@lovable.dev/email-js", () => ({ sendLovableEmail: m.send }));

import { sendLoginNudgeNow } from "./send-login-nudge-now";
import { MEMBER_REPLY_TO } from "@/lib/email/reply-to";

const URL_EXACT =
  "https://app.alpcontractorcircle.com/auth/callback?token_hash=inert&type=magiclink&continuation=signed.abc";

function fakeAdmin(opts: { suppressed?: boolean } = {}) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        upsert: async () => ({ error: null }),
        insert: async (row: unknown) => {
          m.inserts.push(row);
          return { error: null };
        },
        maybeSingle: async () => {
          if (table === "suppressed_emails")
            return { data: opts.suppressed ? { email: "x" } : null };
          if (table === "email_unsubscribe_tokens")
            return { data: { token: "unsub", used_at: null } };
          return { data: null };
        },
      };
      return chain;
    },
  } as never;
}

const base = {
  email: "member@example.test",
  firstName: "Pat",
  confirmationUrl: URL_EXACT,
  idempotencyKey: "idem-1",
  siteUrl: "https://app.alpcontractorcircle.com",
};

beforeEach(() => {
  vi.stubEnv("LOVABLE_API_KEY", "inert-test-key");
  m.send.mockResolvedValue({});
  m.inserts.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const decode = (s: string) => s.replace(/&amp;/g, "&");

describe("sendLoginNudgeNow variants", () => {
  it("athena: exact sender name, subject, heading, button, body; URL preserved; no Circle copy", async () => {
    const r = await sendLoginNudgeNow({
      ...base,
      supabaseAdmin: fakeAdmin(),
      channel: "public_magic_link",
      variant: "athena",
    });
    expect(r.status).toBe("sent");
    const p = m.send.mock.calls[0][0];
    expect(p.from).toBe("Athena <no-reply@notify.mail.alpcontractorcircle.com>");
    expect(p.sender_domain).toBe("notify.mail.alpcontractorcircle.com");
    expect(p.reply_to).toBe(MEMBER_REPLY_TO);
    expect(p.subject).toBe("Sign in to Athena");
    expect(p.unsubscribe_token).toBe("unsub");
    expect(p.idempotency_key).toBe("idem-1");
    const body =
      "Use the secure button below to sign in to Athena. The link works once, so open the newest email only.";
    expect(p.html).toContain(body);
    expect(p.text).toContain(body);
    expect(p.html).toMatch(/<h1[^>]*>Sign in to Athena<\/h1>/);
    expect(p.html).toMatch(/>Sign in to Athena<\/span>|>Sign in to Athena<\/a>/);
    expect(p.text).toContain("Sign in to Athena");
    expect(p.html).toContain("Athena powered by ALP");
    expect(p.html).toContain("https://app.meetathena.io/brand/athena/email/athena-mark-180.png");
    expect(decode(p.html)).toContain(`href="${URL_EXACT}"`);
    expect(p.text).toContain(URL_EXACT);
    const visible = (t: string) => t.replace(/https?:\/\/\S+?(?=["\s)\]]|$)/g, "");
    expect(visible(p.html)).not.toMatch(/Circle|member/i);
    expect(visible(p.text)).not.toMatch(/Circle|member/i);
  });

  it.each(["public_magic_link", "admin_people_signin"] as const)(
    "%s default stays Contractor Circle",
    async (channel) => {
      await sendLoginNudgeNow({ ...base, supabaseAdmin: fakeAdmin(), channel });
      const p = m.send.mock.calls[0][0];
      expect(p.from).toBe("Contractor Circle <no-reply@notify.mail.alpcontractorcircle.com>");
      expect(p.subject).toBe("Pat, your login link");
      expect(p.label).toBe("magic-link");
      expect(p.html).not.toContain("Athena");
      expect(decode(p.html)).toContain(`href="${URL_EXACT}"`);
    },
  );

  it("athena connect: connect copy and typed code", async () => {
    await sendLoginNudgeNow({
      ...base,
      supabaseAdmin: fakeAdmin(),
      channel: "public_magic_link",
      variant: "athena",
      connecting: true,
      otpCode: "482913",
    });
    const p = m.send.mock.calls[0][0];
    expect(p.html).toContain("finish connecting your AI app");
    expect(p.html).toContain("482913");
  });

  it("preview Athena code email has no callback link and requires a code", async () => {
    await sendLoginNudgeNow({
      ...base,
      supabaseAdmin: fakeAdmin(),
      channel: "public_magic_link",
      variant: "athena-code",
      otpCode: "482913",
    });
    const p = m.send.mock.calls[0][0];
    expect(p.subject).toBe("Your Athena sign-in code");
    expect(p.from).toBe("Athena <no-reply@notify.mail.alpcontractorcircle.com>");
    expect(p.html).toContain("482913");
    expect(p.text).toContain("482913");
    expect(decode(p.html)).not.toContain(URL_EXACT);
    expect(p.text).not.toContain(URL_EXACT);
    m.send.mockClear();
    await expect(
      sendLoginNudgeNow({
        ...base,
        supabaseAdmin: fakeAdmin(),
        channel: "public_magic_link",
        variant: "athena-code",
      }),
    ).rejects.toThrow("Preview sign-in code is missing");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("athena still honors suppression", async () => {
    const r = await sendLoginNudgeNow({
      ...base,
      supabaseAdmin: fakeAdmin({ suppressed: true }),
      channel: "public_magic_link",
      variant: "athena",
    });
    expect(r.status).toBe("suppressed");
    expect(m.send).not.toHaveBeenCalled();
  });
});
