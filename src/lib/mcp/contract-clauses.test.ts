import { describe, it, expect } from "vitest";
import { legacySourceLabel, missingNoticeNote, classifyClause, clauseLine, missingNotices, normSection, parseClause, isClaimClause } from "./contract-clauses";
import { findDelayTerms } from "./delays";
import { visibleProblems, splitGuidance } from "./visible";

describe("contract clauses", () => {
  it("normalizes section numbers", () => {
    expect(["§6.4", "§ 6.4", "Section 6.4", "6.4."].map(normSection)).toEqual(["6.4", "6.4", "6.4", "6.4"]);
  });
  it("parses days, day type and trigger only from the clause's own words", () => {
    expect(parseClause("Subcontractor shall give written notice of any delay **within three (3) calendar days** after the start of the event, stating the cause")).toMatchObject({ n_days: 3, day_type: "calendar" });
    expect(parseClause("review each update and promptly notify Contractor of any disagreement.")).toMatchObject({ n_days: null, day_type: null });
    expect(parseClause("does not cure within three (3) working days after written notice").day_type).toBe("working");
  });
  it("classifies the notice checklist", () => {
    expect(classifyClause("Delay Notice", "notice of any delay")).toBe("delay_notice");
    expect(classifyClause("Claim Notice", "Any claim for additional time or money must be submitted in writing")).toBe("claim_notice");
    expect(classifyClause("Notice of Non-Payment", "")).toBe("nonpayment_notice");
    expect(classifyClause("For Cause", "does not cure within three (3) working days after written notice")).toBe("cure_notice");
    expect(classifyClause(undefined, "Subcontractor shall review each update and promptly notify Contractor of any disagreement.")).toBe("schedule_disagreement");
    expect(classifyClause("Liquidated Damages", "at $1,000 per calendar day")).toBe("other");
  });
  it("prints §X Heading: ‹exact text› with its tag, and the line stays visible", () => {
    const l = clauseLine({ section: "6.4", heading: "Delay Notice", verbatim_text: "Subcontractor shall give written notice.", source: "document" });
    expect(l).toBe("§6.4 Delay Notice: ‹Subcontractor shall give written notice.› (document)");
    const u = clauseLine({ section: "6.4", heading: null, verbatim_text: "x", source: "unverified" });
    expect(u).toContain("UNVERIFIED");
    for (const t of [l, u]) { expect(visibleProblems(t)).toEqual([]); expect(splitGuidance(t).guidance).toEqual([]); }
  });
  it("missing notices and claim clauses", () => {
    expect(missingNotices([{ category: "delay_notice" }]).map((m) => m.category)).toEqual(["claim_notice", "nonpayment_notice", "cure_notice", "schedule_disagreement"]);
    expect(isClaimClause({ category: "claim_notice" })).toBe(true);
  });
  it("due-date math reads each clause's own days; legacy combined text is never split", () => {
    const t = findDelayTerms([], {}, [{ section: "6.4", category: "delay_notice", n_days: 3, day_type: "calendar" }, { section: "7.4", category: "claim_notice", n_days: 7, day_type: "calendar" }]);
    expect(t.notice).toMatchObject({ n_days: 3, clause_ref: "§6.4" });
    expect(t.claim).toMatchObject({ n_days: 7, clause_ref: "§7.4" });
    const legacy = findDelayTerms([], { notice_timing: "§6.4 delay notice within 3 calendar days; §7.4 claim notice within 7 calendar days" });
    expect(legacy).toEqual({ notice: null, claim: null });
  });
  it("legacy summary label and honest Missing note", () => {
    expect(legacySourceLabel("document")).toBe("from the contract, summary");
    expect(legacySourceLabel("document")).not.toMatch(/not verified|manual/);
    expect(legacySourceLabel("member_answer")).toBe("manual");
    expect(legacySourceLabel("company_default")).toBe("company default");
    expect(missingNoticeNote(false)).toContain("opens once");
    expect(missingNoticeNote(true)).toBe("open item asks to confirm it");
    for (const t of [legacySourceLabel("document"), missingNoticeNote(false)]) expect(visibleProblems(t)).toEqual([]);
  });
});
