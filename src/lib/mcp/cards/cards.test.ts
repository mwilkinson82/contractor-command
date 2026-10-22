import { describe, expect, it } from "vitest";
import { inferCard } from "./infer";
import { attachAthenaCard } from "./attach";
import { CARD_SHOWN, CARD_SHOWN_PICK } from "./silence";
import { CARD_WIDGET_URI, cardWidgetHtml } from "./widget";
import { renderHtml } from "./html";
import { renderMarkdown } from "./markdown";
import { plainLabel } from "../plain-label";
import type { CardModel } from "./model";

const states: CardModel["state"][] = ["intake", "progress", "ask", "result"];

describe("plain names and detail links", () => {
  const before = "Overdue Oct 14, #8, #A4634D";
  const job = "11111111-1111-4111-8111-111111111111";
  const href = `https://app.meetathena.io/r/job/${job}/items#item-8`;

  it("drops raw codes from the label and keeps the title", () => {
    expect(plainLabel(before).label).toBe("Overdue Oct 14");
    expect(plainLabel(before).label).not.toContain("#A4634D");
    expect(plainLabel(before).label).not.toContain("#8");
  });

  it("links the item in the widget html and the markdown fallback", () => {
    const card: CardModel = {
      state: "result",
      title: "Open items",
      sections: [{ heading: "Items", kind: "list", rows: [{ cells: ["Inspection", "City of Harbor", before], href, refId: "8", flag: "overdue" }] }],
    };
    const html = renderHtml(card);
    const md = renderMarkdown(card);
    expect(html).toContain(`<a href="${href}">`);
    expect(html).toContain("Inspection");
    expect(html).toContain("City of Harbor");
    expect(html).not.toContain("#A4634D");
    expect(html).toContain('data-id="8"');
    expect(md).toContain(`[Inspection · City of Harbor · Overdue Oct 14](${href})`);
    expect(md).not.toContain("#A4634D");
    expect(cardWidgetHtml()).toContain("<a href=");
  });
});

describe("four card states", () => {
  it("renders intake, progress, ask, and result", () => {
    for (const state of states) {
      const html = renderHtml({ state, title: state, ask: state === "ask" ? { prompt: "What is missing?" } : null, progress: { done: 1, total: 4 } });
      expect(html).toContain("<!doctype html>");
      expect(html).toContain(`data-state="${state}"`);
    }
  });
});

describe("PM tools become cards", () => {
  it("next_question before was a plain question and after is an ask card", () => {
    const before = "2701 – Setup question 3 — 4 more after this (Pay terms) [Contract]\nQuestion ref: pay-terms\n\nWhat are the pay terms?";
    const after = attachAthenaCard("next_question", { content: [{ type: "text", text: before }] }) as unknown as {
      content: { text: string }[];
      structuredContent: { card: CardModel; html: string };
      _meta: Record<string, string>;
    };
    expect(before.startsWith("2701")).toBe(true);
    expect(after.structuredContent.card.state).toBe("ask");
    expect(after.structuredContent.card.ask?.prompt).toContain("What are the pay terms?");
    expect(after.structuredContent.card.progress).toEqual({ done: 3, total: 7 });
    expect(after.content[0].text).toContain("## 🔵 Next question");
    expect(after.content[0].text).toContain(before);
    expect(after.content[0].text).toContain("REQUIRED VIEW: render this HTML card as-is.");
    expect(after.structuredContent.html).toContain("What are the pay terms?");
    expect(after._meta["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
  });

  it("contract_terms paints the liquidated damages clause itself red and keeps every line inside the card", () => {
    const before = [
      "2701 – CONTRACT CLAUSES (exact contract text)",
      "- §6.3 Liquidated Damages: ‹$500 per day› (document)",
      "- §4.1 Payment: ‹Net 30› (document)",
      "Applicability:",
      "- has lds: ON",
      "- has retainage: ON",
      "- Missing: claim notice (open item asks to confirm it)",
      "Do you want me to summarize this legal text so you know what it means in plain English?",
    ].join("\n");
    const after = attachAthenaCard("contract_terms", {
      content: [{ type: "text", text: before + "\n\n---\nAthena powered by ALP, construction agents" }],
      structuredContent: { flags: [{ flag: "has_lds", value: "ON" }, { flag: "has_retainage", value: "ON" }], contract_clauses: [] },
    }) as unknown as { content: { text: string }[]; structuredContent: { card: CardModel; html: string } };
    const clauses = after.structuredContent.card.sections?.find((s) => s.heading === "Clauses")?.rows ?? [];
    expect(clauses.find((r) => r.cells[0].includes("§6.3"))?.flag).toBe("risk");
    expect(clauses.find((r) => r.cells[0].includes("§4.1"))?.flag).toBeNull();
    expect(after.structuredContent.html).toContain('data-alert="risk"');
    expect(after.structuredContent.html).toContain('<div class="flag-head">Risk</div>');
    expect(after.structuredContent.html).toContain("border:2px solid #DC2626");
    expect(after.structuredContent.html).toContain("- §6.3 Liquidated Damages");
    expect(after.structuredContent.html).not.toContain('data-alert="risk">- §4.1');
    expect(after.structuredContent.card.sections?.some((s) => s.heading === "Incomplete terms")).toBe(true);
    expect(after.structuredContent.card.ask?.prompt).toContain("Do you want me to summarize");
    expect(after.content[0].text).toContain("- §6.3 Liquidated Damages");
    expect(after.content[0].text).toContain("Incomplete terms");
    expect(after.content[0].text.trim().endsWith(CARD_SHOWN)).toBe(true);
    const beforeClose = after.content[0].text.trim().slice(0, -CARD_SHOWN.length).trim();
    const fence = beforeClose.lastIndexOf("```");
    expect(beforeClose.slice(fence + 3).trim()).toBe("");
    expect(beforeClose.endsWith("```")).toBe(true);
    expect(after.content[0].text).not.toContain("Athena powered by ALP");
    expect(after.content[0].text).not.toMatch(/\nDisplay: blue/);
  });

  it("list_open_items cards the company list and the item list", () => {
    const companies = "No job named. Your companies and jobs:\n- Harbor Electric: 2701 (Harbor Point)\nWhich job should I list open items for?";
    const companyCard = attachAthenaCard("list_open_items", { content: [{ type: "text", text: companies }] }) as unknown as { content: { text: string }[]; structuredContent: { card: CardModel } };
    expect(companyCard.structuredContent.card.state).toBe("ask");
    expect(companyCard.structuredContent.card.title).toBe("Which job?");
    expect(companyCard.content[0].text.startsWith("## 🔵 Which job?")).toBe(true);
    expect(companyCard.content[0].text).toContain("Harbor Electric: 2701");
    expect(companyCard.content[0].text.trim().endsWith(CARD_SHOWN_PICK)).toBe(true);
    const items = "2701 – Open items (2):\n- OVERDUE storm delay\n- Buy the gear";
    const itemCard = attachAthenaCard("list_open_items", { content: [{ type: "text", text: items }] }) as unknown as { structuredContent: { card: CardModel; html: string }; content: { text: string }[] };
    expect(itemCard.structuredContent.card.state).toBe("result");
    expect(itemCard.structuredContent.card.show_state).toBe(false);
    expect(itemCard.structuredContent.html).not.toContain(">Result<");
    expect(itemCard.structuredContent.card.alerts?.[0].level).toBe("overdue");
    expect(itemCard.structuredContent.html).toContain('data-alert="overdue"');
    expect(itemCard.content[0].text).toContain("OVERDUE storm delay");
    expect(itemCard.content[0].text).toContain("Buy the gear");
    expect(itemCard.structuredContent.card.kpis?.find((k) => k.label === "Open items")?.value).toBe("2");
  });

  it("does not nest an HTML card inside a Result list item", () => {
    const nested = inferCard("report", "2701 – Harbor\n<!doctype html><html><style>body{background: ;color: ;}</style><body>card</body></html>", {});
    const cells = nested.sections?.flatMap((section) => section.rows.flatMap((row) => row.cells)) ?? [];
    expect(cells.join(" ")).not.toMatch(/<!doctype|<html|background:/i);
    expect(nested.title).not.toBe("Result");
  });
});
