import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { drawingCardHtml } from "./cards/drawing-card";

class Element {
  children: Element[] = [];
  className = "";
  style: Record<string, string> = {};
  handlers: Record<string, () => void> = {};
  src = "";
  parent?: Element;
  private value = "";
  constructor(public tagName = "DIV") {}
  set textContent(value: string) {
    this.value = value;
    this.children = [];
  }
  get textContent(): string {
    return this.value + this.children.map((c) => c.textContent).join(" ");
  }
  append(...children: Element[]) {
    children.forEach((child) => {
      child.parent = this;
    });
    this.children.push(...children);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  querySelectorAll(selector: string) {
    return descendants(this).filter((child) => child.className === selector.slice(1));
  }
  getBoundingClientRect() {
    return { left: 10, top: 20, width: 200, height: 100 };
  }
  replaceChildren(...children: Element[]) {
    this.value = "";
    this.children = children;
  }
  addEventListener(type: string, handler: () => void) {
    this.handlers[type] = handler;
  }
}
function descendants(root: Element): Element[] {
  return [root, ...root.children.flatMap(descendants)];
}
function view() {
  const app = new Element(),
    status = new Element(),
    sent: { data: Record<string, unknown>; origin: string }[] = [];
  const parent = {
    postMessage(data: Record<string, unknown>, origin: string) {
      sent.push({ data, origin });
    },
  };
  let receive: (event: unknown) => void = () => {},
    removed = false;
  const window = {
    parent,
    addEventListener(_type: string, cb: typeof receive) {
      receive = cb;
    },
    removeEventListener() {
      removed = true;
    },
  };
  const document = {
    getElementById: (id: string) => (id === "app" ? app : status),
    createElement: (tag: string) => new Element(tag.toUpperCase()),
    body: { getBoundingClientRect: () => ({ width: 390, height: 900 }) },
  };
  const script = drawingCardHtml("https://storage.example.com").match(
    /<script>([\s\S]*?)<\/script>/,
  )![1];
  runInNewContext(script, { window, document, URL, setTimeout, clearTimeout, btoa });
  const message = (data: unknown, source: unknown = parent, origin = "https://host.example.com") =>
    receive({ data, source, origin });
  const result = (payload: unknown) =>
    message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: payload });
  return {
    app,
    status,
    sent,
    message,
    result,
    parent,
    removed: () => removed,
    all: () => descendants(app),
    ready: (hostCapabilities = {}) =>
      message({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2026-07-28", hostCapabilities },
      }),
  };
}
function payload(
  href = "https://storage.example.com/storage/v1/object/sign/athena-files/company/job/drawing-markup-copy/S-100.pdf?token=fictional",
) {
  return {
    content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
    structuredContent: {
      source: { id: "original", company_id: "company", job_id: "job" },
      markup: {
        kind: "markup",
        parent_id: "original",
        path: "company/job/drawing-markup-copy/S-100.pdf",
        sheet: "S-100",
      },
      card: {
        title: "S-100 drawing markup",
        job: "CCW-003 · Fictional job",
        kpis: [{ label: "Markup version", value: "2" }],
        sections: [
          {
            heading: "Drawing record",
            rows: [
              { cells: ["Open dated markup PDF"], href },
              { cells: ["QA pin", "Not a quantity measurement"], flag: "callout" },
            ],
          },
        ],
      },
    },
  };
}

describe("drawing card view", () => {
  it("locates an unpositioned finding on the original image and saves that exact source only after the member clicks", async () => {
    const v = view();
    v.ready({ serverTools: {} });
    const p = payload();
    v.result({
      ...p,
      structuredContent: {
        ...p.structuredContent,
        saved: false,
        job_number: "CCW-003",
        company_id: "company",
        sheet: "S-100",
        drawing_annotations: [{ label: "F1", text: "Fictional test finding", severity: "callout" }],
      },
    });
    const save = v.all().find((e) => e.textContent === "Save dated markup")!;
    expect((save as unknown as { disabled: boolean }).disabled).toBe(true);
    const img = v.all().find((e) => e.tagName === "IMG")!;
    (img.handlers.click as unknown as (event: { clientX: number; clientY: number }) => void)({
      clientX: 110,
      clientY: 70,
    });
    expect((save as unknown as { disabled: boolean }).disabled).toBe(false);
    expect(v.all().find((e) => e.className === "drawing-pin")?.style).toMatchObject({
      left: "50%",
      top: "50%",
    });
    expect(v.sent.some(({ data }) => data.method === "tools/call")).toBe(false);
    const saving = save.handlers.click();
    const request = v.sent.at(-1)!.data;
    expect(request).toMatchObject({
      method: "tools/call",
      params: {
        name: "drawing_markup",
        arguments: {
          job_number: "CCW-003",
          source_id: "original",
          operation: "save",
          annotations: [{ label: "F1", geometry: { kind: "pin", point: { x: 0.5, y: 0.5 } } }],
        },
      },
    });
    v.message({
      jsonrpc: "2.0",
      id: request.id,
      result: { structuredContent: { saved: true, card: p.structuredContent.card } },
    });
    await saving;
    expect(v.status.textContent).toBe("");
  });
  it("draws supplied preview pins on the sheet and keeps key-only findings unlocated", () => {
    const v = view();
    v.ready();
    const p = payload();
    v.result({
      ...p,
      structuredContent: {
        ...p.structuredContent,
        saved: false,
        drawing_annotations: [
          {
            label: "F1",
            severity: "callout",
            geometry: { kind: "pin", point: { x: 0.25, y: 0.6 } },
          },
          {
            label: "Risk",
            severity: "risk",
            geometry: { kind: "pin", point: { x: 0.75, y: 0.2 } },
          },
          { label: "No position", severity: "callout" },
        ],
      },
    });
    const pins = v.all().filter((e) => e.className === "drawing-pin");
    expect(pins).toHaveLength(2);
    expect(pins[0].style).toMatchObject({ left: "25%", top: "60%", border: "2px solid #1E5FED" });
    expect(pins[1].style.border).toBe("2px solid #DC2626");
    const surface = v.all().find((e) => e.children.includes(pins[0]))!;
    v.all()
      .find((e) => e.textContent === "Zoom in")!
      .handlers.click();
    expect(surface.style.width).toBe("150%");
    expect(pins[0].style.left).toBe("25%");
  });
  it("uploads a normal 2.9 MB PDF directly through the host tool bridge, once and only after a click", async () => {
    const v = view();
    v.ready({ serverTools: {} });
    const p = payload();
    v.result({
      content: [],
      structuredContent: {
        card: p.structuredContent.card,
        upload_context: { job_number: "CCW-003", company_id: "company" },
      },
    });
    expect(v.sent.some(({ data }) => data.method === "tools/call")).toBe(false);
    const bytes = new Uint8Array(2900000);
    bytes.set(new TextEncoder().encode("%PDF-1.7\nfictional UI upload fixture"));
    const pick = v.all().find((e) => e.tagName === "INPUT")!;
    Object.assign(pick, {
      files: [{ name: "CCW.pdf", size: bytes.length, arrayBuffer: async () => bytes.buffer }],
    });
    const submit = v.all().find((e) => e.textContent === "Store PDF on this job")!;
    const upload = submit.handlers.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    submit.handlers.click();
    const calls = v.sent.filter(({ data }) => data.method === "tools/call");
    expect(calls).toHaveLength(1);
    const request = calls[0].data as {
      id: number;
      params: {
        name: string;
        arguments: { job_number: string; drawing: { content_base64: string; filename: string } };
      };
    };
    expect(request.params.name).toBe("drawing_set_import");
    expect(request.params.arguments.job_number).toBe("CCW-003");
    expect(
      Buffer.from(request.params.arguments.drawing.content_base64, "base64").equals(
        Buffer.from(bytes),
      ),
    ).toBe(true);
    v.message({
      jsonrpc: "2.0",
      id: request.id,
      result: { structuredContent: { stored: true, card: p.structuredContent.card } },
    });
    await upload;
    expect(v.status.textContent).toBe("");
    expect(v.sent.every(({ data }) => data.method !== "ui/message")).toBe(true);
  });
  it("keeps direct upload disabled when the host has not granted serverTools", () => {
    const v = view();
    v.ready();
    const p = payload();
    v.result({
      structuredContent: {
        card: p.structuredContent.card,
        upload_context: { job_number: "CCW-003", company_id: "company" },
      },
    });
    expect(v.app.textContent).toContain("has not enabled uploads");
    v.all()
      .find((e) => e.textContent === "Store PDF on this job")!
      .handlers.click();
    expect(v.sent.some(({ data }) => data.method === "tools/call")).toBe(false);
  });
  it("accepts a successful parent handshake, rejects other senders/origins, and tears down", () => {
    const v = view();
    expect(v.sent[0].data).toMatchObject({ method: "ui/initialize" });
    v.message({ jsonrpc: "2.0", id: 1, result: {} }, {});
    v.message({ jsonrpc: "2.0", id: 1, error: { code: -1 } });
    expect(v.sent).toHaveLength(1);
    v.ready();
    expect(v.sent[1].data.method).toBe("ui/notifications/initialized");
    expect(v.sent[2].data.method).toBe("ui/notifications/size-changed");
    v.message(
      { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: payload() },
      v.parent,
      "https://other.example.com",
    );
    expect(v.app.children).toHaveLength(0);
    v.message({ jsonrpc: "2.0", id: 8, method: "ui/resource-teardown" });
    expect(v.removed()).toBe(true);
    expect(v.sent.at(-1)?.data).toMatchObject({ id: 8, result: {} });
  });
  it("draws the actual PNG and all facts, with local zoom and no automatic downloads", () => {
    const v = view();
    v.ready();
    v.result(payload());
    expect(v.app.textContent).toContain("S-100 drawing markup");
    expect(v.app.textContent).toContain("Not a quantity measurement");
    const img = v.all().find((e) => e.tagName === "IMG")!;
    expect(img.src).toBe("data:image/png;base64,iVBORw0KGgo=");
    v.all()
      .find((e) => e.tagName === "BUTTON" && e.textContent === "Zoom in")!
      .handlers.click();
    expect(v.all().find((element) => element.children.includes(img))!.style.width).toBe("150%");
    v.all()
      .find((e) => e.tagName === "BUTTON" && e.textContent === "Reset")!
      .handlers.click();
    expect(v.all().find((element) => element.children.includes(img))!.style.width).toBe("100%");
    expect(
      v.sent.every(
        ({ data }) => !["tools/call", "ui/message", "ui/open-link"].includes(String(data.method)),
      ),
    ).toBe(true);
    expect(v.all().filter((e) => e.className.includes("alert"))).toHaveLength(0);
  });
  it("opens only the exact private markup link after a click and handles denial", () => {
    const v = view();
    v.ready();
    const p = payload();
    v.result(p);
    v.all()
      .find((e) => e.className === "download")!
      .handlers.click();
    const call = v.sent.at(-1)!.data;
    expect(call).toMatchObject({
      method: "ui/open-link",
      params: { url: p.structuredContent.card.sections[0].rows[0].href },
    });
    v.message({ jsonrpc: "2.0", id: call.id, error: { code: -1 } });
    expect(v.status.textContent).toContain("could not be opened");
  });
  it("renders and zooms the structured preview when the host omits image content", () => {
    const v = view();
    v.ready();
    const p = payload();
    v.result({
      structuredContent: { ...p.structuredContent, drawing_preview: p.content[0] },
      content: [{ type: "text", text: "S-100 preview" }],
    });
    const img = v.all().find((e) => e.tagName === "IMG")!;
    expect(img.src).toBe("data:image/png;base64,iVBORw0KGgo=");
    v.all()
      .find((e) => e.textContent === "Zoom in")!
      .handlers.click();
    expect(v.all().find((element) => element.children.includes(img))!.style.width).toBe("150%");
  });
  it.each([
    { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
    { type: "image", mimeType: "image/png", data: "https://other.example.com/picture.png" },
    { type: "image", mimeType: "image/png", data: "A".repeat(12000001) },
  ])("rejects unsafe structured previews without fetching them", (drawing_preview) => {
    const v = view();
    v.ready();
    const p = payload();
    v.result({ structuredContent: { ...p.structuredContent, drawing_preview }, content: [] });
    expect(v.all().some((e) => e.tagName === "IMG")).toBe(false);
  });
  it.each([
    "https://other.example.com/storage/v1/object/sign/athena-files/company/job/drawing-markup-copy/S-100.pdf?token=fictional",
    "https://storage.example.com.evil.example.com/storage/v1/object/sign/athena-files/company/job/drawing-markup-copy/S-100.pdf?token=fictional",
    "https://storage.example.com/storage/v1/object/sign/athena-files/company/another-job/drawing-markup-copy/S-100.pdf?token=fictional",
    "https://storage.example.com/storage/v1/object/sign/athena-drawings/company/job/source.pdf?token=fictional",
    "https://member:secret@storage.example.com/storage/v1/object/sign/athena-files/company/job/drawing-markup-copy/S-100.pdf?token=fictional",
    "javascript:alert(1)",
  ])("keeps an unsafe or unrelated link inert: %s", (href) => {
    const v = view();
    v.ready();
    v.result(payload(href));
    expect(v.all().some((e) => e.className === "download")).toBe(false);
    expect(v.app.textContent).toContain("Open dated markup PDF");
  });
  it("keeps hostile text literal, refuses SVG/remote images, and colors only true alerts red", () => {
    const v = view();
    v.ready();
    const p = payload();
    p.content[0] = { type: "image", mimeType: "image/svg+xml", data: "<svg onload='alert(1)'>" };
    p.structuredContent.card.title = "<script>alert(1)</script>";
    p.structuredContent.card.sections[0].rows[1].flag = "risk";
    v.result(p);
    expect(v.app.textContent).toContain("<script>alert(1)</script>");
    expect(v.all().some((e) => ["SCRIPT", "IMG", "IFRAME"].includes(e.tagName))).toBe(false);
    expect(v.all().filter((e) => e.className.includes("alert"))).toHaveLength(1);
  });
  it("falls back truthfully when data is missing and fails closed without a configured storage origin", () => {
    const v = view();
    v.ready();
    v.result({});
    expect(v.app.textContent).toContain("complete reply remains");
    const html = drawingCardHtml("");
    expect(html).toContain('storageOrigin=""');
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("fetch(");
  });
});
