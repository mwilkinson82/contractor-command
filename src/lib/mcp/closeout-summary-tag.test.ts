import { describe, it, expect } from "vitest";
import { renderWarrantyRegister, alignCloseoutSource, CLOSEOUT_SUMMARY_TAG } from "./warranty";
import { LEGACY_SUMMARY_TAG } from "./contract-clauses";

const k = (key: string, value: string, source = "member_answer") => ({ key, value, status: "known", source, module: "warranty" });

describe("Required closeout documents from a document summary", () => {
  it("uses the same summary tag as contract summary fields", () => expect(CLOSEOUT_SUMMARY_TAG).toBe(LEGACY_SUMMARY_TAG));
  it("is tagged summary when copied from the contract closeout summary, never (document)", () => {
    const w = alignCloseoutSource([], k("closeout", "§9.1 O&M manuals, as-builts", "document"));
    const out = renderWarrantyRegister(w, "2026-10-19").join("\n");
    expect(out).toContain(`Required closeout documents: §9.1 O&M manuals, as-builts (${CLOSEOUT_SUMMARY_TAG})`);
    expect(out).not.toMatch(/Required closeout documents: .*\(document\)/);
  });
  it("member-typed closeout documents stay manual", () => {
    const out = renderWarrantyRegister([k("closeout_documents", "O&Ms")], "2026-10-19").join("\n");
    expect(out).toContain("Required closeout documents: O&Ms (manual)");
  });
});
