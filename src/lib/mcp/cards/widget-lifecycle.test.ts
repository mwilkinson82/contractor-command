import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { cardWidgetHtml } from "./widget";

function widget(initial: unknown = null) {
  let html = "",
    paints = 0;
  const app = {
    dataset: {} as Record<string, string>,
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
      paints++;
    },
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const window = {
    openai: { toolOutput: initial },
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
  };
  const document = { getElementById: () => app };
  const script = cardWidgetHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, { window, document });
  return {
    app,
    paints: () => paints,
    update: (globals: unknown) => listeners.get("openai:set_globals")?.({ detail: { globals } }),
  };
}
const brief = {
  card: {
    title: "Morning brief",
    state: "result",
    sections: [{ heading: "From your inbox and calendar", rows: [{ cells: ["Job 2701"] }] }],
  },
};
describe("ChatGPT card result delivery", () => {
  it("renders the full morning brief when toolOutput arrives after the resource loads", () => {
    const view = widget();
    expect(view.app.innerHTML).toBe("");
    view.update({ toolOutput: brief });
    expect(view.app.innerHTML).toContain("Morning brief");
    expect(view.app.innerHTML).toContain("From your inbox and calendar");
    expect(view.app.innerHTML).toContain("Job 2701");
    expect(view.paints()).toBe(1);
    view.update({ theme: "dark" });
    view.update({ toolOutput: brief });
    expect(view.paints()).toBe(1);
  });
  it("preserves the existing initial render, escapes text, and accepts a newer complete card", () => {
    const view = widget(brief);
    expect(view.paints()).toBe(1);
    view.update({ toolOutput: null });
    expect(view.paints()).toBe(1);
    view.update({ toolOutput: { card: { title: '<script>alert("x")</script>', sections: [] } } });
    expect(view.app.innerHTML).toContain("&lt;script&gt;");
    expect(view.app.innerHTML).not.toContain("<script>");
    expect(view.paints()).toBe(2);
  });
});
