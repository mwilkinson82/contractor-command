import { describe, expect, it } from "vitest";
import { sendPortalEmail, type PortalSender } from "../customer-portal/email";
import { CONFIRM_BUTTON, confirmRequestEmail } from "./email";
import { confirmUrl } from "./model";

const base = {
  to: "orders@acme.example",
  partyName: "Acme Supply",
  partyKind: "supplier" as const,
  askKind: "delivery" as const,
  company: "Northline Electric",
  jobNumber: "2810",
  jobName: "Willow Creek",
  what: "Delivery of switchgear",
  date: "2026-11-12",
  sender: "Pat Lee",
  link: confirmUrl("T".repeat(43)),
  expires: "Nov 19, 2026",
  requestId: "00000000-0000-4000-8000-0000000000f1",
};

describe("look-ahead confirmation request email", () => {
  it("leads with the contractor, carries the button and says Powered by Athena", () => {
    const m = confirmRequestEmail(base);
    expect(m.fromName).toBe("Northline Electric via Athena");
    expect(m.subject).toBe("Northline Electric: confirm delivery Nov 12 for Willow Creek");
    expect(m.key).toBe(`lookahead-confirm:${base.requestId}`);
    expect(m.html).toContain(`>${CONFIRM_BUTTON}<`);
    expect(CONFIRM_BUTTON).toBe("Confirm the date");
    expect(m.html).toContain(`href="https://app.meetathena.io/l/${"T".repeat(43)}"`);
    expect(m.html).toContain("Northline Electric</p>");
    expect(m.html).toContain("Powered by Athena");
    expect(m.html).toContain("Confirm your delivery date");
    expect(m.text).toContain(
      "Pat Lee at Northline Electric has you on the two-week look-ahead for Willow Creek (job 2810): Delivery of switchgear, Thursday, Nov 12, 2026.",
    );
    expect(m.text).toContain(`Confirm the date: ${base.link}`);
    expect(m.text).toContain("This link works until Nov 19, 2026.");
    expect(`${m.html}${m.text}`).not.toMatch(/\$|cost|markup|price/i);
  });

  it("shows the contractor's logo, a window and a sub's crew start", () => {
    const m = confirmRequestEmail({
      ...base,
      partyKind: "sub",
      askKind: "start",
      partyName: "Rivera Drywall",
      what: "Crew start, level 2 drywall",
      windowEnd: "2026-11-14",
      logo: "https://backend.example/storage/v1/object/public/company-logos/n.png",
    });
    expect(m.subject).toBe(
      "Northline Electric: confirm crew start Nov 12 to Nov 14 for Willow Creek",
    );
    expect(m.html).toContain('alt="Northline Electric"');
    expect(m.html).toContain("Confirm your crew start date");
    expect(m.text).toContain("between Thursday, Nov 12, 2026 and Saturday, Nov 14, 2026");
  });

  it("escapes what the team typed", () => {
    const m = confirmRequestEmail({
      ...base,
      what: "<b>Panels</b> & gear",
      partyName: "A&B <Supply>",
    });
    expect(m.html).toContain("&lt;b&gt;Panels&lt;/b&gt; &amp; gear");
    expect(m.html).not.toContain("<b>Panels</b>");
  });

  it("goes out only when portal email is on, from the contractor via Athena", async () => {
    const sent: { from: string }[] = [];
    const sender: PortalSender = async (x) => void sent.push(x);
    const m = confirmRequestEmail(base);
    expect(await sendPortalEmail(m, { env: {}, sender })).toBe("off");
    expect(sent).toEqual([]);
    expect(await sendPortalEmail(m, { env: { ATHENA_PORTAL_EMAIL_ENABLED: "true" }, sender })).toBe(
      "sent",
    );
    expect(sent[0]!.from).toBe('"Northline Electric via Athena" <team@meetathena.io>');
  });
});
