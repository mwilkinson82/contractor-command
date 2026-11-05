import { describe, expect, it } from "vitest";
import { approvalStatement, choiceTerms } from "./model";

const sel = (difference_cents: number, schedule_days?: number) =>
  choiceTerms(true, { difference_cents, schedule_days }, "USD");

describe("what the customer signs for a package choice", () => {
  it("under contract, the choice approves the change order and states no added time", () => {
    const t = sel(494910);
    expect(t).toEqual({ days: 0, changeOrder: { difference: "+$4,949.10" } });
    expect(
      approvalStatement({
        kind: "selection",
        company: "Willow Creek Electric",
        label: "Track lighting",
        price: "$29,949.10",
        choice: "Best",
        scheduleDays: t.days,
        changeOrder: t.changeOrder,
      }),
    ).toBe(
      "I choose the Best package for Track lighting from Willow Creek Electric and approve it as a change order to my contract for +$4,949.10, as described on this page. No additional time is necessary for this change. I understand that typing my name and confirming with the emailed code is my electronic signature.",
    );
  });

  it("states the added days when the upgrade needs them", () => {
    const t = sel(494910, 3);
    expect(
      approvalStatement({
        kind: "selection",
        company: "Willow Creek Electric",
        label: "Track lighting",
        price: "$29,949.10",
        choice: "Best",
        scheduleDays: t.days,
        changeOrder: t.changeOrder,
      }),
    ).toContain("The additional time necessary for this change is 3 days.");
    expect(sel(0, 1).changeOrder).toEqual({ difference: "$0.00" });
  });

  it("is no change order before a contract, or for the package already in it", () => {
    expect(choiceTerms(false, { difference_cents: 494910 }, "USD").changeOrder).toBeNull();
    expect(sel(0).changeOrder).toBeNull();
  });
});
