import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUBMITTAL_DRAFT_LABEL, submittalDisplayStatus } from "./mcp/submittals";

const row = { status: "in_review" as const, revision: 0, built_package: null, submission_sent_at: null };
const pkg = { revision: 0, is_current: true, sent_at: null, revoked_at: null };

describe("one submittal status for log and record page", () => {
  it("log row with a built, unsent package reads as a draft", () => {
    expect(submittalDisplayStatus({ ...row, built_package: { id: "a", filename: "f.pdf", page_count: 1, sent_at: null } })).toBe(SUBMITTAL_DRAFT_LABEL);
  });
  it("record page with the same package list reads the same draft label, not In review", () => {
    expect(submittalDisplayStatus(row, [pkg])).toBe(SUBMITTAL_DRAFT_LABEL);
  });
  it("sent, revoked, older-revision or no package falls back to the saved status", () => {
    expect(submittalDisplayStatus({ ...row, submission_sent_at: "2026-10-25" }, [pkg])).toBe("In review");
    expect(submittalDisplayStatus(row, [{ ...pkg, sent_at: "2026-10-25" }])).toBe("In review");
    expect(submittalDisplayStatus(row, [{ ...pkg, revoked_at: "2026-10-25" }])).toBe("In review");
    expect(submittalDisplayStatus(row, [{ ...pkg, revision: 1 }])).toBe("In review");
    expect(submittalDisplayStatus({ ...row, status: "approved" }, [])).toBe("Approved");
  });
  it("record page uses the shared mapping", () => {
    expect(readFileSync("src/lib/submittal-record-page.ts", "utf8")).toContain("submittalDisplayStatus(row, p.packages)");
  });
});
