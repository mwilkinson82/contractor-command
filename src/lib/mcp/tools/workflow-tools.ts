import { SovMismatch, buildSov, retainagePct, sovLayout, sovSummaryText, type SovBrand } from "../sov";
import { ATHENA_VERSION } from "../server-info-branding";
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { ITEM_COLS, READ_ONLY_MESSAGE, FULL_ACCESS_MESSAGE, activeNa, audit, flagWord, itemLine, itemType, jobTimeZone, prefix, renderSetupReport, resolveCompany, resolveJob, type Job } from "../jobs";
import { computeDue, todayIn, type DayType } from "../deadlines";
import { INPUT_KEYS, INPUT_LABELS, currentCheck, loadLookahead, renderReport, type InputKey } from "../workflow";
import { WARRANTY_CHECK_PREFIX, WARRANTY_SETUP_QUESTIONS, mapTrigger, nextWarrantyQuestion, CONTRACT_WARRANTY_KEY, alignCloseoutSource, renderWarrantyRegister, warrantyAnswerFacts, warrantyHow, warrantyOpenItems, type WarrantyKey } from "../warranty";
import { EVIDENCE_ASK, evidenceProblem } from "../evidence";
import { itemRef, matchRef, parseQuestionRef, questionRef, shortRef } from "../refs";
import { findDelayTerms, termDue, type DeadlineRow } from "../delays";
import { draftGuidance, draftIdentityText, type PmIdentity } from "../drafts";
import { guide } from "../visible";
import { withoutClaims } from "../internal-claims";
import { CLAUSE_HOST_RULE, classifyClause, clauseLine, missingNotices, normSection, parseClause, NOTICE_CHECKLIST, type ClauseRow, LEGACY_SUMMARY_TAG, missingNoticeNote } from "../contract-clauses";
import { FLAGS_ASKED_LATER, noGuidance, noGuidanceText, reconcileRecommendation } from "../guidance";
import { LOOKAHEAD_BUILD_QUESTIONS, LOOKAHEAD_EXISTS_ASK, LOOKAHEAD_PUSHBACK, LOOKAHEAD_SETUP_KEY, PUSHBACK_GUIDANCE, buildQuestionsGuidance, buildQuestionsText, pushbackText } from "../lookahead-help";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2417).");
const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company. Pass the company name exactly as Athena lists it (e.g. \"ALP Construction\"); a company id also works. Not case-sensitive. If the member hasn't named one, call list_open_items with no job_number to list the companies.");
const short = (d: string) => z.string().max(2000).optional().describe(d);
const tri = z.enum(["yes", "no", "na", "unknown"]);
const doc = (what: string) => z.string().max(20_000).optional().describe(`${what}, as plain text. Leave out if you don't have it; it is recorded as unknown.`);
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const MAX_INPUT = 20_000;

function capInput(args: unknown) {
  // The contract text has its own limit (it is the document itself, not instructions).
  const { contract_text: _doc, ...rest } = (args ?? {}) as Record<string, unknown>;
  void _doc;
  const n = JSON.stringify(rest).length;
  if (n > MAX_INPUT) throw new ToolError(`Input is ${n.toLocaleString()} characters; the limit is 20,000. Trim or split it.`);
}

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  // Function names and argument shapes are fixed server-side; inputs are passed as data only.
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

type ItemResult = { item_id: string; existing: boolean; item_type?: string; delivery_item?: ItemResult | null; owner_defaulted?: boolean; needed_by_defaulted?: boolean; accountable?: string; needed_by?: string };
/** Shown when the owner was defaulted: name the PM, or say plainly that no PM is set. */
export const ownerDefaultNote = (accountable: string | null | undefined) =>
  !accountable?.trim() || /^unassigned\b/i.test(accountable.trim()) ? " — no PM is set on this job, so it stays unassigned until you name one" : " — defaulted to the job's PM";
/** Open-item notes after a block of text, one per line (never run onto the block's last line). */
export const itemNotes = (rs: (ItemResult | null | undefined)[]) => rs.filter(Boolean).map((r) => `\n-${itemNote(r)}`).join("");
const itemNote = (r: ItemResult | null | undefined): string =>
  !r
    ? ""
    : r.existing
      ? " Already open."
      : ` Open item created (accountable: ${r.accountable}${r.owner_defaulted ? ownerDefaultNote(r.accountable) : ""}; needed by ${r.needed_by}${r.needed_by_defaulted ? " — defaulted to 7 days" : ""}).${r.delivery_item ? ` Delivery method/recipient unknown:${itemNote(r.delivery_item)}` : ""}`;
const itemOut = (r: ItemResult | null | undefined) => (r ? { item_id: r.item_id, item_ref: shortRef(r.item_id), item_type: r.item_type ?? "deadline" } : null);

type FlagResult = { changed: string[]; confirm_items: ItemResult[]; reenable_suggestions: { na_id: string; scope: string; target: string; trigger: string }[] };
const flagNote = (r: FlagResult) => {
  const out: string[] = [];
  if (r.confirm_items.length) out.push(`Unknown applicability opened ${r.confirm_items.length} confirm item(s):${r.confirm_items.map((i) => itemNote(i)).join("")}`);
  for (const s of r.reenable_suggestions)
    out.push(`Suggestion (asked once): "${s.target}" is marked N/A but ${s.trigger}. Re-enable it with answer action "reenable" (scope ${s.scope}, target ${s.target}), or decline with action "decline_reenable" and na_id ${s.na_id}.`);
  return out.join("\n");
};

// ---------- onboarding ----------
const rightsList = z.array(z.string().trim().min(1).max(100)).max(20);
export const onboarding = defineTool({
  name: "onboarding",
  title: "Company profile and members",
  description: "Read or save the company profile Athena works for (role, work types, trades, tool stack, decision rights, default applicability), and add members as Owner, PM or All-access. Athena is for contractors running their own construction company: never offer a consulting option or frame anything as consulting. No job number is needed here; it is required when you create a job.",
  inputSchema: {
    action: z.enum(["read", "save_company", "add_member", "save_brand"]).describe("read, save_company (create or update), add_member, or save_brand (SOV logo link and footer)."),
    company_id: companyId,
    name: z.string().trim().max(200).optional().describe("Company name (required to create)."),
    your_name: z.string().trim().max(120).optional().describe("Your display name on the company (when creating)."),
    agent_name: z.string().trim().max(60).optional().describe("What to call the agent. Default 'Athena PM'."),
    company_role: short("Company role, e.g. mechanical prime / specialty sub."),
    work_types: z.array(z.enum(["commercial", "public", "residential"])).max(3).optional(),
    trades: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    tool_stack: z.record(z.string().max(60), z.string().max(200)).optional().describe("Tools by function, e.g. {schedule: 'P6', accounting: '...'}."),
    decision_rights: z
      .object({ buyout: rightsList.optional(), change_orders: rightsList.optional(), claims: rightsList.optional(), write_offs: rightsList.optional(), waive_items: rightsList.optional() })
      .optional()
      .describe("Who may approve each: roles (owner, pm, all_access) or member names."),
    default_flags: z.record(z.string().regex(/^[a-z_]{1,40}$/), tri).optional().describe("Company default applicability flags, e.g. {residential: 'no'}."),
    member_email: z.string().email().optional().describe("add_member: the person's sign-in email."),
    member_name: z.string().trim().max(120).optional().describe("add_member: display name."),
    member_role: z.enum(["owner", "pm", "all_access"]).optional().describe("add_member: launch role."),
    logo_url: z.string().trim().url().max(2000).optional().describe("save_brand: https link to the company logo (PNG, JPG or SVG). Leave out if there is none; the company name prints in bold."),
    license_number: short("save_brand: license designation and number as it should print on the SOV footer."),
    contact_name: short("save_brand: named contact on the SOV footer."),
    contact_phone: z.string().trim().max(40).optional().describe("save_brand: the contact's phone."),
    website: z.string().trim().max(200).optional().describe("save_brand: website printed in the SOV footer (plain text)."),
  },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("onboarding", ctx, undefined, async (sb) => {
      capInput(args);
      let cid: string | undefined = args.company_id ? await resolveCompany(sb, args.company_id) : undefined;
      if (args.action === "save_company") {
        if (!cid) {
          const { data: mine } = await sb.from("mcp_companies").select("id");
          if ((mine ?? []).length === 1 && !args.name) cid = mine![0].id;
        }
        cid = await rpc<string>(sb, "mcp_company_save", {
          _company: cid ?? null,
          _p: {
            name: args.name, display_name: args.your_name, agent_name: args.agent_name, company_role: args.company_role,
            work_types: args.work_types, trades: args.trades, tool_stack: args.tool_stack, decision_rights: args.decision_rights, default_flags: args.default_flags,
          },
        });
      } else if (args.action === "save_brand") {
        cid = await resolveCompany(sb, cid);
        const p: Record<string, string> = {};
        for (const k of ["logo_url", "license_number", "contact_name", "contact_phone", "website"] as const) if (args[k] !== undefined) p[k] = args[k]!;
        if (!Object.keys(p).length) throw new ToolError("Nothing to save. Give the logo link or any of the footer details.");
        await rpc(sb, "mcp_company_brand_save", { _company: cid, _p: p });
      } else if (args.action === "add_member") {
        cid = await resolveCompany(sb, cid);
        if (!args.member_email || !args.member_name || !args.member_role) throw new ToolError("add_member needs member_email, member_name and member_role.");
        await rpc(sb, "mcp_member_add", { _company: cid, _email: args.member_email, _display_name: args.member_name, _role: args.member_role });
      } else {
        cid = await resolveCompany(sb, cid);
        await audit(sb, null, "onboarding", "company_view", cid, cid);
      }
      const [{ data: c, error }, { data: members }] = await Promise.all([
        sb.from("mcp_companies").select("name, agent_name, company_role, work_types, trades, tool_stack, decision_rights, default_flags, logo_url, license_number, contact_name, contact_phone, website").eq("id", cid!).maybeSingle(),
        sb.from("mcp_company_members").select("display_name, role").eq("company_id", cid!),
      ]);
      if (error) throw new Error(error.message);
      if (!c) throw new ToolError("Company not found.");
      const rights = (c.decision_rights ?? {}) as Record<string, string[]>;
      return {
        ...text(
          [
            args.action === "read" ? "Company profile:" : "Saved.",
            `Company: ${c.name}`,
            `Agent name: ${c.agent_name}`,
            `Role: ${c.company_role ?? "unknown"} | Work types: ${(c.work_types ?? []).join(", ") || "unknown"} | Trades: ${(c.trades ?? []).join(", ") || "unknown"}`,
            `Tool stack: ${Object.entries((c.tool_stack ?? {}) as Record<string, string>).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ") || "unknown"}`,
            `Decision rights: ${Object.entries(rights).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v.join(", ")}`).join("; ")}`,
            `Default applicability: ${Object.entries((c.default_flags ?? {}) as Record<string, string>).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ") || "none"}`,
            `Members: ${(members ?? []).map((m) => `${m.display_name} (${m.role.replace(/_/g, "-")})`).join(", ")}`,
            `SOV logo: ${c.logo_url ? "link on file" : `none on file (${c.name} prints in bold)`}`,
            `SOV footer: ${[c.name, c.license_number, [c.contact_name, c.contact_phone].filter(Boolean).join(" "), c.website].filter(Boolean).join(" · ")}`,
            ...(sovFooterMissing(c).length ? [`For the SOV, send your logo link (optional) and the footer details still missing: ${sovFooterMissing(c).join(", ")}.`] : []),
            `Athena v${ATHENA_VERSION}`,
            "",
            'Next: create a job with intake section "create_job" and a job_number.',
          ].join("\n"),
        ),
        structuredContent: { company_id: cid! },
      };
    }),
});

// ---------- intake ----------
const workPackage = z.object({ name: z.string().trim().min(1).max(120), mode: z.enum(["self_perform", "subcontract"]) });
const budgetLine = z.object({ cost_code: z.string().trim().min(1).max(40), description: z.string().max(200).optional(), amount: z.number().optional() });
const sovLine = z.object({ line: z.string().trim().min(1).max(40), description: z.string().max(200).optional(), billable_value: z.number().optional(), cost_codes: z.array(z.string().max(40)).max(50).optional() });
const gap = z.object({ gap: z.string().trim().min(1).max(1000), owner: z.string().trim().min(1).max(120), needed_by: date.optional() });
import { CLAUSE_ABSENT, CLAUSE_UNKNOWN, FLAG_CLAUSE, clauseFlag, effectiveFlag } from "../clauses";
export { CLAUSE_ABSENT, CLAUSE_UNKNOWN };
/** Field keys in words ("beneficial_use_clause" -> "beneficial use clause"). */
const humanKeys = (ks: string[]) => ks.map((k) => k.replace(/_/g, " ")).join(", ");
function triFrom(v: boolean | undefined): "yes" | "no" | "unknown" {
  return v === undefined ? "unknown" : v ? "yes" : "no";
}
const TYPED_MARK = /user[- ]typed|typed (?:in )?by|member[- ]typed|reported by (?:the )?user|no (?:contract )?document|not read from/i;

/** Terms count as read from the contract only when the client names the document it read and nothing says they were typed. */
export function readFromDocument(a: { contract_document_provided?: boolean; contract_document_name?: string }, text: string): boolean {
  return a.contract_document_provided === true && !!a.contract_document_name?.trim() && !TYPED_MARK.test(text);
}

function keysText(a: Record<string, unknown>): string {
  return Object.values(a).filter((v) => typeof v === "string").join(" ");
}

/** Save warranty/closeout setup facts, then open an item for every "no" or unknown (deduped by check_key). */
async function saveWarranty(sb: Sb, job: Job, facts: Record<string, unknown>, o: { fillMissing: boolean; owner: string | null; neededBy: string | null; tool: string }) {
  if (o.fillMissing) {
    const { data: prior, error: priorErr } = await sb.from("mcp_job_facts").select("key").eq("job_id", job.job_id).eq("module", "warranty");
    if (priorErr) throw new Error(priorErr.message);
    const had = new Set((prior ?? []).map((p) => p.key));
    for (const q of WARRANTY_SETUP_QUESTIONS) if (!(q.key in facts) && !had.has(q.key)) facts[q.key] = null;
  }
  if (Object.keys(facts).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "warranty", _facts: facts, _source: "member_answer" });
  const all = await warrantyFacts(sb, job);
  const asked = new Set(all.map((f) => f.key));
  const made: ItemResult[] = [];
  for (const it of warrantyOpenItems(all)) {
    // In the one-at-a-time flow, only questions already asked can owe an item.
    if (!o.fillMissing && it.check_key !== "warranty:start_conflict" && !asked.has(it.check_key.slice(WARRANTY_CHECK_PREFIX.length))) continue;
    made.push(await rpc<ItemResult>(sb, "mcp_add_item", {
      _job: job.job_id,
      _f: {
        check_key: it.check_key, action: it.action, item_type: it.item_type, kind: it.item_type === "unknown" ? "confirm_unknown" : "gap", section: "warranty", category: "Warranty",
        recommendation: it.recommendation ?? null, why: it.why ?? null, accountable: o.owner, needed_by: o.neededBy, source: "member_answer", tool: o.tool,
      },
    }));
  }
  return { all, made };
}

async function warrantyFacts(sb: Sb, job: Job, synced = false): Promise<{ key: string; value: unknown; status: string; source: string }[]> {
  const { data, error } = await sb.from("mcp_job_facts").select("module, key, value, status, source").eq("job_id", job.job_id).in("module", ["warranty", "contract"]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { module: string; key: string; value: unknown; status: string; source: string }[];
  const w = rows.filter((r) => r.module === "warranty");
  // Closeout documents given with the contract terms count for the warranty register too (copied once, keeping the contract's source).
  const fromContract = rows.find((r) => r.module === "contract" && r.key === "closeout" && r.status === "known" && r.value);
  const mine = w.find((r) => r.key === "closeout_documents");
  if (!synced && fromContract && (!mine || mine.status !== "known")) {
    await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "warranty", _facts: { closeout_documents: fromContract.value }, _source: ["document", "member_answer", "company_default"].includes(fromContract.source) ? fromContract.source : "member_answer" });
    return warrantyFacts(sb, job, true);
  }
  const cw = rows.find((r) => r.module === "contract" && r.key === "warranty_clauses" && r.status === "known");
  return [...alignCloseoutSource(w, fromContract ?? null), ...(cw ? [{ ...cw, module: "warranty", key: CONTRACT_WARRANTY_KEY }] : [])];
}

export async function loadClauses(sb: Sb, jobId: string): Promise<ClauseRow[]> {
  const { data, error } = await sb.from("mcp_contract_clauses").select("section, heading, category, verbatim_text, n_days, day_type, trigger_desc, source").eq("job_id", jobId);
  if (error) throw new Error(error.message);
  const key = (s: string) => s.split(".").map((n) => n.padStart(4, "0")).join(".");
  return ((data ?? []) as ClauseRow[]).sort((a, b) => key(a.section).localeCompare(key(b.section)));
}

/** Open a confirm item for each missing notice clause and each unverified clause; close them once the clause is on file and verified. */
async function syncClauseItems(sb: Sb, job: Job, saved: ClauseRow[]): Promise<ItemResult[]> {
  const made: ItemResult[] = [];
  const add = async (check_key: string, action: string, why: string) =>
    made.push(await rpc<ItemResult>(sb, "mcp_add_item", { _job: job.job_id, _f: { check_key, action, item_type: "unknown", kind: "confirm_unknown", section: "contract_time", category: "Contract clause", why, source: "member_answer", tool: "intake" } }));
  for (const m of missingNotices(saved)) await add(`clause_missing:${m.category}`, `Confirm the contract's ${m.label} clause (none recorded)`, "Notice terms come only from the contract; Athena never fills one in.");
  for (const c of saved.filter((x) => x.source !== "document")) await add(`clause_unverified:${c.section}`, `Check §${c.section} wording against the contract (not found exactly)`, "Only clause text matching the contract exactly counts as document.");
  // Close items the contract now answers.
  const done = new Set([...NOTICE_CHECKLIST.filter((n) => saved.some((c) => c.category === n.category)).map((n) => `clause_missing:${n.category}`), ...saved.filter((c) => c.source === "document").map((c) => `clause_unverified:${c.section}`)]);
  const { data: open } = await sb.from("mcp_open_items").select("id, check_key").eq("job_id", job.job_id).eq("status", "open").like("check_key", "clause_%");
  for (const it of (open ?? []) as { id: string; check_key: string }[])
    if (done.has(it.check_key)) {
      const c = saved.find((x) => it.check_key.endsWith(x.section) || it.check_key.endsWith(x.category));
      await rpc(sb, "mcp_resolve_item", { _item: it.id, _kind: "verified", _evidence: `Contract §${c?.section ?? "?"} on file, matching the contract text.`, _stated_by: null, _stated_on: null, _reason: null, _approval: null, _billing: null, _collection: null });
    }
  return made.filter((m) => !m.existing);
}

export const intake = defineTool({
  name: "intake",
  title: "Job setup intake",
  description:
    "Create a job (keyed by job number) and record its setup: job settings (time zone, PM), step 0 scoping, contract terms, contract deadlines, estimate handoff, budget and SOV, open items, a delay event, or a two-week lookahead. Missing data is recorded as unknown, never guessed. Record every delay, slip or schedule impact the member mentions with section delay_event before answering.",
  inputSchema: {
    section: z.enum(["create_job", "job_settings", "scope", "contract", "deadline", "handoff", "budget", "warranty", "open_item", "lookahead", "delay_event", "clauses"]).describe("Which part of setup to record. Use clauses for contract notice and time clauses, copied word for word."),
    job_number: jobNumber,
    company_id: companyId,
    job_name: z.string().trim().max(200).optional().describe("create_job: job name."),
    restrict_to: z.array(z.string().trim().min(1).max(120)).max(30).optional().describe("create_job: member names who may see this job (leave out for all members)."),
    // Job settings
    time_zone: z.string().trim().max(60).optional().describe("job_settings: IANA time zone, e.g. America/Chicago. Deadlines are computed in it."),
    pm: z.string().trim().max(120).optional().describe("job_settings: the job PM's name only (put the email in pm_email; no notes such as \"non-member\"). A company member is linked; anyone else is saved as a contact (name + email) with no Athena access."),
    pm_email: z.string().trim().max(200).optional().describe("job_settings: the PM's email. Used as the suggested From on drafts. No Athena access is granted."),
    pm_title: z.string().trim().max(120).optional().describe("job_settings: the PM's title for draft signatures. Default 'Project Manager'."),
    // Delay event
    delay_description: z.string().trim().max(500).optional().describe("delay_event: what slipped, in the member's words, e.g. 'Lighting rough-in slipped 3 weeks'."),
    delay_activity: z.string().trim().max(200).optional().describe("delay_event: the schedule activity affected, if named."),
    delay_start_date: date.optional().describe("delay_event: the date the delay began. Leave out if the member doesn't know; Athena flags both notices due today with 'confirm start date'."),
    delay_days: z.number().int().min(0).max(3650).optional().describe("delay_event: estimated impact in calendar days, if stated."),
    delay_cause: z.string().trim().max(500).optional().describe("delay_event: cause, if stated. Never guess it."),
    // Verbatim contract clauses
    clauses: z.array(z.object({
      section: z.string().trim().min(1).max(40).describe("Section number as printed, e.g. 6.4."),
      heading: z.string().trim().max(200).optional().describe("The clause heading as printed, e.g. Delay Notice. Leave out if the clause has none."),
      text: z.string().trim().min(1).max(10_000).describe("The clause text copied exactly as written in the contract. Never summarize, shorten or merge clauses."),
      category: z.enum(["delay_notice", "claim_notice", "nonpayment_notice", "cure_notice", "schedule_disagreement", "other"]).optional().describe("Optional; Athena classifies from the heading and text when left out."),
    })).max(60).optional().describe(`clauses: ${CLAUSE_HOST_RULE}`),
    contract_text: z.string().max(400_000).optional().describe("clauses: the full contract text as uploaded (copied, not summarized). Used to verify each clause word for word; stored with the job, readable by members with contract access."),
    // Deadline (contract time clause)
    clause_key: z.enum(["notice", "submittal_turnaround", "rfi_turnaround", "liquidated_damages", "completion", "other"]).optional(),
    label: short("deadline: what is due, e.g. 'Delay notice: utility shutdown denied'."),
    clause_ref: z.string().max(200).optional().describe("deadline: clause reference, e.g. §8.3."),
    trigger_desc: short("deadline: the event that starts the clock."),
    trigger_date: date.optional().describe("deadline: date of the triggering event."),
    trigger_alternatives: z.array(date).max(5).optional().describe("deadline: other plausible trigger dates if the trigger is ambiguous."),
    n_days: z.number().int().min(0).max(3650).optional().describe("deadline: number of days in the clause."),
    day_type: z.enum(["calendar", "business", "working"]).optional().describe("deadline: only if the contract defines it. Leave out otherwise."),
    holidays: z.array(date).max(60).optional().describe("deadline: holidays listed in the contract. Leave out otherwise."),
    weekend_roll: z.boolean().optional().describe("deadline: true only if the contract moves weekend/holiday deadlines later."),
    fixed_date: date.optional().describe("deadline: a fixed contract date (e.g. substantial completion)."),
    delivery_method: short("deadline / open_item: how it must be sent, per the contract."),
    recipient: short("deadline / open_item: who it must go to."),
    // Open item typing
    item_type: z.enum(["unknown", "no", "pending_document", "deadline"]).optional().describe("open_item: type. na_disposition is applied automatically under N/A sections."),
    waiting_on_document: short("open_item pending_document: the named document."),
    waiting_on_who: short("open_item pending_document: who it is coming from."),
    waiting_since: date.optional(),
    clause_source: short("open_item deadline: clause or source of the due date."),
    recommendation: short("open_item no: recommendation."), why: short("open_item no: why it matters."),
    // Step 0
    job_type: short("scope: job type / trade."),
    scope_summary: short("scope: short scope summary."),
    size_band: z.enum(["<$250k", "$250k–$2M", "$2M–$10M", "$10M+"]).optional(),
    sector: z.enum(["public", "private_commercial", "residential"]).optional(),
    client_type: short("scope: client type."),
    pricing_model: z.enum(["lump_sum", "unit_price", "cost_plus", "gmp"]).optional(),
    position: z.enum(["prime", "sub", "sub_sub"]).optional(),
    work_packages: z.array(workPackage).max(50).optional(),
    major_equipment: z.array(z.string().trim().min(1).max(120)).max(50).optional().describe("scope: major equipment; [] means none."),
    key_clauses: z
      .object({ retainage: tri.optional(), beneficial_use: tri.optional(), liquidated_damages: tri.optional(), notice: tri.optional() })
      .optional()
      .describe("scope: which key clauses the job has."),
    job_tool_stack: z.record(z.string().max(60), z.string().max(200)).optional(),
    // Contract (A)
    contract_document_provided: z.boolean().optional().describe("contract/deadline: true ONLY if you read these terms from the contract document itself in this conversation (and give contract_document_name). Terms the member typed or told you are manual: leave this out."),
    contract_document_name: z.string().max(300).optional().describe("contract/deadline: the contract document the terms were read from (file name or title). Required for source document; without it the terms are saved as manual."),
    pay_terms: short("contract"), notice_timing: short("contract: notice deadline and clause, as written"), tia_timing: short("contract"),
    change_process: short("contract"), claim_process: short("contract"), retainage: short("contract: % and clause"),
    retainage_reduction: short("contract"), beneficial_use_clause: short("contract"), liquidated_damages: short("contract"),
    savings_split: short("contract"), closeout: short("contract"), warranty_clauses: short("contract"),
    // Warranty and closeout (job setup)
    workmanship_warranty: tri.optional().describe("warranty: is there a workmanship warranty?"),
    workmanship_warranty_months: z.number().int().min(0).max(240).optional().describe("warranty: how long the workmanship warranty runs, in months."),
    warranty_start_trigger: z.enum(["substantial_completion", "final_acceptance", "other"]).optional().describe("warranty: what starts the workmanship warranty. Owner acceptance = final_acceptance. Prefer warranty_start_trigger_text with the member's own words."),
    warranty_start_trigger_text: short("warranty: the member's own words for what starts the warranty (e.g. \"owner acceptance\"). Mapped for you and wins over warranty_start_trigger."),
    warranty_start_trigger_other: short("warranty: describe the trigger when warranty_start_trigger is other"),
    warranty_trigger_date: date.optional().describe("warranty: the actual date of the trigger event, once it has happened. Leave out until then."),
    warranty_start_basis: short("warranty: what sets the warranty start date (clause or document)"),
    closeout_documents: short("warranty: required closeout documents (O&Ms, as-builts, etc.); \"unknown\" if not known"),
    punch_final_acceptance: short("warranty: punch list and final acceptance requirements"),
    manufacturer_warranties: short("warranty: manufacturer warranties to collect, or none"),
    closeout_expectations: short("warranty: other closeout expectations (training, commissioning, final cleaning, lien waivers, warranty walk, turnover meeting), or none"),
    // Handoff (C)
    sold_scope: short("handoff"), carried_scope: short("handoff"), exclusions: short("handoff"), allowances: short("handoff"), addenda: short("handoff"),
    concessions: short("handoff"), quantities: short("handoff"), production_rates: short("handoff"), crew_assumptions: short("handoff"), sub_qualifications: short("handoff"),
    gaps: z.array(gap).max(50).optional().describe("handoff: each gap becomes an open item with its named owner."),
    // Budget (F)
    budget_lines: z.array(budgetLine).max(300).optional().describe("budget: internal cost budget by cost code (internal only)."),
    sov_lines: z.array(sovLine).max(300).optional().describe("budget: owner SOV lines at billable value, with the cost codes each maps to. For the SOV, number lines 01.01-style (CSI division, dot, line)."),
    fee_pct: z.number().optional().describe("budget: contractor's fee as a percent of the contract total (e.g. 15)."),
    sov_basis: z.string().trim().max(200).optional().describe("budget: the contract document the SOV numbers come from, e.g. \"Schedule A, Total Investment\"."),
    // Open item
    action: short("open_item: what has to happen"), kind: z.enum(["general", "commercial", "warranty"]).optional(),
    commercial_type: z.enum(["co", "rea", "claim", "retainage"]).optional(), owner: short("open_item: accountable named person"), needed_by: date.optional(),
    cost_effect: short("open_item"), time_effect: short("open_item"), cash_effect: short("open_item"), effect_is_estimate: z.boolean().optional(),
    next_action: short("open_item"), next_action_approved_by: short("open_item"), internal_only: z.boolean().optional(),
    // Lookahead
    lookahead_exists: z.enum(["yes", "no", "build"]).optional().describe("lookahead: the member's answer to \"is there a two-week look-ahead on this job?\" Leave out the first time; Athena asks. yes = they have one, build = they want Athena to build it from the schedule, no = they don't (Athena pushes back)."),
        start_date: date.optional(), end_date: date.optional(),
    schedule_export: doc("lookahead: schedule export"), crews: doc("lookahead: crews/subs by day"), submittal_log: doc("lookahead: submittal log"),
    rfi_log: doc("lookahead: RFI log"), inspection_list: doc("lookahead: inspection list"), deliveries: doc("lookahead: deliveries list"),
  },
  annotations: { ...WRITE, idempotentHint: false },
  handler: (args, ctx) =>
    run("intake", ctx, { lookaheadId: undefined, jobNumber: args.job_number }, async (sb) => {
      capInput(args);
      if (args.section === "create_job") {
        if (!args.job_name) throw new ToolError("create_job needs job_name.");
        const company = await resolveCompany(sb, args.company_id);
        const r = await rpc<{ duplicate: boolean; suggestion?: string; job_id?: string }>(sb, "mcp_job_create", {
          _company: company, _job_number: args.job_number, _name: args.job_name, _restrict_to: args.restrict_to ?? null,
        });
        if (r.duplicate) throw new ToolError(`Job ${args.job_number} already exists in this company. Use a different number, e.g. ${r.suggestion}. Nothing was created.`);
        return {
          ...text(`${args.job_number} – Job created: ${args.job_name}.${args.restrict_to?.length ? ` Restricted to: ${args.restrict_to.join(", ")}.` : ""}\nPM: not set yet. Ask who the PM is and record it with intake section "job_settings" (pm); open items default to the job's PM.\nNext: intake section "scope" (step 0). Ask the member for job type, owner/client type, sector and pricing model; never assume them.`),
          structuredContent: { job_id: r.job_id!, job_number: args.job_number },
        };
      }
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const P = prefix(job);

      if (args.section === "job_settings") {
        if (!args.time_zone && !args.pm && !args.pm_email && !args.pm_title) throw new ToolError("job_settings needs time_zone and/or pm (pm_email, pm_title).");
        type Settings = { time_zone: string | null; pm: string | null; pm_email?: string | null; pm_title?: string | null; pm_is_member?: boolean };
        let r: Settings;
        const full = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>)("mcp_job_settings", {
          _job: job.job_id, _time_zone: args.time_zone ?? null, _pm_name: args.pm ?? null, _pm_email: args.pm_email ?? null, _pm_title: args.pm_title ?? null,
        });
        if (full.error && isMissingFunction(full.error)) {
          // Migration 0019 not applied yet: the old 3-arg version (members only).
          r = await rpc<Settings>(sb, "mcp_job_settings", { _job: job.job_id, _time_zone: args.time_zone ?? null, _pm_name: args.pm ?? null });
        } else {
          if (full.error) dbError(full.error);
          r = full.data as Settings;
        }
        const co = await sb.from("mcp_companies").select("name").eq("id", job.company_id).maybeSingle();
        const pmLine = r.pm ? `${r.pm}${r.pm_is_member === false ? " (not an Athena user; saved as a contact with no Athena access)" : ""}${r.pm_email ? ` <${r.pm_email}>` : ""}` : "unassigned";
        const id: PmIdentity = { name: r.pm, email: r.pm_email ?? null, title: r.pm_title ?? null, isMember: r.pm_is_member !== false };
        return guide({
          ...text(`${P}Job settings saved. Time zone: ${r.time_zone ?? "unknown"} | PM: ${pmLine}${r.pm ? `\nOpen items that were unassigned now read Accountable: ${r.pm} (PM). To assign an item to the PM, pass the name only.` : ""}\n\n${draftIdentityText(id, { name: co.data?.name ?? null })}`),
          structuredContent: { time_zone: r.time_zone, pm: r.pm, pm_email: r.pm_email ?? null, pm_title: r.pm_title ?? null, pm_is_member: r.pm_is_member ?? true },
        }, ...draftGuidance(id, { name: co.data?.name ?? null }));
      }

      if (args.section === "delay_event") {
        if (!args.delay_description) throw new ToolError("delay_event needs delay_description (what slipped, in the member's words).");
        const [dl, facts, jr, co] = await Promise.all([
          sb.from("mcp_job_deadlines").select("clause_key, label, clause_ref, trigger_desc, n_days, day_type, recipient, delivery_method, active").eq("job_id", job.job_id),
          sb.from("mcp_job_facts").select("key, value, status").eq("job_id", job.job_id).eq("module", "contract").in("key", ["notice_timing", "claim_process"]),
          sb.from("mcp_jobs").select("pm_name, pm_email, pm_title, pm_user_id").eq("id", job.job_id).maybeSingle(),
          sb.from("mcp_companies").select("name").eq("id", job.company_id).maybeSingle(),
        ]);
        const known = Object.fromEntries(((facts.data ?? []) as { key: string; value: unknown; status: string }[]).filter((f) => f.status === "known").map((f) => [f.key, f.value]));
        const { notice, claim } = findDelayTerms((dl.data ?? []) as DeadlineRow[], known, await loadClauses(sb, job.job_id));
        const start = args.delay_start_date ?? null;
        const nd = termDue(notice, start);
        const cd = termDue(claim, start);
        const pack = (t: typeof notice, d: typeof nd) => (t ? { label: t.label, clause_ref: t.clause_ref, due: d.due, recipient: t.recipient, delivery_method: t.delivery_method } : null);
        const r = await rpc<{ delay_event_id: string; start_known: boolean; notice_item: ItemResult; claim_item: ItemResult }>(sb, "mcp_delay_event_add", {
          _job: job.job_id,
          _d: { description: args.delay_description, activity: args.delay_activity, start_date: start, days: args.delay_days, cause: args.delay_cause },
          _notice: pack(notice, nd), _claim: pack(claim, cd),
        });
        const termLine = (name: string, t: typeof notice, d: typeof nd) =>
          !t ? `${name}: contract term not recorded — open item asks to confirm it (due today).`
            : !start ? `${name}: ${t.n_days} ${t.day_type ?? "(day type not stated)"} days${t.clause_ref ? ` (${t.clause_ref})` : ""}; start date unknown, so flagged due today — confirm start date.`
              : `${name}: due ${d.due} (${d.math}${t.clause_ref ? `, ${t.clause_ref}` : ""}).${d.precautions.length ? ` ${d.precautions.join(" ")}` : ""}`;
        const j = (jr.data ?? {}) as { pm_name?: string | null; pm_email?: string | null; pm_title?: string | null; pm_user_id?: string | null };
        let pmName = j.pm_name ?? null;
        if (!pmName && j.pm_user_id) pmName = ((await sb.from("mcp_company_members").select("display_name").eq("company_id", job.company_id).eq("user_id", j.pm_user_id).maybeSingle()).data as { display_name?: string } | null)?.display_name ?? null;
        const id: PmIdentity = { name: pmName, email: j.pm_email ?? null, title: j.pm_title ?? null, isMember: !!j.pm_user_id };
        return guide({
          ...text([
            `${P}Delay recorded: ${args.delay_description}${args.delay_activity ? ` (activity: ${args.delay_activity})` : ""}.`,
            `Start date: ${start ?? "unknown — confirm it; the notice clock runs from when the delay began, not when it was found"} | Impact: ${args.delay_days != null ? `${args.delay_days} days` : "unknown"} | Cause: ${args.delay_cause ?? "unknown"}`,
            termLine("Delay notice", notice, nd), `Notice item:${itemNote(r.notice_item)}`,
            termLine("Claim notice", claim, cd), `Claim item:${itemNote(r.claim_item)}`,
            "", draftIdentityText(id, { name: co.data?.name ?? null }),
          ].join("\n")),
          structuredContent: { delay_event_id: r.delay_event_id, start_known: r.start_known, notice_due: start ? nd.due : null, claim_due: start ? cd.due : null,
            items: [r.notice_item, r.notice_item?.delivery_item, r.claim_item, r.claim_item?.delivery_item].filter((x): x is ItemResult => !!x).map((x) => itemOut(x)!) },
        }, ...draftGuidance(id, { name: co.data?.name ?? null }));
      }

      if (args.section === "clauses") {
        if (!args.clauses?.length) throw new ToolError("clauses needs at least one clause: section, heading and the text copied exactly from the contract.");
        const rows = args.clauses.map((c) => {
          const p = parseClause(c.text);
          return { section: normSection(c.section), heading: c.heading?.trim() || null, text: c.text, category: c.category ?? classifyClause(c.heading, c.text), ...p };
        });
        const r = await rpc<{ clauses: { section: string; source: "document" | "unverified" }[]; has_document: boolean }>(sb, "mcp_clauses_save", {
          _job: job.job_id, _doc: args.contract_text?.trim() ? { name: args.contract_document_name ?? "contract", body: args.contract_text } : null, _clauses: rows,
        });
        const saved = await loadClauses(sb, job.job_id);
        const made = await syncClauseItems(sb, job, saved);
        const srcOf = new Map(r.clauses.map((c) => [c.section, c.source]));
        const unverified = rows.filter((x) => srcOf.get(x.section) !== "document");
        const lines = [
          `${P}Contract clauses saved as written (${rows.length}).${r.has_document ? "" : " No contract text on file, so none could be verified: every clause is marked UNVERIFIED until the contract text is provided."}`,
          ...saved.filter((c) => rows.some((x) => x.section === c.section)).map((c) => `- ${clauseLine(c)}`),
          ...(unverified.length && r.has_document ? [`Not found exactly in the contract text: ${unverified.map((x) => `§${x.section}`).join(", ")}. Check the wording; an open item was opened for each.`] : []),
          ...missingNotices(saved).map((m) => `Missing from the contract clauses: ${m.label}. An open item asks you to confirm it; nothing was filled in.`),
        ];
        return { ...text(`${lines.join("\n")}${itemNotes(made)}`), structuredContent: { clauses: saved.map((c) => ({ section: c.section, category: c.category, source: c.source, n_days: c.n_days, day_type: c.day_type })), items: made.map((m) => itemOut(m)!) } };
      }

      if (args.section === "deadline") {
        if (!args.clause_key || !args.label?.trim()) throw new ToolError("deadline needs clause_key and label.");
        if (args.fixed_date === undefined && (args.trigger_date === undefined || args.n_days === undefined))
          throw new ToolError("deadline needs fixed_date, or trigger_date and n_days. Leave the clause out if you don't have it; it stays unknown.");
        const c = computeDue({
          id: "", label: args.label, clause_ref: args.clause_ref ?? null, trigger_desc: args.trigger_desc ?? null, trigger_date: args.trigger_date ?? null,
          trigger_alternatives: args.trigger_alternatives ?? [], n_days: args.n_days ?? null, day_type: (args.day_type ?? null) as DayType | null,
          holidays: args.holidays ?? null, weekend_roll: args.weekend_roll ?? false, fixed_date: args.fixed_date ?? null,
        });
        const r = await rpc<{ deadline_id: string; item: ItemResult | null; day_type_item: ItemResult | null; trigger_item: ItemResult | null }>(sb, "mcp_deadline_add", {
          _job: job.job_id, _due: c.due,
          _d: {
            clause_key: args.clause_key, label: args.label, clause_ref: args.clause_ref, trigger_desc: args.trigger_desc, trigger_date: args.trigger_date,
            trigger_alternatives: args.trigger_alternatives ?? [], n_days: args.n_days, day_type: args.day_type, holidays: args.holidays,
            weekend_roll: args.weekend_roll, fixed_date: args.fixed_date, delivery_method: args.delivery_method, recipient: args.recipient,
            owner: args.owner, source: readFromDocument(args, [args.label, args.clause_ref, args.trigger_desc].join(" ")) ? "document" : "member_answer",
          },
        });
        return {
          ...text(
            [`${P}Deadline recorded: ${args.label}${args.clause_ref ? ` (${args.clause_ref})` : ""}. Due ${c.due ?? "unknown"}.`, `Math: ${c.math}.`, ...c.alternatives.map((a) => `Also shown: ${a}.`), ...c.precautions,
              `Deadline item:${itemNote(r.item)}`, r.day_type_item ? `Day type ambiguity:${itemNote(r.day_type_item)}` : "", r.trigger_item ? `Trigger ambiguity:${itemNote(r.trigger_item)}` : ""].filter(Boolean).join("\n"),
          ),
          structuredContent: { deadline_id: r.deadline_id, due: c.due, items: [r.item, r.item?.delivery_item, r.day_type_item, r.trigger_item].filter((x): x is ItemResult => !!x).map((x) => itemOut(x)!) },
        };
      }

      if (args.section === "scope") {
        const facts = {
          job_type: args.job_type ?? null, scope_summary: args.scope_summary ?? null, size_band: args.size_band ?? null, sector: args.sector ?? null,
          client_type: args.client_type ?? null, pricing_model: args.pricing_model ?? null, position: args.position ?? null,
          work_packages: args.work_packages ?? null, major_equipment: args.major_equipment ?? null, key_clauses: args.key_clauses ?? null, tool_stack: args.job_tool_stack ?? null,
        };
        const fr = await rpc<{ known: string[]; unknown: string[] }>(sb, "mcp_set_facts", { _job: job.job_id, _module: "scope", _facts: facts, _source: "member_answer" });
        const wp = args.work_packages;
        const flags: Record<string, string> = {
          public_job: triFrom(args.sector === undefined ? undefined : args.sector === "public"),
          residential: triFrom(args.sector === undefined ? undefined : args.sector === "residential"),
          prime_contract: triFrom(args.position === undefined ? undefined : args.position === "prime"),
          sub_position: triFrom(args.position === undefined ? undefined : args.position !== "prime"),
          pricing_lump_sum: triFrom(args.pricing_model === undefined ? undefined : args.pricing_model === "lump_sum"),
          pricing_unit_price: triFrom(args.pricing_model === undefined ? undefined : args.pricing_model === "unit_price"),
          pricing_cost_plus: triFrom(args.pricing_model === undefined ? undefined : args.pricing_model === "cost_plus"),
          pricing_gmp: triFrom(args.pricing_model === undefined ? undefined : args.pricing_model === "gmp"),
          has_subcontracts: triFrom(wp === undefined ? undefined : wp.some((w) => w.mode === "subcontract")),
          self_perform: triFrom(wp === undefined ? undefined : wp.some((w) => w.mode === "self_perform")),
          major_equipment: triFrom(args.major_equipment === undefined ? undefined : args.major_equipment.length > 0),
          has_retainage: args.key_clauses?.retainage ?? "unknown",
          beneficial_use: args.key_clauses?.beneficial_use ?? "unknown",
          has_lds: args.key_clauses?.liquidated_damages ?? "unknown",
          notice_requirements: args.key_clauses?.notice ?? "unknown",
        };
        // Unknown flags that a setup question or the contract section asks directly are left for that step,
        // so the member isn't asked to confirm the same thing twice.
        for (const k of Object.keys(flags)) if (flags[k] === "unknown" && FLAGS_ASKED_LATER.has(k)) delete flags[k];
        const r = await rpc<FlagResult>(sb, "mcp_set_flags", { _job: job.job_id, _flags: flags, _source: "member_answer" });
        await settleFlagConfirms(sb, job);
        const { data: all } = await sb.from("mcp_job_flags").select("flag_key, value, source").eq("job_id", job.job_id).order("flag_key");
        return text(
          `${P}Step 0 scoping saved.\nRecorded: ${humanKeys(fr.known) || "none"}\nUnknown: ${humanKeys(fr.unknown) || "none"}\n\nApplicability flags:\n${(all ?? []).map((f) => `- ${f.flag_key.replace(/_/g, " ")}: ${f.value} (${f.source.replace(/_/g, " ")})`).join("\n")}\n${flagNote(r)}\n\nNext: intake section "contract", or next_question.`,
        );
      }

      if (args.section === "contract") {
        const fromDoc = readFromDocument(args, keysText(args));
        const source = fromDoc ? "document" : "member_answer";
        const keys = ["pay_terms", "notice_timing", "tia_timing", "change_process", "claim_process", "retainage", "retainage_reduction", "beneficial_use_clause", "liquidated_damages", "savings_split", "closeout", "warranty_clauses"] as const;
        // Values the member gave are always kept: "document" when read from the contract, otherwise "manual"
        // (member_answer). Keys not given are never overwritten; they are recorded as unknown only the first time.
        const given: Record<string, string> = {};
        const unknownNow: Record<string, null> = {};
        for (const k of keys) {
          const v = args[k]?.trim();
          if (!v) continue;
          if (CLAUSE_UNKNOWN.test(v)) unknownNow[k] = null; // "not specified" is unknown, never a term
          else given[k] = v;
        }
        const { data: prior, error: priorErr } = await sb.from("mcp_job_facts").select("key").eq("job_id", job.job_id).eq("module", "contract");
        if (priorErr) throw new Error(priorErr.message);
        const had = new Set((prior ?? []).map((p) => p.key));
        const fill: Record<string, null> = {};
        for (const k of keys) if (!(k in given) && !had.has(k)) fill[k] = null;
        Object.assign(fill, unknownNow);
        if (Object.keys(given).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "contract", _facts: given, _source: source });
        if (Object.keys(fill).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "contract", _facts: fill, _source: "member_answer" });
        const { data: now, error: nowErr } = await sb.from("mcp_job_facts").select("key, status, source").eq("job_id", job.job_id).eq("module", "contract");
        if (nowErr) throw new Error(nowErr.message);
        const srcLabel = (s: string) => (s === "member_answer" ? "manual" : s.replace(/_/g, " "));
        const fr = {
          known: (now ?? []).filter((f) => f.status === "known").map((f) => `${f.key} (${srcLabel(f.source)})`),
          unknown: (now ?? []).filter((f) => f.status === "unknown").map((f) => f.key),
        };
        let note = "";
        {
          const flags: Record<string, string> = {};
          const set = (k: string, v: "yes" | "no" | undefined) => { if (v) flags[k] = v; };
          set("has_retainage", clauseFlag(args.retainage));
          set("beneficial_use", clauseFlag(args.beneficial_use_clause));
          set("has_lds", clauseFlag(args.liquidated_damages));
          set("notice_requirements", clauseFlag(args.notice_timing));
          if (Object.keys(flags).length) note = flagNote(await rpc<FlagResult>(sb, "mcp_set_flags", { _job: job.job_id, _flags: flags, _source: source }));
          // "Not specified" puts the flag back to unknown, even over an earlier (mis-tagged) value.
          const CLAUSE_FLAG: Record<string, string> = { retainage: "has_retainage", beneficial_use_clause: "beneficial_use", liquidated_damages: "has_lds", notice_timing: "notice_requirements" };
          const toUnknown = Object.keys(unknownNow).map((k) => CLAUSE_FLAG[k]).filter(Boolean);
          if (toUnknown.length) {
            const u = await sb.rpc("mcp_flags_unknown", { _job: job.job_id, _keys: toUnknown });
            if (u.error && !isMissingFunction(u.error)) dbError(u.error);
          }
          await settleFlagConfirms(sb, job);
        }
        const saved = Object.keys(given);
        return text(
          `${P}Contract terms saved${saved.length ? (fromDoc ? " from the contract (source: document)" : " as manual entries (source: manual)") : ""}.\n${!fromDoc && saved.length ? "These were entered by hand, not read from the contract. Confirm them against the contract when you have it.\n" : ""}Known: ${humanKeys(fr.known) || "none"}\nUnknown: ${humanKeys(fr.unknown) || "none"}${note ? `\n${note}` : ""}`,
        );
      }

      if (args.section === "warranty") {
        const facts: Record<string, unknown> = {};
        const put = (k: string, v: unknown) => { if (v !== undefined) facts[k] = typeof v === "string" ? v.trim() || null : v; };
        put("workmanship_warranty", args.workmanship_warranty);
        put("workmanship_warranty_months", args.workmanship_warranty_months);
        put("warranty_start_trigger", args.warranty_start_trigger);
        put("warranty_start_trigger_other", args.warranty_start_trigger_other);
        if (args.warranty_start_trigger_text?.trim()) Object.assign(facts, mapTrigger(args.warranty_start_trigger_text));
        put("warranty_trigger_date", args.warranty_trigger_date);
        for (const k of ["warranty_start_basis", "closeout_documents", "punch_final_acceptance", "manufacturer_warranties", "closeout_expectations"] as const) put(k, args[k]);
        const { all, made } = await saveWarranty(sb, job, facts, { fillMissing: true, owner: args.owner ?? null, neededBy: args.needed_by ?? null, tool: "intake" });
        const today = todayIn(await jobTimeZone(sb, job.job_id));
        return {
          ...text(`${P}Warranty and closeout setup saved.\n\nWARRANTY REGISTER\n${renderWarrantyRegister(all, today).join("\n")}${itemNotes(made)}`),
          structuredContent: { items: made.map((m) => itemOut(m)!) },
        };
      }

      if (args.section === "handoff") {
        const keys = ["sold_scope", "carried_scope", "exclusions", "allowances", "addenda", "concessions", "quantities", "production_rates", "crew_assumptions", "sub_qualifications"] as const;
        const facts: Record<string, string | null> = {};
        for (const k of keys) facts[k] = args[k]?.trim() || null;
        const fr = await rpc<{ known: string[]; unknown: string[] }>(sb, "mcp_set_facts", { _job: job.job_id, _module: "handoff", _facts: facts, _source: "member_answer" });
        const notes: string[] = [];
        for (const g of args.gaps ?? []) {
          const r = await rpc<ItemResult>(sb, "mcp_add_item", {
            _job: job.job_id,
            _f: { action: `Handoff gap: ${g.gap}`, accountable: g.owner, needed_by: g.needed_by ?? null, kind: "gap", section: "handoff", category: "Handoff", internal_only: true, source: "member_answer", tool: "intake" },
          });
          notes.push(`-${itemNote(r)}`);
        }
        return text(`${P}Estimate-to-execution baseline saved (internal only).\nKnown: ${humanKeys(fr.known) || "none"}\nUnknown: ${humanKeys(fr.unknown) || "none"}\nGaps:\n${notes.join("\n") || "- none"}`);
      }

      if (args.section === "budget") {
        if (args.fee_pct !== undefined && !(args.fee_pct >= 0 && args.fee_pct < 100)) throw new ToolError("The fee percent must be at least 0 and under 100.");
        const budget: Record<string, unknown> = {};
        for (const b of args.budget_lines ?? []) budget[b.cost_code] = { description: b.description ?? null, amount: b.amount ?? null };
        const sov: Record<string, unknown> = {};
        for (const s of args.sov_lines ?? []) sov[s.line] = { description: s.description ?? null, billable_value: s.billable_value ?? null, cost_codes: s.cost_codes ?? [] };
        if (Object.keys(budget).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "budget", _facts: budget, _source: "member_answer" });
        if (Object.keys(sov).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "sov", _facts: sov, _source: "member_answer" });
        if (args.fee_pct !== undefined || args.sov_basis) await rpc(sb, "mcp_job_sov_terms", { _job: job.job_id, _fee_pct: args.fee_pct ?? null, _basis: args.sov_basis ?? null });
        const { data: terms } = await sb.from("mcp_jobs").select("sov_fee_pct, sov_basis").eq("id", job.job_id).maybeSingle();
        const { data: all } = await sb.from("mcp_job_facts").select("module, key, value").eq("job_id", job.job_id).in("module", ["budget", "sov"]);
        const codes = new Set((all ?? []).filter((f) => f.module === "budget").map((f) => f.key));
        const sovRows = (all ?? []).filter((f) => f.module === "sov");
        const mapped = new Set<string>();
        const unmappedLines: string[] = [];
        const badRefs: string[] = [];
        for (const s of sovRows) {
          const cc = (((s.value ?? {}) as { cost_codes?: string[] }).cost_codes ?? []);
          if (!cc.length) unmappedLines.push(s.key);
          for (const c of cc) (codes.has(c) ? mapped.add(c) : badRefs.push(`${s.key}→${c}`));
        }
        const unmappedCodes = [...codes].filter((c) => !mapped.has(c));
        let note = "";
        if (unmappedLines.length || unmappedCodes.length || badRefs.length) {
          const r = await rpc<ItemResult>(sb, "mcp_add_item", {
            _job: job.job_id,
            _f: { check_key: "budget:unmapped", action: "Map SOV lines to cost codes", detail: `SOV lines without codes: ${unmappedLines.join(", ") || "none"}; codes not on any SOV line: ${unmappedCodes.join(", ") || "none"}; SOV codes not in budget: ${badRefs.join(", ") || "none"}`, section: "budget", category: "Budget", internal_only: true, tool: "intake" },
          });
          note = itemNote(r);
        }
        return text(
          `${P}Budget and SOV saved. Budget is internal only.\nCost codes: ${codes.size} | SOV lines: ${sovRows.length}\nSOV lines not mapped to a cost code: ${unmappedLines.join(", ") || "none"}\nCost codes not on any SOV line: ${unmappedCodes.join(", ") || "none"}\nSOV codes missing from the budget: ${badRefs.join(", ") || "none"}\nFee: ${terms?.sov_fee_pct == null ? "not recorded" : `${Number(terms.sov_fee_pct).toFixed(2)}% of contract total`} | Basis: ${terms?.sov_basis ?? "not recorded"}${note}`,
        );
      }

      if (args.section === "open_item") {
        if (!args.action?.trim()) throw new ToolError("open_item needs action.");
        if (args.kind === "commercial" && !args.commercial_type) throw new ToolError("A commercial item needs commercial_type (co, rea, claim or retainage).");
        const r = await rpc<ItemResult>(sb, "mcp_add_item", {
          _job: job.job_id,
          _f: {
            action: args.action, kind: args.kind ?? "general", commercial_type: args.commercial_type ?? null, accountable: args.owner ?? null, needed_by: args.needed_by ?? null,
            cost_effect: args.cost_effect ?? null, time_effect: args.time_effect ?? null, cash_effect: args.cash_effect ?? null,
            effect_is_estimate: args.effect_is_estimate ?? true, next_action: args.next_action ?? null, next_action_approved_by: args.next_action_approved_by ?? null,
            internal_only: args.internal_only ?? false, source: "member_answer", tool: "intake", category: args.kind === "commercial" ? "Commercial" : "General",
            item_type: args.item_type ?? null, waiting_on_document: args.waiting_on_document ?? null, waiting_on_who: args.waiting_on_who ?? null,
            waiting_since: args.waiting_since ?? null, clause_source: args.clause_source ?? null, delivery_method: args.delivery_method ?? null,
            recipient: args.recipient ?? null, recommendation: args.recommendation ?? null, why: args.why ?? null,
          },
        });
        return { ...text(`${P}${itemNote(r).trim()}`), structuredContent: { items: [itemOut(r)!, ...(r.delivery_item ? [itemOut(r.delivery_item)!] : [])] } };
      }

      // lookahead: ask whether one exists first (setup check bss_lookahead); a "no" gets the push-back, never a silent create.
      const { data: la0 } = await sb.from("mcp_job_answers").select("answer").eq("job_id", job.job_id).eq("check_key", LOOKAHEAD_SETUP_KEY).maybeSingle();
      const hasAnswer = (la0 as { answer?: string } | null)?.answer;
      if (!args.lookahead_exists && hasAnswer !== "yes") {
        await audit(sb, job, "intake", "lookahead_ask_exists", null);
        return {
          ...text(`${P}${LOOKAHEAD_EXISTS_ASK}\n\nAsk the member and wait for the answer. Then call intake section "lookahead" again with lookahead_exists "yes" (they have one), "build" (they want Athena to build it from the schedule) or "no".`),
          structuredContent: { created: false, asked: LOOKAHEAD_SETUP_KEY },
        };
      }
      if (args.lookahead_exists === "no") {
        await audit(sb, job, "intake", "lookahead_no_pushback", null);
        return guide({ ...text(pushbackText(P)), structuredContent: { created: false, lookahead_help: "offered", prompt: LOOKAHEAD_PUSHBACK } }, `Ask the member, then call intake section "lookahead" again with lookahead_exists "build" (they want help) or answer check_key "${LOOKAHEAD_SETUP_KEY}" with response "no" and lookahead_help "decline".`);
      }
      const docs: Partial<Record<InputKey, string>> = {};
      for (const k of ["schedule_export", "crews", "submittal_log", "rfi_log", "inspection_list", "deliveries"] as const) {
        const v = args[k]?.trim();
        if (v) docs[k] = v;
      }
      if (args.start_date && args.end_date && args.end_date < args.start_date) throw new ToolError("end_date is before start_date.");
      const provided: string[] = Object.keys(docs);
      if (args.start_date && args.end_date) provided.push("lookahead_dates");
      const missing = INPUT_KEYS.filter((k) => !provided.includes(k));
      const { data: la, error } = await sb
        .from("mcp_lookaheads")
        .insert({ job_id: job.job_id, start_date: args.start_date ?? null, end_date: args.end_date ?? null, inputs: docs, provided_inputs: provided, missing_inputs: missing })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await audit(sb, job, "intake", "lookahead_create", la.id);
      if (hasAnswer !== "yes") {
        // They have one (or are building it now): record the setup check as yes. Ignored where the check isn't installed.
        await sb.rpc("mcp_answer", { _job: job.job_id, _key: LOOKAHEAD_SETUP_KEY, _answer: "yes", _detail: args.lookahead_exists === "build" ? "Built with Athena from the schedule." : "Look-ahead in place.", _owner: null, _needed_by: null });
      }
      return {
        ...text(
          `${P}Look-ahead created for ${args.start_date ?? "the next two weeks"}${args.end_date ? ` to ${args.end_date}` : ""}.\n\nProvided:\n${provided.map((k) => `- ${INPUT_LABELS[k as InputKey]}`).join("\n") || "- none"}\n\nMissing (recorded as unknown):\n${missing.map((k) => `- ${INPUT_LABELS[k]}`).join("\n") || "- none"}\n\nNext: next_question with this job_number and lookahead_id (from structuredContent; don't show the id to the member).`,
        ),
        structuredContent: { lookahead_id: la.id, provided, missing },
      };
    }),
});

/** The calling member as "Name (Role)". */
async function callerLabel(sb: Sb, job: Job, userId: string | undefined): Promise<string> {
  if (!userId) return "the calling member";
  const { data } = await sb.from("mcp_company_members").select("display_name, role").eq("company_id", job.company_id).eq("user_id", userId).maybeSingle();
  if (!data) return "the calling member";
  const role = data.role === "pm" ? "PM" : data.role === "all_access" ? "All-access" : String(data.role).charAt(0).toUpperCase() + String(data.role).slice(1);
  return `${data.display_name} (${role})`;
}

async function flagMap(sb: Sb, job: Job): Promise<Record<string, string>> {
  const { data } = await sb.from("mcp_job_flags").select("flag_key, value").eq("job_id", job.job_id);
  return Object.fromEntries((data ?? []).map((f) => [f.flag_key, f.value]));
}

/** Close "Confirm whether this applies" items once the member has answered that flag elsewhere (setup question or intake). */
async function settleFlagConfirms(sb: Sb, job: Job) {
  const { data: open } = await sb.from("mcp_open_items").select("id, check_key").eq("job_id", job.job_id).eq("status", "open").like("check_key", "flag:%");
  if (!open?.length) return;
  const flags = await flagMap(sb, job);
  for (const it of open) {
    const k = String(it.check_key).slice(5);
    const v = flags[k];
    if (!v || v === "unknown") continue;
    await rpc(sb, "mcp_resolve_item", { _item: it.id, _kind: "member_statement", _evidence: `Answered: ${k.replace(/_/g, " ")} = ${v}.`, _stated_by: "member answer", _stated_on: todayIn(await jobTimeZone(sb, job.job_id)),
      _reason: null, _approval: null, _billing: null, _collection: null });
  }
}

async function lookaheadForJob(sb: Sb, job: Job, id: string) {
  const la = await loadLookahead(sb, id);
  if (la.job_id !== job.job_id) throw new ToolError(`That lookahead doesn't belong to job ${job.job_number}.`);
  return la;
}

// ---------- next_question ----------
type NextCheck = { key: string; label: string | null; section: string | null; category: string; prompt: string; record_value: unknown; index: number; total: number } | null;
export const nextQuestion = defineTool({
  name: "next_question",
  title: "Next question",
  description: "Get the next setup question for a job, one at a time (or the next lookahead question when lookahead_id is given). Skips anything marked N/A or already answered.",
  inputSchema: { job_number: jobNumber, company_id: companyId, lookahead_id: uuid.optional().describe("Only for a two-week lookahead.") },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("next_question", ctx, { lookaheadId: args.lookahead_id, jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const P = prefix(job);
      if (args.lookahead_id) {
        const la = await lookaheadForJob(sb, job, args.lookahead_id);
        const { check, index, total } = await currentCheck(sb, la, "next_question");
        await audit(sb, job, "next_question", "view_lookahead_question", la.id);
        if (!check) return text(`${P}All lookahead checks are done. Call report with lookahead_id.`);
        const how = check.rule_type === "confirm" ? 'Answer with response "yes", "no" or "unknown".' : 'Answer with detail listing the items, or detail "none". Use response "unknown" if you don\'t know.';
        return {
          ...text(`${P}Question ${index} of ${total} [${check.trade} / ${check.category}]\nQuestion ref: ${questionRef(check.key)}\n\n${check.prompt}\n\n${how}\nCall answer with job_number, lookahead_id and check_key.`),
          structuredContent: { check_key: check.key, index, total },
        };
      }
      let q = await rpc<NextCheck>(sb, "mcp_next_check", { _job: job.job_id });
      // The job number is on record (every job is keyed by it), so this check is answered for the member, visibly.
      let auto = "";
      if (q?.key === "job_number_assigned") {
        await rpc(sb, "mcp_answer", { _job: job.job_id, _key: q.key, _answer: "yes", _detail: `Job number ${job.job_number} is on record.`, _owner: null, _needed_by: null });
        auto = `Answered for you: ${q.label ? `${q.label} ` : ""}"${q.prompt}" — yes (job number ${job.job_number} is on record). Say so if that's wrong and I'll change it.\n\n`;
        q = await rpc<NextCheck>(sb, "mcp_next_check", { _job: job.job_id });
      }
      // Workmanship warranty and closeout expectations are asked up front: right after the gate questions, before the rest of the checklist.
      const wq = nextWarrantyQuestion(await warrantyFacts(sb, job));
      const wLeft = wq ? wq.remaining_after + 1 : 0;
      if (wq && q?.section !== "gate") {
        const key = `${WARRANTY_CHECK_PREFIX}${wq.key}`;
        const after = wq.remaining_after + (q ? q.total - q.index + 1 : 0);
        await audit(sb, job, "next_question", "view_setup_question", key);
        return {
          ...text(`${P}${auto}Setup question — ${after === 0 ? "last one" : `${after} more after this`} (Warranty and closeout ${wq.index} of ${wq.total}: ${wq.label}) [Warranty / section warranty]\nQuestion ref: ${questionRef(key)}\n\n${wq.ask}\n\n${warrantyHow(wq.key)}\nCall answer with job_number and check_key.`),
          structuredContent: { check_key: key, index: wq.index, total: wq.total, remaining_after: after, auto_answered: auto ? "job_number_assigned" : null },
        };
      }
      await audit(sb, job, "next_question", "view_setup_question", q?.key ?? null);
      if (!q) {
        const { data: mods } = await sb.from("mcp_job_facts").select("module").eq("job_id", job.job_id);
        const have = new Set((mods ?? []).map((m) => m.module));
        const todo = ["scope", "contract", "handoff", "budget", "warranty"].filter((m) => !have.has(m));
        return text(`${P}${auto}No setup questions left.${todo.length ? ` Intake sections not started: ${todo.join(", ")}.` : ""} Call report.`);
      }
      const confirm = q.record_value != null;
      const ask = confirm ? `The record shows: ${typeof q.record_value === "string" ? q.record_value : JSON.stringify(q.record_value)}\nConfirm this is right (yes), or say no / unknown.` : q.prompt;
      return {
        ...text(
          `${P}${auto}Setup question ${q.index} — ${q.total - q.index + wLeft === 0 ? "last one" : `${q.total - q.index + wLeft} more after this`}${q.label ? ` (${q.label})` : ""} [${q.category}]\nQuestion ref: ${questionRef(q.key)}\n\n${confirm ? `${q.prompt}\n${ask}` : ask}\n\nAnswer with response yes, no, na (with a reason in detail) or unknown. For unknown or no, add owner and due_date if known. To mark the whole section N/A use answer action "mark_na" with scope "section".`,
        ),
        structuredContent: { check_key: q.key, index: q.index, total: q.total, remaining_after: q.total - q.index + wLeft, auto_answered: auto ? "job_number_assigned" : null },
      };
    }),
});

// ---------- answer ----------
export const answer = defineTool({
  name: "answer",
  title: "Answer or mark N/A",
  description:
    "Answer the current question (yes / no / na / unknown), mark an item or section N/A, re-enable it, or decline a re-enable suggestion. N/A only stops future questions; it never closes open items. Unknown opens a confirm item.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    action: z.enum(["answer", "mark_na", "reenable", "decline_reenable"]).optional().describe("Default answer."),
    check_key: z.string().min(1).max(100).optional().describe("answer: the question ref shown by next_question (e.g. gate-role-gc) or check_key from structured content. mark_na/reenable with scope item: the same ref."),
    lookahead_help: z.enum(["accept", "decline"]).optional().describe(`answer on check ${"bss_lookahead"} with response "no": "accept" if the member wants help building a look-ahead, "decline" if not (logs an open item). Leave out the first time; Athena asks.`),
    response: tri.optional().describe("answer: yes / no / na / unknown."),
    detail: z.string().max(10_000).optional().describe("Details, or the N/A reason (max 10,000 characters)."),
    owner: z.string().max(200).optional().describe("Accountable person for a follow-up. Leave out if unknown."),
    due_date: date.optional().describe("Needed-by date (YYYY-MM-DD)."),
    scope: z.enum(["item", "section"]).optional().describe("mark_na / reenable: item or section."),
    section: z.string().max(60).optional().describe("mark_na / reenable with scope section: section name, e.g. bid_documents, insurance_bonding, contract_time, self_perform_premob."),
    na_id: uuid.optional().describe("decline_reenable: na_id from the suggestion."),
    lookahead_id: uuid.optional().describe("Only for a two-week lookahead question."),
  },
  annotations: { ...WRITE, idempotentHint: false },
  handler: (args, ctx) =>
    run("answer", ctx, { lookaheadId: args.lookahead_id, jobNumber: args.job_number }, async (sb) => {
      capInput(args);
      if (args.check_key) args.check_key = parseQuestionRef(args.check_key);
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const P = prefix(job);
      const action = args.action ?? "answer";
      if (action === "mark_na" || action === "reenable") {
        const scope = args.scope ?? (args.section ? "section" : "item");
        const target = scope === "section" ? args.section : args.check_key;
        if (!target) throw new ToolError(scope === "section" ? "Give the section name." : "Give the check_key.");
        if (action === "mark_na") {
          if (!args.detail?.trim()) throw new ToolError("N/A needs a reason in detail.");
          const r = await rpc<{ already_na: boolean; open_items_kept: number }>(sb, "mcp_mark_na", { _job: job.job_id, _scope: scope, _target: target, _reason: args.detail });
          return text(
            `${P}${r.already_na ? "Already" : "Marked"} N/A (${scope} ${target}). Future questions there are skipped.${r.open_items_kept ? ` ${r.open_items_kept} open item(s) stay open and are labeled "section N/A — needs disposition".` : ""}`,
          );
        }
        await rpc(sb, "mcp_reenable", { _job: job.job_id, _scope: scope, _target: target });
        return text(`${P}Re-enabled (${scope} ${target}). Its questions will be asked again. Call next_question.`);
      }
      if (action === "decline_reenable") {
        if (!args.na_id) throw new ToolError("decline_reenable needs na_id.");
        await rpc(sb, "mcp_decline_reenable", { _job: job.job_id, _na_id: args.na_id });
        return text(`${P}Declined. It stays N/A and you won't be asked again for that same trigger.`);
      }
      if (!args.check_key) throw new ToolError("Which question? Give its question ref (for example gate-role-gc).");

      if (args.lookahead_id) {
        const la = await lookaheadForJob(sb, job, args.lookahead_id);
        const { check } = await currentCheck(sb, la, "answer");
        if (!check) throw new ToolError("All checks are already answered. Call report.");
        if (check.key !== args.check_key) throw new ToolError("That isn't the current question. Call next_question and answer the check it returns.");
        const detail = args.detail?.trim() || null;
        let status: "answered" | "unknown" = "answered";
        let openItem = false;
        if (args.response === "unknown") status = "unknown";
        else if (check.rule_type === "confirm") {
          if (!args.response || args.response === "na") throw new ToolError('This question needs response "yes", "no" or "unknown".');
          openItem = args.response === "no";
        } else {
          if (!detail) throw new ToolError('This question needs detail (the list, or "none"), or response "unknown".');
          openItem = !/^(none|n\/a|na|no|nothing)\.?$/i.test(detail);
        }
        const { error } = await sb.from("mcp_answers").insert({ lookahead_id: la.id, check_key: check.key, check_version: check.version, status, response: args.response ?? null, detail });
        if (error) throw new Error(error.message);
        let item: ItemResult | null = null;
        if (openItem || status === "unknown") {
          item = await rpc<ItemResult>(sb, "mcp_add_item", {
            _job: job.job_id,
            _f: {
              action: `${check.category}: ${detail ?? check.prompt.replace(/^PLACEHOLDER:\s*/, "")}`.slice(0, 480), kind: status === "unknown" ? "confirm_unknown" : "general",
              item_type: status === "unknown" ? "unknown" : "no", accountable: args.owner ?? null, needed_by: args.due_date ?? null, trade: check.trade, category: check.category, severity: check.severity, detail, tool: "answer",
            },
          });
        }
        await audit(sb, job, "answer", `lookahead_answer_${status}`, check.key);
        return { ...text(`${P}Recorded${status === "unknown" ? " as unknown" : ""}.${itemNote(item)}\nNext: next_question.`), structuredContent: { status, item_id: item?.item_id ?? null, item_type: item?.item_type ?? null } };
      }

      if (args.check_key.startsWith(WARRANTY_CHECK_PREFIX)) {
        const key = args.check_key.slice(WARRANTY_CHECK_PREFIX.length) as WarrantyKey;
        if (!WARRANTY_SETUP_QUESTIONS.some((q) => q.key === key)) throw new ToolError("That isn't a setup question. Call next_question and answer the check it returns.");
        let facts: Record<string, unknown>;
        try { facts = warrantyAnswerFacts(key, args.response, args.detail); } catch (e) { throw new ToolError((e as Error).message); }
        const { all, made } = await saveWarranty(sb, job, facts, { fillMissing: false, owner: args.owner ?? null, neededBy: args.due_date ?? null, tool: "answer" });
        await audit(sb, job, "answer", "warranty_answer", args.check_key);
        const today = todayIn(await jobTimeZone(sb, job.job_id));
        const left = nextWarrantyQuestion(all);
        return {
          ...text(`${P}Recorded.${itemNotes(made)}${left ? "" : `\n\nWARRANTY REGISTER\n${renderWarrantyRegister(all, today).join("\n")}`}\nNext: next_question.`),
          structuredContent: { recorded: JSON.parse(JSON.stringify(facts)) as Record<string, string | number | null>, items: made.map((m) => itemOut(m)!) },
        };
      }
      if (!args.response) throw new ToolError("answer needs response yes, no, na or unknown.");
      // A "no" on the look-ahead check is not accepted: push back and offer to build one from the schedule.
      if (args.check_key === LOOKAHEAD_SETUP_KEY && args.response === "no" && args.lookahead_help !== "decline") {
        await audit(sb, job, "answer", args.lookahead_help === "accept" ? "lookahead_help_accepted" : "lookahead_no_pushback", args.check_key);
        if (args.lookahead_help === "accept")
          return guide({ ...text(buildQuestionsText(P)), structuredContent: { recorded: null, lookahead_help: "accepted", questions: [...LOOKAHEAD_BUILD_QUESTIONS] } }, ...buildQuestionsGuidance(job.job_number));
        return guide({ ...text(pushbackText(P)), structuredContent: { recorded: null, lookahead_help: "offered", prompt: LOOKAHEAD_PUSHBACK } }, PUSHBACK_GUIDANCE);
      }
      const r = await rpc<{ recorded: string; item: ItemResult | null; recommendation: string | null }>(sb, "mcp_answer", {
        _job: job.job_id, _key: args.check_key, _answer: args.response, _detail: args.detail ?? null, _owner: args.owner ?? null, _needed_by: args.due_date ?? null,
      });
      await settleFlagConfirms(sb, job);
      let guidance = "";
      if (r.recorded === "no" && r.item) {
        const { data: it } = await sb.from("mcp_open_items").select("recommendation, why, help_offer").eq("id", r.item.item_id).maybeSingle();
        const flags = await flagMap(sb, job);
        guidance = noGuidanceText(noGuidance(reconcileRecommendation(args.check_key, it?.recommendation ?? r.recommendation, flags), it?.why, it?.help_offer));
      } else if (r.recommendation) guidance = `\n\nRecommendation: ${r.recommendation}`;
      return {
        ...text(`${P}Recorded ${r.recorded}.${r.recorded === "na" ? " This question won't be asked again unless you re-enable it." : ""}${itemNote(r.item)}${guidance}\nNext: next_question.`),
        structuredContent: { recorded: r.recorded, item_id: r.item?.item_id ?? null, item_type: r.item?.item_type ?? null },
      };
    }),
});

// ---------- report ----------
export const report = defineTool({
  name: "report",
  title: "Job report",
  description: "Render the full job setup report (internal or client-facing), or the two-week lookahead report when lookahead_id is given. Client-facing reports leave out internal cost and strategy detail. To read back just the contract terms, use contract_terms instead.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    audience: z.enum(["internal", "client"]).optional().describe("Default internal."),
    lookahead_id: uuid.optional().describe("Only for a two-week lookahead report."),
    deliverable: z.enum(["setup", "sov"]).optional().describe("Default setup. sov: the schedule of values data and its layout recipe (full job access only; audience client for the copy sent to the owner)."),
  },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("report", ctx, { lookaheadId: args.lookahead_id, jobNumber: args.job_number, client: args.audience === "client", ownerSov: args.audience === "client" && args.deliverable === "sov" && !args.lookahead_id }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (args.lookahead_id) {
        const la = await lookaheadForJob(sb, job, args.lookahead_id);
        await audit(sb, job, "report", "view_lookahead_report", la.id);
        return text(`${prefix(job)}${await renderReport(sb, la)}`);
      }
      const audience = args.audience ?? "internal";
      if (args.deliverable === "sov") return sovResult(sb, job, audience);
      await audit(sb, job, "report", `view_setup_report_${audience}`, null);
      const body = await renderSetupReport(sb, job, audience);
      let iq = sb.from("mcp_open_items").select("id, section, check_key, item_type, commercial_type, category, action").eq("job_id", job.job_id).eq("status", "open");
      if (audience === "client") iq = iq.eq("internal_only", false);
      const [{ data: its0 }, nas] = await Promise.all([iq, activeNa(sb, job.job_id)]);
      const its = audience === "client" ? withoutClaims(its0 ?? []) : its0;
      // Client-facing output never carries item ids.
      const items = (its ?? []).map((i) => (audience === "client" ? { item_type: itemType(i, nas) } : { item_id: i.id, item_type: itemType(i, nas) }));
      return { ...text(body), structuredContent: { items } };
    }),
});

// ---------- carry_forward ----------
export const carryForward = defineTool({
  name: "carry_forward",
  title: "Carry forward open items",
  description: "Move open items from last week's lookahead into this week's lookahead for the same job, with history.",
  inputSchema: { job_number: jobNumber, company_id: companyId, from_lookahead_id: uuid.describe("Previous lookahead_id."), to_lookahead_id: uuid.describe("New lookahead_id from intake.") },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("carry_forward", ctx, { lookaheadId: args.to_lookahead_id, jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      if (args.from_lookahead_id === args.to_lookahead_id) throw new ToolError("from and to lookaheads must be different.");
      const [from, to] = await Promise.all([lookaheadForJob(sb, job, args.from_lookahead_id), lookaheadForJob(sb, job, args.to_lookahead_id)]);
      const { data: items, error } = await sb.from("mcp_open_items").select("id, carry_count, section, check_key, item_type").eq("lookahead_id", from.id).eq("status", "open");
      const nas = await activeNa(sb, job.job_id);
      if (error) throw new Error(error.message);
      for (const it of items ?? []) {
        const up = await sb.from("mcp_open_items").update({ lookahead_id: to.id, carry_count: it.carry_count + 1, updated_at: new Date().toISOString() }).eq("id", it.id);
        if (up.error) throw new Error(up.error.message);
        await sb.from("mcp_carry_forwards").insert({ item_id: it.id, from_lookahead_id: from.id, to_lookahead_id: to.id });
        await sb.from("mcp_item_events").insert({ item_id: it.id, event: "carried_forward", lookahead_id: to.id });
      }
      await audit(sb, job, "carry_forward", "carry_forward", to.id);
      const typed = (items ?? []).map((i) => ({ item_id: i.id, item_type: itemType(i, nas) }));
      return guide({
        ...text(`${prefix(job)}${typed.length} open item(s) carried forward.`),
        structuredContent: { items: typed.map((t) => ({ ...t, item_ref: shortRef(t.item_id) })) },
      }, "Next: next_question for the new lookahead.");
    }),
});

// ---------- list_open_items ----------
// The one exception to "job_number is required": with no job named, list_open_items lists the companies and jobs instead.
const listJobNumber = z.string().trim().min(1).max(40).optional().describe("Job number, exact match (e.g. 2417). Leave out when the member hasn't named a job: Athena then lists your companies and their jobs.");
export const NO_JOB_HINT = "If the member hasn't named a company or a job, call list_open_items with no job_number (and no company_id): Athena lists the companies and their jobs itself, so don't ask the member to guess.";

/** No job named: the caller's companies and their job numbers, in plain text. */
export async function listCompaniesAndJobs(sb: Sb, companyId?: string): Promise<string> {
  const { data: cos, error } = await sb.from("mcp_companies").select("id, name");
  if (error) throw new Error(error.message);
  let companies = (cos ?? []) as { id: string; name: string | null }[];
  if (companyId?.trim()) { const cid = await resolveCompany(sb, companyId); companies = companies.filter((c) => c.id === cid); }
  if (!companies.length) return 'No company set up yet. Call onboarding with action "save_company" first.';
  const { data: jobs, error: je } = await sb.from("mcp_jobs").select("job_number, name, company_id").in("company_id", companies.map((c) => c.id));
  if (je) throw new Error(je.message);
  const js = (jobs ?? []) as { job_number: string; name: string | null; company_id: string }[];
  const out = ["No job named. Your companies and jobs:"];
  for (const c of companies) {
    const mine = js.filter((j) => j.company_id === c.id).sort((a, b) => a.job_number.localeCompare(b.job_number));
    out.push(`- ${c.name ?? "unnamed company"}: ${mine.length ? mine.map((j) => `${j.job_number}${j.name ? ` (${j.name})` : ""}`).join(", ") : "no jobs yet"}`);
  }
  out.push("Which job should I list open items for?");
  return out.join("\n");
}
export const listOpenItems = defineTool({
  name: "list_open_items",
  title: "List open items",
  description: `List a job's open items with accountable person, needed-by date, verified or last-reported status, source and effects. Items under an N/A section are labeled for disposition. ${NO_JOB_HINT}`,
  inputSchema: {
    job_number: listJobNumber,
    company_id: companyId,
    lookahead_id: uuid.optional().describe("Limit to one lookahead."),
  },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("list_open_items", ctx, { lookaheadId: args.lookahead_id, jobNumber: args.job_number }, async (sb) => {
      if (!args.job_number?.trim()) return text(await listCompaniesAndJobs(sb, args.company_id));
      const job = await resolveJob(sb, args.job_number, args.company_id);
      let q = sb.from("mcp_open_items").select(ITEM_COLS).eq("job_id", job.job_id).eq("status", "open");
      if (args.lookahead_id) q = q.eq("lookahead_id", args.lookahead_id);
      const [{ data, error }, nas] = await Promise.all([q.order("needed_by", { nullsFirst: false }).limit(200), activeNa(sb, job.job_id)]);
      if (error) throw new Error(error.message);
      const tz = await jobTimeZone(sb, job.job_id);
      await audit(sb, job, "list_open_items", "view_open_items", null);
      if (!data?.length) return text(`${prefix(job)}No open items.`);
      const lines = (data as unknown as Parameters<typeof itemLine>[0][]).map((it) => `- ${itemLine(it, nas, job.scope !== "full", { tz })}`);
      const rows = data as unknown as Parameters<typeof itemLine>[0][];
      return { ...text(`${prefix(job)}Open items (${data.length}):\n${lines.join("\n")}`), structuredContent: { items: rows.map((i) => ({ item_ref: itemRef(i), item_id: i.id, item_type: itemType(i, nas) })) } };
    }),
});

// ---------- resolve_item ----------
/** The warranty setup question a closed confirm item answers (check_key "warranty:<key>"), if any. Gap ("no") items already have an answer. */
export function closedWarrantyKey(checkKey: string | null | undefined, closed: boolean, kind: string): WarrantyKey | null {
  if (!closed || (kind !== "verified" && kind !== "member_statement")) return null;
  const k = (checkKey ?? "").startsWith(WARRANTY_CHECK_PREFIX) ? (checkKey as string).slice(WARRANTY_CHECK_PREFIX.length) : "";
  return (WARRANTY_SETUP_QUESTIONS.slice(3).some((q) => q.key === k) ? k : null) as WarrantyKey | null;
}

export const resolveItem = defineTool({
  name: "resolve_item",
  title: "Resolve or update an open item",
  description:
    "Close an open item with evidence, close a confirm item with a dated statement, waive it (decision right and reason required), close a commercial item on approval + billing + collection, or record a last-reported status update. N/A is not a resolution.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    item_id: z.string().min(1).max(64).describe("The item: the ref shown on its line in list_open_items (e.g. A1 or 36C31, with or without \"Ref\") or the item_id from structured content."),
    kind: z.enum(["verified", "member_statement", "waive", "commercial_close", "update", "na"]).describe("How it is being closed or updated."),
    evidence: z.string().trim().max(10_000).optional().describe("Evidence: a document (name or number), or for member_statement what was said. A bare \"we're good\" is not evidence; the item stays open."),
    stated_by: z.string().max(200).optional().describe("member_statement / update: who said it, only if the member named someone. Leave out and it is attributed to the calling user."),
    stated_on: date.optional().describe("member_statement / update: date of the statement."),
    reason: z.string().max(2000).optional().describe("waive: reason (logged)."),
    approval: z.string().max(1000).optional().describe("commercial_close: approval reference."),
    billing: z.string().max(1000).optional().describe("commercial_close: billing reference."),
    collection: z.string().max(1000).optional().describe("commercial_close: collection reference."),
  },
  annotations: { ...WRITE, idempotentHint: false },
  handler: (args, ctx) =>
    run("resolve_item", ctx, { lookaheadId: undefined, jobNumber: args.job_number }, async (sb) => {
      capInput(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const { data: open, error: oe } = await sb.from("mcp_open_items").select("id, action, check_key").eq("job_id", job.job_id).eq("status", "open");
      if (oe) throw new Error(oe.message);
      const hit = matchRef(args.item_id, (open ?? []) as { id: string; action: string | null; check_key: string | null }[]);
      if ("error" in hit) throw new ToolError(hit.error === "ambiguous" ? `More than one open item matches ${args.item_id}. Use the ref exactly as shown on the item line.` : `No open item ${args.item_id} on job ${job.job_number}. List the open items to see each ref.`);
      const itemId = hit.id;
      const { data: it, error } = await sb.from("mcp_open_items").select("id, job_id, section, check_key, item_type, action").eq("id", itemId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!it || it.job_id !== job.job_id) throw new ToolError(`Item not found on job ${job.job_number}.`);
      const ref = itemRef(it);
      // Closing needs real evidence: a document, a dated who-said-what statement, or an explicit waiver.
      if ((args.kind === "verified" || args.kind === "member_statement") && evidenceProblem(args.evidence)) {
        await audit(sb, job, "resolve_item", "close_rejected_no_evidence", itemId);
        return { ...text(`${prefix(job)}${EVIDENCE_ASK}`), structuredContent: { item_id: itemId, item_ref: ref, item_type: itemType(it, await activeNa(sb, job.job_id)), closed: false } };
      }
      // Statements are attributed to the calling user (name and role) unless the member named who said it.
      const me = await callerLabel(sb, job, ctx.getUserId?.());
      const statedBy = args.kind === "member_statement" || args.kind === "update" ? (args.stated_by?.trim() || me) : args.stated_by ?? null;
      const evidence = args.kind === "member_statement" && args.evidence ? `${args.evidence.trim()} (recorded by ${me})` : args.evidence ?? null;
      const r = await rpc<{ closed: boolean; resolution?: string }>(sb, "mcp_resolve_item", {
        _item: itemId, _kind: args.kind, _evidence: evidence, _stated_by: statedBy, _stated_on: args.stated_on ?? null,
        _reason: args.reason ?? null, _approval: args.approval ?? null, _billing: args.billing ?? null, _collection: args.collection ?? null,
      });
      // A closed warranty/closeout confirm item answers its setup question: record the answer so the
      // register shows it and it leaves UNKNOWNS.
      let filled = "";
      const wkey = closedWarrantyKey(it.check_key, r.closed, args.kind);
      if (wkey && args.evidence?.trim()) {
        const cur = await sb.from("mcp_job_facts").select("status").eq("job_id", job.job_id).eq("module", "warranty").eq("key", wkey).maybeSingle();
        const st = (cur.data as { status?: string } | null)?.status;
        if (st !== "known" && st !== "na") {
          await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "warranty", _facts: { [wkey]: args.evidence.trim() }, _source: "member_answer" });
          filled = ` ${WARRANTY_SETUP_QUESTIONS.find((q) => q.key === wkey)?.label ?? wkey} recorded from the evidence.`;
        }
      }
      const t = itemType(it, await activeNa(sb, job.job_id));
      const msg = r.closed ? `${prefix(job)}Item closed: ${(it.action ?? "").replace(/^\S+ – /, "")} (${r.resolution === "member_statement" ? "member statement" : r.resolution}). Evidence and history kept.${filled}` : `${prefix(job)}Item updated: ${(it.action ?? "").replace(/^\S+ – /, "")} (last reported by ${statedBy}). Still open.`;
      return { ...text(msg), structuredContent: { item_id: itemId, item_ref: ref, item_type: t, closed: r.closed } };
    }),
});

// ---------- contract_terms (read-only) ----------
const CONTRACT_KEYS = ["pay_terms", "notice_timing", "tia_timing", "change_process", "claim_process", "retainage", "retainage_reduction", "beneficial_use_clause", "liquidated_damages", "savings_split", "closeout", "warranty_clauses"] as const;
const CONTRACT_FLAGS = ["has_retainage", "has_lds", "beneficial_use", "notice_requirements"] as const;

export const contractTerms = defineTool({
  name: "contract_terms",
  title: "Read contract terms",
  description:
    "Read back a job's contract terms exactly as saved: each clause with its value and source (manual = typed by the member, document = read from the contract), unknown clauses, and the applicability flags (ON / OFF / UNKNOWN). Use this, not the setup report, when the member asks what terms are on file or to confirm terms they just entered. Read-only.",
  inputSchema: { job_number: jobNumber, company_id: companyId },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("contract_terms", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (job.scope === "super") throw new ToolError(READ_ONLY_MESSAGE);
      const [fR, flR] = await Promise.all([
        sb.from("mcp_job_facts").select("key, value, status, source").eq("job_id", job.job_id).eq("module", "contract"),
        sb.from("mcp_job_flags").select("flag_key, value, source").eq("job_id", job.job_id).in("flag_key", [...CONTRACT_FLAGS]),
      ]);
      if (fR.error) throw new Error(fR.error.message);
      if (flR.error) throw new Error(flR.error.message);
      await audit(sb, job, "contract_terms", "view_contract_terms", null);
      const by = new Map((fR.data ?? []).map((f) => [f.key, f]));
      const src = (s: string) => (s === "member_answer" ? "manual" : s.replace(/_/g, " "));
      const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
      const clauses = CONTRACT_KEYS.map((k) => {
        const f = by.get(k);
        const known = f && f.status === "known" && f.value !== null;
        return { key: k, value: known ? show(f!.value) : null, source: f ? src(f.source) : null, status: known ? "known" : "unknown" };
      });
      const flags = CONTRACT_FLAGS.map((k) => {
        const f = (flR.data ?? []).find((x) => x.flag_key === k);
        return { flag: k, value: flagWord(effectiveFlag(f?.value ?? "unknown", by.get(FLAG_CLAUSE[k]))), source: f ? src(f.source) : null };
      });
      const cl = await loadClauses(sb, job.job_id);
      const lines = [
        `${prefix(job)}CONTRACT CLAUSES (exact contract text)`,
        ...(cl.length ? cl.map((c) => `- ${clauseLine(c)}`) : ["- None recorded. Record them with intake section clauses, copied exactly from the contract."]),
        ...missingNotices(cl).map((m) => `- Missing: ${m.label} (${missingNoticeNote(cl.length > 0)})`),
        "",
        `CONTRACT TERMS (as saved${cl.length ? "; summary fields, the clauses above govern" : ""})`,
        ...clauses.map((c) => `- ${c.key.replace(/_/g, " ")}: ${c.value ?? "UNKNOWN"}${c.value ? ` (${c.source === "document" ? LEGACY_SUMMARY_TAG : c.source})` : ""}`),
        "",
        "Applicability:",
        ...flags.map((f) => `- ${f.flag.replace(/_/g, " ")}: ${f.value}${f.source ? ` (${f.source})` : ""}`),
      ];
      return { ...text(lines.join("\n")), structuredContent: { clauses, flags, contract_clauses: cl.map((c) => ({ section: c.section, heading: c.heading, category: c.category, source: c.source, n_days: c.n_days, day_type: c.day_type, trigger: c.trigger_desc })) } };
    }),
});

// ---------- SOV (lean v1) ----------
const sovFooterMissing = (c: { license_number?: string | null; contact_name?: string | null; contact_phone?: string | null; website?: string | null }) =>
  [["license number", c.license_number], ["contact name", c.contact_name], ["phone", c.contact_phone], ["website", c.website]].filter(([, v]) => !v).map(([k]) => k as string);

async function sovResult(sb: Sb, job: Job, audience: "internal" | "client") {
  // Dollars: full job access only (internal or for the owner, per Marshall 2026-10-19). Never the Super view or contract-only roles.
  // This is the only client-facing output that carries dollars; the client setup report keeps its no-dollars rule.
  if (job.scope === "super") throw new ToolError(READ_ONLY_MESSAGE);
  if (job.scope !== "full") throw new ToolError(FULL_ACCESS_MESSAGE);
  const [co, jr, facts] = await Promise.all([
    sb.from("mcp_companies").select("name, logo_url, license_number, contact_name, contact_phone, website").eq("id", job.company_id).maybeSingle(),
    sb.from("mcp_jobs").select("sov_fee_pct, sov_basis").eq("id", job.job_id).maybeSingle(),
    sb.from("mcp_job_facts").select("module, key, value, status").eq("job_id", job.job_id).in("module", ["sov", "contract"]),
  ]);
  for (const r of [co, jr, facts]) if (r.error) throw new Error(r.error.message);
  const rows = (facts.data ?? []) as { module: string; key: string; value: unknown; status: string }[];
  const lines = rows.filter((f) => f.module === "sov").map((f) => {
    const v = (f.value ?? {}) as { description?: string | null; billable_value?: number | null };
    return { item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null };
  });
  const ret = retainagePct(rows.find((f) => f.module === "contract" && f.key === "retainage" && f.status === "known")?.value);
  const fee = jr.data?.sov_fee_pct == null ? null : Number(jr.data.sov_fee_pct);
  let sov;
  try {
    sov = buildSov(lines, fee, ret);
  } catch (e) {
    if (e instanceof SovMismatch) {
      await audit(sb, job, "report", "sov_refused", null);
      throw new ToolError(`${prefix(job)}The SOV can't be built yet. Nothing was produced.\n${e.message}`);
    }
    throw e;
  }
  const c = co.data!;
  const brand: SovBrand = { company_name: c.name, logo_url: c.logo_url ?? null, license_number: c.license_number ?? null, contact_name: c.contact_name ?? null, contact_phone: c.contact_phone ?? null, website: c.website ?? null };
  await audit(sb, job, "report", "view_sov", null);
  const today = new Date().toISOString().slice(0, 10);
  return guide(
    {
      ...text(sovSummaryText(prefix(job), sov, brand, jr.data?.sov_basis ?? null, sovFooterMissing(c), audience)),
      structuredContent: {
        sov: {
          audience,
          header: { project: `${job.job_number} – ${job.name}`, prepared: today, contractor: c.name, basis: jr.data?.sov_basis ?? null, contract_sum: sov.summary.contract_total },
          ...sov,
          footer: sovLayout(brand).footer,
          layout: sovLayout(brand),
        },
      },
    },
    "To produce the SOV file, use structuredContent.sov exactly: numbers, column set and layout recipe come from the server. Do not recompute or reorder.",
  );
}
