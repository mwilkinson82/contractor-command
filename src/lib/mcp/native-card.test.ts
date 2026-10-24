import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { nativeCardHtml } from "./cards/native";
import { attachAthenaCard } from "./cards/attach";
import { cardWidgetMeta } from "./cards/widget";
import { openItemsCard } from "./open-feed";

function view() {
  const sent: { data: Record<string, unknown>; origin: string }[] = [];
  const clicks = new Map<string, (event: unknown) => void>();
  const app = { textContent: "Loading", replaceChildren() {}, contains: (node: { inside?: boolean }) => node.inside !== false,
    addEventListener: (name: string, cb: (event: unknown) => void) => clicks.set(name, cb),
    removeEventListener: (name: string) => clicks.delete(name) };
  const notice = { textContent: "" };
  const parent = { postMessage(data: Record<string, unknown>, origin: string) { sent.push({ data, origin }); } };
  let receive: (event: unknown) => void = () => {};
  let removed = false;
  const window = { parent, addEventListener(_type: string, cb: typeof receive) { receive = cb; }, removeEventListener() { removed = true; } };
  const document = { getElementById(id: string) { return id === "link-notice" ? notice : app; }, body: { getBoundingClientRect: () => ({ width: 640, height: 500 }) } };
  const script = nativeCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, { window, document, URL });
  const message = (data: unknown, source: unknown = parent, origin = "https://host.example.com") => receive({ data, source, origin });
  const click = (href: string, inside = true) => {
    let prevented = false;
    const anchor = { inside, getAttribute: () => href };
    clicks.get("click")?.({ target: { closest: () => anchor }, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { sent, app, notice, message, click, removed: () => removed };
}

describe("native card view lifecycle", () => {
  it("opens the 03 30 00-001 uploader with its encoded number, board key and upload destination intact", () => {
    const v = view();
    v.message({ jsonrpc: "2.0", id: 1, result: {} });
    const href = "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/submittal/03%2030%2000-001?t=fixture&upload=1#upload";
    v.click(href);
    expect(v.sent.at(-1)?.data).toMatchObject({ method: "ui/open-link", params: { url: href } });
    expect(v.sent.filter((m) => m.data.method === "ui/open-link")).toHaveLength(1);
  });
  it("opens exact signed package and record links through the initialized host instead of a sandbox popup", () => {
    const v = view();
    const href = "https://app.meetathena.io/r/job/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/submittal/QA?" +
      "t=fictional-key&open=package&package_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    v.click(href);
    expect(v.sent).toHaveLength(1); // No navigation request before the parent handshake.
    v.message({ jsonrpc: "2.0", id: 1, result: {} });
    expect(v.click(href)).toBe(true);
    expect(v.sent.at(-1)).toMatchObject({ origin: "https://host.example.com", data: { id: 2, method: "ui/open-link", params: { url: href } } });
    const record = href.split("&open=")[0];
    v.click(record);
    expect(v.sent.at(-1)?.data).toMatchObject({ id: 3, method: "ui/open-link", params: { url: record } });
    v.message({ jsonrpc: "2.0", id: 11, method: "ui/resource-teardown" });
    const count = v.sent.length;
    v.click(record);
    expect(v.sent).toHaveLength(count);
  });
  it("does not open off-origin, executable, malformed or out-of-card links", () => {
    const v = view();
    v.message({ jsonrpc: "2.0", id: 1, result: {} });
    const count = v.sent.length;
    for (const href of ["javascript:alert(1)", "https://app.meetathena.io.evil.example/r/job/x", "https://evil.example/r/job/x", "https://user@app.meetathena.io/r/job/x", "https://app.meetathena.io/login", "not a URL"])
      expect(v.click(href)).toBe(true);
    expect(v.click("https://app.meetathena.io/r/job/x", false)).toBe(false);
    expect(v.sent).toHaveLength(count);
  });
  it("shows a host denial without replacing the card or trusting other origins", () => {
    const v = view();
    v.message({ jsonrpc: "2.0", id: 1, result: {} });
    v.click("https://app.meetathena.io/r/job/x");
    v.message({ jsonrpc: "2.0", id: 2, result: { isError: true } }, undefined, "https://evil.example");
    expect(v.notice.textContent).toBe("");
    v.message({ jsonrpc: "2.0", id: 2, result: { isError: true } });
    expect(v.notice.textContent).toContain("host could not open");
    expect(v.app.textContent).toBe("Loading");
    v.click("https://app.meetathena.io/r/job/x");
    expect(v.notice.textContent).toBe("");
    v.message({ jsonrpc: "2.0", id: 3, error: { code: -32000 } });
    expect(v.notice.textContent).toContain("host could not open");
  });
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
  it.each([{}, { protocolVersion: "2025-06-18" }, { protocolVersion: "2026-07-28" }])("accepts a successful initialization result without requiring one protocol version: %j", (result) => {
    const v = view();
    v.message({ jsonrpc: "2.0", id: 1, result });
    expect(v.sent[1].data.method).toBe("ui/notifications/initialized");
    expect(v.sent[2].data.method).toBe("ui/notifications/size-changed");
  });
  it("ignores initialization errors, unrelated replies, and missing results", () => {
    const v = view();
    for (const reply of [{ id: 1, error: { code: -32603 } }, { id: 2, result: {} }, { id: 1 }]) v.message({ jsonrpc: "2.0", ...reply });
    expect(v.sent).toHaveLength(1);
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
