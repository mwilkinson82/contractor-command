import { describe, it, expect } from "vitest";
import { findDelayTerms, parseClauseText, termDue } from "./delays";
import { clientSafe, hasClientLeak } from "./client-safe";
import { draftGuidance, draftIdentity, draftIdentityText } from "./drafts";
import { makeWho } from "./people";

describe("delay terms", () => {
  it("parses typed notice terms", () => {
    expect(parseClauseText("Delay notice", "§6.4: written notice within three (3) calendar days")).toMatchObject({ n_days: 3, day_type: "calendar", clause_ref: "§6.4" });
    expect(parseClauseText("Claim notice", "Article 7.4 — 7 days")).toMatchObject({ n_days: 7, day_type: null, clause_ref: "Article 7.4" });
    expect(parseClauseText("x", "promptly")).toBeNull();
  });
  it("prefers recorded deadlines, never splits a claim period out of combined notice text, and computes due dates", () => {
    const t = findDelayTerms([{ clause_key: "notice", label: "Delay notice", clause_ref: "§8.3", trigger_desc: null, n_days: 2, day_type: "business", recipient: "GC PM", delivery_method: "email" }],
      { notice_timing: "3 calendar days; claims within 10 calendar days" });
    expect(t.notice).toMatchObject({ n_days: 2, day_type: "business", clause_ref: "§8.3", recipient: "GC PM" });
    expect(t.claim).toBeNull(); // 0021: the sentence splitter is retired; claim days come only from a clause row or deadline row
    expect(termDue(t.notice, "2026-10-12").due).toBe("2026-10-14");
    expect(termDue(t.notice, null).due).toBeNull();
  });
});

describe("client-safe output", () => {
  it("withholds amounts and drops margin/forecast lines", () => {
    const out = clientSafe("Contract: $1,125,000\nGross margin 16.89%\nBilling forecast Nov\nRetainage 10%\nPaid 50k dollars");
    expect(out).toBe("Contract: [amount withheld]\nRetainage 10%\nPaid [amount withheld]");
    expect(hasClientLeak(out)).toBe(false);
    expect(hasClientLeak("Owes $5")).toBe(true);
  });
});

describe("draft identity", () => {
  it("signs as the PM with title and company; From is the PM email", () => {
    expect(draftIdentity({ name: "Sam Ortiz", email: "sam@x.invalid", title: null, isMember: false }, { name: "ALP Construction" }))
      .toEqual({ suggested_from: "sam@x.invalid", signature: "Sam Ortiz\nProject Manager\nALP Construction", missing: [] });
    const t = draftIdentityText({ name: null, email: null, title: null, isMember: false }, { name: "ALP" });
    expect(t).toContain("no PM set");
    expect(t).not.toContain("email card"); // retest 4: how-to-send guidance is hidden (draftGuidance)
    expect(draftGuidance({ name: null, email: null, title: null, isMember: false }, { name: "ALP" }).join(" ")).toContain("host's email card picks");
  });
  it("accountable defaults to a contact PM", () => {
    const who = makeWho([{ user_id: "u1", display_name: "Marshall", role: "owner" }], null, "Sam Ortiz");
    expect(who(null)).toBe("Sam Ortiz (PM)");
    expect(who("sam ortiz")).toBe("Sam Ortiz (PM)");
    expect(who("Marshall")).toBe("Marshall (Owner)");
  });
});
