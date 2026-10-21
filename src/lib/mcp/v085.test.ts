import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clauseDelivery, contactForRole, dedupeNotices, emailContact, fillNotice, noticeKey, parseContacts, EMAIL_CONTACT_RULE } from "./contacts";
import { visibleProblems } from "./visible";
import { ATHENA_VERSION } from "./server-info-branding";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const C62 = "6.2 **Delay Notice.** Subcontractor shall give written notice of any delay **within five (5) calendar days** after the start of the event, stating the cause and the estimated impact, delivered by email to Contractor's Project Manager. Failure to give timely notice waives the claim.";
const C73 = "7.3 **Claim Notice.** Any claim for additional time or money must be submitted in writing **within ten (10) calendar days of the event** giving rise to it, delivered by email to Contractor's Project Manager with supporting documentation.";
const contacts = parseContacts("Calloway Builders (Jordan Reyes, PM)");
const item = (id: string, action: string, sec: string, due: string) => ({ id, action, clause_source: `${sec} (contract)`, delivery_method: null, recipient: null, needed_by: due, item_type: "deadline" });

describe("0.8.5 job contacts and notice items", () => {
  it("parses the saved job contact", () => {
    expect(contacts[0]).toMatchObject({ name: "Jordan Reyes", role: "PM", company: "Calloway Builders" });
  });
  it("reads method and recipient role from the clause", () => {
    expect(clauseDelivery(C62)).toEqual({ method: "email", to_role: "Contractor's Project Manager" });
    expect(clauseDelivery(C73).method).toBe("email");
  });
  it("fills Method and Recipient from §6.2 and the job contact", () => {
    const f = fillNotice(item("a", "Send written delay notice (§6.2) for: Weather delay", "§6.2", "2026-10-25"), [{ section: "6.2", verbatim_text: C62 }], contacts);
    expect(f.delivery_method).toBe("email, per §6.2");
    expect(f.recipient).toContain("Jordan Reyes");
  });
  it("asks when no contact is saved", () => {
    const f = fillNotice(item("a", "Send written delay notice (§6.2) for: Weather delay", "§6.2", "2026-10-25"), [{ section: "6.2", verbatim_text: C62 }], []);
    expect(f.recipient).toContain("who should it go to?");
    expect(emailContact(null).text).toContain("Who should this go to?");
  });
  it("dedupes the same event and notice type, idempotently", () => {
    const xs = [
      item("b", "Send written delay notice (§6.2) for: Weather delay occurred today", "§6.2", "2026-10-25"),
      item("a", "Send written delay notice (§6.2) for: Weather delay", "§6.2", "2026-10-25"),
      item("c", "Submit claim notice (§7.3) for: Weather delay", "§7.3", "2026-10-30"),
      item("d", "Submit claim notice (§7.3) for: Weather delay occurred today", "§7.3", "2026-10-30"),
    ];
    expect(noticeKey(xs[0])).toBe(noticeKey(xs[1]));
    const once = dedupeNotices(xs);
    expect(once.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(dedupeNotices(once.items).items.map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("email contact fills To and greeting; never 'Dear Project Manager'", () => {
    const e = emailContact(contactForRole(contacts, "Contractor's Project Manager"));
    expect(e.structured.greeting).toBe("Hi Jordan,");
    expect(e.text).not.toMatch(/Dear Project Manager/);
    expect(visibleProblems(e.text)).toEqual([]);
    expect(EMAIL_CONTACT_RULE).toContain("Never write \"Dear Project Manager\"");
  });
  it("wired into list_open_items, report sov and delay_event", () => {
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain("email_contact: ec.structured");
    expect(w).toContain("email_contact: ecDelay.structured");
    expect(w).toContain("dedupeNotices(");
  });
  it("0.8.5 tests run on the current version", () => expect(ATHENA_VERSION).toBe("0.8.14"));
});

