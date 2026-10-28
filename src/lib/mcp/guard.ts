import { isCardFirstTool, attachAthenaCard } from "./cards/attach";
import { renderHtml } from "./cards/html";
import { htmlBlock, renderMarkdown } from "./cards/markdown";
import type { CardModel } from "./cards/model";
import { sealCardReply } from "./cards/silence";
import { displayFactsResult } from "./cards/display-result";
import { TAKEOFF_CARD_URI } from "./cards/takeoff-card";
import { estimatingTool, estimatingUpgrade } from "./estimating-plan";
import { WhichCompanyAsk } from "./jobs";
import { attachDailyReminder } from "./field-reminder";
import { attachGettingStarted } from "./getting-started";
import { attachMorningCard } from "./morning-brief-card";
import { HOST_DISPLAY_BLOCK, finalizeVisible, guide, splitGuidance, withStyleLine } from "./visible";
import { REMINDERS_VIEW_SPEC } from "./views";
import { DB_UNAVAILABLE, MCP_DAILY_CAP, MCP_HOURLY_CAP, capMessage, type CapResult } from "./limits";
import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";
import { runSweep, type SweepScope } from "./sweep";
import { clientSafe } from "./client-safe";

// Access: the shared membership entitlement (./entitlement), checked on every call.
import { checkAthenaEntitlement } from "./entitlement";
import { enforceTouch, getCallSignals, securityTouch, stampCanary } from "./security";
export const FOOTER = "\n\n---\nAthena powered by ALP, construction agents";
export const INACTIVE_MESSAGE = "Your membership isn't active, so Athena is paused. Your job data is saved.";

export type Sb = ReturnType<typeof supabaseForUser>;

// Per-account call cap: mcp_abuse_cap_check with the caps from ./limits. The member sees which limit and when it resets.
export async function guard(ctx: ToolContext): Promise<Sb> {
  if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated.");
  const sb = supabaseForUser(ctx);
  const { data, error } = await sb.rpc("mcp_abuse_cap_check", { _hourly: MCP_HOURLY_CAP, _daily: MCP_DAILY_CAP });
  let cap: CapResult;
  if (error && isMissingFunction(error)) {
    // Migration 0017 not applied yet: fall back to the older cap (true = allowed) so the connector keeps working.
    const old = await sb.rpc("mcp_abuse_cap_hit");
    if (old.error) throw new ToolError(DB_UNAVAILABLE);
    cap = old.data === true ? { ok: true } : { ok: false, limit: "hourly" };
  } else {
    if (error) throw new ToolError(DB_UNAVAILABLE);
    cap = (data ?? { ok: false }) as CapResult;
  }
  if (!cap.ok) {
    await logWorkflow(sb, { event_type: "failure", tool: "guard", error_code: cap.limit === "daily" ? "cap_hit_daily" : "cap_hit_hourly" });
    throw new ToolError(capMessage(cap));
  }
  // Membership entitlement, before any job read or write. Cached ~5 minutes in the database.
  const ent = await checkAthenaEntitlement(sb);
  if (!ent.allowed && ent.reason === "unavailable") throw new ToolError(DB_UNAVAILABLE);
  if (!ent.allowed) {
    await logWorkflow(sb, { event_type: "failure", tool: "guard", error_code: "membership_inactive" });
    throw new ToolError(INACTIVE_MESSAGE);
  }
  return sb;
}

export function isMissingFunction(e: { code?: string; message?: string }): boolean {
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? "");
}

/** Map database errors raised by the mcp_* functions to member-facing messages. */
export function dbError(error: { message?: string } | null): never {
  const m = error?.message ?? "";
  if (m.startsWith("MCP_BAD:")) throw new ToolError(m.slice(8));
  if (m.includes("MCP_INACTIVE")) throw new ToolError(INACTIVE_MESSAGE);
  if (m.includes("MCP_NO_JOB")) throw new ToolError("Job not found.");
  if (m.includes("MCP_NO_ITEM")) throw new ToolError("Item not found.");
  if (m.includes("MCP_NO_COMPANY")) throw new ToolError("You aren't a member of that company.");
  throw new Error(m || "database error");
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

/** Guard + run + log failures.
 * 0.8.7: the date sweep shows only at the first call of a session (job open) or when the member asks for it
 * (list_open_items date_sweep: true). It no longer rides on every list_open_items call.
 * report never carries it, so it is never prepended to an SOV or any other deliverable. */
const NEVER_SWEEP = new Set(["jobs_list", "drawing_sets_list", "report", "pm_meeting", "pm_morning", "pm_evening", "athena_morning_hitlist", "athena_hello", "morning_brief", "morning_brief_settings", "list_open_items", "lookahead_get"]);
NEVER_SWEEP.add("project_documents");
NEVER_SWEEP.add("getting_started");
for (const tool of ["billing_evidence_read", "billing_evidence_record", "job_cost_submissions_read", "job_cost_submission_record", "job_cost_accounting_record", "job_cost_pm_payment_approval"]) NEVER_SWEEP.add(tool);
for (const tool of ["change_order_log", "change_order_record", "rfi_log", "rfi_record", "rfc_log", "rfc_record"]) NEVER_SWEEP.add(tool);

/** opts: a lookahead id, or { lookaheadId, jobNumber, client }. With a job number the date sweep shows that job only. */
export async function run<R>(tool: string, ctx: ToolContext, opts: string | undefined | { lookaheadId?: string; jobNumber?: string; companyId?: string; client?: boolean; ownerSov?: boolean; sweep?: boolean }, fn: (sb: Sb) => Promise<R>): Promise<R> {
  const o = typeof opts === "object" ? opts : { lookaheadId: opts };
  const lookaheadId = o.lookaheadId;
  const sweepScope: SweepScope = { jobNumber: o.jobNumber, client: o.client };
  const sb = await guard(ctx);
  // 0.8.22: success-call log, heavy-tool cap, security flags, optional soft lock and the company canary.
  const sig = getCallSignals(ctx as unknown as object);
  const touch = await securityTouch(sb as never, tool, o.jobNumber ?? sig?.jobNumber ?? null, sig?.signals ?? []);
  enforceTouch(touch);
  let sweep: Awaited<ReturnType<typeof runSweep>> = null;
  let freshSession = false;
  try {
    const fresh = await sb.rpc("mcp_session_touch");
    freshSession = fresh.data === true;
    if (!NEVER_SWEEP.has(tool) && (fresh.data === true || o.sweep === true)) sweep = await runSweep(sb, sweepScope);
  } catch {
    sweep = null; // the sweep never blocks the tool itself
  }
  try {
    const upgrade = estimatingTool(tool) && o.jobNumber ? await estimatingUpgrade(sb, o.jobNumber, o.companyId) : null;
    const r = upgrade ? { content: [{ type: "text", text: renderMarkdown(upgrade) }], structuredContent: { card: upgrade, html: renderHtml(upgrade), upgrade_required: true, plan: "athena_office" }, _meta: { "openai/outputTemplate": TAKEOFF_CARD_URI, ui: { resourceUri: TAKEOFF_CARD_URI } } } as R : await fn(sb);
    // Source reading feeds the host model exact text, not a dashboard widget.
    // Keep the shared entitlement, RLS, call caps and security touch above; avoid
    // sweeps, reminders or presentation transforms changing the source response.
    if (tool === "project_documents") return r;
    // The host-display block rides on every result (assistant_guidance only; members never see it).
    // Card pass is presentation after the guard. It does not change auth, entitlement, or the sweep.
    let swept = sweep ? withSweep(r, sweep, sweepScope.client === true, o.ownerSov === true) : r;
    const sweptText = (swept as { content?: { text?: string }[] })?.content?.find((c) => c.text)?.text ?? "";
    if (tool === "list_open_items" && /No job named/.test(sweptText)) swept = r;
    const finalized = finalizeVisible(swept, tool.startsWith("submittal") ? [] : [HOST_DISPLAY_BLOCK]);
    const cardFirst = isCardFirstTool(tool, finalized);
    const visible = cardFirst ? finalized : withStyleLine(finalized);
    const carded = attachAthenaCard(tool, visible);
    const reminded = cardFirst || tool === "getting_started" ? carded : await attachDailyReminder(sb as never, o.jobNumber ?? sig?.jobNumber ?? null, carded);
    const started = await attachGettingStarted(sb as never, reminded, { prepend: !cardFirst });
    const sealed = sealCardReply(tool, started);
    const morning = await attachMorningCard(sb as never, sealed, { fresh: freshSession, explicit: tool === "morning_brief" });
    return displayFactsResult(stampCanary(morning, touch.canary));
  } catch (e) {
    if (e instanceof WhichCompanyAsk) {
      const reply = whichCompanyReply(e);
      const carded = attachAthenaCard(tool, finalizeVisible(reply, tool.startsWith("submittal") ? [] : [HOST_DISPLAY_BLOCK]));
      return displayFactsResult(stampCanary(sealCardReply(tool, carded), touch.canary)) as R;
    }
    await logWorkflow(sb, {
      event_type: "failure",
      tool,
      lookahead_id: lookaheadId && /^[0-9a-f-]{36}$/i.test(lookaheadId) ? lookaheadId : null,
      error_code: e instanceof ToolError ? "tool_error" : "internal",
    });
    if (e instanceof ToolError) throw new ToolError(splitGuidance(e.message).visible.trim() || e.message);
    throw new ToolError("Something went wrong. Try again in a moment.");
  }
}

export function text(body: string) {
  return { content: [{ type: "text" as const, text: body + FOOTER }] };
}

function whichCompanyReply(ask: WhichCompanyAsk) {
  const rows = ask.matches.map((match) => ({
    cells: [`${match.company_name}: ${ask.jobNumber}${match.job_name ? ` (${match.job_name})` : ""}`],
    tone: "action" as const,
  }));
  const card: CardModel = {
    state: "ask",
    title: "Which company?",
    show_state: false,
    ask: { prompt: ask.creating ? `Which company should job ${ask.jobNumber} be created in?` : `Which company is job ${ask.jobNumber} in?` },
    sections: [{ heading: "Companies", kind: "list", rows }],
    next_move: ask.creating ? "Name the company. Nothing was created." : "Name the company.",
  };
  const body = `${renderMarkdown(card)}\n\n${htmlBlock(renderHtml(card))}`;
  return guide(
    { ...text(body), structuredContent: { card, which_company: true, job_number: ask.jobNumber, companies: ask.matches } },
    "Wait for the company. Pass company_id on the next call. Nothing was changed.",
  );
}

/** ownerSov: the body is the server-built owner SOV (full job access only), the one client-facing output that carries dollars.
 * Its body keeps its amounts and fee line; the date sweep above it is still filtered. */
function withSweep<R>(r: R, sweep: NonNullable<Awaited<ReturnType<typeof runSweep>>>, client = false, ownerSov = false): R {
  const res = r as unknown as { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };
  if (!res?.content?.length || res.content[0].type !== "text") return r;
  const body = res.content[0].text ?? "";
  const sweepText = client ? clientSafe(sweep.text) : sweep.text;
  const bodyText = client && !ownerSov ? clientSafe(body) : body;
  const first = { ...res.content[0], text: `${REMINDERS_VIEW_SPEC.join("\n")}\n${sweepText}\n\n====\n\n${bodyText}` };
  const items = sweep.items.map((i) => ({ job_number: i.job_number, item_ref: client ? null : i.item_ref, item_id: client ? null : i.item_id, item_type: i.item_type, due: i.due, days: i.days, bucket: i.bucket }));
  return { ...res, content: [first, ...res.content.slice(1)], structuredContent: { ...(res.structuredContent ?? {}), sweep: items, sweep_display: { required: true, render: "grouped_cards", groups: ["Overdue", "Due this week", "Later"], countdown_chips: true, never_bullets: true } } } as unknown as R;
}
