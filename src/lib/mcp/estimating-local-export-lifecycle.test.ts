import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalBidFiles } from "./estimating-bid-files";
import type { BidBreakdown } from "./estimating-bid";
class Element {
  children: Element[] = []; textContent = ""; disabled = false; href = ""; download = "";
  events = new Map<string, () => void>();
  constructor(public tag: string, private onAnchor: () => void) {}
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  addEventListener(type: string, fn: () => void) { this.events.set(type, fn); }
  click() { if (!this.disabled) { if (this.tag === "a") this.onAnchor(); this.events.get("click")?.(); } }
  remove() {}
  querySelectorAll(tag: string): Element[] { return this.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...c.querySelectorAll(tag)]); }
}
const breakdown: BidBreakdown = { direct: [{ ref: "T-1", basis: "direct", quoteId: null, amountCents: 10000 }], directCents: 10000,
  generalConditions: [], requirements: [], generalConditionsCents: 0, requirementsCents: 0, overheadCents: 0, profitCents: 0, totalCents: 10000 };
const context = { company_id: "company", job_id: "job", job_number: "SYNTHETIC", snapshot_version: 7, source_sha256: "a".repeat(64) };
async function fixture(format: "pdf" | "xlsx") {
  const files = canonicalBidFiles({ job: "Synthetic", version: 7, ready: true, breakdown });
  if (!files) throw Error("Synthetic file unavailable");
  const bytes = files[format];
  return { delivery: "local", filename: `Bid-summary-v7.${format}`, mime_type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: bytes.length, content_base64: Buffer.from(bytes).toString("base64"), sha256: Buffer.from(await webcrypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex"), ...context };
}
export function syntheticExportViewer(permission: "top" | "blocked" | "opaque" = "top", digest = webcrypto.subtle.digest.bind(webcrypto.subtle)) {
  let anchors = 0, anchorFailure = false;
  const make = (tag: string) => new Element(tag, () => { if (anchorFailure) throw Error("blocked"); anchors++; });
  const root = make("root"), status = make("status"), body = make("body");
  let listener: ((event: unknown) => void) | undefined;
  const messages: Array<{ id?: number; method?: string; params?: { arguments?: Record<string, unknown> } }> = [];
  const parent = { postMessage: (message: typeof messages[number]) => messages.push(message) };
  const window: Record<string, unknown> = { parent, top: parent, frameElement: permission === "opaque" ? null : {
    hasAttribute: () => true, sandbox: { contains: () => permission !== "blocked" },
  }, addEventListener: (_type: string, fn: typeof listener) => { listener = fn; } };
  if (permission === "top") window.top = window;
  const urls = new Set<string>(), revoked: string[] = [];
  const source = readFileSync(new URL("./cards/takeoff-client.js", import.meta.url), "utf8");
  runInNewContext(source, { window, document: { getElementById: (id: string) => id === "app" ? root : status, createElement: make, body },
    Blob, Uint8Array, TextDecoder, atob, btoa, crypto: { subtle: { digest } },
    URL: { createObjectURL: () => { const url = `blob:synthetic-${urls.size}`; urls.add(url); return url; }, revokeObjectURL: (url: string) => { urls.delete(url); revoked.push(url); } },
    setTimeout, clearTimeout, Map, Number });
  const send = (message: unknown) => listener?.({ source: parent, origin: "https://synthetic-host.example", data: message });
  send({ jsonrpc: "2.0", id: 1, result: { hostCapabilities: { serverTools: {} }, hostContext: {} } });
  const load = (value: Record<string, unknown> = { local_export_context: context, context, card: { title: "Bid summary", sections: [] } }) =>
    send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: value } });
  load();
  const button = (name: string) => { const found = root.querySelectorAll("button").find((b) => b.textContent === name); if (!found) throw Error(`Missing ${name}`); return found; };
  return { root, status, messages, urls, revoked, anchors: () => anchors, button, load,
    failAnchor: (value: boolean) => { anchorFailure = value; },
    reply: (id: number | undefined, result: unknown) => send({ jsonrpc: "2.0", id, result }),
    teardown: () => send({ jsonrpc: "2.0", id: 99, method: "ui/resource-teardown" }) };
}
const viewer = syntheticExportViewer;
async function flush() { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); }
describe("synthetic complete local-export card lifecycle", () => {
  it.each(["pdf", "xlsx"] as const)("sends the real %s widget request, suppresses repeated clicks, and revokes URLs on teardown", async (format) => {
    const v = viewer(); const prepare = v.button(format === "pdf" ? "Prepare PDF" : "Prepare XLSX");
    prepare.click(); prepare.click();
    const calls = v.messages.filter((m) => m.method === "tools/call"); expect(calls).toHaveLength(1);
    expect(calls[0].params?.arguments).toEqual({ job_number: "SYNTHETIC", company_id: "company", export_format: format, export_delivery: "local", expected_version: 7, expected_source_sha256: context.source_sha256 });
    v.reply(calls[0].id, { structuredContent: { local_export: await fixture(format) } }); await flush();
    const download = v.button("Download local copy"); download.click(); download.click();
    expect(v.anchors()).toBe(1); expect(v.urls.size).toBe(1);
    v.teardown(); download.click(); expect(v.anchors()).toBe(1); expect(v.urls.size).toBe(0); expect(v.revoked).toHaveLength(1); expect(v.root.children).toHaveLength(0);
  });
  it.each(["pdf", "xlsx"] as const)("ignores late %s generation and failures after navigation, and permits a new request", async (format) => {
    const v = viewer(); v.button(format === "pdf" ? "Prepare PDF" : "Prepare XLSX").click();
    const first = v.messages.find((m) => m.method === "tools/call");
    v.load({ local_export_context: { ...context, job_id: "other" }, context: { ...context, job_id: "other" }, card: { title: "Other", sections: [] } });
    v.reply(first?.id, { structuredContent: { local_export: await fixture(format) } }); await flush();
    expect(v.root.querySelectorAll("button").map((b) => b.textContent)).not.toContain("Download local copy");
    v.button("Prepare PDF").click(); expect(v.messages.filter((m) => m.method === "tools/call")).toHaveLength(2);
    const second = v.messages.filter((m) => m.method === "tools/call")[1];
    v.load(); v.status.textContent = "Current view"; v.reply(second.id, { isError: true, content: [{ type: "text", text: "Old failure" }] }); await flush();
    expect(v.status.textContent).toBe("Current view"); v.teardown();
  });
  it.each(["pdf", "xlsx"] as const)("retries failed %s preparation and failed anchor requests", async (format) => {
    const v = viewer(); const name = format === "pdf" ? "Prepare PDF" : "Prepare XLSX";
    v.button(name).click(); let call = v.messages.filter((m) => m.method === "tools/call").at(-1);
    v.reply(call?.id, { isError: true, content: [{ type: "text", text: "Synthetic failure" }] }); await flush();
    expect(v.urls.size).toBe(0); v.button(name).click(); call = v.messages.filter((m) => m.method === "tools/call").at(-1);
    v.reply(call?.id, { structuredContent: { local_export: await fixture(format) } }); await flush();
    v.failAnchor(true); v.button("Download local copy").click(); expect(v.urls.size).toBe(0); expect(v.anchors()).toBe(0);
    v.failAnchor(false); v.button("Download local copy").click(); expect(v.anchors()).toBe(1); v.teardown();
  });
  it.each(["blocked", "opaque"] as const)("does not request a Blob download in an unsupported %s sandbox", async (permission) => {
    const v = viewer(permission); v.load({ estimate_local_export: true, local_export: await fixture("pdf"), context, card: { title: "Bid", sections: [] } }); await flush();
    expect(v.root.querySelectorAll("button")).toHaveLength(0); expect(v.anchors()).toBe(0); expect(v.urls.size).toBe(0); v.teardown();
  });
  it("invalidates pending hashing on teardown and ignores subsequent messages", async () => {
    let release: ((value: ArrayBuffer) => void) | undefined;
    const v = viewer("top", (() => new Promise<ArrayBuffer>((resolve) => { release = resolve; })) as typeof webcrypto.subtle.digest);
    const file = await fixture("pdf"); v.load({ estimate_local_export: true, local_export: file, context, card: { title: "Bid", sections: [] } }); await flush();
    const hash = Uint8Array.from(Buffer.from(file.sha256, "hex"));
    v.teardown(); release?.(hash.buffer); await flush();
    expect(v.root.children).toHaveLength(0); expect(v.urls.size).toBe(0);
    v.load(); expect(v.root.children).toHaveLength(0);
  });
  it.each(["pdf", "xlsx"] as const)("clears a prepared %s Blob and pending RPC on teardown", async (format) => {
    const v = viewer(); v.button(format === "pdf" ? "Prepare PDF" : "Prepare XLSX").click();
    const call = v.messages.find((m) => m.method === "tools/call");
    v.teardown(); v.reply(call?.id, { structuredContent: { local_export: await fixture(format) } }); await flush();
    expect(v.root.children).toHaveLength(0); expect(v.anchors()).toBe(0); expect(v.urls.size).toBe(0);
  });
});