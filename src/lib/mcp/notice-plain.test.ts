import { describe, expect, it } from "vitest";
import rows2603 from "./__fixtures__/job-2603-clauses.json";
import { noticeRequirements, recipientIn, noticeEventOf, isNoticeAddressClause } from "./notice-plain";
import type { ClauseRow } from "./contract-clauses";

const c = (section: string, text: string, extra: Partial<ClauseRow> = {}): ClauseRow => ({ section, heading: null, category: "other", verbatim_text: text, n_days: null, day_type: null, trigger_desc: null, source: "document", ...extra });
const r2603 = rows2603 as ClauseRow[];

describe("plain-language notice requirements", () => {
  it("2603: days and who per event, verbatim quotes, missing named", () => {
    const s = noticeRequirements(r2603);
    const t = s.lines.join("\n");
    expect(s.status).toBe("partial");
    expect(t).toContain("- Delays: notice within 3 calendar days after the start of the event (§6.4); the contract doesn't say who it goes to.");
    expect(t).toContain("- Claims: notice within 7 calendar days of the event giving rise to it (§7.4)");
    expect(t).toContain("- Differing site conditions: the contract has no notice requirement");
    expect(t).toContain("it goes to Contractor (§3.4)");
    expect(t).toContain("calendar or business days");
    // verbatim, with section
    for (const sec of ["6.4", "7.4", "3.4", "7.1"]) expect(t).toContain(`‹${r2603.find((x) => x.section === sec)!.verbatim_text}›`);
    expect(t).toMatch(/Missing: The contract doesn't outline when notice must be sent for changes or differing site conditions; and it doesn't say who notice goes to for delays, changes, claims or differing site conditions\./);
    // never fills in a recipient that isn't in the text
    expect(t).not.toMatch(/Delays:[^\n]*goes to (Owner|Contractor)/);
  });
  it("no notice terms: says so plainly", () => {
    const s = noticeRequirements([c("2.1", "Subcontractor shall furnish all labor and materials for the electrical work.")]);
    expect(s.status).toBe("none");
    expect(s.lines.join("\n")).toContain("In the contract we notice there are no specific notice requirements");
  });
  it("member said no notice terms, no clauses", () => {
    expect(noticeRequirements([], { noticeFlagNo: true }).lines.join("\n")).toContain("no specific notice requirements");
  });
  it("nothing recorded is not the same as none", () => {
    const s = noticeRequirements([]);
    expect(s.status).toBe("not_recorded");
    expect(s.lines.join("\n")).not.toContain("no specific notice requirements");
  });
  it("partial: a notices clause names who but no timing", () => {
    const s = noticeRequirements([c("14.1", "All notices shall be delivered in writing to the Owner at the address shown above.", { heading: "Notices" })]);
    const t = s.lines.join("\n");
    expect(s.status).toBe("partial");
    expect(t).toContain("Notices should go to Owner (§14.1), but the contract doesn't outline when notices must be sent for delays, changes, claims or differing site conditions.");
    expect(t).toContain("‹All notices shall be delivered in writing to the Owner at the address shown above.›");
  });
  it("detects change and differing site condition clauses", () => {
    expect(noticeEventOf(c("8", "Contractor shall give notice of differing site conditions within 5 days."))).toBe("differing_site_conditions");
    expect(noticeEventOf({ category: "other", heading: "Changes", verbatim_text: "x" })).toBe("change");
    expect(isNoticeAddressClause({ heading: "Notices", verbatim_text: "x" })).toBe(true);
    const s = noticeRequirements([c("8.2", "Subcontractor shall notify the Contractor in writing of concealed conditions within five (5) calendar days after discovery.", { n_days: 5, day_type: "calendar", trigger_desc: "after discovery" })]);
    expect(s.lines.join("\n")).toContain("- Differing site conditions: notice within 5 calendar days after discovery (§8.2); it goes to Contractor (§8.2).");
  });
  it("recipient only from the clause's own words", () => {
    expect(recipientIn("Subcontractor shall give Contractor written notice")).toBe("Contractor");
    expect(recipientIn("promptly notify Contractor of any disagreement")).toBe("Contractor");
    expect(recipientIn("give written notice of any delay within three days")).toBeNull();
  });
});
