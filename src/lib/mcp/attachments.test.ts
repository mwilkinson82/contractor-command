import { describe, expect, it } from "vitest";
import {
  EMAIL_ATTACHMENT_RULE, EMAIL_ATTACHMENT_STRUCTURED, REPORT_SHARE_ASK, REPORT_SHARE_STRUCTURED, SOV_DELIVERY_ASK,
  SOV_DELIVERY_BLOCK, SOV_DELIVERY_STRUCTURED, sovRequiredTop, visibleProblems,
} from "./visible";

describe("0.8.10 email attachments", () => {
  it("rule is a pinned REQUIRED line that forbids claiming a missing attachment", () => {
    expect(EMAIL_ATTACHMENT_RULE).toMatch(/^REQUIRED: Only say a file is attached if your email tool actually attached it/);
    expect(EMAIL_ATTACHMENT_RULE).toMatch(/link to the file in the email body/);
    expect(EMAIL_ATTACHMENT_STRUCTURED.never_claim_missing_attachment).toBe(true);
  });
  it("SOV result text pins the rule after the 3 sharing options", () => {
    const lines = sovRequiredTop([{ item_no: "1", cost_code: "01-000", scheduled_value_display: "$1.00" }], "To: a@b.com").split("\n");
    expect(lines[2]).toMatch(/^REQUIRED: .*all 3 sharing options/);
    expect(lines[3]).toBe(EMAIL_ATTACHMENT_RULE);
  });
  it("SOV and report delivery data carry the attachment fallback", () => {
    expect(SOV_DELIVERY_STRUCTURED.attachments).toBe(EMAIL_ATTACHMENT_STRUCTURED);
    expect(REPORT_SHARE_STRUCTURED.attachments).toBe(EMAIL_ATTACHMENT_STRUCTURED);
    expect(SOV_DELIVERY_STRUCTURED.options[1].note).toMatch(/can't attach files \(ChatGPT\)/);
    expect(SOV_DELIVERY_BLOCK).toMatch(/- Attachments: Only say a file is attached/);
  });
  it("member-facing option 2 is honest about links and stays clean", () => {
    for (const ask of [SOV_DELIVERY_ASK, REPORT_SHARE_ASK]) {
      expect(ask.split("\n")).toHaveLength(4);
      expect(ask).toMatch(/with the file attached \(or a link to it if your email can't carry files from here\)/);
      expect(visibleProblems(ask)).toEqual([]);
    }
  });
  it("no red, no Lovable, fragnet wording intact", () => {
    const all = [EMAIL_ATTACHMENT_RULE, JSON.stringify(EMAIL_ATTACHMENT_STRUCTURED), SOV_DELIVERY_ASK, REPORT_SHARE_ASK].join(" ");
    expect(all).not.toMatch(/lovable|\bred\b|fragment/i);
  });
});
