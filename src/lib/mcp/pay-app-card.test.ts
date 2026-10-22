import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { buildFieldPayApp } from "./superintendent";
import { payAppView, payModel } from "./styled-views";
import { billingForecastCardModel, fieldPayAppCardModel, presentPayApp } from "./pay-app-card";
import { attachAthenaCard, isCardFirstTool } from "./cards/attach";
import { CARD_WIDGET_URI, cardWidgetHtml } from "./cards/widget";
import { paletteViolations } from "./cards/palette";

describe("pay application cards", () => {
  it("renders a checked $1.4M certificate with 10% retainage in both card renderers", () => {
    const app = buildFieldPayApp(
      [{ item_no: "03.01", description: "Concrete", scheduled_value: 1_400_000 }],
      0,
      10,
      [{ item_no: "03.01", pct: 50 }],
      [],
    );
    const model = fieldPayAppCardModel("2701 Harbor", "2026-10-22", app);
    const shown = presentPayApp(model);
    const out = attachAthenaCard("field_pay_app", shown);
    expect(app.retainage).toBe(70_000);
    expect(out.structuredContent.card).toEqual(model);
    expect(out._meta["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
    expect(out.structuredContent.html).toContain("G703 continuation");
    expect(out.structuredContent.html).toContain("$1,400,000.00");
    expect(out.structuredContent.html).toContain("$70,000.00");
    expect(paletteViolations(out.structuredContent.html, false)).toEqual([]);
    const node = { dataset: {}, innerHTML: "" };
    const script = cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
    runInNewContext(script, {
      window: { openai: { toolOutput: out.structuredContent } },
      document: { getElementById: () => node },
    });
    expect(node.innerHTML).toContain("G703 continuation");
    expect(node.innerHTML).toContain("$70,000.00");
    expect(node.innerHTML).toContain("03.01 Concrete");
  });

  it("sums and accumulates cents without floating point drift", () => {
    const model = payModel(
      {
        months: [
          { month: "2026-10", amount: 0.1, kind: "actual" },
          { month: "2026-11", amount: 0.2, kind: "forecast" },
        ],
      },
      0.3,
    );
    expect(model.total).toBe(0.3);
    expect(model.months.at(-1)?.cum).toBe(0.3);
    expect(model.tie).toBe("Forecast total $0.30 = contract $0.30");
  });

  it("shows a failed tie instead of drawing an over-contract forecast", () => {
    const card = billingForecastCardModel(
      "2701",
      payModel(
        { months: [{ month: "2026-10", amount: 1_400_000.01, kind: "forecast" }] },
        1_400_000,
      ),
    );
    expect(card.sections?.some((s) => s.heading === "Monthly billing")).toBe(false);
    expect(card.sections?.find((s) => s.heading === "Tie check")?.rows[0].flag).toBe("risk");
    expect(presentPayApp(card).content[0].text).toContain("off by $0.01");
    expect(
      billingForecastCardModel("2701", payModel(null, null)).sections?.some(
        (s) => s.heading === "Monthly billing",
      ),
    ).toBe(false);
    expect(payAppView({ title: "2701", billing: null, contract: null })).toContain(
      "Contract value Needed",
    );
  });

  it("leaves Gantt, IOR and other living report presentation alone", () => {
    for (const report_type of ["cpm", "ior", "dashboard"]) {
      const result = {
        content: [{ type: "text", text: "Existing report" }],
        structuredContent: { report_type },
      };
      expect(isCardFirstTool("living_report_get", result)).toBe(false);
      expect(attachAthenaCard("living_report_get", result)).toBe(result);
    }
    const shown = presentPayApp(billingForecastCardModel("2701", payModel(null, null)));
    const billing = {
      ...shown,
      structuredContent: { ...shown.structuredContent, report_type: "billing_forecast" },
    };
    expect(isCardFirstTool("living_report_get", billing)).toBe(true);
    expect(attachAthenaCard("living_report_get", billing)._meta["openai/outputTemplate"]).toBe(
      CARD_WIDGET_URI,
    );
  });
});
