import { describe, expect, it } from "vitest";
import { PAY_APP_VIEW_SPEC } from "./views";
import { stripDirectiveText } from "./result-directives";

describe("tool results carry the card, not commands to the model", () => {
  it("drops a pay-app render command and keeps the tie line and the HTML", () => {
    const text = [
      "2701 – Harbor Point",
      "Forecast total $420,000.00 = contract $420,000.00",
      "",
      ...PAY_APP_VIEW_SPEC,
      "",
      "<!doctype html><html><body><h1>Pay app</h1></body></html>",
      "Card shown. Do not add text.",
    ].join("\n");
    const out = stripDirectiveText(text);
    expect(out).toContain("Forecast total $420,000.00 = contract $420,000.00");
    expect(out).toContain("<!doctype html>");
    expect(out).toContain("Pay app");
    expect(out).not.toMatch(/REQUIRED VIEW/i);
    expect(out).not.toMatch(/do not add text/i);
    expect(out).not.toMatch(/build ONE styled card/i);
    expect(out).not.toMatch(/tie line goes on top/i);
    const kept = stripDirectiveText("Your team:\n1. Marshall, Owner, all jobs");
    expect(kept).toContain("1. Marshall, Owner, all jobs");
  });
});
