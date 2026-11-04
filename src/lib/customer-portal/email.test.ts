import { describe, expect, it } from "vitest";
import {
  PORTAL_FROM_DEFAULT,
  codeEmail,
  decisionEmail,
  inviteEmail,
  noticeEmail,
  portalFrom,
  sendPortalEmail,
  type PortalSender,
} from "./email";

const invite = inviteEmail({
  to: "rosa@example.com",
  name: "Rosa",
  company: "ALP Construction",
  jobName: "Harbor Point Dental",
  pmName: "Pat Lee",
  link: "https://app.meetathena.io/c/i/token",
  expires: "Nov 11, 2026",
  nonce: "n1",
});

describe("customer emails lead with the contractor", () => {
  it('sends from "{company} via Athena" on Athena\'s own address', async () => {
    const sent: { from: string }[] = [];
    const sender: PortalSender = async (m) => void sent.push(m);
    const env = { ATHENA_PORTAL_EMAIL_ENABLED: "true" };
    expect(await sendPortalEmail(invite, { env, sender })).toBe("sent");
    expect(sent[0].from).toBe('"ALP Construction via Athena" <team@meetathena.io>');
    expect(sent[0]).not.toHaveProperty("fromName");
  });

  it("keeps a configured address and strips characters that could break the header", () => {
    expect(portalFrom("Athena <portal@meetathena.io>", 'Bob "The" <Builder>\r\nBcc: x')).toBe(
      '"Bob The Builder Bcc: x" <portal@meetathena.io>',
    );
    expect(portalFrom("portal@meetathena.io", "ALP via Athena")).toBe(
      '"ALP via Athena" <portal@meetathena.io>',
    );
    expect(portalFrom(PORTAL_FROM_DEFAULT)).toBe(PORTAL_FROM_DEFAULT);
  });

  it("sets the contractor-first sender on every customer email", () => {
    for (const m of [
      invite,
      codeEmail({
        to: "r@e.com",
        name: "Rosa",
        company: "ALP Construction",
        jobName: "J",
        code: "123456",
        purpose: "sign_in",
        nonce: "n",
      }),
      noticeEmail({
        to: "r@e.com",
        name: "Rosa",
        company: "ALP Construction",
        jobName: "J",
        link: "https://app.meetathena.io/c/x",
        kind: "update",
        nonce: "n",
      }),
    ])
      expect(m.fromName).toBe("ALP Construction via Athena");
  });

  it("leaves the PM's own decision notice as Athena, with no customer footer", () => {
    const m = decisionEmail({
      to: "pat@e.com",
      customer: "Rosa",
      jobName: "J",
      jobNumber: "2715",
      label: "PCO-004",
      decision: "approved",
      choice: null,
      note: null,
      reference: "R1",
    });
    expect(m.fromName).toBeUndefined();
  });
});
