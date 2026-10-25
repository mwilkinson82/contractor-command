import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draftMonthForecast, draftSovText, nextDraftFacts } from "./sov-draft";
import { DRAFT_NOT_OFFICIAL, storedModule } from "./record-copy";

const brand = { company_name: "Fictional Construction", logo_url: null, license_number: null, contact_name: null, contact_phone: null, website: null };

describe("draft schedule of values", () => {
  it("labels the draft and its monthly forecast, and does not call the figure the contract value", () => {
    const text = draftSovText(
      [
        { item_no: "26.06", description: "Branch rough-in", scheduled_value: 255000 },
        { item_no: "26.90", description: "Expected change order", scheduled_value: 50000 },
      ],
      0,
      "Exhibit B",
      brand,
      { start: "2026-11-02", finish: "2026-11-06" },
    );
    expect(text).toContain(DRAFT_NOT_OFFICIAL);
    expect(text).toContain("Expected change order");
    expect(text).toContain("Monthly forecast");
    expect(text).toContain("2026-11");
    expect(text).not.toContain("Contract total:");
    expect(text).not.toContain("Contract sum");
    expect(draftMonthForecast(50000, null, null)).toBeNull();
    const official = [{ key: "26.06", value: { billable_value: 255000 } }];
    const first = nextDraftFacts(official, [], { "26.90": { billable_value: 50000 } });
    expect(first.copy).toEqual({ "26.06": { billable_value: 255000 } });
    const again = nextDraftFacts(official, [{ key: "26.06", value: { billable_value: 255000 } }, { key: "26.90", value: { billable_value: 50000 } }], { "26.90": { billable_value: 80000 } });
    expect(again.copy).toBeNull();
    expect(again.edits).toEqual({ "26.90": { billable_value: 80000 } });
  });

  it("keeps the draft in its own module, away from pay apps and the official SOV", () => {
    expect(storedModule("sov", "official")).toBe("sov");
    expect(storedModule("sov", "draft")).toBe("sov_draft");
    const payApp = readFileSync("src/lib/mcp/tools/superintendent-tools.ts", "utf8");
    const contract = readFileSync("src/lib/mcp/contract-value.ts", "utf8");
    expect(payApp).not.toContain("sov_draft");
    expect(contract).not.toContain("sov_draft");
    expect(payApp).toContain('f.module === "sov"');
  });
});