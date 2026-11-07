import { describe, expect, it } from "vitest";
import { hideAmounts, isMoneyBoardPage, redactMoney } from "./board-redact";

describe("hideAmounts", () => {
  it("drops a bracketed dollar figure", () => {
    expect(hideAmounts("Cabinets damaged on delivery ($20,000 held)")).toBe(
      "Cabinets damaged on delivery",
    );
  });
  it("replaces a loose figure and keeps other numbers", () => {
    expect(hideAmounts("Collect $9,500.25 on job 2717 by 6/28")).toBe(
      "Collect an amount on job 2717 by 6/28",
    );
    expect(hideAmounts("Unpaid $12k retainage")).toBe("Unpaid an amount retainage");
  });
  it("leaves text without money alone", () => {
    expect(hideAmounts("Submit RFI 126 response")).toBe("Submit RFI 126 response");
  });
});

describe("redactMoney", () => {
  it("removes money fields and figures in text but keeps schedule numbers", () => {
    const out = redactMoney({
      page: "schedule",
      report: {
        contract_total: 3410000,
        total_float: 4,
        activities: [{ name: "Rough-in ($9,500 CO)", duration: 5 }],
      },
      items: [{ action: "Review risk ($20,000 held)", amount: 20000, due: "2026-06-28" }],
    });
    expect(out).toEqual({
      page: "schedule",
      report: { total_float: 4, activities: [{ name: "Rough-in", duration: 5 }] },
      items: [{ action: "Review risk", due: "2026-06-28" }],
    });
  });
  it("marks only the IOR and billing forecast as money pages", () => {
    expect(isMoneyBoardPage("ior")).toBe(true);
    expect(isMoneyBoardPage("payapp")).toBe(true);
    expect(isMoneyBoardPage("items")).toBe(false);
    expect(isMoneyBoardPage("schedule")).toBe(false);
  });
});
