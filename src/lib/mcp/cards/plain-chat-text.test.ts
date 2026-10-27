import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import { renderHtml } from "./html";
import type { CardModel } from "./model";
import { phoneHostText } from "../phone-reply";

const href = "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/items#item-8";

describe("plain chat text without decorative circles", () => {
  it("retains statuses, links, values and progress across card sections", () => {
    const card: CardModel = {
      state: "progress",
      title: "Open items",
      progress: { done: 2, total: 4 },
      kpis: [{ label: "Exposure", value: "$1,400.00", flag: "risk" }],
      sections: [
        {
          heading: "Items",
          kind: "list",
          rows: [{ cells: ["Confirm delivery"], href, flag: "overdue" }],
        },
        {
          heading: "Details",
          kind: "chips",
          rows: [
            { cells: ["Owner"], tone: "unknown" },
            { cells: ["Delay notice"], flag: "delay" },
          ],
        },
        {
          heading: "Terms",
          kind: "table",
          columns: ["Item", "Value"],
          rows: [{ cells: ["Liquidated damages", "$500.00"], flag: "risk" }],
        },
        {
          heading: "Notice",
          kind: "list",
          flag: "delay",
          rows: [{ cells: ["Give written notice"], flag: "delay", raw: true }],
        },
        { heading: "Empty", kind: "list", rows: [] },
      ],
      ask: { prompt: "Who will confirm the date?" },
      alerts: [{ level: "risk", text: "Contract notice required" }],
    };
    const original = structuredClone(card);
    const text = renderMarkdown(card);
    expect(text).not.toMatch(/[🔵🔴⚪]/u);
    expect(text).toContain("## Open items");
    expect(text).toContain("**Progress:** 2 of 4\n");
    expect(text).toContain(`Overdue: [Confirm delivery](${href})`);
    expect(text).toContain("Unknown: Owner · Delay notice");
    expect(text).toContain("| Risk: Exposure | $1,400.00 |");
    expect(text).toContain("| Risk: Liquidated damages | $500.00 |");
    expect(text).toContain("### Delay: Notice");
    expect(text).toContain("- **Delay**\nGive written notice");
    expect(text).toContain("Nothing on this card yet.");
    expect(text).toContain("### This question\nWho will confirm the date?");
    expect(text).toContain("Risk: Contract notice required");
    expect(card).toEqual(original);
    expect(renderHtml(card)).toContain('data-alert="overdue"');
    expect(renderHtml(card)).toContain("#DC2626");
  });

  it("does not remove markers that are part of literal or quoted source text", () => {
    const text = renderMarkdown({
      state: "result",
      title: "Contract source",
      sections: [
        {
          heading: "Source",
          kind: "list",
          rows: [
            { cells: ["Literal 🔵 wording"], tone: "literal" },
            { cells: ["Quoted 🔴 wording"], tone: "quote" },
          ],
        },
      ],
    });
    expect(text).toContain("Literal 🔵 wording");
    expect(text).toContain("> Quoted 🔴 wording");
    expect(text.startsWith("## Contract source")).toBe(true);
  });

  it.each(["list_open_items", "lookahead_get"])(
    "keeps phone status groups and linked rows for %s",
    (tool) => {
      const text = phoneHostText(tool, {
        as_of: "2026-10-27",
        card: { state: "result", title: "Items" },
        items: [
          { action: "Confirm delivery", due: "2026-10-26", owner: "Sam", href },
          { action: "Issue notice", due: "2026-11-10", flag: "delay" },
        ],
      })!;
      expect(text).not.toMatch(/[🔵🔴⚪]/u);
      expect(text).toContain("### Overdue");
      expect(text).toMatch(/### Delay(?: \/ risk)? notices/);
      expect(text).toContain("1 overdue");
      expect(text).toContain(`[Confirm delivery.](${href})`);
      expect(text).toContain("Sam, due Oct 26");
      expect(text).toContain("Issue notice");
    },
  );
});
