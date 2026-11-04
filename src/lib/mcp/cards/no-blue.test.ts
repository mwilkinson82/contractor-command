import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderHtml } from "./html";
import { cardWidgetHtml } from "./widget";
import { cardBaseCss } from "./card-style";
import type { CardModel } from "./model";

// Marshall (Nov 4): no blue in Athena's chat cards. Links are dark ink with a quiet underline and
// the action button is a dark ink fill, like the accounting suite's shapes without its blue.
const OLD_BLUE = /#2465CB/i;

const rfiLog: CardModel = {
  state: "result",
  title: "RFI log",
  job: "2810 – Willow Creek",
  sections: [
    {
      heading: "Requests for information",
      kind: "table",
      columns: ["Number", "Title", "State"],
      rows: [
        {
          cells: ["RFI-001 · Revision 0 · T-1", "Track lighting", "Sent"],
          href: "https://app.meetathena.io/r/job/x/submittal/RFI-001",
        },
      ],
    },
    {
      heading: "Live log",
      kind: "chips",
      rows: [
        {
          cells: ["Open live RFI log"],
          href: "https://app.meetathena.io/r/job/x/rfis",
          tone: "action",
        },
      ],
    },
  ],
  next_move: "Open a record.",
};

describe("chat cards carry no blue", () => {
  it("renders links and the action button in dark ink", () => {
    const html = renderHtml(rfiLog);
    expect(html).not.toMatch(OLD_BLUE);
    expect(html).toContain(".card a{color:#183B63;");
    expect(html).toContain(
      ".card .chip.tone-action{border-radius:7px;padding:7px 14px;background:#18314F;color:#FFFFFF;",
    );
    expect(html).toContain('class="chip tone-action"');
  });

  it("keeps the ChatGPT widget and the shared stylesheet free of blue", () => {
    expect(cardWidgetHtml()).not.toMatch(OLD_BLUE);
    expect(cardBaseCss(true)).not.toMatch(OLD_BLUE);
  });

  it("keeps every card source file free of the old blue", () => {
    for (const file of [
      "card-style.ts",
      "responsive.ts",
      "onboarding-style.ts",
      "sov-style.ts",
      "report-link-card.ts",
      "drawing-card.ts",
      "native.ts",
      "widget.ts",
      "html.ts",
    ]) {
      expect(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), file).not.toMatch(
        OLD_BLUE,
      );
    }
  });
});
