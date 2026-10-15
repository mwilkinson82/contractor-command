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
          if (table === "email_unsubscribe_tokens") return { data: { token: "unsub", used_at: null } };
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
    expect(p.from).toBe("Athena by ALP <no-reply@notify.mail.alpcontractorcircle.com>");
    expect(p.sender_domain).toBe("notify.mail.alpcontractorcircle.com");
    expect(p.reply_to).toBe(MEMBER_REPLY_TO);
    expect(p.subject).toBe("Sign into Athena");
    expect(p.unsubscribe_token).toBe("unsub");
    expect(p.idempotency_key).toBe("idem-1");
    const body =
      "Use the secure link below to sign into Athena and continue connecting your account.";
    expect(p.html).toContain(body);
    expect(p.text).toContain(body);
    expect(p.html).toMatch(/<h1[^>]*>Sign into Athena<\/h1>/);
    expect(p.html).toMatch(/>Sign into Athena<\/span>|>Sign into Athena<\/a>/);
    expect(p.text).toContain("Sign into Athena");
    expect(decode(p.html)).toContain(`href="${URL_EXACT}"`);
    expect(p.text).toContain(URL_EXACT);
    expect(p.html).not.toMatch(/Circle|member/i);
    expect(p.text).not.toMatch(/Circle|member/i);
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
