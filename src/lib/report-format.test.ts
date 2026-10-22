import { describe, expect, it } from "vitest";
import { formatBillingText, formatMoneyPhrase, formatReportNumber } from "./report-format";

describe("report number format", () => {
  it("shows a margin ratio that currency would round to $0.16 as 16.1%", () => {
    expect(formatReportNumber("budgeted_margin", 0.161)).toBe("16.1%");
    expect(formatReportNumber("amount", 0.161)).toBe("$0.16");
  });

  it("rounds the fully incurred margin ratio to one decimal", () => {
    expect(formatReportNumber("margin_if_fully_incurred", 0.14714285714285713)).toBe("14.7%");
  });

  it("keeps dollar fields in currency and versions as plain numbers", () => {
    expect(formatReportNumber("gross_profit", 226000)).toBe("$226,000.00");
    expect(formatReportNumber("source_cpm_version", 3)).toBe("3");
    expect(formatReportNumber("amount", 10000)).toBe("$10,000.00");
    expect(formatReportNumber("fee_pct", 15)).toBe("15.0%");
    expect(formatReportNumber("pct_complete", 46)).toBe("46.0%");
    expect(formatReportNumber("gp_pct", 0.125)).toBe("12.5%");
    expect(formatReportNumber("total_float", 5.333333)).toBe("5.33");
  });

  it("formats bare billing amounts", () => {
    expect(formatMoneyPhrase("10,000 / 8,000")).toBe("$10,000.00 / $8,000.00");
    expect(formatMoneyPhrase("10000")).toBe("$10,000.00");
    expect(formatBillingText("Planned billing this month 10000. Realistic billing this month 8000.")).toBe(
      "Planned billing this month $10,000.00. Realistic billing this month $8,000.00.",
    );
  });
});
