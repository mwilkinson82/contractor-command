import { reminderSource } from "./views";
import { FLAG_CLAUSE, effectiveFlag } from "./clauses";
// Module 1 (Job Setup): company + job resolution and the fixed setup report.
// Rule evaluation (applies_when, N/A suppression, resolution rules) lives in the database mcp_* functions.
import { CONTRACT_WARRANTY_KEY, alignCloseoutSource, renderWarrantyRegister } from "./warranty";
import { whoForJob } from "./people";
import { displayRef } from "./refs";
import { clientSafe, withoutContactPii } from "./client-safe";
import { draftGuidance, draftIdentityText } from "./drafts";
import { ToolError } from "@lovable.dev/mcp-js";
import { dbError, type Sb } from "./guard";
import { withoutClaims } from "./internal-claims";
import { clauseLine, isClaimClause, missingNotices, type ClauseRow, legacySourceLabel, LEGACY_SUMMARY_TAG, OLD_SUMMARY_TAG, SUMMARY_OFFER, SUMMARY_HEADING } from "./contract-clauses";
import { noticeRequirements } from "./notice-plain";
import { DEFAULT_TZ, dateIn, todayIn } from "./deadlines";

export type Job = { job_id: string; job_number: string; name: string; company_id: string; scope?: "full" | "contract" | "super" };

const companyNames = (m: { mcp_companies: { name: string | null } }[]) => m.map((c) => c.mcp_companies.name ?? "unnamed company").join("; ");

export const MULTI_COMPANY_ASK = "You belong to more than one company. Which one should Athena use? I'll remember it, so you only answer this once (call set_current_company with that name).";

export type MemberCompany = { id: string; name: string };

/** Saved current company from mcp_user_settings. Read on every call so two hosts for the same member see the same company. */
export async function currentCompany(sb: Sb): Promise<string | null> {
  const cur = await sb.from("mcp_user_settings").select("current_company").maybeSingle();
  return (cur.data as { current_company?: string | null } | null)?.current_company ?? null;
}
/** Save the company the member just named as their current one. */
export async function rememberCompany(sb: Sb, companyId: string): Promise<void> {
  try {
    await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ error: unknown }>)("mcp_set_current_company", { _company: companyId });
  } catch { /* the call still works with the named company */ }
}
export const _resetCurrentCompanyCache = () => {};

/** Companies the caller belongs to, in a stable order: name, then id. */
export async function memberCompanies(sb: Sb): Promise<MemberCompany[]> {
  const { data, error } = await sb.from("mcp_companies").select("id, name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string | null }[])
    .map((c) => ({ id: c.id, name: (c.name ?? "").trim() || "unnamed company" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type CompanyChoice = { companyId: string } | { ask: MemberCompany[] };

/**
 * A new job is written in the active company. A named company is used only when it is the active one,
 * or when no company is active yet. A different name does not move the job.
 */
export function companyForCreate(input: { companies: MemberCompany[]; activeId: string | null; namedId: string | null }): CompanyChoice {
  const companies = [...input.companies].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const active = input.activeId && companies.some((c) => c.id === input.activeId) ? input.activeId : companies.length === 1 ? companies[0].id : null;
  if (input.namedId && companies.some((c) => c.id === input.namedId) && (!active || input.namedId === active)) return { companyId: input.namedId };
  if (active) return { companyId: active };
  if (!companies.length) return { ask: [] };
  return { ask: companies };
}

export type CompanyJobHit = Job & { company_name: string };

/** More than one company has this job number. The tool returns a card instead of guessing. */
export class WhichCompanyAsk extends Error {
  readonly jobNumber: string;
  readonly matches: { company_id: string; company_name: string; job_name: string }[];
  readonly creating: boolean;
  constructor(jobNumber: string, matches: { company_id: string; company_name: string; job_name: string }[], creating = false) {
    super("Which company?");
    this.name = "WhichCompanyAsk";
    this.jobNumber = jobNumber;
    this.matches = matches;
    this.creating = creating;
  }
}

export function isWhichCompanyAsk(e: unknown): e is WhichCompanyAsk {
  return e instanceof WhichCompanyAsk;
}

export async function resolveCompany(sb: Sb, companyId?: string): Promise<string> {
  // Companies are only visible to their members (RLS), so this is "my companies".
  const companies = await memberCompanies(sb);
  const mine = companies.map((c) => ({ company_id: c.id, mcp_companies: { name: c.name } }));
  if (companyId) {
    // Accept the company's id or its name (plain-text hosts only see names).
    const want = companyId.trim().toLowerCase();
    const byId = companies.find((m) => m.id === want);
    const byName = companies.filter((m) => m.name.trim().toLowerCase() === want);
    const hit = byId?.id ?? (byName.length === 1 ? byName[0].id : null);
    if (hit) {
      // Naming a company makes it the member's current company, so later calls don't ask again.
      if (companies.length > 1) await rememberCompany(sb, hit);
      return hit;
    }
    throw new ToolError(companies.length > 1 ? `You aren't a member of a company called "${companyId.trim()}". Your companies: ${companyNames(mine)}.` : "You aren't a member of that company.");
  }
  if (!companies.length) {
    const nr = await sb.rpc("mcp_caller_is_no_access_role");
    if (nr.data === true) throw new ToolError("Your role doesn't have access to Athena. Ask your company owner if you need it.");
  }
  if (!companies.length) throw new ToolError('No company set up yet. Call onboarding with action "save_company" first.');
  if (companies.length > 1) {
    // The member's saved current company is used when they didn't name one. Same row for every host.
    const curId = await currentCompany(sb);
    if (curId && companies.some((m) => m.id === curId)) return curId;
    // Never pick one silently. Ask once; the answer is saved (set_current_company, or naming it on the next call).
    throw new ToolError(`${MULTI_COMPANY_ASK} Your companies: ${companyNames(mine)}. Nothing was changed.`);
  }
  return companies[0].id;
}

/** Exact job-number match only. Anything else returns "Did you mean…" without acting. */
export const READ_ONLY_MESSAGE = "Your role has a limited, read-only view of this job (no financials). Ask your owner or PM to make changes.";
export const FULL_ACCESS_MESSAGE = "This needs full access to the job. Your role can't do it.";

/** need "write": anything but the read-only Super view; need "full": full job scope only. Re-checked by the database on every write. */
export async function resolveJob(sb: Sb, jobNumber: string, companyId?: string, need?: "write" | "full"): Promise<Job> {
  const job = await resolveJobRaw(sb, jobNumber, companyId);
  if (need === "write" && job.scope === "super") throw new ToolError(READ_ONLY_MESSAGE);
  if (need === "full" && job.scope !== "full") throw new ToolError(job.scope === "super" ? READ_ONLY_MESSAGE : FULL_ACCESS_MESSAGE);
  return job;
}

type JobLookup = Partial<Job> & { not_found?: boolean; suggestions?: { job_number: string; name: string }[] };

async function lookupJob(sb: Sb, companyId: string, jobNumber: string): Promise<JobLookup> {
  const { data, error } = await sb.rpc("mcp_resolve_job", { _company: companyId, _job_number: jobNumber });
  if (error) dbError(error);
  return (data ?? { not_found: true, suggestions: [] }) as JobLookup;
}

function namedCompanyId(companies: MemberCompany[], companyId?: string): string | null {
  const want = companyId?.trim().toLowerCase();
  if (!want) return null;
  const byId = companies.find((company) => company.id === want);
  if (byId) return byId.id;
  const byName = companies.filter((company) => company.name.trim().toLowerCase() === want);
  return byName.length === 1 ? byName[0].id : null;
}

async function resolveJobRaw(sb: Sb, jobNumber: string, companyId?: string): Promise<Job> {
  const companies = await memberCompanies(sb);
  if (!companies.length) await resolveCompany(sb);
  const hits: CompanyJobHit[] = [];
  const suggestions: { job_number: string; name: string }[] = [];
  for (const company of companies) {
    const r = await lookupJob(sb, company.id, jobNumber);
    if (r.job_id && r.job_number) hits.push({ ...(r as Job), company_name: company.name });
    else for (const s of r.suggestions ?? []) suggestions.push(s);
  }
  // A host often sends the active company. A number that exists on exactly one company still resolves.
  const named = namedCompanyId(companies, companyId);
  const namedHit = named ? hits.find((hit) => hit.company_id === named) : undefined;
  if (namedHit) return namedHit;
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new WhichCompanyAsk(jobNumber, hits.map((hit) => ({ company_id: hit.company_id, company_name: hit.company_name, job_name: hit.name })));
  }
  if (suggestions.length) throw new ToolError(`No job ${jobNumber}. Did you mean ${suggestions.slice(0, 3).map((x) => `job ${x.job_number} (${x.name})`).join(" or ")}? Nothing was changed.`);
  throw new ToolError(companies.length > 1 ? `No job ${jobNumber} in your companies. Create it with intake section "create_job".` : `No job ${jobNumber} in this company. Create it with intake section "create_job".`);
}

/** The job's stored time zone, or DEFAULT_TZ (America/New_York) when none is stored. */
export async function jobTimeZone(sb: Sb, jobId: string): Promise<string> {
  try {
    const { data } = await sb.from("mcp_jobs").select("time_zone").eq("id", jobId).maybeSingle();
    const tz = (data as { time_zone?: string | null } | null)?.time_zone?.trim();
    if (tz) { todayIn(tz); return tz; }
  } catch { /* unknown or invalid zone: use the default */ }
  return DEFAULT_TZ;
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

const CLIENT_SCRUB = /budget|margin|markup|forecast|overhead|\$\s?\d|contingency|\bIOR\b|cost[- ]to[- ]complete|strategy|profit|fee\b|savings[ _]split|runs the money/i;
/** Coaching or internal copy that never belongs in a client-facing report. */
export const CLIENT_COACHING = /can help you|I can help|Athena can|PM agent|the super runs|my recommendation/i;

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

function typeDetail(it: Item, t: string, client: boolean, clientFacing = false) {
  if (t === "no" && clientFacing) return "";
  // No recommendation on file (look-ahead entries have none): leave the part out rather than print "none recorded".
  if (t === "no") return `${it.recommendation ? ` | Recommendation: ${it.recommendation}` : ""} | Why: ${it.why ?? "best-practice gap"} | ${it.help_offer ?? "Athena can help with this."}`;
  if (t === "pending_document") return ` | Waiting on: ${it.waiting_on_document ?? "unknown document"} from ${it.waiting_on_who ?? "unknown"} since ${it.waiting_since ?? "unknown"}`;
  if (t === "deadline") return ` | Clause/source: ${it.clause_source ?? "unknown"} | Method: ${it.delivery_method ?? "unknown"} | Recipient: ${it.recipient ?? "unknown"}`;
  // The evidence prompt follows the resolve rule: only a confirm item (kind confirm_unknown) closes on a dated member statement.
  if (t === "unknown") return it.kind === "confirm_unknown" ? " | Needs confirming evidence or a dated member statement" : " | Needs evidence (a document or record); a member statement won't close it";
  return client ? "" : "";
}

/** Item types in words a PM reads. */
export function typeWord(t: string): string {
  return ({ deadline: "Deadline", unknown: "To confirm", no: "Gap", na_disposition: "N/A, needs a decision", pending_document: "Waiting on a document" } as Record<string, string>)[t] ?? t;
}
/** Checklist labels (A1, D9) mean something to a PM; hash refs (#36c310) don't, so they stay in structured content. */

/** Source codes in words: member_answer -> manual, other snake_case codes spaced. */
const humanSources = (l: string) => l.replace(/\bmember_answer\b/g, "manual").replace(/(Source|Clause\/source): ([a-z]+(?:_[a-z]+)+)/g, (_m, k, v) => `${k}: ${v.replace(/_/g, " ")}`);

export type LineOpts = { clientFacing?: boolean; who?: (raw: string | null | undefined) => string; tz?: string; plain?: boolean };

/** A due date the contract sets (a contract deadline item tied to a clause), as opposed to Athena's own follow-up date. */
export function isContractDate(it: Pick<Item, "item_type" | "clause_source">): boolean {
  const cs = it.clause_source ?? "";
  return it.item_type === "deadline" && !/due date set by member/i.test(cs) && (/§/.test(cs) || /\(document\)/i.test(cs));
}

export function itemLine(it: Item, nas: Na[], client = false, o: LineOpts = {}) {
  const status = it.verify_state === "verified" ? `verified ${dateIn(it.verified_at, o.tz)}` : `last reported by ${it.reported_by ?? "unknown"} ${dateIn(it.reported_at, o.tz)}`;
  const effects = client
    ? `time: ${it.time_effect ?? "unknown"}`
    : `cost: ${it.cost_effect ?? "unknown"} | time: ${it.time_effect ?? "unknown"} | cash: ${it.cash_effect ?? "unknown"}${it.effect_is_estimate ? " (estimate)" : ""}`;
  const na = naLabel(it, nas);
  const next = !client && it.next_action ? ` | Next: ${it.next_action}${it.next_action_approved_by ? ` (approved by ${it.next_action_approved_by})` : " (not yet approved)"}` : "";
  const t = itemType(it, nas);
  const who = o.who ? o.who(it.accountable ?? it.owner) : it.accountable ?? it.owner;
  const cf = o.clientFacing === true;
  // Client-facing: Athena's internal follow-up dates stay internal; only dates the contract sets are shown.
  const needed = cf && !isContractDate(it) ? "" : ` | ${cf ? "Contract due date" : "Needed by"}: ${it.needed_by ?? it.due_date ?? "unknown"}`;
  // Client-facing: who is accountable is internal staffing, so it stays out of the owner's copy.
  const ref = cf || o.plain ? "" : ` | ${displayRef(it)}`;
  const named = o.plain ? it.action.replace(/^\s*\d[\w.-]*\s*[–-]\s*/, "") : it.action;
  return humanSources(`[${typeWord(t)}] ${named}${cf ? "" : ` | Accountable: ${who}`}${needed} | ${status.trim()}${cf ? "" : ` | Source: ${reminderSource(it) ?? it.source ?? "unknown"}`} | ${effects}${next}${typeDetail(it, t, client, cf)}${na ? ` | ${na}` : ""}${ref}`);
}

const SECTION_TITLES: Record<string, string> = {
  applicability: "APPLICABILITY",
  contract: "CONTRACT TERMS",
  handoff: "ESTIMATE-TO-EXECUTION HANDOFF",
  budget: "BUDGET AND SOV",
  warranty: "WARRANTY REGISTER",
};

/** The agent's display name. The old default "PM agent" (or none) shows as "Athena PM". */
export function agentLabel(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return !n || n === "PM agent" || n === "Athena" ? "Athena PM" : n;
}

/** Applicability flags read ON / OFF / UNKNOWN. */
export function flagWord(v: string): string {
  return v === "yes" ? "ON" : v === "no" ? "OFF" : v === "na" ? "N/A" : "UNKNOWN";
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "unknown";
  if (typeof v === "string") return v;
  // Structured values (SOV lines, budget lines) read as "description: x | billable value: y", not JSON.
  if (typeof v === "object" && !Array.isArray(v))
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k.replace(/_/g, " ")}: ${Array.isArray(x) ? (x.length ? x.join(", ") : "none") : x === null || x === undefined ? "unknown" : typeof x === "object" ? JSON.stringify(x) : String(x)}`)
      .join(" | ");
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
  return JSON.stringify(v);
}

/**
 * Client copy: the internal verification tag on summary fields ("summary, not verified against the contract text") is
 * Athena's check for the PM and stays out of the owner's copy (Marshall 2026-10-20); contact emails and phone numbers
 * are withheld; then the money/margin scrub. The internal copy keeps the tag.
 */
export function clientCopy(text: string): string {
  return clientSafe(withoutContactPii(text.split(` (${LEGACY_SUMMARY_TAG})`).join("").split(` (${OLD_SUMMARY_TAG})`).join("")));
}

export async function renderSetupReport(sb: Sb, job: Job, audience: "internal" | "client", opts: { includeSummary?: boolean } = {}) {
  const includeSummary = opts.includeSummary === true;
  const client = audience === "client";
  const contractOnly = job.scope === "contract";
  const superView = job.scope === "super";
  const hideMoney = client || contractOnly || superView;
  const [who, tz] = await Promise.all([whoForJob(sb, job.company_id, job.job_id), jobTimeZone(sb, job.job_id)]);
  const lineOpts = { clientFacing: client, who, tz };
  const [co, flagsR, factsR, itemsR, nas] = await Promise.all([
    sb.from("mcp_companies").select("name, agent_name").eq("id", job.company_id).maybeSingle(),
    sb.from("mcp_job_flags").select("flag_key, value, source, set_at").eq("job_id", job.job_id),
    sb.from("mcp_job_facts").select("module, key, value, status, source, internal_only, updated_at").eq("job_id", job.job_id),
    sb.from("mcp_open_items").select(ITEM_COLS).eq("job_id", job.job_id).eq("status", "open"),
    activeNa(sb, job.job_id),
  ]);
  const cr = superView ? { data: [] } : await sb.from("mcp_contract_clauses").select("section, heading, category, verbatim_text, n_days, day_type, trigger_desc, source").eq("job_id", job.job_id);
  const secKey = (x: string) => x.split(".").map((n) => n.padStart(4, "0")).join(".");
  const clauses = ((cr.data ?? []) as ClauseRow[]).sort((a, b) => secKey(a.section).localeCompare(secKey(b.section)));
  for (const r of [flagsR, factsR, itemsR]) if (r.error) throw new Error(r.error.message);
  const flags = (flagsR.data ?? []) as Flag[];
  let facts = (factsR.data ?? []) as Fact[];
  let items = (itemsR.data ?? []) as unknown as Item[];
  if (hideMoney) {
    facts = facts.filter((f) => !f.internal_only && !CLIENT_SCRUB.test(f.key));
    items = items.filter((i) => !i.internal_only && !CLIENT_SCRUB.test(`${i.action} ${i.category}`));
  }
  // Claim notices and the claim clause are internal strategy, never client-facing.
  if (client) { items = withoutClaims(items); facts = facts
      .filter((f) => !(f.module === "contract" && f.key === "claim_process"))
      // Legacy combined terms are never split: a term that mentions a claim is left out of client output whole.
      .filter((f) => !(f.module === "contract" && typeof f.value === "string" && /\bclaims?\b/i.test(f.value))); }
  // Internal to-confirm items (open questions for the PM) never go in the client copy.
  if (client) items = items.filter((i) => itemType(i, nas) !== "unknown");
  if (client) facts = facts.filter((f) => !CLIENT_COACHING.test(typeof f.value === "string" ? f.value : ""));
  const dates = [...flags.map((f) => f.set_at), ...facts.map((f) => f.updated_at), ...items.map((i) => i.updated_at)].filter(Boolean).sort();
  const dataThrough = dates.length ? dateIn(dates[dates.length - 1], tz) : "no data yet";
  const sectionNa = new Set(nas.filter((n) => n.scope === "section").map((n) => n.target));
  const out: string[] = [];
  out.push(
    `${prefix(job)}JOB SETUP REPORT (${client ? "CLIENT-FACING" : superView ? "LIMITED VIEW — NO FINANCIALS" : contractOnly ? "INTERNAL — CONTRACT SIDE ONLY" : "INTERNAL"})`,
    `Job: ${job.job_number} – ${job.name}`,
    `Company: ${co.data?.name ?? "unknown"} | Prepared by: ${agentLabel(co.data?.agent_name)}`,
    `Data through: ${dataThrough}`,
    "",
  );
  let n = 1;
  const modules: string[] = superView ? [] : contractOnly ? ["contract"] : client ? ["applicability", "contract", "warranty"] : ["applicability", "contract", "handoff", "budget", "warranty"];
  for (const mod of modules) {
    const sectionItems = items.filter((i) => i.section === mod);
    out.push(`${n++}. ${SECTION_TITLES[mod]}`);
    if (sectionNa.has(mod)) {
      const reason = nas.find((x) => x.scope === "section" && x.target === mod)?.reason;
      out.push(`   Marked N/A for this job (${reason ?? "no reason"}).`);
      if (sectionItems.length) {
        out.push("   Section N/A — needs disposition:");
        sectionItems.forEach((it) => out.push(`   - ${itemLine(it, nas, hideMoney, lineOpts)}`));
      }
      out.push("");
      continue;
    }
    if (mod === "applicability") {
      if (!flags.length) out.push("   None recorded.");
      flags.sort((a, b) => a.flag_key.localeCompare(b.flag_key)).forEach((f) => out.push(`   - ${f.flag_key.replace(/_/g, " ")}: ${flagWord(FLAG_CLAUSE[f.flag_key] ? effectiveFlag(f.value, facts.find((x) => x.module === "contract" && x.key === FLAG_CLAUSE[f.flag_key])) : f.value)} (${f.source.replace(/_/g, " ").replace(/^member answer$/, "manual")})`));
    } else if (mod === "budget") {
      const budget = facts.filter((f) => f.module === "budget");
      const sov = facts.filter((f) => f.module === "sov");
      out.push("   Internal cost budget (internal only):");
      if (!budget.length) out.push("   - none recorded");
      budget.forEach((f) => out.push(`   - ${f.key}: ${show(f.value)}`));
      out.push("   Owner SOV:");
      if (!sov.length) out.push("   - none recorded");
      sov.forEach((f) => out.push(`   - ${f.key}: ${show(f.value)}`));
    } else if (mod === "warranty") {
      const cc = facts.find((f) => f.module === "contract" && f.key === "closeout" && f.status === "known");
      const w = alignCloseoutSource(facts.filter((f) => f.module === "warranty"), cc ? { ...cc, module: "warranty" } : null);
      // The contract warranty summary is skipped when verbatim clauses exist, unless a summary was asked for.
      const cw = clauses.length && !includeSummary ? undefined : facts.find((f) => f.module === "contract" && f.key === "warranty_clauses" && f.status === "known");
      out.push(...renderWarrantyRegister(cw ? [...w, { ...cw, module: "warranty", key: CONTRACT_WARRANTY_KEY }] : w, todayIn(tz)));
    } else if (mod === "contract" && clauses.length) {
      // Verbatim clauses only; summary fields are a fallback for jobs with no clauses.
      const shownClauses = client ? clauses.filter((c) => !isClaimClause(c)) : clauses;
      out.push("   Contract clauses (exact contract text):");
      shownClauses.forEach((c) => out.push(`   - ${clauseLine(c)}`));
      if (!client) missingNotices(clauses).forEach((m) => out.push(`   - Missing: ${m.label} (to confirm)`));
      if (includeSummary) {
        // Summaries only on request: plain-language notice block (PM copy only) and the saved summary fields.
        out.push(`   ${SUMMARY_HEADING}:`);
        if (!client) noticeRequirements(clauses).lines.forEach((l) => out.push(`   ${l}`));
        facts.filter((f) => f.module === mod && f.status === "known").forEach((f) => out.push(`   - ${f.key.replace(/_/g, " ")}: ${show(f.value)} (${legacySourceLabel(f.source)})`));
      } else out.push(`   ${SUMMARY_OFFER}`);
    } else {
      const fs = facts.filter((f) => f.module === mod);
      if (!fs.length) out.push("   Not started.");
      // Contract summary fields never claim "document": only exact clause rows do.
      const legacy = mod === "contract"; // summary fields never claim "document", client or internal
      fs.forEach((f) => out.push(`   - ${f.key.replace(/_/g, " ")}: ${f.status === "known" ? `${show(f.value)} (${legacy ? legacySourceLabel(f.source) : f.source === "member_answer" ? "manual" : f.source.replace(/_/g, " ")})` : f.status}`));
      if (legacy && !client) {
        const nf = flags.find((f) => f.flag_key === "notice_requirements");
        const flagNo = !!nf && effectiveFlag(nf.value, facts.find((x) => x.module === "contract" && x.key === FLAG_CLAUSE.notice_requirements)) === "no";
        noticeRequirements([], { noticeFlagNo: flagNo }).lines.forEach((l) => out.push(`   ${l}`));
      }
    }
    if (sectionItems.length) {
      out.push("   Open items:");
      sectionItems.forEach((it) => out.push(`   - ${itemLine(it, nas, hideMoney, lineOpts)}`));
    }
    out.push("");
  }
  if (client) {
    const sov = facts.filter((f) => f.module === "sov");
    out.push(`${n++}. SCHEDULE OF VALUES`);
    if (!sov.length) out.push("   None recorded.");
    sov.forEach((f) => {
      // Client documents list the billing lines only; values stay out (no dollar figures in client reports).
      const v = (f.value ?? {}) as { description?: string };
      out.push(`   - ${f.key}: ${v.description ?? ""}`.trimEnd());
    });
    out.push("");
  }
  const shown = new Set(modules);
  const other = items.filter((i) => !i.section || !shown.has(i.section));
  out.push(`${n++}. OTHER OPEN ITEMS AND OBLIGATIONS`);
  if (!other.length) out.push("   None.");
  other
    .sort((a, b) => (a.needed_by ?? "9999").localeCompare(b.needed_by ?? "9999"))
    .forEach((it) => out.push(`   - ${itemLine(it, nas, hideMoney, lineOpts)}`));
  out.push("");
  out.push(`${n++}. UNKNOWNS`);
  const unk = [
    ...flags.filter((f) => f.value === "unknown").map((f) => `   - Applicability unknown: ${f.flag_key.replace(/_/g, " ")}`),
    ...facts.filter((f) => f.status === "unknown").map((f) => `   - ${f.module}: ${f.key.replace(/_/g, " ")}`),
  ];
  if (!unk.length) out.push("   None.");
  out.push(...unk);
  if (!client) {
    // Internal only: who drafts for this job are signed as (0019).
    const jr = await sb.from("mcp_jobs").select("pm_user_id, pm_name, pm_email, pm_title").eq("id", job.job_id).maybeSingle();
    if (!jr.error) {
      const j = (jr.data ?? {}) as { pm_user_id?: string | null; pm_name?: string | null; pm_email?: string | null; pm_title?: string | null };
      const pmName = who("unknown").replace(/ \(PM\)$/, "");
      const name = pmName.startsWith("Unassigned") ? (j.pm_name ?? null) : pmName;
      const pmId = { name, email: j.pm_email ?? null, title: j.pm_title ?? null, isMember: !!j.pm_user_id };
      out.push("", draftIdentityText(pmId, { name: co.data?.name ?? null }));
      // Assistant-only; the last pass (finalizeVisible) moves these lines out of the visible text.
      out.push(...draftGuidance(pmId, { name: co.data?.name ?? null }));
    }
  }
  return client ? clientCopy(out.join("\n")) : out.join("\n");
}
