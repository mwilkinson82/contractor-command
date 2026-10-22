import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_TOOLS, attachAthenaCard } from "./attach";
import { NAVY } from "./palette";
import { CARD_WIDGET_URI } from "./widget";
import { CARD_SHOWN, CARD_SHOWN_PICK, sealCardReply } from "./silence";
import { HOST_DISPLAY_BLOCK } from "../visible";

const WHICH_JOB = ["list_open_items", "pm_meeting", "pm_morning", "pm_evening"] as const;
const PREVIEW =
  "I'll pull the overdue items, today's deadlines, upcoming commitments, and what needs your attention first.";

type CardResult = {
  content: { type: string; text?: string }[];
  structuredContent: {
    card: { title: string; state: string };
    html: string;
    which_job?: boolean;
    assistant_guidance: string[];
    "openai/outputTemplate"?: string;
  };
  _meta: Record<string, string>;
};

function assertCardContract(result: CardResult, closing: string) {
  const text = result.content.find((c) => c.type === "text")?.text ?? "";
  expect(text.trim().endsWith(closing)).toBe(true);
  const before = text.trim().slice(0, -closing.length).trim();
  expect(before.endsWith("</html>")).toBe(true);
  expect(before.match(/<!doctype html/gi)).toHaveLength(1);
  expect(before).not.toContain("```html");
  expect(before).not.toContain("&lt;!doctype");
  expect(before).not.toMatch(/[a-z-]+\s*:\s*;/);
  expect(text).not.toContain(PREVIEW);
  expect(text).not.toMatch(/upcoming commitments/i);
  expect(result.content.some((c) => c.type === "resource")).toBe(false);
  expect(JSON.stringify(result)).not.toContain("toolInvocation");
  expect(JSON.stringify(result.content)).not.toContain("skybridge");
  expect(result.structuredContent.card.title.length).toBeGreaterThan(0);
  expect(result.structuredContent.html).toContain(NAVY);
  expect(result.structuredContent.html).toContain("<!doctype html>");
  expect(result.structuredContent["openai/outputTemplate"]).toBeUndefined();
  expect(result._meta["openai/outputTemplate"]).toBe(CARD_WIDGET_URI);
  expect(result.structuredContent.assistant_guidance.at(-1)).toBe(closing);
}

describe("which-job and picker cards end on the pick", () => {
  const companies = [
    "No job named. Your companies and jobs:",
    "- ALP Construction: 1001 (Lakeview Elementary Gym)",
    "Which job should I list open items for?",
    PREVIEW,
  ].join("\n");

  it.each(WHICH_JOB)("%s which-job card waits and does not keep the preview", (tool) => {
    const out = attachAthenaCard(tool, {
      content: [{ type: "text", text: companies }],
    }) as unknown as CardResult;
    assertCardContract(out, CARD_SHOWN_PICK);
    expect(out.structuredContent.which_job).toBe(true);
    expect(out.structuredContent.card.title).toBe("Which job?");
    expect(out.structuredContent.card.state).toBe("ask");
    expect(out.content[0].text).toContain("1001");
    expect(out.content[0].text).toContain("Lakeview Elementary Gym");
    expect(out.content[0].text?.startsWith("## 🔵 Which job?")).toBe(true);
  });

  it("team_list picker uses the same closing and the existing template", () => {
    const out = sealCardReply("team_list", {
      content: [{ type: "text", text: "Your team:\n1. Marshall, Owner, all jobs" }],
      structuredContent: { team: { members: [] } },
      _meta: { "openai/outputTemplate": "ui://athena/team-picker.html" },
    }) as unknown as {
      content: { type: string; text?: string }[];
      structuredContent: { assistant_guidance: string[]; "openai/outputTemplate": string };
      _meta: Record<string, string>;
    };
    expect(out.content[0].text?.trim().endsWith(CARD_SHOWN_PICK)).toBe(true);
    expect(out.content[0].text).toContain("1. Marshall, Owner, all jobs");
    expect(out.content.some((c) => c.type === "resource")).toBe(false);
    expect(JSON.stringify(out.content)).not.toMatch(/<html|<!doctype|<script|skybridge/i);
    expect(JSON.stringify(out)).not.toContain("toolInvocation");
    expect(out._meta["openai/outputTemplate"]).toBe("ui://athena/team-picker.html");
    expect(out.structuredContent["openai/outputTemplate"]).toBe("ui://athena/team-picker.html");
    expect(out.structuredContent.assistant_guidance.at(-1)).toBe(CARD_SHOWN_PICK);
  });
});

describe("every card tool follows the no-trailing-prose contract", () => {
  it.each([...CARD_TOOLS])("%s text ends on the card", (tool) => {
    const pick = (WHICH_JOB as readonly string[]).includes(tool);
    const body = pick ? "2701 – Open items (1):\n- Buy the gear" : "2701 – Detail\n- Item one";
    const out = attachAthenaCard(tool, {
      content: [{ type: "text", text: `${body}\n${PREVIEW}` }],
      structuredContent: tool === "contract_terms" ? { flags: [], contract_clauses: [] } : {},
    }) as unknown as CardResult;
    assertCardContract(out, CARD_SHOWN);
    expect(out.structuredContent.which_job).toBeUndefined();
    expect(out.content[0].text).not.toMatch(/I['’]ll pull the overdue items/);
  });

  it("drops a spoken preview that was sitting under a question card", () => {
    const noisy = [
      "2701 – Setup question 3 — 4 more after this (Pay terms) [Contract]",
      "Question ref: pay-terms",
      "",
      "What are the pay terms?",
      PREVIEW,
    ].join("\n");
    const out = attachAthenaCard("next_question", {
      content: [{ type: "text", text: noisy }],
    }) as unknown as CardResult;
    assertCardContract(out, CARD_SHOWN);
    expect(out.content[0].text).toContain("What are the pay terms?");
  });

  it("seals a card another tool already put on structuredContent", () => {
    const out = sealCardReply("estimate_status", {
      content: [{ type: "text", text: `No estimate on this job yet.\n${PREVIEW}` }],
      structuredContent: { card: { state: "progress", title: "No estimate on this job yet" } },
    }) as {
      content: { type: string; text?: string }[];
      structuredContent: { assistant_guidance: string[] };
    };
    expect(out.content[0].text?.trim().endsWith(CARD_SHOWN)).toBe(true);
    expect(out.content[0].text).not.toContain(PREVIEW);
    expect(out.content.some((c) => c.type === "resource")).toBe(false);
    expect(out.structuredContent.assistant_guidance.at(-1)).toBe(CARD_SHOWN);
  });

  it("leaves a non-card result alone", () => {
    const plain = { content: [{ type: "text", text: "Saved the line." }] };
    expect(sealCardReply("cpm_activities", plain)).toBe(plain);
  });
});

describe("the card instruction is the last word, and the widget is unchanged", () => {
  it("tells the host that an Athena card allows no lines after it", () => {
    expect(HOST_DISPLAY_BLOCK).toContain("This limit does not apply to an Athena card.");
    expect(HOST_DISPLAY_BLOCK).toContain(
      "When the result says the card is shown, add no text before or after it.",
    );
    const idx = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(idx).toContain(
      "When a tool result says the card is shown, that card is the whole reply: do not add text after it.",
    );
    expect(idx).toContain("On a which-job or picker card, wait for the user's pick.");
  });

  it("does not inline a skybridge resource or toolInvocation metadata", () => {
    for (const file of [
      "silence.ts",
      "attach.ts",
      "widget.ts",
      "../guard.ts",
      "../widget-bridge.ts",
      "../tools/flow-tools.ts",
    ]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).not.toContain("toolInvocation");
      expect(src, file).not.toMatch(/type:\s*"resource"/);
    }
    expect(readFileSync(new URL("../guard.ts", import.meta.url), "utf8")).toContain(
      "sealCardReply",
    );
  });
});
