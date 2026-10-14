import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";

// Private prototype: hard-coded allowlist. (No is_circle_active() function
// exists in the database yet; add that check here once it does.)
export const MCP_ALLOWED_EMAILS = new Set(["marshall@marshallwilkinson.com"]);
export const FOOTER = "\n\n---\nALP Contractor Circle - private prototype";

export type Sb = ReturnType<typeof supabaseForUser>;

// Hidden per-account abuse cap lives in the database (mcp_abuse_cap_hit). Never surface its numbers.
export async function guard(ctx: ToolContext): Promise<Sb> {
  if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated.");
  const email = (ctx.getUserEmail() ?? "").trim().toLowerCase();
  if (!MCP_ALLOWED_EMAILS.has(email)) throw new ToolError("Forbidden (403): this account isn't enabled for this prototype.");
  const sb = supabaseForUser(ctx);
  const { data, error } = await sb.rpc("mcp_abuse_cap_hit");
  if (error) throw new ToolError("Please try again later.");
  if (data !== true) {
    await logWorkflow(sb, { event_type: "failure", tool: "guard", error_code: "cap_hit" });
    throw new ToolError("Please try again later.");
  }
  return sb;
}

/** Workflow log: failures and missing-question events only. Ids and check keys only — never project content. */
export async function logWorkflow(
  sb: Sb,
  row: { event_type: "failure" | "missing_question"; tool: string; lookahead_id?: string | null; check_key?: string | null; error_code?: string | null },
) {
  try {
    await sb.from("mcp_workflow_log").insert(row);
  } catch {
    // never break a tool call on logging
  }
}

/** Guard + run + log failures. */
export async function run<R>(tool: string, ctx: ToolContext, lookaheadId: string | undefined, fn: (sb: Sb) => Promise<R>): Promise<R> {
  const sb = await guard(ctx);
  try {
    return await fn(sb);
  } catch (e) {
    await logWorkflow(sb, {
      event_type: "failure",
      tool,
      lookahead_id: lookaheadId && /^[0-9a-f-]{36}$/i.test(lookaheadId) ? lookaheadId : null,
      error_code: e instanceof ToolError ? "tool_error" : "internal",
    });
    if (e instanceof ToolError) throw e;
    throw new ToolError("Something went wrong. Try again in a moment.");
  }
}

export function text(body: string) {
  return { content: [{ type: "text" as const, text: body + FOOTER }] };
}
