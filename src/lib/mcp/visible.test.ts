import { describe, expect, it } from "vitest";
import { finalizeVisible, splitGuidance, visibleProblems } from "./visible";
import { draftGuidance, draftIdentityText } from "./drafts";
import { buildQuestionsText, pushbackText } from "./lookahead-help";

// Phrases seen leaking into ChatGPT (retest 4) and the instruction forms they came from.
const LEAKS = [
  "Relay the questions as written.",
  "Show the report verbatim.",
  "Every email or letter you draft for this job starts with these two lines, word for word, above the draft (outside the email card):",
  "Ask the member and wait for the answer.",
  "Then call intake section \"lookahead\" again with lookahead_exists \"yes\".",
  "Next: intake section \"contract\", or next_question.",
  "check_key: warranty:workmanship_warranty",
  "The host's email card picks the account that actually sends.",
  "Answer with response \"yes\", \"no\" or \"unknown\".",
  "To mark the whole section N/A use answer action \"mark_na\" with scope \"section\".",
];

describe("visible text has no host-directed instructions (retest 4)", () => {
  it.each(LEAKS)("flags and moves: %s", (l) => {
    expect(visibleProblems(l).length).toBeGreaterThan(0);
    const s = splitGuidance(`J-1 – Saved.\n${l}`);
    expect(s.visible).toBe("J-1 – Saved.");
    expect(s.guidance.join(" ")).toContain(l.slice(0, 20));
  });
  it("keeps a numbered spec item together so a guidance phrase cannot leave a blank 1.", () => {
    const s = splitGuidance("1. Header: copy the Tie line word for word, then stop.");
    expect(s.visible).not.toMatch(/^1\.\s*$/m);
    expect(s.visible).not.toContain("1.");
    expect(s.guidance.join("\n")).toBe("1. Header: copy the Tie line word for word, then stop.");
    const kept = splitGuidance("1. Draw the header. Never invent a date.");
    expect(kept.visible).toBe("1. Draw the header.");
    expect(kept.guidance).toEqual(["Never invent a date."]);
  });
  it("keeps PM-facing content, including item actions and the draft data lines", () => {
    const pm = "- [To confirm] 2601 – Confirm delivery method and recipient for: Long-lead switchgear submittals | Accountable: Sam Ortiz (PM) | Needed by: 2026-10-21";
    expect(visibleProblems(pm)).toEqual([]);
    expect(splitGuidance(pm).visible).toBe(pm);
    const d = draftIdentityText({ name: "Sam Ortiz", email: "sam@example.com", title: null, isMember: false }, { name: "ALP" });
    expect(d).toContain("- Sign as: Sam Ortiz, Project Manager, ALP");
    expect(d).toContain("- Suggested From: sam@example.com");
    expect(visibleProblems(d)).toEqual([]);
  });
  it("internal refs and codes are flagged", () => {
    expect(visibleProblems("Due 2026-10-21 | Accountable: X [ref #0c4408, type unknown]").length).toBeGreaterThan(0);
    expect(visibleProblems("Unknown: beneficial_use_clause").length).toBeGreaterThan(0);
    expect(visibleProblems("dates counted in America/New_York")).toEqual([]);
  });
  it("draft guidance and look-ahead steps are hidden; finalizeVisible moves them to structuredContent", () => {
    const g = draftGuidance({ name: "Sam Ortiz", email: "sam@example.com", title: null, isMember: false }, { name: "ALP" });
    expect(g.join(" ")).toContain("Suggested From: sam@example.com / Sign as: Sam Ortiz, Project Manager, ALP");
    expect(visibleProblems(pushbackText("J-1 – "))).toEqual([]);
    expect(visibleProblems(buildQuestionsText("J-1 – "))).toEqual([]);
    const r = finalizeVisible({ content: [{ type: "text", text: "Saved.\nNext: next_question." }] });
    expect(r.content[0].text).toBe("Saved.");
    expect((r as { structuredContent?: { assistant_guidance?: string[] } }).structuredContent?.assistant_guidance).toEqual(["Next: next_question."]);
  });
});
