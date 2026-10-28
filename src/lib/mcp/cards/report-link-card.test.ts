import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderHtml } from "./html";
import { cardWidgetHtml } from "./widget";
import type { CardModel } from "./model";

const url =
  "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/schedule?t=synthetic&x=1";
const home = url.replace("/schedule?", "/home?");
const card: CardModel = {
  presentation: "report-link",
  state: "result",
  show_state: false,
  title: "A long schedule <script> title",
  job: "2701 – Fictional project",
  sections: [
    {
      heading: "Open",
      kind: "chips",
      rows: [
        { cells: ["Open schedule"], href: url },
        { cells: ["Project home"], href: home },
      ],
    },
    { heading: "Link", kind: "list", rows: [{ cells: ["This link works until Nov 1, 2026."] }] },
  ],
};

function widget(cardModel: CardModel): string {
  const node = { dataset: {}, innerHTML: "" };
  runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
    window: { openai: { toolOutput: { card: cardModel } } },
    document: { getElementById: () => node },
  });
  return node.innerHTML;
}

describe("report link presentation", () => {
  it.each([renderHtml, widget])(
    "preserves signed destinations and expiry without redundant headings",
    (render) => {
      const html = render(card);
      expect(html).toContain("A long schedule &lt;script&gt; title");
      expect(html).toContain("2701 – Fictional project");
      expect(html).toContain(url.replace("&", "&amp;"));
      expect(html).toContain(home.replace("&", "&amp;"));
      expect(html).toContain("This link works until Nov 1, 2026.");
      expect(html).not.toContain("<h2>Open</h2>");
      expect(html).not.toContain("<h2>Link</h2>");
      expect(html).not.toContain("<script> title");
    },
  );

  it.each([renderHtml, widget])(
    "does not invent metrics, statuses, dates, or destinations",
    (render) => {
      const html = render({ presentation: "report-link", state: "result", title: "Schedule" });
      expect(html).not.toMatch(/Approved|Draft|Overdue|Unknown|Data date|Project home/);
      expect(html).not.toContain("<a href=");
    },
  );

  it.each([renderHtml, widget])("keeps an explicitly unknown value visible", (render) => {
    const html = render({ ...card, kpis: [{ label: "Status", value: "Unknown" }] });
    expect(html).toContain("Unknown");
    expect(html).not.toContain("Approved");
  });

  it("provides responsive layout and visible keyboard focus", () => {
    const html = renderHtml(card);
    expect(html).toContain("@media(max-width:520px)");
    expect(html).toContain("min-height:44px");
    expect(html).toContain(":focus-visible");
    expect(html).toContain("overflow-wrap:anywhere");
  });
});
