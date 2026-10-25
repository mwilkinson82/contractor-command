import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verbatimBlock } from "./cards/verbatim";
import { htmlBlock } from "./cards/markdown";
import { NATIVE_CARD_TOOLS } from "./cards/native";
import { CHATGPT_DRAWING_HOSTS, allowedDrawingDownloadUrl } from "./drawing-set";
import {
  nativeCardPayload,
  nativeCardResponse,
  nativeCardVisit,
  relocateGrokInstructionText,
} from "./native-card-transport";
import { EMAIL_TO_LABEL_REQUIRED, finalizeVisible, SOV_DELIVERY_ASK, sovDeliveryAsk, sovRequiredTop } from "./visible";
import { EMAIL_VIEW_SPEC } from "./views";
import { buildSov, money, sovLineRows, sovSummaryText } from "./sov";
import { sovCard } from "./cards/structured";
import { activityIdName } from "./styled-views";
import { phoneLookaheadText } from "./phone-reply";
import { DATA_DATE_FUTURE_ERROR, iorPlainReply, iorSectionsText, resolveDataDate } from "./living";
import { scheduleWindowLabel } from "./styled-views";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import { companyProjectSoftware } from "./scope-defaults";
import { attachAthenaCard } from "./cards/attach";
import { inferCard } from "./cards/infer";
import { displayFactsResult } from "./cards/display-result";
import { presentBrief } from "./morning-brief";
import { presentPayApp } from "./pay-app-card";
import type { CardModel } from "./cards/model";

const HTML =
  '<!doctype html><html><head><style>body{color:#1E5FED}</style></head><body><article class="card">Harbor Point</article></body></html>';
const LEAK = /REQUIRED VIEW|Card shown\. Do not add text|REQUIRED: Any email card/;
const DOCUMENT = /<!doctype html|<html/i;

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
    "Grok Bot %s text hides render orders and the card document",
    async (tool, lead, sov) => {
      const result = reply(lead, sov);
      const { out } = await present("Grok Bot", tool, result);
      expect(out.changed).toBe(true);
      const returned = (out.value as { result: Reply }).result;
      const text = textOf(returned);
      expect(text).not.toMatch(LEAK);
      expect(text).toContain(lead);
      expect(text).not.toMatch(DOCUMENT);
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
    "ChatGPT %s drops the text document and keeps the card fields",
    async (tool, lead, sov) => {
      const result = reply(lead, sov);
      const { out } = await present("ChatGPT", tool, result);
      expect(out.changed).toBe(true);
      const returned = (out.value as { result: Reply }).result;
      const text = textOf(returned);
      expect(text).toContain(lead);
      expect(text).toContain("REQUIRED VIEW: render this HTML card as-is.");
      expect(text).toContain("(spec V6QPP3)");
      expect(text).toContain("Card shown. Do not add text.");
      expect(text).not.toMatch(DOCUMENT);
      expect(returned.structuredContent.html).toBe(HTML);
      expect(returned.structuredContent.assistant_guidance).toBe(result.structuredContent.assistant_guidance);
      expect(returned._meta).toBe(result._meta);
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
    const returned = (out.value as { result: Reply }).result;
    expect(textOf(returned)).not.toMatch(LEAK);
    expect(textOf(returned)).not.toMatch(DOCUMENT);
    expect(returned.structuredContent.html).toBe(HTML);
  });

  it("accepts only the observed ChatGPT drawing storage accounts", () => {
    expect([...CHATGPT_DRAWING_HOSTS]).toEqual([
      "oaisdmntprbrazilsouth.blob.core.windows.net",
      "oaisdmntpreastus2.blob.core.windows.net",
    ]);
    for (const host of CHATGPT_DRAWING_HOSTS) {
      expect(allowedDrawingDownloadUrl(`https://${host}/fictional/permit.pdf?sig=1`)).toBe(true);
      expect(allowedDrawingDownloadUrl(`https://${host.toUpperCase()}/fictional/permit.pdf`)).toBe(true);
      expect(allowedDrawingDownloadUrl(`http://${host}/fictional/permit.pdf`)).toBe(false);
      expect(allowedDrawingDownloadUrl(`https://user:fictional@${host}/fictional/permit.pdf`)).toBe(false);
      expect(allowedDrawingDownloadUrl(`https://${host}:444/fictional/permit.pdf`)).toBe(false);
    }
    expect(allowedDrawingDownloadUrl("https://files.oaiusercontent.com/file-abc?sig=1")).toBe(true);
    for (const host of [
      "oaiexample.blob.core.windows.net",
      "oaisdmntpreastus3.blob.core.windows.net",
      "evil-oaisdmntpre.blob.core.windows.net",
      "oaisdmntpre.blob.core.windows.net.evil.com",
      "contoso.blob.core.windows.net",
    ]) {
      expect(allowedDrawingDownloadUrl(`https://${host}/permit.pdf`)).toBe(false);
    }
    const source = readFileSync(new URL("./drawing-set.ts", import.meta.url), "utf8");
    expect(source).toContain('redirect: "manual"');
    expect(source).not.toMatch(/oai\[a-z0-9\]\*/);
    expect(source).not.toMatch(/\*\.blob\.core\.windows\.net/);
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("oaisdmntpreastus2.blob.core.windows.net");
    expect(doc).toContain("oaiexample.blob.core.windows.net");
    expect(doc).toContain("oaisdmntpreastus3.blob.core.windows.net");
    expect(doc).toContain("evil-oaisdmntpre.blob.core.windows.net");
    expect(doc).toContain("oaisdmntpre.blob.core.windows.net.evil.com");
  });

  it("prints split lookahead activities with their ids", () => {
    expect(activityIdName({ id: "A1110a", name: "Underground conduit rough-in" })).toBe(
      "A1110a – Underground conduit rough-in",
    );
    const text = phoneLookaheadText({
      as_of: "2026-10-21",
      activities: [
        { id: "A1110a", name: "Underground conduit rough-in", start: "2026-10-26", finish: "2026-10-30" },
        { id: "A1110b", name: "Underground conduit rough-in", start: "2026-10-27", finish: "2026-10-31" },
      ],
      items: [],
    });
    expect(text).toContain("A1110a – Underground conduit rough-in");
    expect(text).toContain("A1110b – Underground conduit rough-in");
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("A1110a – Underground conduit rough-in");
  });

  it("defaults a missing data date to today in Manaus and refuses a later one", () => {
    const now = new Date("2026-10-25T03:30:00Z");
    expect(resolveDataDate(undefined, now)).toEqual({ ok: true, dataDate: "2026-10-24" });
    expect(resolveDataDate("2026-10-25", now).ok).toBe(false);
    expect(DATA_DATE_FUTURE_ERROR.endsWith("Nothing was saved.")).toBe(true);
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("America/Manaus");
    expect(doc).toContain("Nothing was saved.");
  });

  it("treats company-profile project software as the setup answer", () => {
    expect(companyProjectSoftware({ project_software: "Procore" })).toBe("Procore");
    expect(companyProjectSoftware({ accounting: "Foundation" })).toBeNull();
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("company profile");
  });

  it("prints saved IOR sections as readable text", () => {
    const text = iorSectionsText({
      risk_allocations: [{ description: "Switchgear delay holds the gear", amount: 10000 }],
      top_three_actions: [{ action: "Price the ceiling conflict" }],
    }).join("\n");
    expect(text).toContain("Switchgear delay holds the gear");
    expect(text).toContain("Price the ceiling conflict");
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("risk allocations");
  });

  it("labels each lookahead window row with its activity id", () => {
    const a = scheduleWindowLabel({
      id: "A1110a",
      name: "Underground conduit & grounding",
      start: "2026-11-02",
      finish: "2026-11-11",
    });
    const b = scheduleWindowLabel({
      id: "A1110b",
      name: "Underground conduit & grounding",
      start: "2026-11-02",
      finish: "2026-11-11",
    });
    expect(a).toBe("A1110a – Underground conduit & grounding, Nov 2 to Nov 11");
    expect(b).toBe("A1110b – Underground conduit & grounding, Nov 2 to Nov 11");
    expect(a).not.toBe(b);
    const card = {
      state: "result" as const,
      title: "14-day lookahead",
      show_state: false,
      sections: [{
        heading: "Schedule activities in this window",
        kind: "table" as const,
        columns: ["Activity", "Start", "Finish"],
        rows: [
          { cells: [a, "2026-11-02", "2026-11-11"] },
          { cells: [b, "2026-11-02", "2026-11-11"] },
        ],
      }],
    };
    const html = renderHtml(card);
    const markdown = renderMarkdown(card);
    expect(html).toContain("A1110a – Underground conduit &amp; grounding, Nov 2 to Nov 11");
    expect(html).toContain("A1110b – Underground conduit &amp; grounding, Nov 2 to Nov 11");
    expect(markdown).toContain(a);
    expect(markdown).toContain(b);
    const phone = phoneLookaheadText({
      as_of: "2026-11-01",
      activities: [
        { id: "A1110a", name: "Underground conduit & grounding", start: "2026-11-02", finish: "2026-11-11" },
        { id: "A1110b", name: "Underground conduit & grounding", start: "2026-11-02", finish: "2026-11-11" },
      ],
      items: [],
    });
    expect(phone).toContain("### Schedule in this window");
    expect(phone).toContain(`- ${a}`);
    expect(phone).toContain(`- ${b}`);
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("Schedule activities in this window");
    expect(doc).toContain("A1110a – Underground conduit & grounding, Nov 2 to Nov 11");
  });

  it("Grok Bot SOV text has one table and keeps options 2 and 3", async () => {
    const lines = [
      ["26.01", "Mobilization, bonds and general conditions", 70_000],
      ["26.02", "Submittals and engineering", 20_000],
      ["26.03", "Service entrance and switchgear", 210_000],
      ["26.04", "Emergency generator and transfer switches", 180_000],
      ["26.05", "Panelboards, transformers and feeders", 185_000],
      ["26.06", "Branch circuit rough-in and devices", 255_000],
      ["26.07", "Lighting fixtures and controls", 205_000],
      ["26.08", "Site lighting, testing and closeout", 70_000],
      ["27.01", "Low-voltage pathways", 90_000],
      ["28.01", "Fire alarm system", 115_000],
    ] as const;
    const sov = buildSov(
      lines.map(([item_no, description, scheduled_value]) => ({ item_no, description, scheduled_value })),
      0,
      null,
    );
    const rows = sovLineRows(sov);
    const brand = {
      company_name: "ALP",
      logo_url: null,
      license_number: null,
      contact_name: null,
      contact_phone: null,
      website: null,
    };
    const summary = sovSummaryText("2701 – ", sov, brand, null, [], "internal", "lines");
    const body = `${sovRequiredTop(rows, "To: riley@example.com")}\n${summary}\n\n${sovDeliveryAsk("internal")}\nFor option 2 or 3:\n${EMAIL_TO_LABEL_REQUIRED}\nTo: riley@example.com\nSend to: Riley Brooks, Project Manager, riley@example.com.\n${EMAIL_VIEW_SPEC.join("\n")}`;
    const card = sovCard({
      job: "2701 · Harbor Point",
      rows,
      divisions: [],
      fee: null,
      totalDisplay: money(sov.summary.contract_total),
      basis: null,
      audience: "internal",
      view: "lines",
    });
    const wired = displayFactsResult(
      finalizeVisible(
        attachAthenaCard("report", {
          content: [{ type: "text", text: body }],
          structuredContent: {
            card,
            sov: { line_items: rows, contract_total_display: "$1,400,000.00" },
            delivery: { ask: SOV_DELIVERY_ASK },
          },
        }),
      ),
    ) as unknown as Reply;
    const before = textOf(wired);
    // Card markdown, server lines, and the HTML document each repeat the first line.
    expect(before.split("26.01").length - 1).toBe(3);
    expect(before).not.toContain("Where do you want this SOV to live?");
    expect(before).toContain("For option 2 or 3:");

    const grok = await present("Grok Bot", "report", wired);
    const grokResult = (grok.out.value as { result: Reply }).result;
    const grokText = textOf(grokResult);
    expect(grokText.split("26.01").length - 1).toBe(1);
    expect(grokText).toContain("2701 – SCHEDULE OF VALUES");
    expect(grokText).not.toContain("## ");
    expect(grokText).toContain("$1,400,000.00");
    expect(grokText).toContain("2. As an Excel file (.xlsx) or a PDF.");
    expect(grokText).toContain("3. As a shared link");
    expect(grokText.indexOf("2. As an Excel file")).toBeLessThan(grokText.indexOf("For option 2 or 3:"));
    expect(grokText).toContain("To: riley@example.com");
    expect(grokText).not.toMatch(DOCUMENT);
    expect(grokText).not.toMatch(LEAK);
    expect(grokResult.structuredContent.html).toBe(wired.structuredContent.html);
    expect(grokResult.structuredContent.card).toBe((wired.structuredContent as { card: unknown }).card);
    expect((grokResult.structuredContent as { sov?: { contract_total_display?: string } }).sov?.contract_total_display).toBe("$1,400,000.00");

    for (const host of ["ChatGPT", "claude-ai"] as const) {
      const other = await present(host, "report", wired);
      const returned = (other.out.value as { result: Reply }).result;
      expect(returned.structuredContent.html).toBe(wired.structuredContent.html);
      expect(returned.structuredContent.card).toBe((wired.structuredContent as { card: unknown }).card);
      expect(textOf(returned).split("26.01").length - 1).toBe(2);
      expect(textOf(returned)).not.toContain("Where do you want this SOV to live?");
    }
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("Grok Bot's SOV text is one table and keeps options 2 and 3");
    expect(doc).toContain("For option 2 or 3:");
  });

  it("keeps a fenced HTML quote and drops the unfenced card document", async () => {
    const quoted = verbatimBlock("<!doctype html><html><body>Literal email example</body></html>");
    const result = reply(`Draft\n\n${quoted}`);
    for (const host of ["Grok Bot", "ChatGPT"]) {
      const { out } = await present(host, "morning_brief", result);
      const text = textOf((out.value as { result: Reply }).result);
      expect(text).toContain("<!doctype html><html><body>Literal email example</body></html>");
      expect(text).not.toContain("Harbor Point");
      expect((out.value as { result: Reply }).result.structuredContent.html).toBe(HTML);
    }
  });

  it("styled card text has no HTML document for morning brief, pay app, lookahead, and living report", async () => {
    const card = (title: string): CardModel => ({
      state: "result",
      show_state: false,
      title,
      job: "2701 – Harbor Point",
      sections: [{ heading: "Schedule", kind: "list", rows: [{ cells: ["A1110a – Underground conduit"] }] }],
      next_move: "Clear the overdue item first.",
    });
    const brief = displayFactsResult(presentBrief(card("Morning brief")));
    const pay = displayFactsResult(presentPayApp(card("G702 · Pay app through 2026-10-21")));
    const lookahead = displayFactsResult(
      attachAthenaCard("lookahead_get", {
        content: [{ type: "text", text: "Saved lookahead\nA1110a – Underground conduit" }],
        structuredContent: { card: card("14-day lookahead"), items: [] },
      }),
    );
    const billing = presentPayApp(card("Pay App & Billing Forecast"));
    const living = displayFactsResult({
      ...billing,
      structuredContent: { ...billing.structuredContent, report_type: "billing_forecast", found: true },
    });
    const cases = [
      ["morning_brief", brief],
      ["field_pay_app", pay],
      ["lookahead_get", lookahead],
      ["living_report_get", living],
    ] as const;
    for (const [tool, wired] of cases) {
      for (const host of ["Grok Bot", "ChatGPT", "claude-ai"] as const) {
        const { out } = await present(host, tool, wired as unknown as Reply);
        const returned = (out.value as { result: Reply }).result;
        const text = textOf(returned);
        expect(returned.structuredContent.html).toMatch(/<!doctype html/i);
        expect(returned.structuredContent.html).toBe(wired.structuredContent.html);
        expect(returned._meta).toEqual(wired._meta);
        // Claude renders a living report from the text document. It is not a native-card tool.
        if (host === "claude-ai" && tool === "living_report_get") {
          expect(text).toMatch(DOCUMENT);
          continue;
        }
        for (const block of returned.content) {
          if (block.type === "text") expect(block.text).not.toMatch(DOCUMENT);
        }
        expect(text).toContain("2701");
      }
    }
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("Tool `content` text parts do not carry");
    expect(doc).toContain("structuredContent.html");
    expect(doc).toContain("living_report_get");
  });

  it("gives Grok Bot the IOR sections in plain text and leaves the card HTML", async () => {
    const html = "<!doctype html><p>IOR card</p></html>";
    const structuredContent = {
      report_type: "ior",
      html,
      data: { risk_allocations: [{ description: "Switchgear delay holds the gear", amount: 10000 }] },
      board_links: [{ label: "Open IOR", href: "https://app.meetathena.io/r/job/27010000-0000-4000-8000-000000000001/ior" }],
      version: 4,
      data_date: "2026-10-22",
      change_log: [{ version: 4, at: "2026-10-22T12:00:00Z", who: "member", what: "updated risks" }],
    };
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "links only\n\nChange log (latest 5):" }], structuredContent },
    };
    const request = new Request("https://app.meetathena.io/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Grok" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "living_report_get", arguments: { report_type: "ior" } } }),
    });
    const out = nativeCardPayload(payload, await nativeCardVisit(request));
    const text = (out.value as { result: { content: { text: string }[]; structuredContent: { html: string } } }).result.content[0].text;
    expect(text).toContain("Switchgear delay holds the gear");
    expect(text).toContain("Open IOR:");
    expect(text).toContain("Change log (latest 5):");
    expect(text).toContain("updated risks");
    expect((out.value as { result: { structuredContent: { html: string } } }).result.structuredContent.html).toBe(html);
    expect(iorPlainReply(structuredContent)).toContain("Switchgear delay holds the gear");
    const chatgpt = new Request("https://app.meetathena.io/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "ChatGPT" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "living_report_get" } }),
    });
    const chatgptVisit = await nativeCardVisit(chatgpt);
    expect(chatgptVisit).not.toBeNull();
    const chatgptOut = nativeCardPayload(payload, chatgptVisit);
    expect(chatgptOut.changed).toBe(false);
    expect(chatgptOut.value).toBe(payload);
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("Grok Bot's IOR reply includes the sections");
  });

  it("prints the onboarding profile heading once and keeps the card HTML", () => {
    const profile = [
      "Company profile:",
      "Company: Fictional Electric",
      "Company time zone: America/Manaus",
      "Agent name: Athena",
      "Role: prime",
      "Tool stack: project software: Procore",
      "Decision rights: change orders: owner",
      "Default applicability: none",
      "Members: Sam (owner)",
      "Athena v0.8.23",
    ].join("\n");
    const card = inferCard("onboarding", profile);
    const out = attachAthenaCard("onboarding", { content: [{ type: "text", text: profile }] }) as {
      content: { text: string }[];
      structuredContent: { html: string };
    };
    expect(out.structuredContent.html).toBe(renderHtml(card));
    const prose = out.content[0].text.split("<!doctype")[0];
    expect(prose.match(/What I have so far/g)).toEqual(["What I have so far"]);
    expect(prose.match(/Company: Fictional Electric/g)).toEqual(["Company: Fictional Electric"]);
    const doc = readFileSync(new URL("../../../docs/athena-locked-behaviors.md", import.meta.url), "utf8");
    expect(doc).toContain("What I have so far");
  });
});
