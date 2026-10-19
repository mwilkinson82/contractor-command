import { shortRef } from "./refs";
// Server-side workflow: checklist evaluation and fixed report rendering.
// Rule types and required inputs are never returned to the host.
import { ToolError } from "@lovable.dev/mcp-js";
import { logWorkflow, type Sb } from "./guard";

export const INPUT_KEYS = ["schedule_export", "lookahead_dates", "crews", "submittal_log", "rfi_log", "inspection_list", "deliveries"] as const;
export type InputKey = (typeof INPUT_KEYS)[number];

export const INPUT_LABELS: Record<InputKey, string> = {
  schedule_export: "Schedule export (activity list with IDs, dates and predecessors, as text/CSV)",
  lookahead_dates: "Lookahead start and end dates (YYYY-MM-DD)",
  crews: "Crews/subs by day with headcount and foreman",
  submittal_log: "Submittal log (item, status, activity it releases)",
  rfi_log: "RFI log (number, status, owner, activity it blocks, date needed)",
  inspection_list: "Inspection list (type, required date, requested yes/no, prerequisites)",
  deliveries: "Deliveries (material, confirmed date, staging, receiver)",
};

export type Check = {
  key: string;
  version: number;
  category: string;
  trade: string;
  prompt: string;
  rule_type: "confirm" | "list";
  required_inputs: string[];
  severity: "low" | "medium" | "high";
  position: number;
};

export type Lookahead = {
  id: string;
  job_id: string;
  start_date: string | null;
  end_date: string | null;
  provided_inputs: string[];
  missing_inputs: string[];
};

export async function loadLookahead(sb: Sb, id: string): Promise<Lookahead> {
  const { data, error } = await sb
    .from("mcp_lookaheads")
    .select("id, job_id, start_date, end_date, provided_inputs, missing_inputs")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ToolError("Lookahead not found. Use the lookahead_id returned by intake.");
  return data as Lookahead;
}

// Checklist rules are hidden from members at the database level; only the server (after guard()) reads them.
export async function loadChecks(_sb: Sb): Promise<Check[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("mcp_checklist_items")
    .select("key, version, category, trade, prompt, rule_type, required_inputs, severity, position")
    .eq("module", "lookahead") // job_setup checks share this table; a look-ahead walks only its own.
    .eq("active", true);
  if (error) throw new Error(error.message);
  const latest = new Map<string, Check>();
  for (const c of (data ?? []) as Check[]) {
    const prev = latest.get(c.key);
    if (!prev || c.version > prev.version) latest.set(c.key, c);
  }
  return [...latest.values()].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

type Answer = { check_key: string; status: string; response: string | null };

export async function loadAnswers(sb: Sb, lookaheadId: string): Promise<Answer[]> {
  const { data, error } = await sb.from("mcp_answers").select("check_key, status, response").eq("lookahead_id", lookaheadId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Answer[];
}

/** Returns the current check to ask, recording checks whose required inputs are missing as unknown. */
export async function currentCheck(sb: Sb, la: Lookahead, tool: string) {
  const checks = await loadChecks(sb);
  const done = new Set((await loadAnswers(sb, la.id)).map((a) => a.check_key));
  for (const c of checks) {
    if (done.has(c.key)) continue;
    const missing = c.required_inputs.filter((i) => !la.provided_inputs.includes(i));
    if (missing.length) {
      const { error } = await sb.from("mcp_answers").insert({
        lookahead_id: la.id,
        check_key: c.key,
        check_version: c.version,
        status: "skipped_missing_inputs",
        detail: missing.join(","),
      });
      if (error && error.code !== "23505") throw new Error(error.message);
      await logWorkflow(sb, { event_type: "missing_question", tool, lookahead_id: la.id, check_key: c.key });
      continue;
    }
    return { check: c, index: checks.indexOf(c) + 1, total: checks.length };
  }
  return { check: null, index: checks.length, total: checks.length };
}

const SEV = { high: 0, medium: 1, low: 2 } as Record<string, number>;

type Item = {
  id: string;
  action: string;
  owner: string;
  due_date: string | null;
  severity: string;
  trade: string;
  category: string;
  status: string;
  carry_count: number;
};

export async function renderReport(sb: Sb, la: Lookahead) {
  const [{ data: job }, { data: itemsRaw, error: ie }, answers, checks] = await Promise.all([
    sb.from("mcp_jobs").select("name, job_number").eq("id", la.job_id).maybeSingle(),
    sb.from("mcp_open_items").select("id, action, owner, due_date, severity, trade, category, status, carry_count").eq("lookahead_id", la.id).eq("status", "open"),
    loadAnswers(sb, la.id),
    loadChecks(sb),
  ]);
  if (ie) throw new Error(ie.message);
  const items = ((itemsRaw ?? []) as Item[]).sort(
    (a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
  );
  const byKey = new Map(checks.map((c) => [c.key, c]));
  const answered = new Map(answers.map((a) => [a.check_key, a]));
  const due = (d: string | null) => d ?? "unknown";
  const out: string[] = [];
  const window = `${la.start_date ?? "unknown"} to ${la.end_date ?? "unknown"}`;
  out.push(`TWO-WEEK LOOKAHEAD REPORT`, `Job: ${job?.name ?? "unknown"}${job?.job_number ? ` (#${job.job_number})` : ""}`, `Window: ${window}`, `Lookahead ID: ${la.id}`, "");

  out.push("1. HIT LIST");
  if (!items.length) out.push("   None.");
  items.forEach((it, i) => out.push(`   ${i + 1}. ${it.action} | Owner: ${it.owner} | Due: ${due(it.due_date)}${it.carry_count ? ` | Carried ${it.carry_count}x` : ""} [ref ${shortRef(it.id)}]`));
  out.push("");

  out.push("2. QUESTIONS BY TRADE");
  const qs = new Map<string, string[]>();
  for (const c of checks) {
    const a = answered.get(c.key);
    let tag: string | null = null;
    if (!a) tag = "not yet answered";
    else if (a.status === "unknown") tag = "answered unknown";
    else if (a.status === "skipped_missing_inputs") tag = "inputs missing";
    if (!tag) continue;
    if (!qs.has(c.trade)) qs.set(c.trade, []);
    qs.get(c.trade)!.push(`   - ${c.prompt} (${tag})`);
  }
  if (!qs.size) out.push("   None.");
  for (const [trade, lines] of [...qs.entries()].sort()) out.push(`   [${trade}]`, ...lines);
  out.push("");

  out.push("3. AT-RISK ITEMS");
  const risk = items.filter((i) => i.severity === "high");
  if (!risk.length) out.push("   None.");
  risk.forEach((it) => out.push(`   - ${it.category}: ${it.action} | Owner: ${it.owner} | Due: ${due(it.due_date)}`));
  out.push("");

  out.push("4. DATED FOLLOW-UPS");
  const dated = items.filter((i) => i.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  if (!dated.length) out.push("   None.");
  dated.forEach((it) => out.push(`   - ${it.due_date}: ${it.action} | Owner: ${it.owner}`));
  out.push("");

  out.push("5. UNKNOWNS");
  const unk: string[] = [];
  for (const k of la.missing_inputs) unk.push(`   - Missing input: ${INPUT_LABELS[k as InputKey] ?? k}`);
  for (const a of answers) {
    const c = byKey.get(a.check_key);
    if (a.status === "unknown") unk.push(`   - Answered unknown: ${c?.prompt ?? a.check_key}`);
    if (a.status === "skipped_missing_inputs") unk.push(`   - Not checked (inputs missing): ${c?.prompt ?? a.check_key}`);
  }
  for (const it of items) {
    if (it.owner === "unknown") unk.push(`   - No owner: ${it.action}`);
    if (!it.due_date) unk.push(`   - No due date: ${it.action}`);
  }
  if (!unk.length) out.push("   None.");
  out.push(...unk);
  return out.join("\n");
}
