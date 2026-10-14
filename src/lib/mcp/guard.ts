import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";

// Private prototype: hard-coded allowlist. (No is_circle_active() function
// exists in the database yet; add that check here once it does.)
export const MCP_ALLOWED_EMAILS = new Set(["marshall@marshallwilkinson.com"]);
export const MCP_HOURLY_LIMIT = 60;
export const FOOTER = "\n\n---\nALP Contractor Circle - private prototype";

export async function guard(ctx: ToolContext) {
  if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated.");
  const email = (ctx.getUserEmail() ?? "").trim().toLowerCase();
  if (!MCP_ALLOWED_EMAILS.has(email)) throw new ToolError("Forbidden: this account isn't enabled for this prototype.");
  const { data, error } = await supabaseForUser(ctx).rpc("mcp_rate_hit", { _limit: MCP_HOURLY_LIMIT });
  if (error) throw new ToolError("Couldn't check usage limits. Try again shortly.");
  if (data !== true) throw new ToolError(`Rate limit reached (${MCP_HOURLY_LIMIT} calls per hour). Try again later.`);
}

export function text(body: string) {
  return { content: [{ type: "text" as const, text: body + FOOTER }] };
}
