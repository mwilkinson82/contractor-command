import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { attachAthenaCard, CARD_TOOLS } from "./cards/attach";
import { cardHasAlert } from "./cards/model";
import { paletteViolations } from "./cards/palette";
import { presentStyledCard } from "./cards/present";
import { CARD_WIDGET_URI } from "./cards/widget";
import { tieCheck } from "./living";
import { billingForecastCard } from "./pay-app-card";
import { buildFieldPayApp, payAppCardModel } from "./superintendent";
import { payModel } from "./styled-views";
import { renderReportBody } from "../report-pages";

const lines = [
  { item_no: "03.01", description: "Footings", scheduled_value: 1000 },
  { item_no: "03.02", description: "Rebar", scheduled_value: 500 },
];

describe("pay app card", () => {
  it("carries the card, the html, and the widget meta, with cents and no off-palette color", () => {
    const app = buildFieldPayApp(lines, 10, 10, [{ item_no: "03.01", pct: 30 }], []);
    const card = payAppCardModel("2701 – ", "2026-10-21", app);
    const shown = presentStyledCard(card, { period_to: "2026-10-21", pay_app: app, ties: true });
    const text = shown.content[0].text;
    expect(text).toContain("Contract sum: $1,666.67");
    expect(text).toContain("Ties:");
    expect(text).toContain("$300.00");
    expect(shown.structuredContent.card.title).toBe("Pay app");
    expect(shown.structuredContent.card.kpis?.find((k) => k.label === "Contract sum")?.value).toBe("$1,666.67");
    expect(shown.structuredContent.card.sections?.map((s) => s.heading)).toEqual(expect.arrayContaining(["G702", "G703"]));
    expect(shown.structuredContent.html).toContain("<!doctype html>");
    expect(shown.structuredContent.html).toContain("#1E5FED");
    expect(shown.structuredContent.html).toContain("#1E3A5F");
    expect(shown.structuredContent.html).toContain("#6B7280");
    expect(shown.structuredContent.html).not.toContain("#2563EB");
    expect(shown.structuredContent.html).not.toContain("#9CA3AF");
    expect(paletteViolations(shown.structuredContent.html, cardHasAlert(shown.structuredContent.card))).toEqual([]);
    expect(shown._meta["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
    expect("openai/outputTemplate" in shown.structuredContent).toBe(false);
    const kept = attachAthenaCard("field_pay_app", shown);
    expect(kept.structuredContent.card).toMatchObject({ title: "Pay app" });
    expect(kept.structuredContent.html).toContain("G703");
    expect(kept._meta["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
    expect(CARD_TOOLS.has("field_pay_app")).toBe(true);
    expect(CARD_TOOLS.has("living_report_get")).toBe(true);
  });

  it("keeps Doesn't tie exact, and uses red only for that risk", () => {
    const billing = {
      months: [
        { month: "2027-02", amount: 541_384.62, kind: "actual" as const },
        { month: "2027-03", amount: 868_000, kind: "forecast" as const },
      ],
    };
    const contract = 1_400_000;
    const tieLine = tieCheck(1_409_384.62, contract).line;
    const modelTie = payModel(billing, contract).tie;
    expect(tieLine).toBe("Doesn't tie: off by $9,384.62 (over the contract; forecast $1,409,384.62, contract $1,400,000.00).");
    expect(modelTie).toBe("Doesn't tie: forecast $1,409,384.62 vs contract $1,400,000.00, off by $9,384.62");
    const card = billingForecastCard({
      title: "2701 – Harbor",
      version: 2,
      billing,
      contract,
      tieLine,
      activities: [{ id: "A1000", name: "Footings", value: 1000, pct_complete: 30, sov_line: "03.01" }],
    });
    const shown = presentStyledCard(card, { report_type: "billing_forecast", tie: tieLine });
    expect(shown.content[0].text).toContain(tieLine);
    expect(shown.content[0].text).toContain(modelTie!);
    expect(shown.content[0].text).toContain("Tie: Doesn't tie: off by $9,384.62 (over the contract; forecast $1,409,384.62, contract $1,400,000.00).");
    expect(shown.structuredContent.html).toContain("$300.00");
    expect(shown.structuredContent.html).toContain("$700.00");
    expect(shown.structuredContent.html).toContain("G703");
    expect(shown.structuredContent.card.alerts?.[0]?.level).toBe("risk");
    expect(paletteViolations(shown.structuredContent.html, true)).toEqual([]);
    expect(shown.structuredContent.html).toContain("#DC2626");
    expect(shown._meta["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
    expect(shown.structuredContent.html).toContain("<!doctype html>");
    const kept = attachAthenaCard("living_report_get", shown);
    expect(kept.structuredContent.card.sections?.some((s) => s.heading === "G703")).toBe(true);
    expect(kept.structuredContent.html).toContain(tieLine);
    expect(kept._meta["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
  });

  it("draws a tied forecast in navy, blue and gray, with cents and no red", () => {
    const billing = {
      billed_to_date: 0,
      months: [
        { month: "2026-11", amount: 400000, kind: "forecast" as const },
        { month: "2026-12", amount: 1000000, kind: "forecast" as const },
      ],
    };
    const tieLine = tieCheck(1_400_000, 1_400_000).line;
    expect(tieLine).toBe("Forecast total $1,400,000.00 = contract $1,400,000.00");
    const card = billingForecastCard({ title: "2701 – Harbor", billing, contract: 1_400_000, tieLine });
    const html = presentStyledCard(card, {}).structuredContent.html;
    expect(html).toContain("Forecast total $1,400,000.00 = contract $1,400,000.00");
    expect(html).toContain("$400,000.00");
    expect(html).toContain("$1,000,000.00");
    expect(html).toContain("$1,400,000.00");
    expect(html).not.toContain("Doesn't tie");
    expect(paletteViolations(html, false)).toEqual([]);
    expect(html).not.toContain("#DC2626");
    expect(html).toContain("#1E5FED");
  });

  it("leaves the hosted pay app page on its own renderer", () => {
    const before = readFileSync("src/lib/report-pages.ts", "utf8");
    expect(before).toContain("function payAppPageView");
    const html = renderReportBody({
      page: "payapp",
      job_number: "2701",
      report: {
        found: true,
        version: 1,
        contract_total: 1400000,
        data: {
          billing: {
            billed_to_date: 0,
            months: [
              { month: "2026-11", amount: 400000, kind: "forecast" },
              { month: "2026-12", amount: 1000000, kind: "forecast" },
            ],
          },
        },
      },
    });
    expect(html).toContain("Forecast total $1,400,000.00 = contract $1,400,000.00");
    expect(html).toContain("MONTHLY BILLING");
    expect(html).toContain("#2563EB");
  });
});
