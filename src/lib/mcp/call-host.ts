// Which chat host made this tool call, for the project record. Unverified client input: a label, never an authorization.
// A conversation id is stored only when the host sends one; none of the three hosts does today, so thread_ref stays null
// until the first live run proves otherwise.
import type { ToolContext } from "@lovable.dev/mcp-js";

export type CallHost = "claude" | "chatgpt" | "grokbot" | null;

/** claude, chatgpt or grokbot from the client name the host declared; null when it declared nothing recognisable. */
export function hostFromClientName(name: string | null | undefined): CallHost {
  const n = (name ?? "").toLowerCase();
  if (!n) return null;
  if (/claude|anthropic/.test(n)) return "claude";
  if (/chatgpt|openai/.test(n)) return "chatgpt";
  if (/grok|xai/.test(n)) return "grokbot";
  return null;
}

export function callHost(ctx: Pick<ToolContext, "client"> | null | undefined): CallHost {
  try {
    return hostFromClientName(ctx?.client?.info?.name);
  } catch {
    return null;
  }
}

/** Words for a page: "through Claude", "through ChatGPT", "through Grok Bot". */
export function hostLabel(host: string | null | undefined): string | null {
  if (host === "claude") return "Claude";
  if (host === "chatgpt") return "ChatGPT";
  if (host === "grokbot") return "Grok Bot";
  return null;
}
