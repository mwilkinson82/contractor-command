import { describe, expect, it } from "vitest";
import { verbatimBlock } from "./cards/verbatim";
import { htmlBlock } from "./cards/markdown";
import { NATIVE_CARD_TOOLS } from "./cards/native";
import {
  nativeCardPayload,
  nativeCardResponse,
  nativeCardVisit,
  relocateGrokInstructionText,
} from "./native-card-transport";
import { sovRequiredTop } from "./visible";

const HTML =
  '<!doctype html><html><head><style>body{color:#1E5FED}</style></head><body><article class="card">Harbor Point</article></body></html>';
const LEAK = /REQUIRED VIEW|Card shown\. Do not add text|REQUIRED: Any email card/;

function stampedCard(html: string): string {
  return htmlBlock(html).replace(/^(REQUIRED VIEW:.*)$/m, "$1 (spec V6QPP3)");
}

function replyText(lead: string, html: string, sov = false): string {
  const top = sov
    ? `${sovRequiredTop(
        [{ item_no: "1", cost_code: "26-010", scheduled_value_display: "$1,400,000.00" }],
        "To: pm@example.test",
      )}\n`
    : "";
  return `${top}${lead}\n\n${stampedCard(html)}\n\nCard shown. Do not add text.`;
}

type Reply = {
  content: { type: "text"; text: string }[];
  structuredContent: { html: string; assistant_guidance: string[] };
  _meta: { "openai/outputTemplate": string };
};

function reply(lead: string, sov = false): Reply {
  return {
    content: [{ type: "text", text: replyText(lead, HTML, sov) }],
    structuredContent: { html: HTML, assistant_guidance: ["Keep the delivery question."] },
    _meta: { "openai/outputTemplate": "ui://athena/card.html" },
  };
}

function request(host: string, tool: string, session?: string) {
  const req = new Request("https://app.meetathena.io/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": host,
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: tool,
        arguments: { job_number: "2701" },
        ...(session
          ? {}
          : { _meta: { "io.modelcontextprotocol/clientInfo": { name: host, version: "test" } } }),
      },
    }),
  });
  return req;
}

async function present(host: string, tool: string, result: Reply, session?: string) {
  const payload = { jsonrpc: "2.0", id: 1, result };
  const visit = await nativeCardVisit(request(host, tool, session));
  return { payload, visit, out: nativeCardPayload(payload, visit) };
}

function textOf(result: { content?: { text?: string }[] }): string {
  return (result.content ?? []).map((block) => block.text ?? "").join("\n");
}

function htmlSlice(text: string): string {
  const start = text.indexOf("<!doctype html");
  const end = text.indexOf("</html>");
  return start < 0 || end < 0 ? "" : text.slice(start, end + "</html>".length);
}

const TOOLS = [
  ["contract_terms", "2701 – §6.2 Delay notice: 5 calendar days", false],
  ["report", "2701 – Schedule of values", true],
  ["morning_brief", "From your inbox and calendar", false],
  ["pm_morning", "Morning meeting on job 2701", false],
  ["drawing_markup", "S-100 footing callout", false],
] as const;

describe("locked behaviors", () => {
  it("keeps native card membership unchanged", () => {
    expect(NATIVE_CARD_TOOLS.has("contract_terms")).toBe(true);
    expect(NATIVE_CARD_TOOLS.has("report")).toBe(true);
    expect(NATIVE_CARD_TOOLS.has("morning_brief")).toBe(true);
    expect(NATIVE_CARD_TOOLS.has("pm_morning")).toBe(false);
    expect(NATIVE_CARD_TOOLS.has("drawing_markup")).toBe(false);
  });

  it("leaves a quoted render order inside member text", () => {
    const quoted = verbatimBlock(
      "REQUIRED VIEW: render this HTML card as-is.\nCard shown. Do not add text.",
    );
    const out = relocateGrokInstructionText(
      `${quoted}\n\nREQUIRED VIEW: render this HTML card as-is. (spec V6QPP3)`,
    );
    expect(out.text).toContain(quoted);
    expect(out.text).not.toContain("(spec V6QPP3)");
    expect(out.moved).toEqual(["REQUIRED VIEW: render this HTML card as-is. (spec V6QPP3)"]);
  });

  it.each(TOOLS)(
    "Grok Bot %s text hides render orders and keeps the card HTML",
    async (tool, lead, sov) => {
      const result = reply(lead, sov);
      const { out } = await present("Grok Bot", tool, result);
      expect(out.changed).toBe(true);
      const returned = (out.value as { result: Reply }).result;
      const text = textOf(returned);
      expect(text).not.toMatch(LEAK);
      expect(text).toContain(lead);
      expect(htmlSlice(text)).toBe(HTML);
      expect(returned.structuredContent.html).toBe(HTML);
      expect(returned._meta).toBe(result._meta);
      expect(returned.structuredContent.assistant_guidance[0]).toBe("Keep the delivery question.");
      expect(returned.structuredContent.assistant_guidance.join("\n")).toMatch(
        /REQUIRED VIEW: render this HTML card as-is\..*\(spec V6QPP3\)/,
      );
      expect(returned.structuredContent.assistant_guidance).toContain(
        "Card shown. Do not add text.",
      );
      if (sov) {
        expect(text).toContain("REQUIRED: Draw this bar chart now");
        expect(
          returned.structuredContent.assistant_guidance.some((line) =>
            line.startsWith("REQUIRED: Any email card"),
          ),
        ).toBe(true);
      }
    },
  );

  it.each(TOOLS)(
    "ChatGPT %s stays the original result, card HTML included",
    async (tool, lead, sov) => {
      const result = reply(lead, sov);
      const { payload, out } = await present("ChatGPT", tool, result);
      expect(out.changed).toBe(false);
      expect(out.value).toBe(payload);
      const text = textOf(result);
      expect(text).toContain("REQUIRED VIEW: render this HTML card as-is.");
      expect(text).toContain("(spec V6QPP3)");
      expect(text).toContain("Card shown. Do not add text.");
      expect(htmlSlice(text)).toBe(HTML);
      expect(result.structuredContent.html).toBe(HTML);
      if (sov)
        expect(text).toContain(
          'REQUIRED: Any email card for this SOV shows the literal label "To:"',
        );
    },
  );

  it.each(["contract_terms", "report", "morning_brief"] as const)(
    "Claude %s card HTML is unchanged",
    async (tool) => {
      const result = reply(
        tool === "report" ? "2701 – Schedule of values" : "Harbor Point",
        tool === "report",
      );
      const { out } = await present("claude-ai", tool, result);
      const returned = (out.value as { result: Reply }).result;
      expect(returned.structuredContent.html).toBe(HTML);
      expect(returned._meta).toEqual(result._meta);
      expect(textOf(returned)).not.toContain("<!doctype html");
      expect(textOf(returned)).not.toMatch(/^REQUIRED VIEW/m);
    },
  );

  it("remembers a Grok Bot initialize and still hides the orders", async () => {
    const init = new Request("https://app.meetathena.io/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Grok Bot", version: "1" },
        },
      }),
    });
    await nativeCardResponse(
      Response.json(
        { jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "athena" } } },
        { headers: { "content-type": "application/json", "mcp-session-id": "sess-grok-plain" } },
      ),
      await nativeCardVisit(init),
    );
    const result = reply("S-100 footing callout", true);
    const { out } = await present("test-host", "drawing_markup", result, "sess-grok-plain");
    expect(textOf((out.value as { result: Reply }).result)).not.toMatch(LEAK);
    expect(htmlSlice(textOf((out.value as { result: Reply }).result))).toBe(HTML);
  });
});
