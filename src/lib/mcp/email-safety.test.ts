import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMAIL_DRAFT_ONLY_RULE,
  EMAIL_SEND_OFF_RULE,
  draftCardText,
  draftKey,
  emailRules,
  outboundEmailDisabled,
} from "./email-safety";
import { guide } from "./visible";
import { inviteEnabled, sendInvite } from "./team-invite-email";
import { teamInvite } from "./tools/team-tools";
import { emailConfirmSend, emailDraft } from "./tools/email-tools";

// Never a real address or a real send in these tests.
const D = {
  to: "jordan.reyes@example.com",
  cc: [],
  subject: "Job 2701 — Two-Week Lookahead (Oct 26–Nov 6, 2026)",
  body: "Lookahead below.",
  link: null,
};
const ann = (t: unknown) =>
  (t as { annotations?: Record<string, unknown> }).annotations ??
  (t as { config?: { annotations?: Record<string, unknown> } }).config?.annotations;
const SRC = readFileSync("src/lib/mcp/index.ts", "utf8");

describe("P0: no email is sent without a draft and a separate yes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("email_draft is read-only; email_confirm_send is destructive and needs confirmed true", () => {
    expect(ann(emailDraft)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(ann(emailConfirmSend)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(ann(teamInvite)).toMatchObject({ destructiveHint: true });
  });

  it("both email tools are registered and the server instructions carry the draft-only rule", () => {
    expect(SRC).toMatch(/emailDraft, emailConfirmSend, submittalLog, submittalsList, submittalsImport, projectRecordSearch, gettingStarted\]/);
    expect(SRC).toContain("EMAIL_DRAFT_ONLY_RULE");
    expect(SRC).not.toMatch(/tell the member which account that is before sending/);
    expect(EMAIL_DRAFT_ONLY_RULE).toMatch(/Never send an email in the same reply/);
    expect(EMAIL_DRAFT_ONLY_RULE).toMatch(/email_confirm_send/);
    expect(EMAIL_DRAFT_ONLY_RULE).toMatch(/Yes or no\?/);
  });

  it("the draft card says not sent and leads with To:", () => {
    const t = draftCardText(D, {});
    expect(t.split("\n")[0]).toBe("To: jordan.reyes@example.com");
    expect(t).toMatch(/Not sent\./);
  });

  it("draft key changes when anything on the card changes", () => {
    expect(draftKey(D)).toMatch(/^D[0-9A-F]{8}$/);
    expect(draftKey(D)).toBe(draftKey({ ...D }));
    expect(draftKey({ ...D, to: "other@example.com" })).not.toBe(draftKey(D));
    expect(draftKey({ ...D, body: "x" })).not.toBe(draftKey(D));
  });

  it("any email-related result carries the draft-only rule in guidance", () => {
    const r = guide(
      { content: [{ type: "text" as const, text: "Lookahead ready." }] },
      "Offer to email it to the super.",
    );
    expect(
      (r as unknown as { structuredContent: { assistant_guidance: string[] } }).structuredContent
        .assistant_guidance,
    ).toContain(EMAIL_DRAFT_ONLY_RULE);
    const plain = guide({ content: [{ type: "text" as const, text: "Float is 4 days." }] });
    expect(JSON.stringify(plain)).not.toContain("never send an email in the same reply");
  });

  it("kill switch: off by default, on with ATHENA_OUTBOUND_EMAIL_DISABLED=true", () => {
    expect(outboundEmailDisabled({})).toBe(false);
    expect(outboundEmailDisabled({ ATHENA_OUTBOUND_EMAIL_DISABLED: "true" })).toBe(true);
    expect(emailRules({ ATHENA_OUTBOUND_EMAIL_DISABLED: "true" })[0]).toBe(EMAIL_SEND_OFF_RULE);
    expect(draftCardText(D, { ATHENA_OUTBOUND_EMAIL_DISABLED: "true" })).toMatch(
      /Sending is turned off/,
    );
  });

  it("kill switch beats the invite flag: no invite email, sender never called", async () => {
    const sender = vi.fn(async () => ({ id: "x" }));
    const env = { ATHENA_INVITE_EMAIL_ENABLED: "true", ATHENA_OUTBOUND_EMAIL_DISABLED: "true" };
    expect(inviteEnabled(env)).toBe(false);
    expect(
      await sendInvite(
        { to: "a@example.com", from: "f@example.com", subject: "s", text: "t", html: "h" },
        { env, sender },
      ),
    ).toBe("off");
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("P0: email tool handlers never send", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("the handlers contain no network send", () => {
    const src = readFileSync("src/lib/mcp/tools/email-tools.ts", "utf8");
    expect(src).not.toMatch(/fetch\(|resend|gmail\.googleapis|sendMail/i);
  });
});
