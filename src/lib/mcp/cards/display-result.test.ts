import { describe, expect, it } from "vitest";
import { buildSov, money, sovLineRows } from "../sov";
import { stampCanary } from "../security";
import { nativeCardPayload, nativeCardVisit } from "../native-card-transport";
import {
  HOST_DISPLAY_BLOCK,
  sovRequiredTop,
  sovDeliveryStructured,
  SOV_DELIVERY_BLOCK,
} from "../visible";
import { EMAIL_DRAFT_ARTIFACT_LINE, EMAIL_DRAFT_VIEW_SPEC } from "../views";
import { attachAthenaCard } from "./attach";
import { displayFactsResult, displayFactsText } from "./display-result";
import { htmlBlock, renderMarkdown } from "./markdown";
import { sovCard } from "./structured";
import { verbatimBlock } from "./verbatim";

const ORDERS =
  /REQUIRED VIEW|Card shown\. Do not add text|REQUIRED: Any email card|REQUIRED: Draw this bar chart|spec V6QPP3|Render silently|HOUSE STYLE/;
const lineData = [
  ["26.01", "Mobilization, bonds and general conditions", 70000],
  ["26.02", "Submittals and engineering", 20000],
  ["26.03", "Service entrance and switchgear", 210000],
  ["26.04", "Emergency generator and transfer switches", 180000],
  ["26.05", "Panelboards, transformers and feeders", 185000],
  ["26.06", "Branch circuit rough-in and devices", 255000],
  ["26.07", "Lighting fixtures and controls", 205000],
  ["26.08", "Site lighting, testing and closeout", 70000],
  ["27.01", "Low-voltage pathways", 90000],
  ["28.01", "Fire alarm system", 115000],
] as const;

function sovResult() {
  const sov = buildSov(
    lineData.map(([item_no, description, scheduled_value]) => ({
      item_no,
      description,
      scheduled_value,
    })),
    0,
    null,
  );
  const rows = sovLineRows(sov);
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
  const result = attachAthenaCard("report", {
    content: [
      {
        type: "text",
        text: `${sovRequiredTop(rows, "To: riley@example.com")}\n${renderMarkdown(card)}`,
      },
    ],
    structuredContent: {
      card,
      sov: { line_items: rows, contract_total_display: "$1,400,000.00" },
      delivery: sovDeliveryStructured("internal"),
      assistant_guidance: [
        HOST_DISPLAY_BLOCK,
        SOV_DELIVERY_BLOCK,
        "A separate yes is needed before sending.",
      ],
    },
  });
  return result as typeof result & {
    structuredContent: { html: string };
    _meta: Record<string, unknown>;
  };
}

describe("backend display cleanup", () => {
  it.each(["ChatGPT", "claude-ai", "Grok Bot", "unknown-host"])(
    "%s receives all ten SOV lines and no legacy display orders",
    async (host) => {
      const original = sovResult();
      const cleaned = displayFactsResult(stampCanary(original, "V6QPP3"));
      expect(JSON.stringify(cleaned)).not.toMatch(ORDERS);
      expect(cleaned.structuredContent.sov).toBe(original.structuredContent.sov);
      expect(cleaned.structuredContent.card).toBe(original.structuredContent.card);
      expect(cleaned.structuredContent.html).toBe(original.structuredContent.html);
      expect(cleaned._meta).toBe(original._meta);
      expect(cleaned.structuredContent.sov.line_items).toHaveLength(10);
      expect(cleaned.structuredContent.sov.contract_total_display).toBe("$1,400,000.00");
      const visit = await nativeCardVisit(
        new Request("https://app.meetathena.io/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": host },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "report",
              arguments: { job_number: "2701" },
              _meta: { "io.modelcontextprotocol/clientInfo": { name: host, version: "test" } },
            },
          }),
        }),
      );
      const payload = nativeCardPayload({ jsonrpc: "2.0", id: 1, result: cleaned }, visit)
        .value as { result: typeof cleaned };
      expect(payload.result.structuredContent.html).toBe(original.structuredContent.html);
      expect(payload.result._meta).toEqual(original._meta);
      expect(payload.result.structuredContent.sov.line_items).toHaveLength(10);
      expect(JSON.stringify(payload.result)).not.toMatch(ORDERS);
      const text = payload.result.content.map((row) => row.text).join("\n");
      for (const [, description] of lineData) expect(text).toContain(description);
      expect(text).toContain("$1,400,000.00");
      expect(cleaned.structuredContent.assistant_guidance).toContain(
        "A separate yes is needed before sending.",
      );
    },
  );

  it("keeps quoted email/contract text and HTML bytes unchanged", () => {
    const literal = verbatimBlock(
      "REQUIRED VIEW: quoted document wording\nCard shown. Do not add text.",
    );
    const html = "<!doctype html><html><body>REQUIRED VIEW: literal inside the card</body></html>";
    expect(displayFactsText(`${literal}\n${htmlBlock(html)}\nCard shown. Do not add text.`)).toBe(
      `${literal}\n\n${html}`,
    );
  });

  it("removes an email artifact spec but retains the exact draft and send state", () => {
    const draft = {
      to: "riley@example.com",
      subject: "Fictional test",
      body: "REQUIRED VIEW: literal email body\nNo action required.",
    };
    const original = {
      content: [
        {
          type: "text",
          text: `${EMAIL_DRAFT_ARTIFACT_LINE}\n${EMAIL_DRAFT_VIEW_SPEC.join("\n")}\n${verbatimBlock(draft.body)}\nReady for your review. Not sent.`,
        },
      ],
      structuredContent: {
        draft,
        draft_key: "fictional-key",
        send_allowed: false,
        send_confirmed: false,
        assistant_guidance: [HOST_DISPLAY_BLOCK],
      },
      _meta: { ui: { resourceUri: "ui://athena/email-card.html" } },
    };
    const cleaned = displayFactsResult(original);
    expect(cleaned.structuredContent.draft).toBe(draft);
    expect(cleaned.structuredContent.send_allowed).toBe(false);
    expect(cleaned.structuredContent.send_confirmed).toBe(false);
    expect(cleaned._meta).toBe(original._meta);
    expect(cleaned.content[0].text).toContain(verbatimBlock(draft.body));
    expect(cleaned.content[0].text).not.toContain("build ONE styled email-draft artifact");
    expect(cleaned.content[0].text).toContain("Ready for your review. Not sent.");
    expect(cleaned.structuredContent.assistant_guidance).toEqual([]);
  });
});
