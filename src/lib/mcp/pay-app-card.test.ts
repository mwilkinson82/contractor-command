import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { buildFieldPayApp } from "./superintendent";
import { payAppView, payModel } from "./styled-views";
import { billingForecastCardModel, fieldPayAppCardModel, presentPayApp } from "./pay-app-card";
import { attachAthenaCard, isCardFirstTool } from "./cards/attach";
import { CARD_WIDGET_URI, cardWidgetHtml } from "./cards/widget";
import { paletteViolations } from "./cards/palette";
import { draftBillingFromSchedule, retainageStepDownLines, type Activity } from "./living";
import { visibleProblems } from "./visible";

function forecastActivity(value: number, start: string, finish: string): Activity {
  return {
    id: "A1000",
    name: "Concrete",
    duration: 20,
    start,
    finish,
    predecessors: [],
    total_float: 0,
    critical: true,
    pct_complete: 0,
    value,
    sov_line: "03.01",
    cost_code: "03-100",
  };
}

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
    expect(shown.structuredContent.html).toContain("Reported vs verified");
    expect(shown.structuredContent.html).toContain("arithmetic tie checks only");
    expect(shown.structuredContent.html).toContain("not been independently verified");
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

  it("draws an unsaved forecast with the draft label, the tie check, and a retainage step-down", () => {
    const contract = 1_400_000;
    const term = "§4.1 10% through 50% completion; 5% thereafter";
    const billing = draftBillingFromSchedule(
      [forecastActivity(contract, "2026-10-01", "2026-10-30")],
      contract,
      0,
    );
    expect(billing).not.toBeNull();
    const cents = billing!.months.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
    expect(cents).toBe(140_000_000);
    expect(billing!.months.every((row) => row.kind === "forecast")).toBe(true);
    const model = payModel(billing, contract);
    expect(model.total).toBe(contract);
    expect(model.tie).toBe("Forecast total $1,400,000.00 = contract $1,400,000.00");
    const lines = retainageStepDownLines(term, contract);
    expect(lines).toEqual([
      "10% through 50% complete ($700,000.00), held $70,000.00.",
      "5% thereafter ($700,000.00), held $35,000.00.",
      "Retainage at completion $105,000.00.",
    ]);
    const card = billingForecastCardModel("2701", model, null, {
      draft: true,
      retainageLines: lines,
    });
    const shown = presentPayApp(card);
    const text = shown.content[0].text;
    expect(text).toContain("Draft, not official");
    expect(text).toContain("Tie check");
    expect(text).toContain("Retainage step-down");
    expect(text).toContain(model.tie!);
    expect(text).toContain("Retainage at completion $105,000.00.");
    expect(text).not.toMatch(/Lovable/i);
    expect(visibleProblems(text)).toEqual([]);
    expect(paletteViolations(shown.structuredContent.html, false)).toEqual([]);
    expect(
      card.sections?.find((section) => section.heading === "Tie check")?.rows[0].flag,
    ).toBeNull();
    const saved = billingForecastCardModel("2701", model);
    expect(saved.sections?.some((section) => section.heading === "Draft, not official")).toBe(false);
    expect(saved.sections?.some((section) => section.heading === "Retainage step-down")).toBe(
      false,
    );
    const split = draftBillingFromSchedule(
      [forecastActivity(1_000, "2026-10-01", "2026-10-15")],
      1_000,
      400,
    );
    expect(split?.months).toEqual([
      { month: "2026-10", amount: 400, kind: "actual" },
      { month: "2026-10", amount: 600, kind: "forecast" },
    ]);
    expect(
      draftBillingFromSchedule([forecastActivity(100, "2026-10-01", "2026-10-15")], contract, 0),
    ).toBeNull();
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
