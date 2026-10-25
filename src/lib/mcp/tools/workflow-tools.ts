import { companyProjectSoftware, companyScopeDefaults, scopeAlias, SECTOR_ALIASES, PRICING_ALIASES, POSITION_ALIASES } from "../scope-defaults";
import { SovMismatch, SOV_SPECS_MISSING_NOTE, SOV_TABLE_STYLE, SOV_TOTAL_REFUSAL, buildSov, sovSpecsMissing, sovTotalChangeRefusal, retainagePct, sovLayout, sovLineRows, sovNotes, sovSummaryText, money, type SovBrand, type SovView } from "../sov";
import { draftSovText, nextDraftFacts } from "../sov-draft";
import { storedModule } from "../record-copy";
import type { SovLineIn } from "../sov";
import { ATHENA_VERSION } from "../server-info-branding";
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { ITEM_COLS, READ_ONLY_MESSAGE, FULL_ACCESS_MESSAGE, WhichCompanyAsk, activeNa, audit, companyForCreate, currentCompany, flagWord, itemLine, itemType, jobTimeZone, memberCompanies, named, prefix, rememberCompany, renderSetupReport, resolveCompany, resolveJob, type Job } from "../jobs";
import { computeDue, todayIn, type DayType } from "../deadlines";
import { INPUT_KEYS, INPUT_LABELS, currentCheck, loadAnswers, loadChecks, loadLookahead, renderReport, type InputKey } from "../workflow";
import { WARRANTY_CHECK_PREFIX, WARRANTY_SETUP_QUESTIONS, mapTrigger, nextWarrantyQuestion, CONTRACT_WARRANTY_KEY, alignCloseoutSource, renderWarrantyRegister, warrantyAnswerFacts, warrantyHow, warrantyOpenItems, type WarrantyKey } from "../warranty";
import { EVIDENCE_ASK, evidenceProblem } from "../evidence";
import { itemClosureKey, itemClosurePreview, itemClosureOutcome } from "../item-closure";
import { displayRef, isUuid, itemRef, lookaheadRef, matchRef, parseLookaheadRef, parseQuestionRef, questionRef, shortRef } from "../refs";
import { findDelayTerms, termDue, type DeadlineRow } from "../delays";
import { draftGuidance, draftIdentityText, type PmIdentity } from "../drafts";
import { guide, EMAIL_TO_LABEL_REQUIRED, SHARE_OPTIONS_REQUIRED, REPORT_SHARE_ASK, REPORT_SHARE_STRUCTURED, CHART_PALETTE, JOB_SETUP_SOFTWARE_BLOCK, SOV_CHART_RULE, SOV_PRESENTATION_LEAD, sovChart, sovRequiredTop, sovDeliveryAsk, sovDeliveryBlock, sovDeliveryStructured, JOB_SOFTWARE_ASK, PROJECT_SOFTWARE_KEY, PROJECT_SOFTWARE_POSITION } from "../visible";
import { withoutClaims } from "../internal-claims";
import { LOOKAHEAD_EMAIL_LINE } from "../email-safety";
import { activityIdName, dataDateRule, pickLatestLookahead, type LaRow, emptyCard, lookaheadView, lookaheadModel, entryLine, lookaheadWindow, pageLine, windowActivities, type LaItem, type LaModel, type SAct } from "../styled-views";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { applyCardClosing } from "../cards/silence";
import { cardWidgetMeta } from "../cards/widget";
import { savedLookaheadItems, savedItemsSection, savedLookaheadCard } from "../lookahead-card";
import type { CardSection } from "../cards/model";
import { contractTermsCard, sovCard } from "../cards/structured";
import { signedJobPages } from "../board-url";
import { whichJobAsk } from "../which-job";
import { dueOf, isDueIn7, isOverdue, itemName, openItemFeed, openItemRecordUrl, openItemsCard, openItemsHeader } from "../open-feed";
import { completionDate, contractValueLine, iorContractValue, pickContractValue, setupContractValue, sovContractValue } from "../contract-value";
import { formatBillingText } from "../../report-format";
import { EMAIL_VIEW_SPEC, LOOKAHEAD_VIEW_SPEC, REMINDERS_VIEW_SPEC, highlightLine, lookaheadHighlight } from "../views";
import { EMAIL_CONTACT_RULE, contactForRole, dedupeNotices, emailContact, fillNotice, jobContacts } from "../contacts";
import { noticeRequirements } from "../notice-plain";
import { classifyClause, clauseLine, missingNotices, normSection, parseClause, NOTICE_CHECKLIST, type ClauseRow, LEGACY_SUMMARY_TAG, missingNoticeNote, SUMMARY_OFFER, SUMMARY_HEADING } from "../contract-clauses";
import { FLAGS_ASKED_LATER, noGuidance, noGuidanceText, reconcileRecommendation } from "../guidance";
import { isNoneAnswer, mergeScopeFacts, visibleLookaheads } from "../lookahead-items";
import { addRevision, currentRev, loadRevisions, lookaheadSourceFor, revisionLines, stampItemRev } from "../lookahead-revisions";
import { LOOKAHEAD_BUILD_QUESTIONS, LOOKAHEAD_EXISTS_ASK, LOOKAHEAD_PUSHBACK, LOOKAHEAD_SETUP_KEY, PUSHBACK_GUIDANCE, buildQuestionsGuidance, buildQuestionsText, pushbackText } from "../lookahead-help";

const uuid = z.string().uuid();
const laArg = z.string().trim().min(1).max(64);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const short = (_note?: string) => z.string().max(2000).optional();
const tri = z.enum(["yes", "no", "na", "unknown"]);
const doc = (_note?: string) => z.string().max(20_000).optional();
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
/** Create-job reply. A PM sent on create is named; otherwise the reply says the PM is not set. */
export function jobCreatedText(input: {
  jobNumber: string;
  companyName: string;
  jobName: string;
  restrictTo?: string[] | null;
  pm?: string | null;
}): string {
  const pm = input.pm?.trim() || null;
  const restricted = input.restrictTo?.length ? ` Restricted to: ${input.restrictTo.join(", ")}.` : "";
  const pmLine = pm
    ? `PM: ${pm}. Open items default to this PM.`
    : `PM: not set yet. Ask who the PM is and record it with intake section "job_settings" (pm); open items default to the job's PM.`;
  return `${input.jobNumber} – Job created in ${input.companyName}: ${input.jobName}.${restricted}\n${pmLine}\nNext: intake section "scope" (step 0). Ask the member for job type, owner/client type, sector and pricing model; never assume them.`;
}

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
  description: "Reads or saves the company profile and its members.",
  inputSchema: {
    action: z.enum(["read", "save_company", "add_member", "save_brand"]),
    company_id: companyId,
    name: z.string().trim().max(200).optional(),
    your_name: z.string().trim().max(120).optional(),
    agent_name: z.string().trim().max(60).optional(),
    time_zone: z.string().trim().max(80).optional(),
    company_role: short("Company role, e.g. mechanical prime / specialty sub."),
    work_types: z.array(z.enum(["commercial", "public", "residential"])).max(3).optional(),
    trades: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    tool_stack: z.record(z.string().max(60), z.string().max(200)).optional(),
    decision_rights: z
      .object({ buyout: rightsList.optional(), change_orders: rightsList.optional(), claims: rightsList.optional(), write_offs: rightsList.optional(), waive_items: rightsList.optional() })
      .optional()
      ,
    default_flags: z.record(z.string().regex(/^[a-z_]{1,40}$/), tri).optional(),
    member_email: z.string().email().optional(),
    member_name: z.string().trim().max(120).optional(),
    member_role: z.enum(["owner", "pm", "all_access"]).optional(),
    logo_url: z.string().trim().url().max(2000).optional(),
    license_number: short("save_brand: license designation and number as it should print on the SOV footer."),
    contact_name: short("save_brand: named contact on the SOV footer."),
    contact_phone: z.string().trim().max(40).optional(),
    website: z.string().trim().max(200).optional(),
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
            work_types: args.work_types, trades: args.trades, tool_stack: args.tool_stack, decision_rights: args.decision_rights, default_flags: args.default_flags, time_zone: args.time_zone,
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
        sb.from("mcp_companies").select("name, agent_name, company_role, work_types, trades, tool_stack, decision_rights, default_flags, logo_url, license_number, contact_name, contact_phone, website, time_zone").eq("id", cid!).maybeSingle(),
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
            `Company time zone: ${c.time_zone || "not set; saved member zone is the fallback"}`,
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
const SOV_COPY_NOTE = "budget: which SOV copy sov_lines go to. \"official\" (default) is the contract SOV; once saved, its dollars change only by approved change order. \"draft\" saves a separate copy in Athena labeled \"Draft, not official\" for what-ifs, rebalances, expected change orders and a monthly forecast, and never touches the official SOV, contract value or pay apps. Whenever the member asks for a draft, what-if or proposed SOV, call intake with sov_copy \"draft\". Never build a draft yourself, and never say a draft was saved unless this tool returned \"Saved in Athena\".";
const sovLine = z.object({ line: z.string().trim().min(1).max(40), description: z.string().max(200).optional(), billable_value: z.number().optional(), cost_codes: z.array(z.string().max(40)).max(50).optional(), spec_section: z.string().trim().max(40).optional() });
const gap = z.object({ gap: z.string().trim().min(1).max(1000), owner: z.string().trim().min(1).max(120), needed_by: date.optional() });
import { CLAUSE_ABSENT, CLAUSE_UNKNOWN, FLAG_CLAUSE, clauseFlag, effectiveFlag } from "../clauses";
export { CLAUSE_ABSENT, CLAUSE_UNKNOWN };
/** Field keys in words ("beneficial_use_clause" -> "beneficial use clause"). */
const humanKeys = (ks: string[]) => ks.map((k) => k.replace(/_/g, " ")).join(", ");
/** 0.8.4: step 0 scoping, asked as setup question 1 by next_question. */
const SCOPE_Q1_KEY = "job_scoping";
const SCOPE_Q1_ASK = "Tell me about this job: the job type, who the client is, the sector (public, private commercial or residential), whether you're the prime or a sub, and the pricing model (lump sum, unit price, cost plus or GMP). Or say \"use the defaults\" and I'll fill what I can from your company profile and move on.";
const SCOPE_Q1_GUIDANCE = "Record the answer with intake section \"scope\". If the member says \"use the defaults\" (or similar), call intake section \"scope\" with use_defaults true and nothing else, show which fields were filled and which stay unconfirmed in one line, then call next_question for question 2. Never skip this question and never guess the fields.";
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
async function saveWarranty(sb: Sb, job: Job, facts: Record<string, unknown>, o: { fillMissing: boolean; owner: string | null; neededBy: string | null; tool: string; source?: "document" | "member_answer" }) {
  if (o.fillMissing) {
    const { data: prior, error: priorErr } = await sb.from("mcp_job_facts").select("key").eq("job_id", job.job_id).eq("module", "warranty");
    if (priorErr) throw new Error(priorErr.message);
    const had = new Set((prior ?? []).map((p) => p.key));
    for (const q of WARRANTY_SETUP_QUESTIONS) if (!(q.key in facts) && !had.has(q.key)) facts[q.key] = null;
  }
  if (o.fillMissing) {
    // Questions not answered are recorded unknown as manual entries; only the values given carry the document source.
    const given = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== null));
    const blank = Object.fromEntries(Object.entries(facts).filter(([, v]) => v === null));
    if (Object.keys(given).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "warranty", _facts: given, _source: o.source ?? "member_answer" });
    if (Object.keys(blank).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "warranty", _facts: blank, _source: "member_answer" });
  } else if (Object.keys(facts).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "warranty", _facts: facts, _source: o.source ?? "member_answer" });
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
  description: "Records a job and its setup, including a draft or what-if SOV when sov_copy is \"draft\".",
  inputSchema: {
    section: z.enum(["create_job", "job_settings", "scope", "contract", "deadline", "handoff", "budget", "warranty", "open_item", "lookahead", "delay_event", "clauses"]),
    job_number: jobNumber,
    company_id: companyId,
    job_name: z.string().trim().max(200).optional(),
    restrict_to: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    // Job settings
    time_zone: z.string().trim().max(60).optional(),
    pm: z.string().trim().max(120).optional(),
    pm_email: z.string().trim().max(200).optional(),
    pm_title: z.string().trim().max(120).optional(),
    // Delay event
    delay_description: z.string().trim().max(500).optional(),
    delay_activity: z.string().trim().max(200).optional(),
    delay_start_date: date.optional(),
    delay_days: z.number().int().min(0).max(3650).optional(),
    delay_cause: z.string().trim().max(500).optional(),
    // Verbatim contract clauses
    clauses: z.array(z.object({
      section: z.string().trim().min(1).max(40),
      heading: z.string().trim().max(200).optional(),
      text: z.string().trim().min(1).max(10_000),
      category: z.enum(["delay_notice", "claim_notice", "nonpayment_notice", "cure_notice", "schedule_disagreement", "other"]).optional(),
    })).max(60).optional(),
    contract_text: z.string().max(400_000).optional(),
    // Deadline (contract time clause)
    clause_key: z.enum(["notice", "submittal_turnaround", "rfi_turnaround", "liquidated_damages", "completion", "other"]).optional(),
    label: short("deadline: what is due, e.g. 'Delay notice: utility shutdown denied'."),
    clause_ref: z.string().max(200).optional(),
    trigger_desc: short("deadline: the event that starts the clock."),
    trigger_date: date.optional(),
    trigger_alternatives: z.array(date).max(5).optional(),
    n_days: z.number().int().min(0).max(3650).optional(),
    day_type: z.enum(["calendar", "business", "working"]).optional(),
    holidays: z.array(date).max(60).optional(),
    weekend_roll: z.boolean().optional(),
    fixed_date: date.optional(),
    delivery_method: short("deadline / open_item: how it must be sent, per the contract."),
    recipient: short("deadline / open_item: who it must go to."),
    // Open item typing
    item_type: z.enum(["unknown", "no", "pending_document", "deadline"]).optional(),
    waiting_on_document: short("open_item pending_document: the named document."),
    waiting_on_who: short("open_item pending_document: who it is coming from."),
    waiting_since: date.optional(),
    clause_source: short("open_item deadline: clause or source of the due date."),
    recommendation: short("open_item no: recommendation."), why: short("open_item no: why it matters."),
    // Step 0
    job_type: short("scope: job type / trade."),
    scope_summary: short("scope: short scope summary."),
    size_band: z.enum(["<$250k", "$250k–$2M", "$2M–$10M", "$10M+"]).optional(),
    sector: z.preprocess(scopeAlias(SECTOR_ALIASES), z.enum(["public", "private_commercial", "residential"]).optional()),
    client_type: short("scope: client type."),
    pricing_model: z.preprocess(scopeAlias(PRICING_ALIASES), z.enum(["lump_sum", "unit_price", "cost_plus", "gmp"]).optional()),
    position: z.preprocess(scopeAlias(POSITION_ALIASES), z.enum(["prime", "sub", "sub_sub"]).optional()),
    use_defaults: z.boolean().optional(),
    work_packages: z.array(workPackage).max(50).optional(),
    major_equipment: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    key_clauses: z
      .object({ retainage: tri.optional(), beneficial_use: tri.optional(), liquidated_damages: tri.optional(), notice: tri.optional() })
      .optional()
      ,
    job_tool_stack: z.record(z.string().max(60), z.string().max(200)).optional(),
    // Contract (A)
    contract_document_provided: z.boolean().optional(),
    contract_document_name: z.string().max(300).optional(),
    pay_terms: short("contract"), notice_timing: short("contract: notice deadline and clause, as written"), tia_timing: short("contract"),
    change_process: short("contract"), claim_process: short("contract"), retainage: short("contract: % and clause"),
    retainage_reduction: short("contract"), beneficial_use_clause: short("contract"), liquidated_damages: short("contract"),
    savings_split: short("contract"), closeout: short("contract"), warranty_clauses: short("contract"),
    // Warranty and closeout (job setup)
    workmanship_warranty: tri.optional(),
    workmanship_warranty_months: z.number().int().min(0).max(240).optional(),
    warranty_start_trigger: z.enum(["substantial_completion", "final_acceptance", "other"]).optional(),
    warranty_start_trigger_text: short("warranty: the member's own words for what starts the warranty (e.g. \"owner acceptance\"). Mapped for you and wins over warranty_start_trigger."),
    warranty_start_trigger_other: short("warranty: describe the trigger when warranty_start_trigger is other"),
    warranty_trigger_date: date.optional(),
    warranty_start_basis: short("warranty: what sets the warranty start date (clause or document)"),
    closeout_documents: short("warranty: required closeout documents (O&Ms, as-builts, etc.); \"unknown\" if not known"),
    punch_final_acceptance: short("warranty: punch list and final acceptance requirements"),
    manufacturer_warranties: short("warranty: manufacturer warranties to collect, or none"),
    closeout_expectations: short("warranty: other closeout expectations (training, commissioning, final cleaning, lien waivers, warranty walk, turnover meeting), or none"),
    // Handoff (C)
    sold_scope: short("handoff"), carried_scope: short("handoff"), exclusions: short("handoff"), allowances: short("handoff"), addenda: short("handoff"),
    concessions: short("handoff"), quantities: short("handoff"), production_rates: short("handoff"), crew_assumptions: short("handoff"), sub_qualifications: short("handoff"),
    gaps: z.array(gap).max(50).optional(),
    // Budget (F)
    budget_lines: z.array(budgetLine).max(300).optional(),
    sov_lines: z.array(sovLine).max(300).optional(),
    fee_pct: z.number().optional(),
    sov_basis: z.string().trim().max(200).optional(),
    sov_copy: z.enum(["official", "draft"]).optional().describe(SOV_COPY_NOTE),
    // Open item
    action: short("open_item: what has to happen"), kind: z.enum(["general", "commercial", "warranty"]).optional(),
    commercial_type: z.enum(["co", "rea", "claim", "retainage"]).optional(), owner: short("open_item: accountable named person"), needed_by: date.optional(),
    cost_effect: short("open_item"), time_effect: short("open_item"), cash_effect: short("open_item"), effect_is_estimate: z.boolean().optional(),
    next_action: short("open_item"), next_action_approved_by: short("open_item"), internal_only: z.boolean().optional(),
    // Lookahead
    lookahead_exists: z.enum(["yes", "no", "build"]).optional(),
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
        const companies = await memberCompanies(sb);
        const activeId = await currentCompany(sb);
        let namedId: string | null = null;
        if (args.company_id?.trim()) {
          const want = args.company_id.trim().toLowerCase();
          const byId = companies.find((c) => c.id === want);
          const byName = companies.filter((c) => c.name.trim().toLowerCase() === want);
          namedId = byId?.id ?? (byName.length === 1 ? byName[0].id : null);
          if (!namedId) throw new ToolError(companies.length > 1 ? `You aren't a member of a company called "${args.company_id.trim()}". Your companies: ${companies.map((c) => c.name).join("; ")}.` : "You aren't a member of that company.");
        }
        const choice = companyForCreate({ companies, activeId, namedId });
        if ("ask" in choice) {
          throw new WhichCompanyAsk(args.job_number, choice.ask.map((c) => ({ company_id: c.id, company_name: c.name, job_name: args.job_name! })), true);
        }
        await rememberCompany(sb, choice.companyId);
        const companyName = companies.find((c) => c.id === choice.companyId)?.name ?? "your company";
        const r = await rpc<{ duplicate: boolean; suggestion?: string; job_id?: string }>(sb, "mcp_job_create", {
          _company: choice.companyId, _job_number: args.job_number, _name: args.job_name, _restrict_to: args.restrict_to ?? null,
        });
        if (r.duplicate) throw new ToolError(`Job ${args.job_number} already exists in this company. Use a different number, e.g. ${r.suggestion}. Nothing was created.`);
        let pmName = args.pm?.trim() || null;
        if (r.job_id && (pmName || args.pm_email || args.pm_title || args.time_zone)) {
          const saved = await rpc<{ pm?: string | null }>(sb, "mcp_job_settings", {
            _job: r.job_id,
            _time_zone: args.time_zone ?? null,
            _pm_name: pmName,
            _pm_email: args.pm_email ?? null,
            _pm_title: args.pm_title ?? null,
          });
          if (saved?.pm) pmName = saved.pm;
        }
        return {
          ...text(jobCreatedText({ jobNumber: args.job_number, companyName, jobName: args.job_name, restrictTo: args.restrict_to, pm: pmName })),
          structuredContent: { job_id: r.job_id!, job_number: args.job_number, company_id: choice.companyId, company_name: companyName, pm: pmName },
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
        // 0.8.5: the notice email goes to the contract's recipient (the saved job contact), never "Dear Project Manager".
        const ecDelay = emailContact(contactForRole((await noticeContext(sb, job)).contacts, "Project Manager"));
        const id: PmIdentity = { name: pmName, email: j.pm_email ?? null, title: j.pm_title ?? null, isMember: !!j.pm_user_id };
        return guide({
          // 0.8.8: email-card results lead with the To line.
          ...text([
            ecDelay.structured.to_line,
            `${P}Delay recorded: ${args.delay_description}${args.delay_activity ? ` (activity: ${args.delay_activity})` : ""}.`,
            `Start date: ${start ?? "unknown — confirm it; the notice clock runs from when the delay began, not when it was found"} | Impact: ${args.delay_days != null ? `${args.delay_days} days` : "unknown"} | Cause: ${args.delay_cause ?? "unknown"}`,
            termLine("Delay notice", notice, nd), `Notice item:${itemNote(r.notice_item)}`,
            termLine("Claim notice", claim, cd), `Claim item:${itemNote(r.claim_item)}`,
            "", draftIdentityText(id, { name: co.data?.name ?? null }),
            ecDelay.text,
            ...EMAIL_VIEW_SPEC,
          ].join("\n")),
          structuredContent: { email_contact: ecDelay.structured, delay_event_id: r.delay_event_id, start_known: r.start_known, notice_due: start ? nd.due : null, claim_due: start ? cd.due : null,
            items: [r.notice_item, r.notice_item?.delivery_item, r.claim_item, r.claim_item?.delivery_item].filter((x): x is ItemResult => !!x).map((x) => itemOut(x)!) },
        }, ...draftGuidance(id, { name: co.data?.name ?? null }), EMAIL_CONTACT_RULE);
      }

      if (args.section === "clauses") {
        if (!args.clauses?.length) throw new ToolError("clauses needs at least one clause: section, heading and the text copied exactly from the contract.");
        const rows = args.clauses.map((c) => {
          const p = parseClause(c.text);
          return { section: normSection(c.section), heading: c.heading?.trim() || null, text: c.text, category: c.category ?? classifyClause(c.heading, c.text), ...p };
        });
        const before = await loadClauses(sb, job.job_id);
        const r = await rpc<{ clauses: { section: string; source: "document" | "unverified" }[]; has_document: boolean }>(sb, "mcp_clauses_save", {
          _job: job.job_id, _doc: args.contract_text?.trim() ? { name: args.contract_document_name ?? "contract", body: args.contract_text } : null, _clauses: rows,
        });
        const srcOf = new Map(r.clauses.map((c) => [c.section, c.source]));
        // Verified contract text is never overwritten by wording that isn't in the contract: put the verified text back and flag the new wording.
        const reworded = rows.filter((x) => srcOf.get(x.section) !== "document" && before.some((b) => b.section === x.section && b.source === "document" && b.verbatim_text.trim() !== x.text.trim()));
        const flagged: ItemResult[] = [];
        if (reworded.length) {
          const keep = before.filter((b) => reworded.some((x) => x.section === b.section));
          await rpc(sb, "mcp_clauses_save", { _job: job.job_id, _doc: null, _clauses: keep.map((b) => ({ section: b.section, heading: b.heading, text: b.verbatim_text, category: b.category, n_days: b.n_days, day_type: b.day_type, trigger_desc: b.trigger_desc })) });
          for (const x of reworded)
            flagged.push(await rpc<ItemResult>(sb, "mcp_add_item", { _job: job.job_id, _f: { check_key: `clause_reworded:${x.section}`, action: `Check new §${x.section} wording: it isn't in the contract, so the verified contract text was kept`, item_type: "unknown", kind: "confirm_unknown", section: "contract_time", category: "Contract clause", why: `Proposed wording (not saved): ‹${x.text.trim().slice(0, 1500)}›. Verified contract text is never replaced by wording the contract doesn't contain.`, source: "member_answer", tool: "intake", internal_only: true } }));
        }
        const saved = await loadClauses(sb, job.job_id);
        const made = [...(await syncClauseItems(sb, job, saved)), ...flagged.filter((m) => !m.existing)];
        const isReworded = (sec: string) => reworded.some((x) => x.section === sec);
        const unverified = rows.filter((x) => srcOf.get(x.section) !== "document" && !isReworded(x.section));
        const lines = [
          `${P}Contract clauses saved as written (${rows.length - reworded.length}).${r.has_document ? "" : " No contract text on file, so none could be verified: every clause is marked UNVERIFIED until the contract text is provided."}`,
          ...saved.filter((c) => rows.some((x) => x.section === c.section) && !isReworded(c.section)).map((c) => `- ${clauseLine(c)}`),
          ...reworded.map((x) => `Kept the verified contract text for §${x.section}: the new wording isn't in the contract, so it wasn't saved. An open item was opened to check it.`),
          ...(unverified.length && r.has_document ? [`Not found exactly in the contract text: ${unverified.map((x) => `§${x.section}`).join(", ")}. Check the wording; an open item was opened for each.`] : []),
          ...missingNotices(saved).map((m) => `Missing from the contract clauses: ${m.label}. An open item asks you to confirm it; nothing was filled in.`),
          "",
          ...noticeRequirements(saved).lines,
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
        let defaultsNote = "";
        if (args.use_defaults) {
          const { data: co } = await sb.from("mcp_companies").select("company_role, work_types, trades").eq("id", job.company_id).maybeSingle();
          const d = companyScopeDefaults(co ?? null);
          args = { ...d, ...Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) } as typeof args;
          const used = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined);
          // 0.8.4: every step 0 field is either filled from the profile or named as unconfirmed, then setup moves on to question 2.
          const SCOPE_Q1_FIELDS: [string, string][] = [["job_type", "job type"], ["sector", "sector"], ["position", "prime or sub"], ["pricing_model", "pricing model"], ["client_type", "client type"]];
          const unconfirmed = SCOPE_Q1_FIELDS.filter(([k]) => (args as Record<string, unknown>)[k] === undefined).map(([, l]) => l);
          defaultsNote = `\nCompany defaults used: ${used.length ? humanKeys(used) : "none on file"}. Unconfirmed (saved as unknown, not asked again now): ${unconfirmed.join(", ") || "none"}.`;
        }
        const given = {
          job_type: args.job_type, scope_summary: args.scope_summary, size_band: args.size_band, sector: args.sector,
          client_type: args.client_type, pricing_model: args.pricing_model, position: args.position,
          work_packages: args.work_packages, major_equipment: args.major_equipment, key_clauses: args.key_clauses, tool_stack: args.job_tool_stack,
        };
        const [{ data: priorScope, error: psErr }, { data: priorFlags, error: pfErr }] = await Promise.all([
          sb.from("mcp_job_facts").select("key, value, status").eq("job_id", job.job_id).eq("module", "scope"),
          sb.from("mcp_job_flags").select("flag_key, value").eq("job_id", job.job_id),
        ]);
        if (psErr) throw new Error(psErr.message);
        if (pfErr) throw new Error(pfErr.message);
        // A partial update merges: fields not sent keep their saved value (unknown only the first time).
        const facts = mergeScopeFacts(given, (priorScope ?? []) as { key: string; value: unknown; status: string }[]);
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
        // Fields not sent never reset a flag that is already recorded.
        const hadFlag = new Set(((priorFlags ?? []) as { flag_key: string }[]).map((f) => f.flag_key));
        for (const k of Object.keys(flags)) if (flags[k] === "unknown" && hadFlag.has(k)) delete flags[k];
        const r = await rpc<FlagResult>(sb, "mcp_set_flags", { _job: job.job_id, _flags: flags, _source: "member_answer" });
        await settleFlagConfirms(sb, job);
        const { data: all } = await sb.from("mcp_job_flags").select("flag_key, value, source").eq("job_id", job.job_id).order("flag_key");
        return text(
          `${P}Step 0 scoping saved.${defaultsNote}\nRecorded: ${humanKeys(fr.known) || "none"}\nUnknown: ${humanKeys(fr.unknown) || "none"}\n\nApplicability flags:\n${(all ?? []).map((f) => `- ${f.flag_key.replace(/_/g, " ")}: ${f.value} (${f.source.replace(/_/g, " ")})`).join("\n")}\n${flagNote(r)}\n\n${args.use_defaults ? "Next: next_question (setup question 2, project software). Don't ask the unconfirmed scoping fields again now." : 'Next: intake section "contract", or next_question.'}`,
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
        // Read from the contract (document named, nothing says typed): saved as document, shown as a contract summary, not "manual".
        const wSource = readFromDocument(args, keysText(args)) ? "document" : "member_answer";
        const { all, made } = await saveWarranty(sb, job, facts, { fillMissing: true, owner: args.owner ?? null, neededBy: args.needed_by ?? null, tool: "intake", source: wSource });
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
        const savedOfficial = await sb.from("mcp_job_facts").select("key, value").eq("job_id", job.job_id).eq("module", "sov");
        if (savedOfficial.error) dbError(savedOfficial.error);
        const officialRows = (savedOfficial.data ?? []) as { key: string; value: Record<string, unknown> | null }[];
        const officialByKey = new Map(officialRows.map((row) => [row.key, row.value ?? {}]));
        if (args.sov_copy === "draft") {
          const savedDraft = await sb.from("mcp_job_facts").select("key, value").eq("job_id", job.job_id).eq("module", storedModule("sov", "draft"));
          if (savedDraft.error) dbError(savedDraft.error);
          const draftRows = (savedDraft.data ?? []) as { key: string; value: Record<string, unknown> | null }[];
          const incoming: Record<string, unknown> = {};
          for (const s of args.sov_lines ?? []) incoming[s.line] = { description: s.description ?? null, billable_value: s.billable_value ?? null, cost_codes: s.cost_codes ?? [], ...(s.spec_section ? { spec_section: s.spec_section } : {}) };
          const step = nextDraftFacts(officialRows, draftRows, Object.keys(incoming).length ? incoming : null);
          if (step.copy) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: storedModule("sov", "draft"), _facts: step.copy, _source: "member_answer" });
          if (step.edits) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: storedModule("sov", "draft"), _facts: step.edits, _source: "member_answer" });
          const shown = await sb.from("mcp_job_facts").select("key, value").eq("job_id", job.job_id).eq("module", storedModule("sov", "draft"));
          if (shown.error) dbError(shown.error);
          const lines = ((shown.data ?? []) as { key: string; value: { description?: string | null; billable_value?: number | null; cost_codes?: string[] } }[]).map((row) => ({
            item_no: row.key,
            description: row.value?.description ?? null,
            scheduled_value: typeof row.value?.billable_value === "number" ? row.value.billable_value : null,
            cost_codes: row.value?.cost_codes,
          })) satisfies SovLineIn[];
          const { data: terms } = await sb.from("mcp_jobs").select("sov_fee_pct, sov_basis").eq("id", job.job_id).maybeSingle();
          const cpm = await sb.rpc("mcp_living_report_get", { _job: job.job_id, _type: "cpm", _version: null });
          const activities = ((cpm.data as { data?: { activities?: { start?: string | null; finish?: string | null }[] } } | null)?.data?.activities ?? []);
          const starts = activities.map((row) => row.start?.slice(0, 10)).filter((day): day is string => !!day).sort();
          const finishes = activities.map((row) => row.finish?.slice(0, 10)).filter((day): day is string => !!day).sort();
          const { data: company } = await sb.from("mcp_companies").select("name, logo_url, license_number, contact_name, contact_phone, website").eq("id", job.company_id).maybeSingle();
          const brand: SovBrand = {
            company_name: company?.name ?? "",
            logo_url: company?.logo_url ?? null,
            license_number: company?.license_number ?? null,
            contact_name: company?.contact_name ?? null,
            contact_phone: company?.contact_phone ?? null,
            website: company?.website ?? null,
          };
          const textBody = draftSovText(lines, terms?.sov_fee_pct == null ? null : Number(terms.sov_fee_pct), terms?.sov_basis ?? null, brand, { start: starts[0] ?? null, finish: finishes.at(-1) ?? null });
          return text(`${prefix(job)}Saved in Athena (draft copy only; the official SOV did not change).\n${textBody}`);
        }
        const sov: Record<string, unknown> = {};
        for (const s of args.sov_lines ?? []) {
          const old = officialByKey.get(s.line) ?? {};
          sov[s.line] = {
            ...old,
            description: s.description !== undefined ? s.description : old.description ?? null,
            cost_codes: s.cost_codes ?? (Array.isArray(old.cost_codes) ? old.cost_codes : []),
            ...(s.spec_section ? { spec_section: s.spec_section } : {}),
            ...(s.billable_value !== undefined ? { billable_value: s.billable_value } : {}),
          };
        }
        if (Object.keys(sov).length || args.fee_pct !== undefined) {
          const [savedSov, savedJob] = await Promise.all([
            sb.from("mcp_job_facts").select("key, value").eq("job_id", job.job_id).eq("module", "sov"),
            sb.from("mcp_jobs").select("sov_fee_pct").eq("id", job.job_id).maybeSingle(),
          ]);
          if (savedSov.error) dbError(savedSov.error);
          if (savedJob.error) dbError(savedJob.error);
          const refusal = sovTotalChangeRefusal(
            (savedSov.data ?? []) as { key: string; value: unknown }[],
            (savedJob.data as { sov_fee_pct?: number | null } | null)?.sov_fee_pct ?? null,
            Object.keys(sov).length ? sov : null,
            args.fee_pct,
          );
          if (refusal) throw new ToolError(SOV_TOTAL_REFUSAL);
        }
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
        } else {
          // Everything maps now: close the open "Map SOV lines to cost codes" item a previous save opened.
          const { data: open } = await sb.from("mcp_open_items").select("id").eq("job_id", job.job_id).eq("check_key", "budget:unmapped").eq("status", "open");
          for (const it of open ?? [])
            await rpc(sb, "mcp_resolve_item", { _item: it.id, _kind: "verified", _evidence: `Budget and SOV saved: every SOV line maps to a cost code, every cost code is on an SOV line, and every SOV code is in the budget.`, _stated_by: null, _stated_on: null, _reason: null, _approval: null, _billing: null, _collection: null });
          if (open?.length) note = "\nClosed the open item to map SOV lines to cost codes: everything maps now.";
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
      const src = await lookaheadSourceFor(sb, job.job_id);
      // Same job and same window as a lookahead already on file: a new REVISION of that lookahead (same ref, history kept), never a duplicate.
      if (args.start_date && args.end_date) {
        const { data: same, error: se } = await sb.from("mcp_lookaheads").select("id, inputs, provided_inputs").eq("job_id", job.job_id).eq("start_date", args.start_date).eq("end_date", args.end_date).order("created_at", { ascending: true });
        if (se) throw new Error(se.message);
        const hit = visibleLookaheads((same ?? []) as { id: string; inputs?: unknown; provided_inputs?: string[] | null }[])[0];
        if (hit) {
          // Inputs sent in this revision replace that input; inputs not sent carry over. Earlier text stays in the prior revision.
          const effective: Record<string, unknown> = { ...((hit.inputs as Record<string, unknown> | null) ?? {}), ...docs };
          const effProvided = [...new Set([...(hit.provided_inputs ?? []), ...provided])];
          const effMissing = INPUT_KEYS.filter((k) => !effProvided.includes(k));
          const rev = await addRevision(sb, hit.id, { ...src, start_date: args.start_date, end_date: args.end_date, inputs: docs, effective_inputs: effective, provided_inputs: effProvided, missing_inputs: effMissing });
          if (rev === null) throw new ToolError(`A look-ahead for ${args.start_date} to ${args.end_date} already exists (${lookaheadRef(hit.id)}). Use that ref; revisions aren't available yet, so nothing new was created.`);
          const up = await sb.from("mcp_lookaheads").update({ inputs: effective, provided_inputs: effProvided, missing_inputs: effMissing }).eq("id", hit.id);
          if (up.error) throw new Error(up.error.message);
          await audit(sb, job, "intake", "lookahead_revise", hit.id);
          const ref = lookaheadRef(hit.id);
          return {
            ...text(`${P}Look-ahead ${ref} revised: now Rev ${rev} (source: ${src.source === "schedule" ? `schedule, ${src.schedule_tool}` : "PM"}) for ${args.start_date} to ${args.end_date}. Same ref; earlier revisions are kept and shown in the report.\n\nSent in Rev ${rev}:\n${Object.keys(docs).map((k) => `- ${INPUT_LABELS[k as InputKey]}`).join("\n") || "- none"}\n\nMissing (recorded as unknown):\n${effMissing.map((k) => `- ${INPUT_LABELS[k]}`).join("\n") || "- none"}\n\nLookahead ref: ${ref}\nTo add items to a question already answered, call answer with this lookahead ref and that question ref again. Next: next_question with lookahead ref ${ref}.`),
            structuredContent: { lookahead_id: hit.id, lookahead_ref: ref, rev, source: src.source, provided: effProvided, missing: effMissing, revised: true },
          };
        }
      }
      const missing = INPUT_KEYS.filter((k) => !provided.includes(k));
      const { data: la, error } = await sb
        .from("mcp_lookaheads")
        .insert({ job_id: job.job_id, start_date: args.start_date ?? null, end_date: args.end_date ?? null, inputs: docs, provided_inputs: provided, missing_inputs: missing })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await audit(sb, job, "intake", "lookahead_create", la.id);
      await addRevision(sb, la.id, { ...src, start_date: args.start_date ?? null, end_date: args.end_date ?? null, inputs: docs, effective_inputs: docs, provided_inputs: provided, missing_inputs: missing });
      if (hasAnswer !== "yes") {
        // They have one (or are building it now): record the setup check as yes. Ignored where the check isn't installed.
        await sb.rpc("mcp_answer", { _job: job.job_id, _key: LOOKAHEAD_SETUP_KEY, _answer: "yes", _detail: args.lookahead_exists === "build" ? "Built with Athena from the schedule." : "Look-ahead in place.", _owner: null, _needed_by: null });
      }
      return {
        ...text(
          `${P}Look-ahead created (${lookaheadRef(la.id)}) for ${args.start_date ?? "the next two weeks"}${args.end_date ? ` to ${args.end_date}` : ""}.\n\nProvided:\n${provided.map((k) => `- ${INPUT_LABELS[k as InputKey]}`).join("\n") || "- none"}\n\nMissing (recorded as unknown):\n${missing.map((k) => `- ${INPUT_LABELS[k]}`).join("\n") || "- none"}\n\nLookahead ref: ${lookaheadRef(la.id)}\nNext: next_question with this job_number and lookahead ref ${lookaheadRef(la.id)}.`,
        ),
        structuredContent: { lookahead_id: la.id, lookahead_ref: lookaheadRef(la.id), provided, missing },
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

/** Move a just-opened item onto the lookahead whose question opened it. mcp_item_events is append-only, so the
 * "opened" event is left as written; the item row carries the lookahead. */
async function attachToLookahead(sb: Sb, itemId: string, lookaheadId: string) {
  const up = await sb.from("mcp_open_items").update({ lookahead_id: lookaheadId, origin_lookahead_id: lookaheadId, updated_at: new Date().toISOString() }).eq("id", itemId);
  if (up.error) throw new Error(up.error.message);
  await stampItemRev(sb, itemId, lookaheadId);
}

async function lookaheadForJob(sb: Sb, job: Job, input: string) {
  let id = input.trim();
  if (/^latest$/i.test(id)) {
    const pick = pickLatestLookahead(await lookaheadRows(sb, job));
    if (!pick) throw new ToolError(`Job ${job.job_number} has no lookahead yet. Build one with intake section "lookahead".`);
    id = pick.id;
  } else if (!isUuid(id)) {
    const pre = parseLookaheadRef(id);
    if (!pre) throw new ToolError("Lookahead not found. Use the lookahead ref (LA-…) printed when it was created, or list the job's open items to see each ref.");
    const { data, error } = await sb.from("mcp_lookaheads").select("id, inputs").eq("job_id", job.job_id);
    if (error) throw new Error(error.message);
    const hits = visibleLookaheads((data ?? []) as { id: string; inputs?: unknown }[]).filter((r) => r.id.replace(/-/g, "").startsWith(pre));
    if (hits.length > 1) throw new ToolError(`More than one lookahead on job ${job.job_number} matches ${input.trim()}. Use the ref exactly as printed.`);
    if (!hits.length) throw new ToolError(`Lookahead not found on job ${job.job_number}. List the open items for the job to see each lookahead ref.`);
    id = hits[0].id;
  } else id = id.toLowerCase();
  const la = await loadLookahead(sb, id);
  if (la.job_id !== job.job_id) throw new ToolError(`That lookahead doesn't belong to job ${job.job_number}.`);
  return la;
}

// ---------- next_question ----------
type NextCheck = { key: string; label: string | null; section: string | null; category: string; prompt: string; record_value: unknown; index: number; total: number } | null;
export const nextQuestion = defineTool({
  name: "next_question",
  title: "Next question",
  description: "Returns the next setup question for a job.",
  inputSchema: { job_number: jobNumber, company_id: companyId, lookahead_id: laArg.optional() },
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
      let jobNumberAuto = false;
      if (q?.key === "job_number_assigned") {
        jobNumberAuto = true;
        await rpc(sb, "mcp_answer", { _job: job.job_id, _key: q.key, _answer: "yes", _detail: `Job number ${job.job_number} is on record.`, _owner: null, _needed_by: null });
        auto = `Answered for you: ${q.label ? `${q.label} ` : ""}"${q.prompt}" — yes (job number ${job.job_number} is on record). Say so if that's wrong and I'll change it.\n\n`;
        q = await rpc<NextCheck>(sb, "mcp_next_check", { _job: job.job_id });
      }
      // 0.8.4: step 0 scoping is setup question 1. Hosts that go straight to next_question (ChatGPT on job 2801) skipped it,
      // because only the create_job text asked for it. Ask it here until intake section "scope" has been saved once.
      const { data: sc } = await sb.from("mcp_job_facts").select("key").eq("job_id", job.job_id).eq("module", "scope").eq("key", "job_type").maybeSingle();
      if (!sc) {
        await audit(sb, job, "next_question", "view_setup_question", SCOPE_Q1_KEY);
        return guide({
          ...text(`${P}${auto}Setup question 1 (Job scoping) [Job setup]\nQuestion ref: ${questionRef(SCOPE_Q1_KEY)}\n\n${SCOPE_Q1_ASK}`),
          structuredContent: { check_key: SCOPE_Q1_KEY, index: 1, record_with: { tool: "intake", section: "scope" }, use_defaults_allowed: true },
        }, SCOPE_Q1_GUIDANCE);
      }
      // Project software is a real setup step, asked second (right after the auto-answered job number check, before the gates),
      // so every host shows it. The answer is kept in scope facts (key project_software); no new column.
      // The company profile is checked first. When it already names the software, this question is answered.
      const { data: sw } = await sb.from("mcp_job_facts").select("status").eq("job_id", job.job_id).eq("module", "scope").eq("key", PROJECT_SOFTWARE_KEY).maybeSingle();
      if (!sw) {
        const { data: profile } = await sb.from("mcp_companies").select("tool_stack").eq("id", job.company_id).maybeSingle();
        const fromProfile = companyProjectSoftware(profile?.tool_stack);
        if (fromProfile) {
          await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "scope", _facts: { [PROJECT_SOFTWARE_KEY]: fromProfile }, _source: "company_default" });
          await audit(sb, job, "next_question", "project_software_from_profile", PROJECT_SOFTWARE_KEY);
          auto += `Answered for you: project software is ${fromProfile}, from the company profile. Say so if that's wrong and I'll change it.\n\n`;
        } else {
          const after = (q ? q.total - q.index + 1 : 0) + wLeftFor(await warrantyFacts(sb, job));
          await audit(sb, job, "next_question", "view_setup_question", PROJECT_SOFTWARE_KEY);
          return guide({
            ...text(`${P}${auto}Setup question ${PROJECT_SOFTWARE_POSITION} — ${after} more after this (Project software) [Job setup]\nQuestion ref: ${questionRef(PROJECT_SOFTWARE_KEY)}\n\n${JOB_SOFTWARE_ASK}\n\nAnswer with the tool's name in detail (Overwatch, Buildertrend, Procore, Primavera P6, another web tool, Excel or none), or response unknown.`),
            structuredContent: { check_key: PROJECT_SOFTWARE_KEY, index: PROJECT_SOFTWARE_POSITION, total: after + PROJECT_SOFTWARE_POSITION, remaining_after: after, auto_answered: jobNumberAuto ? "job_number_assigned" : null },
          }, JOB_SETUP_SOFTWARE_BLOCK);
        }
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
          structuredContent: { check_key: key, index: wq.index, total: wq.total, remaining_after: after, auto_answered: jobNumberAuto ? "job_number_assigned" : null },
        };
      }
      await audit(sb, job, "next_question", "view_setup_question", q?.key ?? null);
      if (!q) {
        const { data: mods } = await sb.from("mcp_job_facts").select("module").eq("job_id", job.job_id);
        const have = new Set((mods ?? []).map((m) => m.module));
        const todo = ["scope", "contract", "handoff", "budget", "warranty"].filter((m) => !have.has(m));
        return guide(text(`${P}${auto}No setup questions left.${todo.length ? ` Intake sections not started: ${todo.join(", ")}.` : ""} Call report.`), JOB_SETUP_SOFTWARE_BLOCK);
      }
      const confirm = q.record_value != null;
      const ask = confirm ? `The record shows: ${typeof q.record_value === "string" ? q.record_value : JSON.stringify(q.record_value)}\nConfirm this is right (yes), or say no / unknown.` : q.prompt;
      return guide({
        ...text(
          `${P}${auto}Setup question ${q.index} — ${q.total - q.index + wLeft === 0 ? "last one" : `${q.total - q.index + wLeft} more after this`}${q.label ? ` (${q.label})` : ""} [${q.category}]\nQuestion ref: ${questionRef(q.key)}\n\n${confirm ? `${q.prompt}\n${ask}` : ask}\n\nAnswer with response yes, no, na (with a reason in detail) or unknown. For unknown or no, add owner and due_date if known. To mark the whole section N/A use answer action "mark_na" with scope "section".`,
        ),
        structuredContent: { check_key: q.key, index: q.index, total: q.total, remaining_after: q.total - q.index + wLeft, auto_answered: jobNumberAuto ? "job_number_assigned" : null },
      }, JOB_SETUP_SOFTWARE_BLOCK);
    }),
});

const wLeftFor = (facts: Parameters<typeof nextWarrantyQuestion>[0]) => { const x = nextWarrantyQuestion(facts); return x ? x.remaining_after + 1 : 0; };

// ---------- answer ----------
export const answer = defineTool({
  name: "answer",
  title: "Answer or mark N/A",
  description: "Records the answer to the current setup question.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    action: z.enum(["answer", "mark_na", "reenable", "decline_reenable"]).optional(),
    check_key: z.string().min(1).max(100).optional(),
    lookahead_help: z.enum(["accept", "decline"]).optional(),
    response: tri.optional(),
    detail: z.string().max(10_000).optional(),
    owner: z.string().max(200).optional(),
    due_date: date.optional(),
    scope: z.enum(["item", "section"]).optional(),
    section: z.string().max(60).optional(),
    na_id: uuid.optional(),
    lookahead_id: laArg.optional(),
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
        const { check: current } = await currentCheck(sb, la, "answer");
        let check = current;
        // A check already answered on this lookahead takes more entries: the new item is added, the first answer stays.
        let addEntry = false;
        if (!check || check.key !== args.check_key) {
          const answered = (await loadAnswers(sb, la.id)).some((a) => a.check_key === args.check_key && a.status !== "skipped_missing_inputs");
          const def = answered ? (await loadChecks(sb)).find((c) => c.key === args.check_key) : undefined;
          if (!def) {
            if (!check) throw new ToolError("All checks are already answered. To add an item, answer one of this lookahead's question refs again (for example la-inspections), or call report.");
            throw new ToolError("That isn't the current question. Call next_question and answer the check it returns.");
          }
          check = def;
          addEntry = true;
        }
        const detail = args.detail?.trim() || null;
        let status: "answered" | "unknown" = "answered";
        let openItem = false;
        if (args.response === "unknown") status = "unknown";
        else if (check.rule_type === "confirm") {
          if (!args.response || args.response === "na") throw new ToolError('This question needs response "yes", "no" or "unknown".');
          openItem = args.response === "no";
        } else {
          if (!detail) throw new ToolError('This question needs detail (the list, or "none"), or response "unknown".');
          openItem = !isNoneAnswer(detail);
        }
        if (addEntry && !openItem && status !== "unknown") return text(`${P}Nothing added: that answer opens no item, and the earlier answer to this question stays.\nNext: next_question.`);
        if (!addEntry) {
          const { error } = await sb.from("mcp_answers").insert({ lookahead_id: la.id, check_key: check.key, check_version: check.version, status, response: args.response ?? null, detail });
          if (error) throw new Error(error.message);
        }
        let item: ItemResult | null = null;
        if (openItem || status === "unknown") {
          item = await rpc<ItemResult>(sb, "mcp_add_item", {
            _job: job.job_id,
            _f: {
              action: `${check.category}: ${detail ?? check.prompt.replace(/^PLACEHOLDER:\s*/, "")}`.slice(0, 480), kind: status === "unknown" ? "confirm_unknown" : "general",
              item_type: status === "unknown" ? "unknown" : "no", accountable: args.owner ?? null, needed_by: args.due_date ?? null, trade: check.trade, category: check.category, severity: check.severity, detail, tool: "answer",
              // A look-ahead entry, not a "no" on a best-practice setup check: say where it came from instead of the DB default.
              why: status === "unknown" ? null : `Listed on look-ahead ${lookaheadRef(la.id)} (${check.category}) as open in this window.`,
            },
          });
        }
        // mcp_add_item files every item under the job's hidden setup container; a lookahead question's item belongs to this lookahead.
        if (item && !item.existing) await attachToLookahead(sb, item.item_id, la.id);
        await audit(sb, job, "answer", addEntry ? "lookahead_add_entry" : `lookahead_answer_${status}`, check.key);
        return { ...text(`${P}${addEntry ? `Added to ${lookaheadRef(la.id)}` : "Recorded"}${status === "unknown" ? " as unknown" : ""}.${itemNote(item)}\nNext: next_question.`), structuredContent: { status, item_id: item?.item_id ?? null, item_type: item?.item_type ?? null } };
      }

      if (args.check_key === PROJECT_SOFTWARE_KEY) {
        const tool = (args.detail ?? "").trim().slice(0, 200);
        const value = tool || (args.response === "na" || args.response === "no" ? "none" : null);
        await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "scope", _facts: { [PROJECT_SOFTWARE_KEY]: value }, _source: "member_answer" });
        await audit(sb, job, "answer", "project_software_answer", PROJECT_SOFTWARE_KEY);
        return guide({ ...text(`${P}Recorded: project software ${value ?? "unknown"}.\nNext: next_question.`), structuredContent: { recorded: { [PROJECT_SOFTWARE_KEY]: value } } }, JOB_SETUP_SOFTWARE_BLOCK);
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
  description: "Returns the job setup report or a two-week lookahead.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    audience: z.enum(["internal", "client"]).optional(),
    lookahead_id: laArg.optional(),
    deliverable: z.enum(["setup", "sov"]).optional(),
    sov_view: z.enum(["lines", "divisions"]).optional(),
    include_summary: z.boolean().optional(),
  },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("report", ctx, { lookaheadId: args.lookahead_id, jobNumber: args.job_number, client: args.audience === "client", ownerSov: args.audience === "client" && args.deliverable === "sov" && !args.lookahead_id }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (args.lookahead_id) {
        const la = await lookaheadForJob(sb, job, args.lookahead_id);
        await audit(sb, job, "report", "view_lookahead_report", la.id);
        const revs = revisionLines(await loadRevisions(sb, la.id));
        // 0.8.12: highlight today, or the saved CPM data date when that is later; then the required lookahead view.
        const hl = lookaheadHighlight(todayIn(await jobTimeZone(sb, job.job_id)), await cpmDataDate(sb, job));
        const { view, model } = await styledLookahead(sb, job, la, hl.date);
        // 0.8.18: the view spec sits right under the view (like CPM_GANTT_SPEC after the Tie line) so Claude builds an artifact.
        // 0.8.19: the At-Risk section is the model's risk list, the same one the header counts.
        const detail = await renderReport(sb, la, model ? { atRisk: model.risks.map(entryLine), asOf: model.asOf } : {});
        return text(`${prefix(job)}${view}\n\n${highlightLine(hl)}\n${LOOKAHEAD_VIEW_SPEC.join("\n")}\n\n---\nSource detail:\n${detail}${revs.length ? `\n\n${revs.join("\n")}` : ""}`);
      }
      const audience = args.audience ?? "internal";
      if (args.deliverable === "sov") return sovResult(sb, job, audience, args.sov_view ?? "lines");
      await audit(sb, job, "report", `view_setup_report_${audience}`, null);
      const body = await renderSetupReport(sb, job, audience, { includeSummary: args.include_summary === true });
      let iq = sb.from("mcp_open_items").select("id, section, check_key, item_type, commercial_type, category, action").eq("job_id", job.job_id).eq("status", "open");
      if (audience === "client") iq = iq.eq("internal_only", false);
      const [{ data: its0 }, nas] = await Promise.all([iq, activeNa(sb, job.job_id)]);
      const its = audience === "client" ? withoutClaims(its0 ?? []) : its0;
      // Client-facing output never carries item ids.
      const items = (its ?? []).map((i) => (audience === "client" ? { item_type: itemType(i, nas) } : { item_id: i.id, item_type: itemType(i, nas) }));
      // 0.8.9: sharing a report with the team or owner always lists all three options.
      return { ...text(`${SHARE_OPTIONS_REQUIRED}\n${body}\n\n${REPORT_SHARE_ASK}`), structuredContent: { items, delivery: { ...REPORT_SHARE_STRUCTURED, audience } } };
    }),
});

// ---------- carry_forward ----------
export const carryForward = defineTool({
  name: "carry_forward",
  title: "Carry forward open items",
  description: "Moves open items from one lookahead into the next.",
  inputSchema: { job_number: jobNumber, company_id: companyId, from_lookahead_id: laArg, to_lookahead_id: laArg },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("carry_forward", ctx, { lookaheadId: args.to_lookahead_id, jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const [from, to] = await Promise.all([lookaheadForJob(sb, job, args.from_lookahead_id), lookaheadForJob(sb, job, args.to_lookahead_id)]);
      if (from.id === to.id) throw new ToolError("from and to lookaheads must be different.");
      const { data: items, error } = await sb.from("mcp_open_items").select("id, carry_count, section, check_key, item_type, why").eq("lookahead_id", from.id).eq("status", "open");
      const nas = await activeNa(sb, job.job_id);
      if (error) throw new Error(error.message);
      for (const it of items ?? []) {
        // A why that names the source lookahead ("Listed on look-ahead LA-xxxx ...") now names the destination.
        const fromRef = lookaheadRef(from.id);
        const why = typeof it.why === "string" && it.why.includes(fromRef) ? it.why.split(fromRef).join(lookaheadRef(to.id)) : undefined;
        const up = await sb.from("mcp_open_items").update({ lookahead_id: to.id, carry_count: it.carry_count + 1, updated_at: new Date().toISOString(), ...(why !== undefined ? { why } : {}) }).eq("id", it.id);
        if (up.error) throw new Error(up.error.message);
        await sb.from("mcp_carry_forwards").insert({ item_id: it.id, from_lookahead_id: from.id, to_lookahead_id: to.id });
        await sb.from("mcp_item_events").insert({ item_id: it.id, event: "carried_forward", lookahead_id: to.id });
        await stampItemRev(sb, it.id, to.id);
      }
      await audit(sb, job, "carry_forward", "carry_forward", to.id);
      const typed = (items ?? []).map((i) => ({ item_id: i.id, item_type: itemType(i, nas) }));
      return guide({
        ...text(`${prefix(job)}${typed.length} open item(s) carried forward from ${lookaheadRef(from.id)} to ${lookaheadRef(to.id)}.`),
        structuredContent: { items: typed.map((t) => ({ ...t, item_ref: shortRef(t.item_id) })) },
      }, "Next: next_question for the new lookahead.");
    }),
});

/** 0.8.5: saved job contacts (other parties only) and clause text, for notice Method/Recipient and email cards. */
async function noticeContext(sb: Sb, job: Job) {
  const [co, cl] = await Promise.all([
    sb.from("mcp_companies").select("name").eq("id", job.company_id).maybeSingle(),
    sb.from("mcp_contract_clauses").select("section, verbatim_text").eq("job_id", job.job_id),
  ]);
  const contacts = await jobContacts(sb, job.job_id, (co.data as { name?: string | null } | null)?.name ?? null);
  return { contacts, clauses: (cl.data ?? []) as { section: string; verbatim_text: string | null }[] };
}

// ---------- list_open_items ----------
// The one exception to "job_number is required": with no job named, list_open_items lists the companies and jobs instead.
const listJobNumber = z.string().trim().min(1).max(40).optional();

/** Jobs the caller can see, narrowed to the current company when they belong to more than one. */
export type ListedJob = { job_number: string; name: string | null; company_id: string; updated_at?: string | null };

/**
 * The only job the member can see.
 * One job anywhere is that job. Otherwise the only job in the named or active company.
 * More than one choice returns null so the caller can ask.
 */
export async function soleJob(sb: Sb, companyId?: string): Promise<ListedJob | null> {
  const everywhere = await listedJobs(sb, undefined, { allCompanies: true });
  if (everywhere.length === 1) return everywhere[0];
  if (companyId?.trim()) {
    const scoped = await listedJobs(sb, companyId);
    return scoped.length === 1 ? scoped[0] : null;
  }
  const active = await listedJobs(sb);
  return active.length === 1 ? active[0] : null;
}

/** A named job number, or the only job when none was named. */
export async function namedOrSoleJob(sb: Sb, jobNumber?: string | null, companyId?: string): Promise<{ job_number: string; company_id?: string } | null> {
  const named = jobNumber?.trim();
  if (named) return { job_number: named, company_id: companyId };
  const only = await soleJob(sb, companyId);
  if (!only) return null;
  return { job_number: only.job_number, company_id: companyId ?? only.company_id };
}

/** One job, or the most recently updated job, is the job to open. Several jobs with no stamp still ask. */
export function chooseJob<T extends { job_number: string; updated_at?: string | null }>(jobs: T[]): T | null {
  const named = jobs.filter((job) => job.job_number.trim());
  if (!named.length) return null;
  if (named.length === 1) return named[0];
  const stamped = named.filter((job) => typeof job.updated_at === "string" && job.updated_at);
  if (!stamped.length) return null;
  return [...stamped].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
}

export async function listedJobs(sb: Sb, companyId?: string, opts?: { allCompanies?: boolean }): Promise<ListedJob[]> {
  const { data: cos, error } = await sb.from("mcp_companies").select("id, name");
  if (error) throw new Error(error.message);
  let companies = ((cos ?? []) as { id: string; name: string | null }[]).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id));
  if (companyId?.trim()) {
    const cid = await resolveCompany(sb, companyId);
    companies = companies.filter((c) => c.id === cid);
  } else if (!opts?.allCompanies && companies.length > 1) {
    const cur = await currentCompany(sb);
    if (cur && companies.some((c) => c.id === cur)) companies = companies.filter((c) => c.id === cur);
  }
  if (!companies.length) return [];
  const { data: jobs, error: je } = await sb.from("mcp_jobs").select("job_number, name, company_id, updated_at").in("company_id", companies.map((c) => c.id));
  if (je) throw new Error(je.message);
  return (jobs ?? []) as ListedJob[];
}

/** No job named: the caller's companies and their job numbers, in plain text. */
export async function listCompaniesAndJobs(sb: Sb, companyId?: string, tool = "list_open_items"): Promise<string> {
  const { data: cos, error } = await sb.from("mcp_companies").select("id, name");
  if (error) throw new Error(error.message);
  let companies = (cos ?? []) as { id: string; name: string | null }[];
  let others: string[] = [];
  if (companyId?.trim()) { const cid = await resolveCompany(sb, companyId); companies = companies.filter((c) => c.id === cid); }
  else if (companies.length > 1) {
    // 0.8.17: default to the member's current company; name the others once instead of listing all their jobs.
    const cur = await currentCompany(sb);
    if (cur && companies.some((c) => c.id === cur)) { others = companies.filter((c) => c.id !== cur).map((c) => c.name ?? "unnamed company"); companies = companies.filter((c) => c.id === cur); }
  }
  if (!companies.length) return 'No company set up yet. Call onboarding with action "save_company" first.';
  const { data: jobs, error: je } = await sb.from("mcp_jobs").select("job_number, name, company_id").in("company_id", companies.map((c) => c.id));
  if (je) throw new Error(je.message);
  const js = (jobs ?? []) as { job_number: string; name: string | null; company_id: string }[];
  const out = ["No job named. Your companies and jobs:"];
  for (const c of companies) {
    const mine = js.filter((j) => j.company_id === c.id).sort((a, b) => a.job_number.localeCompare(b.job_number));
    out.push(`- ${c.name ?? "unnamed company"}: ${mine.length ? mine.map((j) => `${j.job_number}${j.name ? ` (${j.name})` : ""}`).join(", ") : "no jobs yet"}`);
  }
  if (others.length) out.push(`(Using your current company. Also yours: ${others.join(", ")}; name one to switch.)`);
  out.push(whichJobAsk(tool));
  return out.join("\n");
}
export const listOpenItems = defineTool({
  name: "list_open_items",
  title: "List open items",
  description: "Lists open items for a job_number the member just gave, and must not fill job_number from chat context.",
  inputSchema: {
    job_number: listJobNumber,
    company_id: companyId,
    lookahead_id: laArg.optional(),
    date_sweep: z.boolean().optional(),
  },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("list_open_items", ctx, { lookaheadId: args.lookahead_id, jobNumber: args.job_number, sweep: args.date_sweep === true }, async (sb) => {
      const picked = await namedOrSoleJob(sb, args.job_number, args.company_id);
      if (!picked) return text(await listCompaniesAndJobs(sb, args.company_id, "list_open_items"));
      const job = await resolveJob(sb, picked.job_number, picked.company_id);
      let q = sb.from("mcp_open_items").select(ITEM_COLS).eq("job_id", job.job_id).eq("status", "open");
      const la = args.lookahead_id ? await lookaheadForJob(sb, job, args.lookahead_id) : null;
      if (la) q = q.eq("lookahead_id", la.id);
      let laBlock = "";
      if (!la) {
        const { data: las0 } = await sb.from("mcp_lookaheads").select("id, start_date, end_date, created_at, inputs").eq("job_id", job.job_id).limit(200);
        // The setup container (inputs.kind "setup") holds job-setup items; it is not a lookahead the member made, so it isn't listed.
        const las = visibleLookaheads((las0 ?? []) as { inputs?: unknown }[]);
        // Newest window first (start date, then end date); undated lookaheads last; ties by creation time.
        const k = (v: string | null | undefined) => v ?? "";
        const sorted = ((las ?? []) as { id: string; start_date: string | null; end_date: string | null; created_at: string }[])
          .sort((x, y) => (!x.start_date !== !y.start_date ? (x.start_date ? -1 : 1) : k(y.start_date).localeCompare(k(x.start_date)) || k(y.end_date).localeCompare(k(x.end_date)) || k(y.created_at).localeCompare(k(x.created_at))))
          .slice(0, 10);
        const revOf = new Map<string, number | null>();
        for (const l of sorted) revOf.set(l.id, await currentRev(sb, l.id));
        const rowsLa = await lookaheadRows(sb, job);
        const latest = pickLatestLookahead(rowsLa);
        const empty = new Set(rowsLa.filter((r) => r.items === 0).map((r) => r.id));
        if (sorted.length) laBlock = `\n\nLookaheads (newest first):\n${sorted.map((l: { id: string; start_date: string | null; end_date: string | null }) => `- ${lookaheadRef(l.id)}: ${l.start_date ?? "dates unknown"}${l.end_date ? ` to ${l.end_date}` : ""}${revOf.get(l.id) != null ? ` (Rev ${revOf.get(l.id)})` : ""}${l.id === latest?.id ? " — use this one (latest with content)" : empty.has(l.id) ? " — empty" : ""}`).join("\n")}`;
      }
      const laHead = la ? `Lookahead ${lookaheadRef(la.id)}: ` : "";
      const [{ data, error }, nas] = await Promise.all([q.order("needed_by", { nullsFirst: false }).limit(200), activeNa(sb, job.job_id)]);
      if (error) throw new Error(error.message);
      const tz = await jobTimeZone(sb, job.job_id);
      await audit(sb, job, "list_open_items", "view_open_items", null);
      const pages = await signedJobPages((fn, params) => sb.rpc(fn, params), job.job_id, job.scope);
      const boardUrl = pages.items ?? null;
      if (!data?.length) {
        const counts = { open: 0, overdue: 0, due_in_7_days: 0 };
        return { ...text(`${prefix(job)}${laHead}No open items.${laBlock}`), structuredContent: {
          counts, items: [], board_url: boardUrl, card: openItemsCard(named(job), [], counts, todayIn(tz), boardUrl),
        } };
      }
      // 0.8.5: notice items take Method and Recipient from the contract clause and the saved job contacts when blank,
      // and the same event + notice type shows once. Display only: nothing is written or deleted, so this is idempotent.
      const { contacts, clauses: cls } = await noticeContext(sb, job);
      const deduped = dedupeNotices((data as unknown as Parameters<typeof itemLine>[0][]).map((it) => fillNotice(it, cls, contacts)));
      const today = todayIn(tz);
      const feed = openItemFeed(deduped.items, today);
      const rows = feed.items;
      const lines = rows.map((it) => {
        const d = deduped.duplicates.get(it.id);
        const same = d?.length ? ` | Same notice also logged as: ${d.map((x) => itemName(x.action)).join(", ")} (shown once)` : "";
        return `- ${formatBillingText(itemLine(it, nas, job.scope !== "full", { tz, plain: true }))}${same}`;
      });
      const dupCount = [...deduped.duplicates.values()].reduce((n, d) => n + d.length, 0);
      const ec = emailContact(contactForRole(contacts, "Project Manager"));
      const dupNote = dupCount ? `\n${dupCount} duplicate notice item${dupCount === 1 ? "" : "s"} shown once (same event and notice type); nothing was deleted.` : "";
      const listed = rows.map((i) => ({ action: formatBillingText(itemName(i.action)), owner: i.accountable ?? i.owner ?? null, due: dueOf(i) || null, overdue: isOverdue(i, today), due_in_7_days: isDueIn7(i, today), item_id: i.id, item_ref: itemRef(i), item_type: itemType(i, nas), href: openItemRecordUrl(boardUrl, i.id) }));
      const counts = { open: listed.length, overdue: listed.filter((i) => i.overdue).length, due_in_7_days: listed.filter((i) => i.due_in_7_days).length };
      const header = openItemsHeader(counts);
      const card = openItemsCard(`${named(job)}`, rows, counts, today, boardUrl);
      return guide({ ...text(`${prefix(job)}${laHead}${header}\n${lines.join("\n")}${dupNote}\n\n${REMINDERS_VIEW_SPEC.join("\n")}\n\n${ec.text}\n${EMAIL_VIEW_SPEC.join("\n")}${laBlock}`), structuredContent: { counts, items: listed, card, board_url: boardUrl, email_contact: ec.structured } }, "The open count is the number of items in this list. Overdue is the number of those items marked overdue. Do not count a different set.", EMAIL_CONTACT_RULE);
    }),
});

/** Opening line for lookahead_list. Counts come from visibleLookaheads via lookaheadRows. */
export function lookaheadListLead(jobNumber: string, visible: { items: number }[]): string {
  const content = visible.filter((row) => row.items > 0).length;
  const empty = visible.length - content;
  const lookaheads = `${visible.length} lookahead${visible.length === 1 ? "" : "s"}`;
  return `Job ${jobNumber} has ${lookaheads} (${content} with content, ${empty} empty).`;
}

/** Normal display path: saved rows are returned directly, never through the PDF/export tool. */
export const lookaheadGet = defineTool({
  name: "lookahead_get",
  title: "Show saved lookahead and its items",
  description: "Reads a job's saved lookahead, its items and current schedule window. Returns the styled card and every saved item directly; no PDF, email or upload needed.",
  inputSchema: { job_number: jobNumber, company_id: companyId, lookahead_id: laArg.optional() },
  annotations: { ...READ, destructiveHint: false, idempotentHint: true },
  handler: (args, ctx) =>
    run("lookahead_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const la = await lookaheadForJob(sb, job, args.lookahead_id ?? "latest");
      const [d, items, rev] = await Promise.all([lookaheadData(sb, job, la), savedLookaheadItems(sb, job, la.id), currentRev(sb, la.id)]);
      const win = lookaheadWindow(la, d.dataDate);
      const activities = win ? windowActivities(d.acts, win.start, win.end) : [];
      const context: CardSection[] = [{ heading: "Window", kind: "list", rows: [
        { cells: [win ? `${win.start} to ${win.end}` : "Window dates needed", rev == null ? "" : `Rev ${rev}`] },
        ...(d.dataDate ? [{ cells: [dataDateRule(d.dataDate, d.version)] }] : []),
        ...(win?.note ? [{ cells: [win.note] }] : []),
      ] }, { heading: "Schedule activities in this window", kind: "table", columns: ["Activity", "Start", "Finish"],
        rows: activities.length ? activities.map((a) => ({ cells: [activityIdName(a), a.start?.slice(0, 10) || "Needed", a.finish?.slice(0, 10) || "Needed"] }))
          : [{ cells: [d.acts.length ? "No saved activities overlap this window" : "No saved CPM activities yet", "", ""] }],
      }];
      // Match the existing report's job obligations, not just this lookahead's attached rows.
      // A saved set may have four open future items while the job still has three overdue obligations.
      const jobOverdue = d.win ? lookaheadModel(d.win.start, d.win.end, d.acts, d.items, { today: d.today, dataDate: d.dataDate }).overdue.map((entry) => entry.item) : null;
      const card = savedLookaheadCard(named(job), d.ref, items, d.today, context, jobOverdue);
      const html = renderHtml(card);
      return { ...text(`${renderMarkdown(card)}\n\n${html}`),
        structuredContent: { lookahead_ref: d.ref, revision: rev, window: win, data_date: d.dataDate, cpm_version: d.version, as_of: d.today, overdue_scope: jobOverdue ? "job" : "saved_items", overdue_items: jobOverdue ?? items.filter((item) => item.status === "open" && item.due && item.due < d.today), activities, items, card, html },
        _meta: { ...cardWidgetMeta } };
    }),
});

export const lookaheadList = defineTool({
  name: "lookahead_list",
  title: "List lookaheads",
  description: "Lists how many lookaheads a job has, which are visible, and writes nothing.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("lookahead_list", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const rows = await lookaheadRows(sb, job);
      const latest = pickLatestLookahead(rows);
      const k = (v: string | null) => v ?? "";
      const sorted = [...rows].sort((a, b) => (!a.start_date !== !b.start_date ? (a.start_date ? -1 : 1) : k(b.start_date).localeCompare(k(a.start_date)) || k(b.end_date).localeCompare(k(a.end_date)) || b.created_at.localeCompare(a.created_at)));
      const items: { ref: string; start: string | null; end: string | null; rev: number | null; open_items: number; items: number; latest: boolean; empty: boolean }[] = [];
      for (const row of sorted) {
        const rev = await currentRev(sb, row.id);
        items.push({
          ref: lookaheadRef(row.id),
          start: row.start_date,
          end: row.end_date,
          rev,
          open_items: row.items,
          items: row.items,
          latest: row.id === latest?.id,
          empty: row.items === 0,
        });
      }
      const lead = lookaheadListLead(job.job_number, rows);
      const savedItems = latest ? await savedLookaheadItems(sb, job, latest.id) : [];
      const today = todayIn(await jobTimeZone(sb, job.job_id));
      const card = {
        state: "result" as const,
        title: "Lookaheads",
        show_state: false,
        job: named(job),
        kpis: [
          { label: "Visible", value: String(rows.length) },
          { label: "With content", value: String(rows.filter((row) => row.items > 0).length) },
          { label: "Empty", value: String(rows.filter((row) => row.items === 0).length) },
        ],
        sections: [
          {
            heading: "Lookaheads",
            kind: "table" as const,
            columns: ["Ref", "Window", "Rev", "Items"],
            rows: items.map((item) => ({
              cells: [item.ref, `${item.start ?? "dates unknown"}${item.end ? ` to ${item.end}` : ""}`, item.rev == null ? "" : `Rev ${item.rev}`, String(item.items)],
            })),
          },
          ...(latest ? [savedItemsSection(lookaheadRef(latest.id), savedItems, today)] : []),
        ],
      };
      const html = renderHtml(card);
      const body = applyCardClosing(`${lead}\n\n${renderMarkdown(card)}\n\n${htmlBlock(html)}`, false);
      return guide(
        {
          ...text(body),
          structuredContent: { total_visible: rows.length, items, lookahead_items: savedItems, card, html },
          _meta: { ...cardWidgetMeta },
        },
        "The card is shown. Add nothing after it.",
      );
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
  description: "Previews a selected open item and its evidence, and closes it only after the member's separate yes with confirmed and the matching confirmation_key; update leaves it open.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    item_id: z.string().min(1).max(64),
    kind: z.enum(["verified", "member_statement", "waive", "commercial_close", "update", "na"]),
    evidence: z.string().trim().max(10_000).optional(),
    stated_by: z.string().max(200).optional(),
    stated_on: date.optional(),
    reason: z.string().max(2000).optional(),
    approval: z.string().max(1000).optional(),
    billing: z.string().max(1000).optional(),
    collection: z.string().max(1000).optional(),
    confirmed: z.boolean().optional(),
    confirmation_key: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
      const { data: it, error } = await sb.from("mcp_open_items").select("id, job_id, section, check_key, item_type, action, accountable, owner, needed_by, due_date, updated_at").eq("id", itemId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!it || it.job_id !== job.job_id) throw new ToolError(`Item not found on job ${job.job_number}.`);
      const ref = itemRef(it);
      const me = await callerLabel(sb, job, ctx.getUserId?.());
      const statedBy = args.kind === "member_statement" || args.kind === "update" ? (args.stated_by?.trim() || me) : args.stated_by ?? null;
      const proposal = args.kind === "member_statement" ? { ...args, stated_by: statedBy ?? undefined } : args;
      // Closing needs real evidence: a document, a dated who-said-what statement, or an explicit waiver.
      if ((args.kind === "verified" || args.kind === "member_statement") && evidenceProblem(args.evidence)) {
        await audit(sb, job, "resolve_item", "close_rejected_no_evidence", itemId);
        const preview = itemClosurePreview(named(job), it, ref, proposal, null, EVIDENCE_ASK);
        return { ...text(renderMarkdown(preview.card)), structuredContent: { ...preview, item_id: itemId, item_ref: ref, item_type: itemType(it, await activeNa(sb, job.job_id)) } };
      }
      if (args.kind !== "update" && args.kind !== "na") {
        const missingDetails = args.kind === "member_statement" && !args.stated_on
          ? "What date was this statement made? Give the date as YYYY-MM-DD; this item stays open."
          : args.kind === "waive" && !args.reason?.trim()
            ? "What is the reason for waiving this item? It stays open until the reason is reviewed and you confirm."
            : args.kind === "commercial_close" && (!args.approval?.trim() || !args.billing?.trim() || !args.collection?.trim())
              ? "What are the approval, billing and collection records for this item? All three are needed before closure can be reviewed."
              : null;
        if (missingDetails) {
          const preview = itemClosurePreview(named(job), it, ref, proposal, null, missingDetails);
          return { ...text(renderMarkdown(preview.card)), structuredContent: { ...preview, item_id: itemId, item_ref: ref, item_type: itemType(it, await activeNa(sb, job.job_id)) } };
        }
        const key = await itemClosureKey(job.job_id, ctx.getUserId?.(), it, proposal);
        if (args.confirmed !== true || args.confirmation_key !== key) {
          const preview = itemClosurePreview(named(job), it, ref, proposal, key);
          return { ...text(renderMarkdown(preview.card)), structuredContent: { ...preview, item_id: itemId, item_ref: ref, item_type: itemType(it, await activeNa(sb, job.job_id)) } };
        }
      }
      // Statements are attributed to the calling user (name and role) unless the member named who said it.
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
      const card = itemClosureOutcome(named(job), msg, r.closed);
      return { ...text(renderMarkdown(card)), structuredContent: { card, item_id: itemId, item_ref: ref, item_type: t, closed: r.closed, confirmation_required: false } };
    }),
});

// ---------- contract_terms (read-only) ----------
const CONTRACT_KEYS = ["pay_terms", "notice_timing", "tia_timing", "change_process", "claim_process", "retainage", "retainage_reduction", "beneficial_use_clause", "liquidated_damages", "savings_split", "closeout", "warranty_clauses"] as const;
const CONTRACT_FLAGS = ["has_retainage", "has_lds", "beneficial_use", "notice_requirements"] as const;

export const contractTerms = defineTool({
  name: "contract_terms",
  title: "Read contract terms",
  description: "Reads contract clauses, the contract value, and the substantial completion date when asked what the contract says, what it is worth, or when the job finishes.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    include_summary: z.boolean().optional(),
  },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("contract_terms", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (job.scope === "super") throw new ToolError(READ_ONLY_MESSAGE);
      const [fR, flR, jobR, valueR, iorR] = await Promise.all([
        sb.from("mcp_job_facts").select("key, value, status, source").eq("job_id", job.job_id).eq("module", "contract"),
        sb.from("mcp_job_flags").select("flag_key, value, source").eq("job_id", job.job_id).in("flag_key", [...CONTRACT_FLAGS]),
        sb.from("mcp_jobs").select("contract_completion_date, sov_fee_pct").eq("id", job.job_id).maybeSingle(),
        sb.from("mcp_job_facts").select("module, key, value, status").eq("job_id", job.job_id).in("module", ["contract", "budget", "job", "setup", "sov"]),
        sb.rpc("mcp_living_report_get", { _job: job.job_id, _type: "ior", _version: null }),
      ]);
      if (fR.error) throw new Error(fR.error.message);
      if (flR.error) throw new Error(flR.error.message);
      if (jobR.error) throw new Error(jobR.error.message);
      if (valueR.error) throw new Error(valueR.error.message);
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
      const notice = noticeRequirements(cl, { noticeFlagNo: flags.find((f) => f.flag === "notice_requirements")?.value === "OFF" });
      // Verbatim clauses first. With clauses on file, summaries (plain-language notice block and summary fields) only on request;
      // with no clauses, the summary fields stay as the fallback. Data is never changed here.
      const withSummary = !cl.length || args.include_summary === true;
      const termLine = (c: (typeof clauses)[number]) => `- ${c.key.replace(/_/g, " ")}: ${c.value ?? "UNKNOWN"}${c.value ? ` (${c.source === "document" ? LEGACY_SUMMARY_TAG : c.source})` : ""}`;
      const valueFacts = (valueR.data ?? []) as { module: string; key: string; value: unknown; status?: string }[];
      const sovLines = valueFacts.filter((f) => f.module === "sov").map((f) => {
        const v = (f.value ?? {}) as { executed_change_order?: string; fee_included?: boolean; description?: string | null; billable_value?: number | null };
        return { executed_change_order: v.executed_change_order, fee_included: v.fee_included, item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null };
      });
      const picked = pickContractValue({
        setup: setupContractValue(valueFacts),
        sov: sovContractValue(sovLines, jobR.data?.sov_fee_pct == null ? null : Number(jobR.data.sov_fee_pct), valueFacts.find((f) => f.module === "contract" && f.key === "retainage")?.value),
        ior: iorR.error ? null : iorContractValue(iorR.data as { contract_total?: number | null; data?: unknown } | null),
      });
      const showMoney = job.scope === "full";
      const completion = completionDate(jobR.data?.contract_completion_date ?? null, valueFacts);
      const board = job.scope === "full" || job.scope === "super" ? await signedJobPages((fn, a) => sb.rpc(fn, a), job.job_id, job.scope) : {};
      const boardLinks = [
        board.items ? { label: "Open items", url: board.items } : null,
        board.ior ? { label: "Open IOR", url: board.ior } : null,
        board.field ? { label: "Open field board", url: board.field } : null,
        board.schedule ? { label: "Open schedule", url: board.schedule } : null,
      ].filter((link): link is { label: string; url: string } => !!link);
      const lines = [
        `${prefix(job)}CONTRACT CLAUSES (exact contract text)`,
        contractValueLine(picked.amount, picked.source, showMoney),
        `Substantial completion: ${completion ?? "Needed"}`,
        ...(cl.length ? cl.map((c) => `- ${clauseLine(c)}`) : ["- None recorded. Record them with intake section clauses, copied exactly from the contract."]),
        ...missingNotices(cl).map((m) => `- Missing: ${m.label} (${missingNoticeNote(cl.length > 0)})`),
        "",
        "Applicability:",
        ...flags.map((f) => `- ${f.flag.replace(/_/g, " ")}: ${f.value}${f.source ? ` (${f.source})` : ""}`),
        ...(withSummary
          ? cl.length
            ? ["", `${SUMMARY_HEADING}:`, ...notice.lines, "", `CONTRACT TERMS (as saved; ${SUMMARY_HEADING.toLowerCase()})`, ...clauses.map(termLine)]
            : ["", ...notice.lines, "", "CONTRACT TERMS (as saved)", ...clauses.map(termLine)]
          : ["", SUMMARY_OFFER]),
      ];
      // With clauses on file, the card is built from the clause rows: one card per clause, exact wording.
      const card = cl.length
        ? contractTermsCard({
            job: named(job),
            clauses: cl,
            valueDisplay: contractValueLine(picked.amount, picked.source, showMoney),
            completion,
            missing: missingNotices(cl).map((m) => `Missing: ${m.label} (${missingNoticeNote(true)})`),
            flags,
            askSummary: !withSummary,
            summary: withSummary ? [...notice.lines, ...clauses.map(termLine)] : undefined,
            boardLinks,
          })
        : undefined;
      return { ...text(lines.join("\n")), structuredContent: { ...(card ? { card } : {}), include_summary: withSummary, clauses: withSummary ? clauses : [], flags, notice_requirements: { status: notice.status, missing: notice.missing }, contract_clauses: cl.map((c) => ({ section: c.section, heading: c.heading, category: c.category, source: c.source, n_days: c.n_days, day_type: c.day_type, trigger: c.trigger_desc })), contract_value: showMoney ? picked.amount : null, contract_value_display: showMoney && picked.amount != null ? contractValueLine(picked.amount, picked.source, true) : null, contract_value_source: showMoney ? picked.source : null, substantial_completion: completion, board_links: boardLinks } };
    }),
});

// ---------- SOV (lean v1) ----------
const sovFooterMissing = (c: { license_number?: string | null; contact_name?: string | null; contact_phone?: string | null; website?: string | null }) =>
  [["license number", c.license_number], ["contact name", c.contact_name], ["phone", c.contact_phone], ["website", c.website]].filter(([, v]) => !v).map(([k]) => k as string);

async function sovResult(sb: Sb, job: Job, audience: "internal" | "client", view: SovView = "lines") {
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
  const ec = emailContact(contactForRole((await noticeContext(sb, job)).contacts, "Project Manager"));
  const lines = rows.filter((f) => f.module === "sov").map((f) => {
    const v = (f.value ?? {}) as { executed_change_order?: string; fee_included?: boolean; description?: string | null; billable_value?: number | null; cost_codes?: string[]; spec_section?: string | null };
    return { executed_change_order: v.executed_change_order, fee_included: v.fee_included, item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null, cost_codes: v.cost_codes, spec_section: v.spec_section ?? null };
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
      // 0.8.4: the delivery step rides in the tool text and structuredContent, not only in guidance, so every host (Claude too) asks it.
      ...text(`${sovRequiredTop(sovLineRows(sov), ec.structured.to_line)}\n${sovSummaryText(prefix(job), sov, brand, jr.data?.sov_basis ?? null, sovFooterMissing(c), audience, view)}${sovSpecsMissing(sov) ? `\n${SOV_SPECS_MISSING_NOTE}` : ""}\n\n${sovDeliveryAsk(audience)}\nFor option 2 or 3:\n${EMAIL_TO_LABEL_REQUIRED}\n${ec.text}\n${EMAIL_VIEW_SPEC.join("\n")}`),
      structuredContent: {
        sov: {
          audience,
          view,
          line_items: sovLineRows(sov),
          notes: sovNotes(brand, sovFooterMissing(c)),
          specs_note: sovSpecsMissing(sov) ? SOV_SPECS_MISSING_NOTE : null,
          header: { project: `${named(job)}`, prepared: today, contractor: c.name, basis: jr.data?.sov_basis ?? null, contract_sum: sov.summary.contract_total, contract_sum_display: money(sov.summary.contract_total) },
          contract_total_display: money(sov.summary.contract_total),
          ...sov,
          footer: sovLayout(brand).footer,
          layout: sovLayout(brand),
        },
        // Card drawn from the rows, every line (the inferred card stopped at eight text lines).
        card: sovCard({
          job: named(job),
          rows: sovLineRows(sov),
          divisions: sov.summary.divisions.map((d) => ({ division: d.division, title: d.title, scheduled_value_display: money(d.scheduled_value), pct_of_contract: d.pct_of_contract })),
          fee: sov.summary.fee > 0 ? { display: money(sov.summary.fee), pct: sov.summary.fee_pct } : null,
          totalDisplay: money(sov.summary.contract_total),
          basis: jr.data?.sov_basis ?? null,
          audience,
          view,
        }),
        // 0.8.7: the host draws this bar chart (scheduled value by line) in the fixed palette, every host.
        chart: sovChart(sovLineRows(sov)),
        // 0.8.8: same three delivery options (project software, Excel/PDF email, shared link) for every audience.
        delivery: sovDeliveryStructured(audience),
        // 0.8.5: who the SOV email card goes to (option 2), so the host fills To and the greeting.
        email_contact: ec.structured,
      },
    },
    "To produce the SOV file, use structuredContent.sov exactly: numbers, column set and layout recipe come from the server. Do not recompute or reorder.",
    `${SOV_PRESENTATION_LEAD} with the line-item view by default (structuredContent.sov.line_items: line no., cost code, division, description, scheduled value, % of total, then the total that ties to the contract sum). Always include a Cost Code column right after the line no., filled from line_items cost_code (e.g. 26-010); never show the item number in its place. Money with cents everywhere, exactly as in the visible text and the *_display fields (e.g. $1,400,000.00); never round or drop the .00. Do not put a date sweep or any other block before the SOV. Claude: an artifact table built from this result with no tool calls inside it; ChatGPT: a canvas or table; elsewhere: a table plus an offer to create an Excel file. Table style: ${SOV_TABLE_STYLE} Colors: blue #2563EB and gray only, never orange, rust or the alert color, including totals. After the table, at most ONE line. The logo, footer gaps (structuredContent.sov.notes), billing note and the division roll-up offer only when the member asks. Line items carry cost_code and spec_section; keep both columns in any file. Chart colors: ${CHART_PALETTE.join(", ")} only.`,
    `REQUIRED: end the reply with the SOV delivery question below, word for word, in every host including Claude.${audience === "client" ? " This is the owner/client SOV: offer options 1 and 2 only; never offer a chat link." : ""}`,
    SOV_CHART_RULE,
    sovDeliveryBlock(audience),
    EMAIL_CONTACT_RULE,
  );
}

/** Visible lookaheads on a job with how many items each has (any status). */
async function lookaheadRows(sb: Sb, job: Job): Promise<LaRow[]> {
  const [{ data: las }, { data: its }] = await Promise.all([
    sb.from("mcp_lookaheads").select("id, start_date, end_date, created_at, inputs").eq("job_id", job.job_id).limit(200),
    sb.from("mcp_open_items").select("lookahead_id").eq("job_id", job.job_id).not("lookahead_id", "is", null).limit(2000),
  ]);
  const n = new Map<string, number>();
  for (const r of (its ?? []) as { lookahead_id: string }[]) n.set(r.lookahead_id, (n.get(r.lookahead_id) ?? 0) + 1);
  return visibleLookaheads((las ?? []) as { id: string; start_date: string | null; end_date: string | null; created_at: string; inputs?: unknown }[]).map((l) => ({ id: l.id, start_date: l.start_date, end_date: l.end_date, created_at: l.created_at, items: n.get(l.id) ?? 0 }));
}

/** 0.8.18: the lookahead's data (window from the saved CPM data date, activities, open items); shared by the view and the PDF. */
export async function lookaheadData(sb: Sb, job: Job, laInput: string | { id: string; start_date?: string | null; end_date?: string | null }) {
  const la = typeof laInput === "string" ? await lookaheadForJob(sb, job, laInput) : laInput;
  type Cpm = { found?: boolean; data_date?: string | null; version?: number | null; data?: { activities?: SAct[] } };
  const cpm: Cpm | null = await (async () => {
    try {
      const { data, error } = await sb.rpc("mcp_living_report_get", { _job: job.job_id, _type: "cpm", _version: null });
      return error ? null : (data as unknown as Cpm);
    } catch { return null; }
  })();
  const acts = (cpm?.found ? cpm.data?.activities ?? [] : []) as SAct[];
  const dataDate = cpm?.found ? cpm.data_date ?? null : null;
  const found = lookaheadWindow(la, dataDate);
  const win = found && windowActivities(acts, found.start, found.end).length ? found : null;
  let items: LaItem[] = [];
  if (win) {
    const { data: rows } = await sb.from("mcp_open_items").select("action, owner, accountable, due_date, needed_by, severity, item_type, kind, category, check_key").eq("job_id", job.job_id).eq("status", "open");
    items = ((rows ?? []) as { action: string; owner?: string | null; accountable?: string | null; due_date?: string | null; needed_by?: string | null; severity?: string | null; item_type?: string | null; kind?: string | null; category?: string | null; check_key?: string | null }[])
      .map((r) => ({ action: r.action, severity: r.severity, type: r.item_type, kind: r.kind, category: r.category, check_key: r.check_key, owner: r.accountable ?? r.owner ?? null, due: (r.needed_by ?? r.due_date ?? null)?.slice(0, 10) ?? null }))
      .filter((r) => !r.due || r.due <= win.end);
  }
  const today = todayIn(await jobTimeZone(sb, job.job_id));
  return { la, ref: lookaheadRef(la.id), win, note: found?.note ?? null, dataDate, version: cpm?.version ?? null, acts, items, today };
}

/** 0.8.17: the lookahead as a finished view, filled from the saved CPM window when no schedule export was sent. */
async function styledLookahead(sb: Sb, job: Job, la: { id: string; start_date?: string | null; end_date?: string | null }, highlight: string | null): Promise<{ view: string; model: LaModel | null }> {
  const d = await lookaheadData(sb, job, la);
  const title = `${named(job)}`;
  const board = await signedJobPages((fn, a) => sb.rpc(fn, a), job.job_id, job.scope);
  const url = board.lookahead ?? null;
  if (!d.win)
    return { model: null, view: `${url ? `${pageLine("lookahead", url)}\n\n` : ""}${emptyCard("lookahead", title, d.acts.length ? "Pick a window that overlaps the saved schedule, or send this window's schedule export." : "Send the schedule export (or save the CPM) and Athena fills the lookahead from it.", d.acts.length ? [] : ["Schedule export or saved CPM"])}` };
  const view = lookaheadView({ title, ref: d.ref, start: d.win.start, end: d.win.end, dataDate: d.dataDate, acts: d.acts, items: d.items, highlight, pageUrl: url, today: d.today });
  const model = lookaheadModel(d.win.start, d.win.end, d.acts, d.items, { today: d.today, dataDate: d.dataDate });
  return { model, view: [view, ...(d.note ? ["", d.note] : []), ...(d.dataDate ? ["", dataDateRule(d.dataDate, d.version)] : []), "", LOOKAHEAD_EMAIL_LINE].join("\n") };
}

/** 0.8.12: the saved CPM data date (null when none is saved or the living reports schema isn't there). */
async function cpmDataDate(sb: Sb, job: Job): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc("mcp_living_report_get", { _job: job.job_id, _type: "cpm", _version: null });
    if (error || !data) return null;
    return ((data as { data_date?: string | null }).data_date ?? null) || null;
  } catch {
    return null;
  }
}
