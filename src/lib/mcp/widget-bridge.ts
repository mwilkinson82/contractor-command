// Meeting replies stay one card. No card widget resource is registered.
// That registration hid the Athena icon in tools/list.
import { McpServer } from "@modelcontextprotocol/server";

const MEETINGS = new Set(["pm_meeting", "pm_morning", "pm_evening", "athena_morning_hitlist", "athena_hello", "morning_brief", "morning_brief_settings"]);
const patched = Symbol.for("athena.cardWidgetBridge");

type RegisterTool = (name: string, config: { _meta?: Record<string, unknown> }, cb: (...args: unknown[]) => Promise<Record<string, unknown>>) => unknown;

/** Keep a meeting reply one card. Drop a nested widget script so the host does not repaint forever. */
export function boundMeetingResult(result: Record<string, unknown>): Record<string, unknown> {
  const sc = { ...((result.structuredContent as Record<string, unknown> | undefined) ?? {}) };
  if (sc.card && typeof sc.card === "object") {
    const card = { ...(sc.card as Record<string, unknown>) };
    delete card.html;
    delete card.card;
    sc.card = card;
  }
  if (typeof sc.html === "string") sc.html = sc.html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const content = Array.isArray(result.content) ? result.content : [];
  let sawResource = false;
  const nextContent = content.filter((block) => {
    const row = block as { type?: string };
    if (row.type !== "resource") return true;
    if (sawResource) return false;
    sawResource = true;
    return true;
  });
  const out: Record<string, unknown> = { ...result, structuredContent: sc, content: nextContent };
  try {
    if (JSON.stringify(out).length > 120_000) {
      delete sc.html;
      out.structuredContent = sc;
    }
  } catch {
    delete sc.html;
    out.structuredContent = sc;
  }
  return out;
}

const proto = McpServer.prototype as unknown as { [patched]?: boolean; registerTool: RegisterTool };

if (!proto[patched]) {
  proto[patched] = true;
  const orig = proto.registerTool;
  proto.registerTool = function (name, config, cb) {
    const wrapped = async (...args: unknown[]) => {
      const result = (await cb(...args)) ?? {};
      if (!MEETINGS.has(name)) return result;
      return boundMeetingResult(result);
    };
    return orig.call(this, name, config, wrapped);
  };
}
