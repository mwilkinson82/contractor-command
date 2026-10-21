import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOST_DISPLAY_BLOCK, SOV_DELIVERY_ASK, SOV_DELIVERY_BLOCK } from "./visible";
import { SOV_SPECS_MISSING_NOTE, buildSov, sovLineRows, sovSpecsMissing, sovSummaryText } from "./sov";
import { ATHENA_VERSION } from "./server-info-branding";

const BRAND = { company_name: "ALP Construction", logo_url: null, license_number: null, contact_name: null, contact_phone: null, website: null };
const lines = [
  { item_no: "26.01", description: "Mobilization", scheduled_value: 700000, cost_codes: ["26-010"] },
  { item_no: "27.01", description: "Pathways", scheduled_value: 700000, cost_codes: ["27-010"], spec_section: "27 05 28" },
];
const wf = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");

describe("0.8.2 SOV delivery step", () => {
  it("asks the exact three-option question after the table", () => {
    expect(SOV_DELIVERY_ASK.split("\n")[0]).toBe("Where do you want this SOV to live?");
    expect(SOV_DELIVERY_ASK).toContain("1. In your project software (Overwatch, Buildertrend, Procore, or another tool).");
    expect(SOV_DELIVERY_ASK).toContain("2. As an Excel file (.xlsx) or a PDF.");
    expect(SOV_DELIVERY_ASK).toContain("3. As a shared link (a Claude artifact, ChatGPT canvas or Grok Bot spreadsheet that anyone with the link can open).");
    expect(SOV_DELIVERY_BLOCK).toContain(SOV_DELIVERY_ASK);
    expect(wf).toContain("sovDeliveryBlock(audience),");
  });
  it("0.8.8: shared links are allowed for any audience", () => {
    expect(SOV_DELIVERY_BLOCK).toContain("anyone with the link");
    expect(SOV_DELIVERY_BLOCK).not.toMatch(/team members only|never an artifact or canvas link/);
  });
  it("never types passwords and never sends", () => {
    expect(SOV_DELIVERY_BLOCK).toContain("Never ask for, type or store a password");
    expect(SOV_DELIVERY_BLOCK).toContain("presses Send");
    expect(SOV_DELIVERY_BLOCK).toContain("within 3 days");
  });
  it("email card on demand: To blank and asked in the same reply, never guessed", () => {
    for (const b of [SOV_DELIVERY_BLOCK, HOST_DISPLAY_BLOCK]) {
      expect(b).toContain("leave To blank");
      expect(b).toContain("Never guess an address");
    }
    expect(HOST_DISPLAY_BLOCK).toContain("show the email card in that same reply");
  });
  it("tightened Claude wording: no narration, card not held back", () => {
    expect(SOV_DELIVERY_BLOCK).toContain("Claude: no narration");
    expect(SOV_DELIVERY_BLOCK).toContain("Never hold the card back while you ask.");
  });
  it("version is 0.8.6", () => expect(ATHENA_VERSION).toBe("0.8.13"));
});

describe("0.8.2 cost codes and spec sections on SOV lines", () => {
  const sov = buildSov(lines, 0, null);
  it("line_items carry the stored cost codes", () => {
    const rows = sovLineRows(sov);
    expect(rows.map((r) => r.cost_code)).toEqual(["26-010", "27-010"]);
    expect(rows[0].cost_codes).toEqual(["26-010"]);
  });
  it("spec section passes through, blank when absent, never invented", () => {
    const rows = sovLineRows(sov);
    expect(rows.map((r) => r.spec_section)).toEqual([null, "27 05 28"]);
    expect(sovSpecsMissing(sov)).toBe(false);
    expect(sovSpecsMissing(buildSov(lines.map(({ spec_section: _s, ...l }) => l), 0, null))).toBe(true);
    expect(SOV_SPECS_MISSING_NOTE).toBe("Specs not provided, so spec sections are blank. Spec sections will be cited once specs are uploaded.");
  });
  it("lines without codes come back empty, not guessed", () => {
    const r = sovLineRows(buildSov([{ item_no: "26.01", description: "x", scheduled_value: 100 }], 0, null));
    expect([r[0].cost_code, r[0].cost_codes]).toEqual([null, []]);
  });
  it("report sov reads cost_codes and spec_section from the stored facts and sets specs_note", () => {
    expect(wf).toContain("cost_codes: v.cost_codes, spec_section: v.spec_section ?? null");
    expect(wf).toContain("specs_note: sovSpecsMissing(sov) ? SOV_SPECS_MISSING_NOTE : null");
  });
  it("visible SOV still ends at the total row", () => {
    expect(sovSummaryText("", sov, BRAND, "Exhibit B", [], "internal").trim().split("\n").pop()).toBe("Total | | | Contract sum | $1,400,000.00 | 100.00%");
  });
});
