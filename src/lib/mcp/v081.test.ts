import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HOST_DISPLAY_BLOCK, SUMMARY_OFFER_TEXT } from "./visible";
import { SOV_TABLE_STYLE, buildSov, sovLayout, sovSummaryText } from "./sov";
import { SUMMARY_OFFER } from "./contract-clauses";
import { companyScopeDefaults, scopeAlias, SECTOR_ALIASES, POSITION_ALIASES, PRICING_ALIASES } from "./scope-defaults";

const BRAND = { company_name: "ALP Construction", logo_url: null, license_number: null, contact_name: null, contact_phone: null, website: null };
const sov = buildSov([{ item_no: "26.01", description: "Mobilization", scheduled_value: 700000 }, { item_no: "27.01", description: "Pathways", scheduled_value: 700000 }], 0, null);

describe("0.8.1 SOV table style", () => {
  it("blue header with white bold text, gray bands, bold total with blue top rule, in both the recipe and the host instruction", () => {
    expect(SOV_TABLE_STYLE).toContain("Header row blue #2563EB with white bold text");
    expect(SOV_TABLE_STYLE).toContain("alternating light-gray");
    expect(SOV_TABLE_STYLE).toContain("bold total row with a blue #2563EB top rule");
    expect(sovLayout(BRAND).table_style).toBe(SOV_TABLE_STYLE);
    expect(HOST_DISPLAY_BLOCK).toContain("header row blue #2563EB with white bold text");
    expect(readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8")).toContain("Table style: ${SOV_TABLE_STYLE}");
  });
  it("nothing after the table in the visible SOV; footer and roll-up only on request", () => {
    const txt = sovSummaryText("", sov, BRAND, "Exhibit B", ["license number"], "internal");
    expect(txt.trim().split("\n").pop()).toBe("Total | | | Contract sum | $1,400,000.00 | 100.00%");
    expect(txt).not.toMatch(/Footer still missing|Division subtotals|Logo:/);
    expect(HOST_DISPLAY_BLOCK).toContain("After the table, at most one line: no footer or license note and no roll-up offer unless the member asks.");
  });
});

describe("0.8.1 exact summary offer", () => {
  it("host told to use it verbatim, same text as the server offer", () => {
    expect(SUMMARY_OFFER_TEXT).toBe("Do you want me to summarize this legal text so you know what it means in plain English?");
    expect(SUMMARY_OFFER_TEXT).toBe(SUMMARY_OFFER);
    expect(HOST_DISPLAY_BLOCK).toContain(`use this wording verbatim, never paraphrased or shortened: "${SUMMARY_OFFER_TEXT}"`);
  });
});

describe("0.8.1 step 0 scoping: use the defaults", () => {
  it("fills job type, sector and position from the profile, never client type or pricing", () => {
    const d = companyScopeDefaults({ company_role: "Self-performing electrical subcontractor", work_types: ["public"], trades: ["Electrical"] });
    expect(d).toEqual({ job_type: "Electrical", sector: "public", position: "sub" });
    expect(d).not.toHaveProperty("client_type");
    expect(d).not.toHaveProperty("pricing_model");
    expect(companyScopeDefaults({ company_role: "", work_types: ["commercial", "public"], trades: ["Electrical", "Low voltage"] })).toEqual({});
    expect(companyScopeDefaults(null)).toEqual({});
  });
  it("accepts common wording and 'defaults' instead of rejecting the save", () => {
    expect(scopeAlias(SECTOR_ALIASES)("commercial")).toBe("private_commercial");
    expect(scopeAlias(POSITION_ALIASES)("Subcontractor")).toBe("sub");
    expect(scopeAlias(PRICING_ALIASES)("Lump sum")).toBe("lump_sum");
    expect(scopeAlias(PRICING_ALIASES)("defaults")).toBeUndefined();
    expect(scopeAlias(PRICING_ALIASES)("unknown")).toBeUndefined();
  });
  it("intake scope takes use_defaults and says which defaults it used", () => {
    const src = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
    expect(src).toContain("use_defaults: z.boolean().optional()");
    expect(src).toContain("Company defaults used:");
  });
});
