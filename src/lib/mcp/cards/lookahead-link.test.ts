import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { attachAthenaCard } from "./attach";
import { cardWidgetHtml } from "./widget";
import { emptyCard, lookaheadView } from "../styled-views";
import { signedJobUrl } from "../board-url";
import type { CardModel } from "./model";

const JOB = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(43);
const href = `${signedJobUrl("lookahead", JOB, TOKEN)}&utm_source=chatgpt.com#item-1`;

function result(url: string, prefix = "2701 – ") {
  // The real report tool prefixes the lookahead view with the job number.
  const text =
    prefix +
    lookaheadView({
      title: "2701 Harbor",
      ref: "LA-TEST",
      start: "2026-10-26",
      end: "2026-11-06",
      today: "2026-10-22",
      dataDate: "2026-10-19",
      acts: [],
      items: [],
      pageUrl: url,
    });
  return attachAthenaCard("report", { content: [{ type: "text", text }] }) as unknown as {
    content: { text: string }[];
    structuredContent: { card: CardModel; html: string };
  };
}

function assertAddress(html: string) {
  const anchor = html.match(/<a href="([^"]+)">Open live lookahead<\/a>/);
  expect(anchor).not.toBeNull();
  const url = new URL(anchor![1].replace(/&amp;/g, "&"));
  expect(url.origin).toBe("https://app.meetathena.io");
  expect(url.pathname).toBe(`/r/job/${JOB}/lookahead`);
  expect(url.searchParams.get("t")).toBe(TOKEN);
  expect(url.searchParams.get("utm_source")).toBe("chatgpt.com");
  expect(url.hash).toBe("#item-1");
  expect(html).not.toContain("/r/job/ /lookahead");
  expect(html).not.toContain("/r/job/%20/lookahead");
}

describe("lookahead report card link", () => {
  it.each(["2701 – ", ""])(
    "preserves the job UUID and key with prefix %j in every renderer",
    (prefix) => {
      const shown = result(href, prefix);
      expect(shown.structuredContent.card.sections?.[0].rows[0]).toEqual({
        cells: ["Open live lookahead"],
        href,
      });
      expect(shown.content[0].text).toContain(`[Open live lookahead](${href})`);
      assertAddress(shown.structuredContent.html);
      const node = { dataset: {}, innerHTML: "" };
      runInNewContext(cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
        window: { openai: { toolOutput: shown.structuredContent } },
        document: { getElementById: () => node },
      });
      assertAddress(node.innerHTML);
    },
  );

  it("keeps a valid stable address available for email-code recovery without inventing a key", () => {
    const url = `https://app.meetathena.io/r/job/${JOB}/lookahead`;
    const row = result(url).structuredContent.card.sections?.[0].rows[0];
    expect(row).toEqual({ cells: ["Open live lookahead"], href: url });
  });

  it("also preserves the live board link when the lookahead has no saved schedule", () => {
    const shown = attachAthenaCard("report", {
      content: [
        {
          type: "text",
          text:
            "2701 – " +
            emptyCard("lookahead", "2701 Harbor", "Send the schedule export.", [], href),
        },
      ],
    }) as unknown as { structuredContent: { html: string } };
    assertAddress(shown.structuredContent.html);
  });

  it.each([
    "https://app.meetathena.io/r/job/ /lookahead",
    "https://app.meetathena.io/r/job/%20/lookahead",
    `https://other.example.com/r/job/${JOB}/lookahead`,
    `https://app.meetathena.io:444/r/job/${JOB}/lookahead`,
    `https://member@app.meetathena.io/r/job/${JOB}/lookahead`,
    `https://app.meetathena.io/r/job/${JOB}/lookahead/extra`,
  ])("does not turn an invalid board address into a clickable card link: %s", (url) => {
    const card = result(url).structuredContent;
    expect(card.card.sections?.[0].rows[0]).toEqual({
      cells: ["Lookahead board link unavailable."],
    });
    expect(card.html).not.toContain("<a href=");
  });
});
