import { describe, expect, it } from "vitest";
import { attachAthenaCard } from "./attach";
import { CARD_WIDGET_URI } from "./widget";
import { renderHtml } from "./html";
import type { CardModel } from "./model";

const states: CardModel["state"][] = ["intake", "progress", "ask", "result"];

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
    ].join("\n");
    const after = attachAthenaCard("contract_terms", {
      content: [{ type: "text", text: before + "\n\n---\nAthena powered by ALP, construction agents" }],
      structuredContent: { flags: [{ flag: "has_lds", value: "ON" }, { flag: "has_retainage", value: "ON" }], contract_clauses: [] },
    }) as unknown as { content: { text: string }[]; structuredContent: { card: CardModel; html: string } };
    const clauses = after.structuredContent.card.sections?.find((s) => s.heading === "Clauses")?.rows ?? [];
    expect(clauses.find((r) => r.cells[0].includes("§6.3"))?.flag).toBe("risk");
    expect(clauses.find((r) => r.cells[0].includes("§4.1"))?.flag).toBeNull();
    expect(after.structuredContent.html).toContain('data-alert="risk">- §6.3 Liquidated Damages');
    expect(after.structuredContent.html).not.toContain('data-alert="risk">- §4.1');
    expect(after.content[0].text).toContain("- §6.3 Liquidated Damages");
    expect(after.content[0].text.trim().endsWith("```")).toBe(true);
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
    expect(companyCard.content[0].text.trim().endsWith("```")).toBe(true);
    const items = "2701 – Open items (2):\n- OVERDUE storm delay\n- Buy the gear";
    const itemCard = attachAthenaCard("list_open_items", { content: [{ type: "text", text: items }] }) as unknown as { structuredContent: { card: CardModel; html: string }; content: { text: string }[] };
    expect(itemCard.structuredContent.card.state).toBe("result");
    expect(itemCard.structuredContent.card.alerts?.[0].level).toBe("overdue");
    expect(itemCard.structuredContent.html).toContain('data-alert="overdue"');
    expect(itemCard.content[0].text).toContain(items);
  });
});
