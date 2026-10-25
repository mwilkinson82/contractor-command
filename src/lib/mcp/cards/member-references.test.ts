import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { plainLabel, rowPlain } from "../plain-label";
import { renderHtml } from "./html";
import { renderMarkdown } from "./markdown";
import type { CardModel } from "./model";
import { cardWidgetHtml } from "./widget";

function widget(card: CardModel) {
  const app = { dataset: {}, innerHTML: "" };
  runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
    window: { openai: { toolOutput: { card } } },
    document: { getElementById: () => app },
  });
  return app.innerHTML;
}

describe("member-authored construction references", () => {
  const fields = [
    ["Source", "TEST upload #282, delete later"],
    ["Note", "Respond to RFI #12 before CO #3; see Bulletin #4."],
    ["RFI title", "RFI #12 — confirm beam connection"],
    ["Change order title", "CO #3 — revised footing detail"],
    ["Short reference", "#282"],
    ["Long reference", "Bulletin #123456; RFI #12345678"],
    ["Alphanumeric reference", "Detail #A1234D and #ABC"],
  ];

  it.each(fields)(
    "keeps %s in HTML, text fallback and the executed ChatGPT widget",
    (name, value) => {
      const card: CardModel = {
        title: "Job 2701 references",
        state: "result",
        sections: ["table", "list", "chips"].map((kind) => ({
          heading: name,
          kind: kind as "table" | "list" | "chips",
          columns: ["Value"],
          rows: [{ cells: [value], refId: "#f00abc" }],
        })),
      };
      const original = JSON.stringify(card);
      expect(plainLabel(value)).toMatchObject({ label: value, refId: null });
      expect(rowPlain(card.sections![0].rows[0])).toMatchObject({
        label: value,
        refId: "#f00abc",
        secondary: null,
      });
      for (const rendered of [renderHtml(card), renderMarkdown(card), widget(card)]) {
        expect(rendered.split(value)).toHaveLength(4);
        // The internal reference stays hidden; only member-authored references are visible.
        expect(rendered.replace(/data-id="[^"]*"/g, "")).not.toContain("#f00abc");
      }
      expect(JSON.stringify(card)).toBe(original);
    },
  );

  it("escapes member text as inert HTML without losing reference numbers", () => {
    const value = 'RFI #12 <img src=x onerror="alert(1)"> & CO #3';
    const card: CardModel = {
      state: "result",
      title: "References",
      sections: [{ heading: "Notes", kind: "list", rows: [{ cells: [value] }] }],
    };
    for (const html of [renderHtml(card), widget(card)]) {
      expect(html).toContain("RFI #12 &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; CO #3");
      expect(html).not.toContain("<img");
    }
    expect(card.sections![0].rows[0].cells[0]).toBe(value);
  });
});
