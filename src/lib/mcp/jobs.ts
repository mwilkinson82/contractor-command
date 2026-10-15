// Module 1 (Job Setup): company + job resolution and the fixed setup report.
// Rule evaluation (applies_when, N/A suppression, resolution rules) lives in the database mcp_* functions.
import { ToolError } from "@lovable.dev/mcp-js";
import { dbError, type Sb } from "./guard";

export type Job = { job_id: string; job_number: string; name: string; company_id: string; scope?: "full" | "contract" };

export async function resolveCompany(sb: Sb, companyId?: string): Promise<string> {
  // Companies are only visible to their members (RLS), so this is "my companies".
  const { data, error } = await sb.from("mcp_companies").select("id, name");
  if (error) throw new Error(error.message);
  const mine = (data ?? []).map((c) => ({ company_id: c.id, mcp_companies: { name: c.name } }));
  if (companyId) {
    if (!mine.some((m) => m.company_id === companyId)) throw new ToolError("You aren't a member of that company.");
    return companyId;
  }
  if (!mine.length) {
    const nr = await sb.rpc("mcp_caller_is_no_access_role");
    if (nr.data === true) throw new ToolError("Your role doesn't have access to the PM agent. Ask your company owner if you need it.");
  }
  if (!mine.length) throw new ToolError('No company set up yet. Call onboarding with action "save_company" first.');
  if (mine.length > 1) {
    throw new ToolError(`You belong to more than one company. Pass company_id:\n${mine.map((m) => `- ${m.company_id}: ${m.mcp_companies?.name ?? "unknown"}`).join("\n")}`);
  }
  return mine[0].company_id;
}

/** Exact job-number match only. Anything else returns "Did you mean…" without acting. */
export async function resolveJob(sb: Sb, jobNumber: string, companyId?: string): Promise<Job> {
  const company = await resolveCompany(sb, companyId);
  const { data, error } = await sb.rpc("mcp_resolve_job", { _company: company, _job_number: jobNumber });
  if (error) dbError(error);
  const r = data as unknown as Partial<Job> & { not_found?: boolean; suggestions?: { job_number: string; name: string }[] };
  if (r.not_found || !r.job_id) {
    const s = r.suggestions ?? [];
    if (s.length) throw new ToolError(`No job ${jobNumber}. Did you mean ${s.map((x) => `job ${x.job_number} (${x.name})`).join(" or ")}? Nothing was changed.`);
    throw new ToolError(`No job ${jobNumber} in this company. Create it with intake section "create_job".`);
  }
  return r as Job;
}

export async function audit(sb: Sb, job: Job | null, tool: string, action: string, objectId?: string | null, companyId?: string | null) {
  try {
    await sb.rpc("mcp_audit", {
      _company: (job?.company_id ?? companyId ?? null) as string,
      _job_number: (job?.job_number ?? null) as string,
      _tool: tool,
      _action: action,
      _object: (objectId ?? null) as string,
    });
  } catch {
    // audit never breaks a call
  }
}

export const prefix = (job: Job) => `${job.job_number} – `;

const CLIENT_SCRUB = /budget|margin|contingency|\bIOR\b|cost[- ]to[- ]complete|strategy|profit|fee\b/i;

type Fact = { module: string; key: string; value: unknown; status: string; source: string; internal_only: boolean; updated_at: string };
type Flag = { flag_key: string; value: string; source: string; set_at: string };
type Item = {
  id: string; action: string; accountable: string | null; owner: string; needed_by: string | null; due_date: string | null; severity: string;
  status: string; section: string | null; check_key: string; kind: string; commercial_type: string | null; internal_only: boolean;
  verify_state: string; verified_at: string | null; reported_by: string | null; reported_at: string | null; source: string | null;
  cost_effect: string | null; time_effect: string | null; cash_effect: string | null; effect_is_estimate: boolean;
  next_action: string | null; next_action_approved_by: string | null; updated_at: string; category: string;
  item_type: string | null; recommendation: string | null; why: string | null; help_offer: string | null; waiting_on_document: string | null;
  waiting_on_who: string | null; waiting_since: string | null; clause_source: string | null; delivery_method: string | null; recipient: string | null;
};
export type { Item };
type Na = { scope: string; target: string; reason: string; set_at: string };

export const ITEM_COLS =
  "id, action, accountable, owner, needed_by, due_date, severity, status, section, check_key, kind, commercial_type, internal_only, verify_state, verified_at, reported_by, reported_at, source, cost_effect, time_effect, cash_effect, effect_is_estimate, next_action, next_action_approved_by, updated_at, category, item_type, recommendation, why, help_offer, waiting_on_document, waiting_on_who, waiting_since, clause_source, delivery_method, recipient";

export async function activeNa(sb: Sb, jobId: string): Promise<Na[]> {
  const { data, error } = await sb.from("mcp_job_na").select("scope, target, reason, set_at").eq("job_id", jobId).eq("active", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as Na[];
}

export function naLabel(it: Pick<Item, "section" | "check_key">, nas: Na[]): string | null {
  const hit = nas.some(
    (n) => (n.scope === "section" && n.target === it.section) || (n.scope === "item" && it.check_key === `setup:${n.target}`),
  );
  return hit ? "section N/A — needs disposition" : null;
}

/** Effective type: items sitting under an active N/A are na_disposition while the N/A stands. */
export function itemType(it: Pick<Item, "section" | "check_key" | "item_type">, nas: Na[]): string {
  if (naLabel(it, nas)) return "na_disposition";
  return it.item_type && it.item_type !== "na_disposition" ? it.item_type : "deadline";
}

function typeDetail(it: Item, t: string, client: boolean) {
  if (t === "no") return ` | Recommendation: ${it.recommendation ?? "none recorded"} | Why: ${it.why ?? "best-practice gap"} | ${it.help_offer ?? "The PM agent can help with this."}`;
  if (t === "pending_document") return ` | Waiting on: ${it.waiting_on_document ?? "unknown document"} from ${it.waiting_on_who ?? "unknown"} since ${it.waiting_since ?? "unknown"}`;
  if (t === "deadline") return ` | Clause/source: ${it.clause_source ?? "unknown"} | Method: ${it.delivery_method ?? "unknown"} | Recipient: ${it.recipient ?? "unknown"}`;
  if (t === "unknown") return " | Needs confirming evidence or a dated member statement";
  return client ? "" : "";
}

export function itemLine(it: Item, nas: Na[], client = false) {
  const status = it.verify_state === "verified" ? `verified ${it.verified_at?.slice(0, 10) ?? ""}` : `last reported by ${it.reported_by ?? "unknown"} ${it.reported_at?.slice(0, 10) ?? ""}`;
  const effects = client
    ? `time: ${it.time_effect ?? "unknown"}`
    : `cost: ${it.cost_effect ?? "unknown"} | time: ${it.time_effect ?? "unknown"} | cash: ${it.cash_effect ?? "unknown"}${it.effect_is_estimate ? " (estimate)" : ""}`;
  const na = naLabel(it, nas);
  const next = !client && it.next_action ? ` | Next: ${it.next_action}${it.next_action_approved_by ? ` (approved by ${it.next_action_approved_by})` : " (not yet approved)"}` : "";
  const t = itemType(it, nas);
  return `[${t}] ${it.action} | Accountable: ${it.accountable ?? it.owner} | Needed by: ${it.needed_by ?? it.due_date ?? "unknown"} | ${status.trim()} | Source: ${it.source ?? "unknown"} | ${effects}${next}${typeDetail(it, t, client)}${na ? ` | ${na}` : ""} [item ${it.id}]`;
}

const SECTION_TITLES: Record<string, string> = {
  applicability: "APPLICABILITY",
  contract: "CONTRACT TERMS",
  handoff: "ESTIMATE-TO-EXECUTION HANDOFF",
  budget: "BUDGET AND SOV",
  warranty: "WARRANTY REGISTER",
};

function show(v: unknown): string {
  if (v === null || v === undefined) return "unknown";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export async function renderSetupReport(sb: Sb, job: Job, audience: "internal" | "client") {
  const client = audience === "client";
  const contractOnly = job.scope === "contract";
  const hideMoney = client || contractOnly;
  const [co, flagsR, factsR, itemsR, nas] = await Promise.all([
    sb.from("mcp_companies").select("name, agent_name").eq("id", job.company_id).maybeSingle(),
    sb.from("mcp_job_flags").select("flag_key, value, source, set_at").eq("job_id", job.job_id),
    sb.from("mcp_job_facts").select("module, key, value, status, source, internal_only, updated_at").eq("job_id", job.job_id),
    sb.from("mcp_open_items").select(ITEM_COLS).eq("job_id", job.job_id).eq("status", "open"),
    activeNa(sb, job.job_id),
  ]);
  for (const r of [flagsR, factsR, itemsR]) if (r.error) throw new Error(r.error.message);
  const flags = (flagsR.data ?? []) as Flag[];
  let facts = (factsR.data ?? []) as Fact[];
  let items = (itemsR.data ?? []) as unknown as Item[];
  if (hideMoney) {
    facts = facts.filter((f) => !f.internal_only && !CLIENT_SCRUB.test(f.key));
    items = items.filter((i) => !i.internal_only && !CLIENT_SCRUB.test(`${i.action} ${i.category}`));
  }
  const dates = [...flags.map((f) => f.set_at), ...facts.map((f) => f.updated_at), ...items.map((i) => i.updated_at)].filter(Boolean).sort();
  const dataThrough = dates.length ? dates[dates.length - 1].slice(0, 10) : "no data yet";
  const sectionNa = new Set(nas.filter((n) => n.scope === "section").map((n) => n.target));
  const out: string[] = [];
  out.push(
    `${prefix(job)}JOB SETUP REPORT (${client ? "CLIENT-FACING" : contractOnly ? "INTERNAL — CONTRACT SIDE ONLY" : "INTERNAL"})`,
    `Job: ${job.job_number} – ${job.name}`,
    `Company: ${co.data?.name ?? "unknown"} | Prepared by: ${co.data?.agent_name ?? "PM agent"}`,
    `Data through: ${dataThrough}`,
    "",
  );
  let n = 1;
  const modules = contractOnly ? ["contract"] : client ? ["applicability", "contract", "warranty"] : ["applicability", "contract", "handoff", "budget", "warranty"];
  for (const mod of modules) {
    const sectionItems = items.filter((i) => i.section === mod);
    out.push(`${n++}. ${SECTION_TITLES[mod]}`);
    if (sectionNa.has(mod)) {
      const reason = nas.find((x) => x.scope === "section" && x.target === mod)?.reason;
      out.push(`   Marked N/A for this job (${reason ?? "no reason"}).`);
      if (sectionItems.length) {
        out.push("   Section N/A — needs disposition:");
        sectionItems.forEach((it) => out.push(`   - ${itemLine(it, nas, hideMoney)}`));
      }
      out.push("");
      continue;
    }
    if (mod === "applicability") {
      if (!flags.length) out.push("   None recorded.");
      flags.sort((a, b) => a.flag_key.localeCompare(b.flag_key)).forEach((f) => out.push(`   - ${f.flag_key.replace(/_/g, " ")}: ${f.value} (${f.source.replace(/_/g, " ")})`));
    } else if (mod === "budget") {
      const budget = facts.filter((f) => f.module === "budget");
      const sov = facts.filter((f) => f.module === "sov");
      out.push("   Internal cost budget (internal only):");
      if (!budget.length) out.push("   - none recorded");
      budget.forEach((f) => out.push(`   - ${f.key}: ${show(f.value)}`));
      out.push("   Owner SOV:");
      if (!sov.length) out.push("   - none recorded");
      sov.forEach((f) => out.push(`   - ${f.key}: ${show(f.value)}`));
    } else {
      const fs = facts.filter((f) => f.module === mod);
      if (!fs.length) out.push("   Not started.");
      fs.forEach((f) => out.push(`   - ${f.key.replace(/_/g, " ")}: ${f.status === "known" ? show(f.value) : f.status} (${f.source.replace(/_/g, " ")})`));
    }
    if (sectionItems.length) {
      out.push("   Open items:");
      sectionItems.forEach((it) => out.push(`   - ${itemLine(it, nas, hideMoney)}`));
    }
    out.push("");
  }
  if (client) {
    const sov = facts.filter((f) => f.module === "sov");
    out.push(`${n++}. SCHEDULE OF VALUES`);
    if (!sov.length) out.push("   None recorded.");
    sov.forEach((f) => {
      const v = (f.value ?? {}) as { description?: string; billable_value?: number };
      out.push(`   - ${f.key}: ${v.description ?? ""} ${v.billable_value ?? "unknown"}`);
    });
    out.push("");
  }
  const shown = new Set(modules);
  const other = items.filter((i) => !i.section || !shown.has(i.section));
  out.push(`${n++}. OTHER OPEN ITEMS AND OBLIGATIONS`);
  if (!other.length) out.push("   None.");
  other
    .sort((a, b) => (a.needed_by ?? "9999").localeCompare(b.needed_by ?? "9999"))
    .forEach((it) => out.push(`   - ${itemLine(it, nas, hideMoney)}`));
  out.push("");
  out.push(`${n++}. UNKNOWNS`);
  const unk = [
    ...flags.filter((f) => f.value === "unknown").map((f) => `   - Applicability unknown: ${f.flag_key.replace(/_/g, " ")}`),
    ...facts.filter((f) => f.status === "unknown").map((f) => `   - ${f.module}: ${f.key.replace(/_/g, " ")}`),
  ];
  if (!unk.length) out.push("   None.");
  out.push(...unk);
  return out.join("\n");
}
