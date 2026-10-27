import { describe, expect, it } from "vitest";
import { renderIorLayout } from "./ior-layout";
import { iorHoldSummary } from "./ior-hold-summary";
import { iorPlainReply, iorSectionsText } from "./mcp/living";
import { formatReportNumber } from "./report-format";

const data = {
  kpis: {
    profit_markup: 0.15,
    overhead_markup: "0.15",
    c_hold_total: 0,
    cost_status: "N",
    billing_status: "N",
  },
  budget_variance_method: "Sequential markups: billing = direct budget × 1.15 × 1.15",
  e_holds: [
    {
      id: "e1",
      description: "Synthetic transfer equipment",
      amount: 10000,
      cost_code: "26.10",
      status: "Open",
    },
    {
      id: "e2",
      description: "Synthetic generation equipment",
      amount: "15000",
      cost_code: "26.0100",
      status: "Open",
    },
  ],
  totals: { direct_cost: 1058601.13, profit: 182608.7 },
};

describe("IOR presentation", () => {
  it("formats markup and cost-code identifiers without changing money", () => {
    const html = renderIorLayout({ report: { scope: "full", data } });
    expect(html.match(/15\.0%/g)).toHaveLength(2);
    expect(html).not.toContain("$0.15");
    expect(html).toContain("26.10");
    expect(html).toContain("26.0100");
    expect(html).not.toContain("$26.10");
    expect(html).toContain("$1,058,601.13");
    expect(html).toContain("$182,608.70");
    expect(formatReportNumber("cost_code", 26.01)).toBe("26.01");
    expect(formatReportNumber("profit_markup", 15)).toBe("15.0%");
    expect(formatReportNumber("profit_amount", 0.15)).toBe("$0.15");
  });
  it("presents the method as text and pairs the E list with the saved C total", () => {
    const html = renderIorLayout({ report: { scope: "full", data } });
    expect(html).toContain("Budget Variance Method</span> Sequential markups");
    expect(html).toContain("$25,000.00 · 2 listed");
    expect(html).toContain("C-holds</div><div");
    expect(html).toContain("$0.00");
    expect(html.match(/Synthetic transfer equipment/g)).toHaveLength(1);
    expect(html.match(/Synthetic generation equipment/g)).toHaveLength(1);
    expect(html).toContain("Cost Status</span> N");
    expect(html).toContain("Billing Status</span> N");
  });
  it("formats numeric strings and identifiers in plain text too", () => {
    const text = iorSectionsText(data).join("\n");
    expect(text).toContain("Profit Markup: 15.0%");
    expect(text).toContain("Overhead Markup: 15.0%");
    expect(text).toContain("Listed E-holds: $25,000.00 · 2 listed");
    expect(text).toContain("C-holds: $0.00");
    expect(text).toContain("Cost Code: 26.0100");
    expect(text).toContain("Amount: $15,000.00");
    expect(text).toContain("Cost Status: N");
  });
  it("does not infer missing holds, count duplicates, or conceal conflicting totals", () => {
    expect(iorHoldSummary({})).toBeNull();
    expect(iorHoldSummary({ e_holds: [] })).toBeNull();
    expect(
      iorHoldSummary({ e_holds: [{ amount: 10000 }, { description: "unknown amount" }] }),
    ).toBeNull();
    expect(
      iorHoldSummary({
        e_holds: [
          { id: "x", amount: 10000 },
          { id: "x", amount: 10000 },
        ],
      }),
    ).toBeNull();
    expect(iorHoldSummary({ ...data, e_hold_total: 10000 })).toBeNull();
    const onlyE = iorHoldSummary({ e_holds: [{ amount: 10000 }] });
    expect(onlyE?.contingencyCents).toBeNull();
    const unknown = renderIorLayout({ report: { scope: "full", data: {} } });
    expect(unknown).toContain("Hold summary: Not available");
    expect(unknown).not.toContain("$0.00");
    const partial = { e_holds: [{ amount: 10000 }] };
    expect(renderIorLayout({ report: { scope: "full", data: partial } })).toContain(
      "Not available",
    );
    expect(iorSectionsText(partial).join("\n")).toContain("C-holds: Not available");
    expect(iorSectionsText({ unknown_hold_register: [] }).join("\n")).toContain(
      "Hold summary: Not available",
    );
  });
  it("does not expose financial summaries to restricted views", () => {
    const html = renderIorLayout({
      report: { scope: "contract", contract_total: 1400000, forecast_total: 1400000, data },
    });
    expect(html).not.toContain("$25,000.00");
    expect(html).not.toContain("$1,400,000.00");
    expect(html).not.toContain("15.0%");
    const text = iorPlainReply({ data, no_financials: true });
    expect(text).not.toContain("$25,000.00");
    expect(text).not.toContain("15.0%");
  });
});
