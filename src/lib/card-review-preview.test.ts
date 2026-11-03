import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { emailCardHtml } from "./mcp/cards/email-card";
import { nativeCardHtml } from "./mcp/cards/native";
import {
  CARD_REVIEW_HOST_SCRIPT, CARD_REVIEW_SOURCE, cardReviewFixtures,
  syntheticCardReviewHtml, syntheticCardReviewResponse,
} from "./card-review-preview";

function reviewHost(surface = "email") {
  const posts: any[] = [];
  const listeners: Record<string, () => void> = {};
  const frame = { contentWindow: { postMessage: (m: unknown) => posts.push(m) }, style: { height: "" }, srcdoc: "" };
  const elements: Record<string, any> = {
    "review-data": { textContent: JSON.stringify(cardReviewFixtures()) }, card: frame,
    surface: { value: surface, addEventListener: (name: string, f: () => void) => { listeners[`surface:${name}`] = f; } },
    width: { value: "600", addEventListener: (name: string, f: () => void) => { listeners[`width:${name}`] = f; } },
    stage: { style: { width: "" } }, status: { textContent: "" }, source: { textContent: "" },
  };
  let receive!: (event: unknown) => void;
  const unexpectedNetwork = () => { throw new Error("No preview network operation is allowed"); };
  runInNewContext(CARD_REVIEW_HOST_SCRIPT, {
    document: { getElementById: (id: string) => elements[id] },
    window: { addEventListener: (name: string, f: typeof receive) => { expect(name).toBe("message"); receive = f; } },
    fetch: unexpectedNetwork, XMLHttpRequest: unexpectedNetwork, WebSocket: unexpectedNetwork,
  });
  return { posts, elements, frame, listeners, receive,
    send(method: string, params: unknown = {}, id: number | undefined = 2) {
      receive({ source: frame.contentWindow, data: { jsonrpc: "2.0", method, params, id } });
    },
  };
}

describe("isolated candidate card review", () => {
  it("uses byte-identical candidate renderers with synthetic fixture data", () => {
    const data = cardReviewFixtures();
    expect(data.source).toBe("382d9c16848612450b12dfd1755a9a411b5282c7");
    expect(data.documents.email).toBe(emailCardHtml());
    expect(data.documents.native).toBe(nativeCardHtml());
    expect(data.results.native.structuredContent.html).toBe(data.documents.sov);
    expect(data.documents.sov).toContain('data-presentation="sov"');
    expect(data.documents.sov).toContain("$100,000.00");
    expect(data.results.email.structuredContent.draft.to).toBe("sam@example.invalid");
    expect(data.results.email.structuredContent.draft.attachment).toBe("November-payment-application-v3.pdf");
    expect(data.results.fallback.structuredContent.draft.attachment).toBeNull();
    expect(data.results.fallback.structuredContent.link_fallback.reason).toBe("member_requested_link");
  });

  it("safely embeds renderer script tags inside inert JSON", () => {
    const html = syntheticCardReviewHtml();
    const serialized = html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized).documents.email).toBe(emailCardHtml());
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  it("serves a no-cache, no-network synthetic page through the exact route", async () => {
    const route = readFileSync(new URL("../routes/card-review.ts", import.meta.url), "utf8");
    expect(route).toContain('createFileRoute("/card-review")');
    expect(route).toContain("GET: () => syntheticCardReviewResponse()");
    expect(route).not.toMatch(/POST:|supabase|auth|database|email_confirm/);
    const response = syntheticCardReviewResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'; form-action 'none'");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.text()).toContain("Synthetic preview");
  });

  it("initializes the real attachment view and delivers only synthetic review data", () => {
    const host = reviewHost();
    expect(host.frame.srcdoc).toBe(emailCardHtml());
    expect(host.elements.source.textContent).toContain(CARD_REVIEW_SOURCE);
    host.send("ui/initialize", {}, 1);
    expect(host.posts[0].result.hostCapabilities).toEqual({ serverTools: {}, message: {} });
    host.send("ui/notifications/initialized");
    expect(host.posts[1].params).toEqual(cardReviewFixtures().results.email);
  });

  it.each(["tools/call", "ui/message", "ui/open-link", "unknown/action"])("rejects %s without invoking a real transport", (method) => {
    const host = reviewHost();
    host.send(method, { name: "document_email_delivery", url: "https://app.meetathena.io/" }, 7);
    expect(host.posts).toHaveLength(1);
    expect(host.posts[0]).toMatchObject({ id: 7, result: { isError: true } });
    expect(host.elements.status.textContent).toContain("Nothing was sent, opened or saved");
    expect(JSON.stringify(host.posts)).not.toMatch(/send_confirmed|provider_message_id|approved.*true/);
  });

  it("does not accept requests from another window", () => {
    const host = reviewHost();
    host.receive({ source: {}, data: { jsonrpc: "2.0", method: "tools/call", id: 3 } });
    expect(host.posts).toEqual([]);
  });

  it("switches between actual HTML and MCP Apps SOV views and clamps reported height", () => {
    const host = reviewHost("native");
    expect(host.frame.srcdoc).toBe(nativeCardHtml());
    host.send("ui/notifications/initialized");
    expect(host.posts[0].params).toEqual(cardReviewFixtures().results.native);
    host.send("ui/notifications/size-changed", { height: 50000 });
    expect(host.frame.style.height).toBe("4000px");
    host.elements.surface.value = "sov";
    host.listeners["surface:change"]();
    expect(host.frame.srcdoc).toBe(cardReviewFixtures().documents.sov);
    host.elements.width.value = "375";
    host.listeners["width:change"]();
    expect(host.elements.stage.style.width).toBe("375px");
  });
});
