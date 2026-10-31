import { runInNewContext } from "node:vm";
import { fileUploadCardHtml } from "../../src/lib/mcp/cards/file-upload-card";

export class UploadElement {
  children: UploadElement[] = [];
  handlers: Record<string, () => unknown> = {};
  disabled = false;
  files: File[] = [];
  type = "";
  private text = "";
  constructor(public tagName = "DIV") {}
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join(" ");
  }
  append(...children: UploadElement[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: UploadElement[]) {
    this.text = "";
    this.children = children;
  }
  addEventListener(name: string, handler: () => unknown) {
    this.handlers[name] = handler;
  }
}
const descendants = (root: UploadElement): UploadElement[] => [
  root,
  ...root.children.flatMap(descendants),
];

/** The real card script; the host bridge dispatches only requests emitted by that script. */
export function uploadCard(options: {
  dispatch(name: string, args: Record<string, unknown>): Promise<unknown>;
  fetch: typeof fetch;
  serverTools?: boolean;
}) {
  const app = new UploadElement(),
    status = new UploadElement();
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  let receive: (event: unknown) => void = () => {},
    removed = false;
  let widgetState: unknown;
  const parent = {
    postMessage(m: Record<string, any>) {
      if (m.method !== "tools/call") return;
      calls.push(m.params);
      Promise.resolve()
        .then(() => options.dispatch(m.params.name, m.params.arguments))
        .then((result) => message({ jsonrpc: "2.0", id: m.id, result }))
        .catch((error) => message({ jsonrpc: "2.0", id: m.id, error: { message: error.message } }));
    },
  };
  const window = {
    parent,
    openai: {
      setWidgetState(state: unknown) {
        widgetState = state;
      },
    },
    addEventListener(_name: string, handler: typeof receive) {
      receive = handler;
    },
    removeEventListener() {
      removed = true;
      receive = () => {};
    },
  };
  function message(data: unknown, source: unknown = parent, origin = "https://host.example.test") {
    receive({ data, source, origin });
  }
  runInNewContext(fileUploadCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1], {
    window,
    document: {
      getElementById: (id: string) => (id === "app" ? app : status),
      createElement: (tag: string) => new UploadElement(tag.toUpperCase()),
      body: { getBoundingClientRect: () => ({ width: 390, height: 800 }) },
    },
    URL,
    setTimeout,
    clearTimeout,
    fetch: options.fetch,
  });
  message({
    jsonrpc: "2.0",
    id: 1,
    result: { hostCapabilities: options.serverTools === false ? {} : { serverTools: {} } },
  });
  return {
    app,
    status,
    calls,
    message,
    removed: () => removed,
    state: () => widgetState,
    result: (result: unknown) =>
      message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result }),
    all: () => descendants(app),
    click(label: string, filename?: string) {
      const root = filename
        ? descendants(app).find((n) => n.tagName === "SECTION" && n.textContent.includes(filename))
        : app;
      const button =
        root && descendants(root).find((n) => n.tagName === "BUTTON" && n.textContent === label);
      if (!button || button.disabled)
        throw new Error("Button unavailable: " + label + "; " + app.textContent);
      return button.handlers.click();
    },
    choose(file: File) {
      const input = descendants(app).find((n) => n.tagName === "INPUT" && n.type === "file");
      if (!input || input.disabled) throw new Error("File input unavailable");
      input.files = [file];
    },
    close: () => message({ jsonrpc: "2.0", id: 999, method: "ui/resource-teardown" }),
  };
}
