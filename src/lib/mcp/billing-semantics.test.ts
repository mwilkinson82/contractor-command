import { describe, expect, it } from "vitest";
import { safeBillingView } from "./billing-semantics";
import { payModel } from "./styled-views";
import { billingForecastCardModel, presentPayApp } from "./pay-app-card";

describe("billing evidence boundaries", () => {
  // These need an authoritative issued-invoice/receipt source before they can
  // assert real billed-but-unpaid and partially paid amounts end to end.
  it.todo("shows a source-backed issued invoice as billed while unpaid");
  it.todo("shows source-backed partial payment separately from issued billing");

  it("keeps unknown billing and payments distinct from earned work", () => {
    const input = { billed_to_date: null, earned_from_dailies: 700, earned_from_schedule: 500,
      payments_received: null, months: [{ month: "2026-10", amount: 1000, kind: "forecast" as const }] };
    const model = payModel(input, 1000);
    expect(model.billed).toBeNull();
    expect(model.payments).toBeNull();
    expect(model.earnedDaily).toBe(700);
    expect(model.earnedSchedule).toBe(500);
    expect(model.left).toBeNull();
    expect(payModel(null, null).forecast).toBeNull();
    const shown = presentPayApp(billingForecastCardModel("TEST", model)).content[0].text;
    expect(shown).toContain("Billed to date");
    expect(shown).toContain("Payments received");
    expect(shown).toContain("Unknown");
    expect(shown).toContain("Earned progress from dailies");
  });

  it.each([0, 125])("does not treat unproven legacy billing or payment %s as actual", (payment) => {
    const original = { billed_to_date: 400, payments_received: payment,
      months: [{ month: "2026-10", amount: 400, kind: "actual" }, { month: "2026-11", amount: 600, kind: "forecast" }] };
    const safe = safeBillingView(original);
    expect(safe.billed_to_date).toBeNull();
    expect(safe.payments_received).toBeNull();
    expect(safe.unverified_billed_to_date).toBe(400);
    expect(safe.months[0].kind).toBe("unverified");
    expect(safeBillingView(safe)).toEqual(safe);
    expect(original.billed_to_date).toBe(400);
    const model = payModel(safe as never, 1000);
    expect(model.billed).toBeNull();
    expect(model.payments).toBeNull();
    expect(model.total).toBe(1000);
    expect(model.months[0].kind).toBe("unverified");
  });
});
