import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSov, sovLineRows, sovSummaryText } from "./sov";
import {
  CHART_PALETTE,
  CHART_PALETTE_RULE,
  DATE_SWEEP_RULE,
  HOST_DISPLAY_BLOCK,
  MONEY_CENTS_RULE,
  SOV_DELIVERY_ASK,
  SOV_DELIVERY_BLOCK,
  SOV_DELIVERY_REQUIRED,
  visibleProblems,
} from "./visible";
import { ATHENA_VERSION } from "./server-info-branding";

const BRAND = {
  company_name: "ALP Construction",
  logo_url: null,
  license_number: null,
  contact_name: null,
  contact_phone: null,
  website: null,
};
const lines = [
  {
    item_no: "26.01",
    description: "Mobilization",
    scheduled_value: 700000,
    cost_codes: ["26-010"],
  },
  { item_no: "28.01", description: "Fire alarm", scheduled_value: 700000, cost_codes: ["28-010"] },
];
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("0.8.3 retest fixes", () => {
  const sov = buildSov(lines, 0, null);
  const txt = sovSummaryText("", sov, BRAND, "Exhibit B", [], "internal");
  it("1. visible SOV text has a Cost code column with the stored codes", () => {
    expect(txt).toContain(
      "Line | Cost code | Division | Description | Scheduled value | % of total",
    );
    expect(txt).toContain("26.01 | 26-010 | 26 Electrical | Mobilization | $700,000.00 | 50.00%");
    expect(txt).toContain("28.01 | 28-010 | ");
    expect(visibleProblems(txt)).toEqual([]);
    expect(HOST_DISPLAY_BLOCK).toContain("line no., cost code, division");
    expect(SOV_DELIVERY_BLOCK).toContain("Never replace the cost code with the item number");
  });
  it("2. money always with cents", () => {
    expect(txt.trim().split("\n").pop()).toBe("Total | | | Contract sum | $1,400,000.00 | 100.00%");
    expect(sovLineRows(sov)[0].scheduled_value_display).toBe("$700,000.00");
    expect(HOST_DISPLAY_BLOCK).toContain(MONEY_CENTS_RULE);
    expect(MONEY_CENTS_RULE).toContain("never drop the .00");
    expect(src("./tools/workflow-tools.ts")).toContain(
      "contract_total_display: money(sov.summary.contract_total)",
    );
  });
  it("3. delivery question is a required next step, Claude included", () => {
    expect(SOV_DELIVERY_BLOCK).toContain(SOV_DELIVERY_ASK);
    expect(SOV_DELIVERY_BLOCK).toContain(SOV_DELIVERY_REQUIRED);
    expect(SOV_DELIVERY_REQUIRED).toContain(
      "End every SOV reply with the delivery question above, word for word",
    );
    expect(src("./index.ts")).toContain(
      "End every SOV reply with the delivery question from the result, word for word.",
    );
  });
  it("4. explicit chart palette, never red/rose/pink/orange", () => {
    expect(CHART_PALETTE[0]).toBe("#2563EB");
    expect(HOST_DISPLAY_BLOCK).not.toContain(CHART_PALETTE_RULE);
    expect(CHART_PALETTE_RULE).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(CHART_PALETTE[0]).toBe("#2563EB");
  });
  it("5. date sweep never on report, only when asked or at job open", () => {
    const g = src("./guard.ts");
    expect(g).toContain("(fresh.data === true || o.sweep === true)");
    expect(g).toContain('const NEVER_SWEEP = new Set(["report"]);');
    expect(HOST_DISPLAY_BLOCK).toContain(DATE_SWEEP_RULE);
    expect(src("./index.ts")).not.toContain("always on report and list_open_items");
  });
  it("version is 0.8.6", () => expect(ATHENA_VERSION).toBe("0.8.18"));
});
