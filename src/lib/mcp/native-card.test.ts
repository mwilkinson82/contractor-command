import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { nativeCardHtml } from "./cards/native";
import { attachAthenaCard } from "./cards/attach";
import { cardWidgetMeta } from "./cards/widget";
import { openItemsCard } from "./open-feed";

function view() {
  const sent: { data: Record<string, unknown>; origin: string }[] = [];
  const app = { textContent: "Loading", replaceChildren() {} };
  const parent = { postMessage(data: Record<string, unknown>, origin: string) { sent.push({ data, origin }); } };
  let receive: (event: unknown) => void = () => {};
  let removed = false;
  const window = { parent, addEventListener(_type: string, cb: typeof receive) { receive = cb; }, removeEventListener() { removed = true; } };
  const document = { getElementById() { return app; }, body: { getBoundingClientRect: () => ({ width: 640, height: 500 }) } };
  const script = nativeCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, { window, document });
  const message = (data: unknown, source: unknown = parent, origin = "https://host.example.com") => receive({ data, source, origin });
  return { sent, app, message, removed: () => removed };
}

describe("native card view lifecycle", () => {
  it("negotiates the published Apps protocol and accepts results only from its initialized parent", () => {
    const v = view();
    expect(v.sent[0].data).toMatchObject({ id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appCapabilities: { availableDisplayModes: ["inline"] } } });
    v.message({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-01-26" } }, {});
    expect(v.sent).toHaveLength(1);
    v.message({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-01-26" } });
    expect(v.sent[1]).toMatchObject({ data: { method: "ui/notifications/initialized" }, origin: "https://host.example.com" });
    v.message({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled" }, {}, "https://evil.example.com");
    v.message({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled" }, undefined, "https://evil.example.com");
    expect(v.app.textContent).toBe("Loading");
    v.message({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled" });
    expect(v.app.textContent).toBe("Athena request cancelled.");
    v.message({ jsonrpc: "2.0", id: 10, method: "ui/resource-teardown" });
    expect(v.sent.at(-1)?.data).toMatchObject({ id: 10, result: {} });
    expect(v.removed()).toBe(true);
    expect(v.sent.some(({ data }) => ["tools/call", "sampling/createMessage", "ui/message"].includes(String(data.method)))).toBe(false);
  });
  it("keeps an explicit fallback when the host supplies no card", () => {
    const v = view();
    v.message({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-01-26" } });
    v.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: {} });
    expect(v.app.textContent).toContain("complete reply is available");
  });
  it("retains the server-styled open-items reply and the exact existing ChatGPT outputTemplate", () => {
    const card = openItemsCard("Fictional job", [{ id: "one", action: "Inspect work", owner: "Example PM", due: "2099-01-01" }], { open: 1, overdue: 0, due_in_7_days: 0 }, "2026-10-22");
    const result = attachAthenaCard("list_open_items", { content: [{ type: "text", text: "Inspect work" }], structuredContent: { card } }) as unknown as { content: { text: string }[]; structuredContent: { html: string }; _meta: unknown };
    expect(result._meta).toEqual(cardWidgetMeta);
    expect(result.content[0].text).toContain(result.structuredContent.html);
    expect(result.content[0].text).toContain("<!doctype html");
    expect(result.content[0].text).toContain("#1E5FED");
    expect(result.content[0].text).toContain("#1E3A5F");
    expect(result.content[0].text).toContain("#6B7280");
    expect(result.content[0].text).not.toContain("#DC2626");
    expect(result.content[0].text).toContain("Inspect work");
  });
});
