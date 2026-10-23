import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import { ATHENA_TOOLS } from "../index";
import { EMAIL_CARD_MIME, EMAIL_CARD_PALETTE, EMAIL_CARD_TOOLS, EMAIL_CARD_URI, emailCardHtml, emailCardMeta } from "./email-card";
import { NATIVE_CARD_MIME, NATIVE_CARD_URI } from "./native";
import { nativeCardPayload, nativeCardResponse, nativeCardVisit } from "../native-card-transport";
import { claudeCardReply } from "./claude-reply";
import { paletteViolations } from "./palette";
import { EMAIL_CARD_RULE } from "../email-safety";
import { EMAIL_DRAFT_ARTIFACT_LINE, EMAIL_DRAFT_VIEW_SPEC } from "../views";

type Obj = Record<string, unknown>;

/** Just enough DOM for the view: elements with children, text, value, attributes and click/input events. */
function fakeDom() {
  const byId = new Map<string, FakeEl>();
  class FakeEl {
    tag: string;
    children: FakeEl[] = [];
    listeners: Record<string, (() => void)[]> = {};
    attrs: Record<string, string> = {};
    private _text = "";
    value = "";
    className = "";
    hidden = false;
    disabled = false;
    type = "";
    href = "";
    target = "";
    rel = "";
    htmlFor = "";
    style: Record<string, string> = {};
    scrollHeight = 200;
    private _id = "";
    constructor(tag: string) {
      this.tag = tag;
    }
    get id() {
      return this._id;
    }
    set id(v: string) {
      this._id = v;
      byId.set(v, this);
    }
    get textContent(): string {
      return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
    }
    set textContent(v: string) {
      this._text = String(v);
      this.children = [];
    }
    appendChild(c: FakeEl) {
      this.children.push(c);
      return c;
    }
    replaceChildren(...c: FakeEl[]) {
      this.children = c;
      this._text = "";
    }
    addEventListener(type: string, cb: () => void) {
      (this.listeners[type] ??= []).push(cb);
    }
    fire(type: string) {
      for (const cb of this.listeners[type] ?? []) cb();
    }
    getBoundingClientRect() {
      return { width: 640, height: 400 };
    }
    find(pred: (e: FakeEl) => boolean): FakeEl | null {
      for (const c of this.children) {
        if (pred(c)) return c;
        const inner = c.find(pred);
        if (inner) return inner;
      }
      return null;
    }
  }
  const body = new FakeEl("body");
  const app = new FakeEl("main");
  app.id = "app";
  body.appendChild(app);
  const document = {
    body,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => new FakeEl(tag),
  };
  return { document, app, body, FakeEl };
}

function view(hostCapabilities: Obj = { serverTools: {}, message: {} }) {
  const sent: Obj[] = [];
  const dom = fakeDom();
  const parent = { postMessage: (data: Obj) => void sent.push(data) };
  let receive: (event: unknown) => void = () => {};
  const window = {
    parent,
    addEventListener: (_t: string, cb: typeof receive) => void (receive = cb),
    removeEventListener: () => {},
  };
  const script = emailCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, { window, document: dom.document, setTimeout, clearTimeout, Promise });
  const message = (data: unknown) => receive({ data, source: parent, origin: "https://sandbox.example" });
  message({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-01-26", hostCapabilities, hostContext: {} } });
  const requests = () => sent.filter((m) => m.id != null && m.method);
  const answer = (id: unknown, result: Obj) => message({ jsonrpc: "2.0", id, result });
  const el = (pred: (e: InstanceType<typeof dom.FakeEl>) => boolean) => dom.app.find(pred)!;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { sent, message, requests, answer, el, app: dom.app, flush };
}

const draft = {
  to: "dana@example.test",
  cc: ["pm@example.test"],
  subject: "Submittal 001 due Friday",
  body: "Hi Dana,\n\nPlease send the stamped set by Friday.\n\nThanks,\nElena Brooks\nProject Manager",
  link: null,
  attachment: null,
};
const emailResult = {
  structuredContent: { draft, draft_key: "DAAAA0001", sent: false, send_allowed: true, job_number: "2701", company_id: "ALP Construction" },
};

describe("email card view", () => {
  it("initializes like the native card and fills editable fields from the draft", () => {
    const v = view();
    expect(v.sent[0]).toMatchObject({ method: "ui/initialize", params: { protocolVersion: "2026-01-26" } });
    expect(v.sent[1]).toMatchObject({ method: "ui/notifications/initialized" });
    v.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: emailResult });
    expect(v.el((e) => e.id === "to").value).toBe(draft.to);
    expect(v.el((e) => e.id === "cc").value).toBe("pm@example.test");
    expect(v.el((e) => e.id === "subject").value).toBe(draft.subject);
    expect(v.el((e) => e.id === "body").value).toBe(draft.body);
    expect(v.el((e) => e.className === "pill").textContent).toBe("Not sent");
    expect(v.el((e) => e.className === "primary").disabled).toBe(false);
  });

  it("re-drafts an edited email, confirms it, then hands the exact text to the chat", async () => {
    const v = view();
    v.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: emailResult });
    const body = v.el((e) => e.id === "body");
    body.value = draft.body.replace("by Friday", "by Friday noon");
    body.fire("input");
    v.el((e) => e.className === "primary").fire("click");
    await v.flush();
    const first = v.requests().at(-1)!;
    expect(first).toMatchObject({ method: "tools/call", params: { name: "email_draft", arguments: { to: draft.to, cc: draft.cc, body: body.value, job_number: "2701", company_id: "ALP Construction" } } });
    expect((first.params as Obj).arguments).not.toHaveProperty("confirmed");
    v.answer(first.id, { content: [], structuredContent: { draft_key: "DBBBB0002" } });
    await v.flush();
    const second = v.requests().at(-1)!;
    expect(second).toMatchObject({ method: "tools/call", params: { name: "email_confirm_send", arguments: { draft_key: "DBBBB0002", confirmed: true, subject: draft.subject } } });
    v.answer(second.id, { content: [], structuredContent: { send_confirmed: true } });
    await v.flush();
    const third = v.requests().at(-1)!;
    expect(third.method).toBe("ui/message");
    const text = ((third.params as Obj).content as { text: string }[])[0].text;
    expect(text).toContain("Draft key: DBBBB0002");
    expect(text).toContain("To: dana@example.test");
    expect(text).toContain("by Friday noon");
    expect(text).toContain("from my connected email account");
    v.answer(third.id, {});
    await v.flush();
    expect(v.el((e) => e.className.startsWith("pill")).textContent).toBe("Approved");
  });

  it("skips the re-draft when nothing changed and shows Athena's refusal verbatim", async () => {
    const v = view();
    v.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: emailResult });
    v.el((e) => e.className === "primary").fire("click");
    await v.flush();
    const only = v.requests().at(-1)!;
    expect(only).toMatchObject({ method: "tools/call", params: { name: "email_confirm_send", arguments: { draft_key: "DAAAA0001", confirmed: true } } });
    v.answer(only.id, { isError: true, content: [{ type: "text", text: "This draft changed after it was reviewed. Nothing was sent." }] });
    await v.flush();
    expect(v.el((e) => e.className === "note").textContent).toContain("This draft changed after it was reviewed");
    expect(v.el((e) => e.className === "pill").textContent).toBe("Not sent");
  });

  it("drafts and approves a submittal delivery with its ids", async () => {
    const v = view();
    v.message({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: { draft, draft_key: "DCCCC0003", delivery_id: "22222222-2222-4222-8222-222222222222", approved: false, sent: false, kind: "chase", submittal_id: "33333333-3333-4333-8333-333333333333", job_number: "2701" } },
    });
    v.el((e) => e.className === "primary").fire("click");
    await v.flush();
    const approve = v.requests().at(-1)!;
    expect(approve).toMatchObject({ method: "tools/call", params: { name: "submittal_delivery", arguments: { action: "approve", delivery_id: "22222222-2222-4222-8222-222222222222", draft_key: "DCCCC0003", confirmed: true, job_number: "2701", submittal_id: "33333333-3333-4333-8333-333333333333" } } });
    v.answer(approve.id, { content: [], structuredContent: { approved: true } });
    await v.flush();
    const msg = v.requests().at(-1)!;
    expect(msg.method).toBe("ui/message");
    expect(((msg.params as Obj).content as { text: string }[])[0].text).toContain("submittal_delivery record_sent");
  });

  it("disables Send when the host cannot run server tools, and when sending is off", () => {
    const a = view({});
    a.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: emailResult });
    expect(a.el((e) => e.className === "primary").disabled).toBe(true);
    expect(a.el((e) => e.className === "note").textContent).toContain("Answer yes in the chat");
    const b = view();
    b.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { ...emailResult.structuredContent, send_allowed: false } } });
    expect(b.el((e) => e.className === "pill").textContent).toBe("Sending is off");
    expect(b.el((e) => e.className === "primary").disabled).toBe(true);
  });

  it("uses only its own stone-and-teal scheme, no red, and nothing from outside it", () => {
    const own = Object.values(EMAIL_CARD_PALETTE);
    expect(paletteViolations(emailCardHtml(), false, own)).toEqual([]);
    // The widening is this card's alone: without it the scheme is off the card palette.
    expect(paletteViolations(emailCardHtml(), false).length).toBeGreaterThan(0);
    expect(emailCardHtml()).not.toMatch(/#1E3A5F|#1E5FED|#2563EB/);
    expect(emailCardHtml()).not.toMatch(/innerHTML|eval\(|fetch\(|XMLHttpRequest/);
  });
});

describe("email card on the wire", () => {
  const meta = {
    "io.modelcontextprotocol/clientInfo": { name: "claude-ai", version: "test" },
    "io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [NATIVE_CARD_MIME] } } },
  };
  const request = (method: string, params: Obj) =>
    new Request("https://app.meetathena.io/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer fictional-credential", "user-agent": "claude-ai" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }),
    });

  it("advertises the email card on email_draft and submittal_delivery only, keeping outputTemplate", async () => {
    const visit = (await nativeCardVisit(request("tools/list", {})))!;
    const wire = { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "email_draft" }, { name: "submittal_delivery", _meta: { "openai/outputTemplate": "ui://athena/card.html" } }, { name: "contract_terms" }, { name: "cpm_activities" }] } };
    const out = nativeCardPayload(wire, visit).value as { result: { tools: { name: string; _meta?: Obj }[] } };
    const by = Object.fromEntries(out.result.tools.map((t) => [t.name, t._meta]));
    expect(by.email_draft).toEqual(emailCardMeta);
    expect(by.submittal_delivery).toEqual({ "openai/outputTemplate": "ui://athena/card.html", ...emailCardMeta });
    expect(by.contract_terms).toEqual({ ui: { resourceUri: NATIVE_CARD_URI } });
    expect(by.cpm_activities).toBeUndefined();
    expect([...EMAIL_CARD_TOOLS]).toEqual(["email_draft", "submittal_delivery"]);
  });

  it("lists and serves the email card resource next to the native card", async () => {
    const list = (await nativeCardVisit(request("resources/list", {})))!;
    const listed = nativeCardPayload({ jsonrpc: "2.0", id: 1, result: { resources: [] } }, list).value as { result: { resources: { uri: string; mimeType: string }[] } };
    expect(listed.result.resources.map((r) => [r.uri, r.mimeType])).toEqual([[NATIVE_CARD_URI, NATIVE_CARD_MIME], [EMAIL_CARD_URI, EMAIL_CARD_MIME]]);
    const read = await nativeCardVisit(request("resources/read", { uri: EMAIL_CARD_URI }));
    const res = await nativeCardResponse(Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }, { status: 404 }), read);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.result.contents[0]).toMatchObject({ uri: EMAIL_CARD_URI, mimeType: EMAIL_CARD_MIME });
    expect(json.result.contents[0].text).toContain("ui/initialize");
    expect(json.result.contents[0].text).toContain("email_confirm_send");
  });

  it("serves the email card through the actual SDK", async () => {
    const mcp = defineMcp({ name: "athena", title: "Athena", version: "test", instructions: "t", tools: ATHENA_TOOLS, metrics: false } as never);
    const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp" });
    for (const [method, params] of [["tools/list", {}], ["resources/read", { uri: EMAIL_CARD_URI }]] as const) {
      const req = request(method, params);
      const visit = await nativeCardVisit(req);
      const res = await nativeCardResponse(await handler({ request: req } as never), visit);
      const raw = await res.text();
      const json = JSON.parse(raw.startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
      expect(json.error).toBeUndefined();
      if (method === "tools/list") {
        const tool = json.result.tools.find((t: { name: string }) => t.name === "email_draft");
        expect(tool._meta.ui.resourceUri).toBe(EMAIL_CARD_URI);
        expect(tool._meta["openai/outputTemplate"]).toBeUndefined();
      } else expect(json.result.contents[0].mimeType).toBe(EMAIL_CARD_MIME);
    }
  });

  it("gives Claude the draft text without the artifact spec", () => {
    const text = [EMAIL_DRAFT_ARTIFACT_LINE, "", "To: dana@example.test", "Subject: Due Friday", "", "Hi Dana, please send it.", "", ...EMAIL_DRAFT_VIEW_SPEC, "", "Confirm question: Send this email to dana@example.test from your connected email account? Yes or no?"].join("\n");
    const out = claudeCardReply({ content: [{ type: "text", text }], structuredContent: { draft, assistant_guidance: [EMAIL_CARD_RULE, "Never send in this reply."] } })!;
    const got = (out.content as { text: string }[])[0].text;
    expect(got).toBe("To: dana@example.test\nSubject: Due Friday\n\nHi Dana, please send it.\n\nConfirm question: Send this email to dana@example.test from your connected email account? Yes or no?");
    expect((out.structuredContent as Obj).assistant_guidance).toEqual(["Never send in this reply."]);
  });
});
