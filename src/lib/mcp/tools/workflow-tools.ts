import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { ITEM_COLS, activeNa, audit, itemLine, itemType, prefix, renderSetupReport, resolveCompany, resolveJob, type Job } from "../jobs";
import { computeDue, type DayType } from "../deadlines";
import { INPUT_KEYS, INPUT_LABELS, currentCheck, loadLookahead, renderReport, type InputKey } from "../workflow";
import { WARRANTY_SETUP_QUESTIONS, renderWarrantyRegister, warrantyOpenItems } from "../warranty";
import { EVIDENCE_ASK, isVagueEvidence } from "../evidence";
import { FLAGS_ASKED_LATER, noGuidance, noGuidanceText, reconcileRecommendation } from "../guidance";
import { LOOKAHEAD_BUILD_QUESTIONS, LOOKAHEAD_PUSHBACK, LOOKAHEAD_SETUP_KEY, buildQuestionsText, pushbackText } from "../lookahead-help";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2417).");
const companyId = uuid.optional().describe("Only needed if you belong to more than one company.");
const short = (d: string) => z.string().max(2000).optional().describe(d);
const tri = z.enum(["yes", "no", "na", "unknown"]);
const doc = (what: string) => z.string().max(20_000).optional().describe(`${what}, as plain text. Leave out if you don't have it; it is recorded as unknown.`);
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const MAX_INPUT = 20_000;

function capInput(args: unknown) {
  const n = JSON.stringify(args ?? {}).length;
  if (n > MAX_INPUT) throw new ToolError(`Input is ${n.toLocaleString()} characters; the limit is 20,000. Trim or split it.`);
}

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  // Function names and argument shapes are fixed server-side; inputs are passed as data only.
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

type ItemResult = { item_id: string; existing: boolean; item_type?: string; delivery_item?: ItemResult | null; owner_defaulted?: boolean; needed_by_defaulted?: boolean; accountable?: string; needed_by?: string };
const itemNote = (r: ItemResult | null | undefined): string =>
  !r
    ? ""
    : r.existing
      ? ` Already open: item ${r.item_id} (type ${r.item_type ?? "unknown"}).`
      : ` Open item ${r.item_id} created, type ${r.item_type ?? "deadline"} (accountable: ${r.accountable}${r.owner_defaulted ? " — defaulted to the job's PM (or to you when no PM is set); reassign if needed" : ""}; needed by ${r.needed_by}${r.needed_by_defaulted ? " — defaulted to 7 days" : ""}).${r.delivery_item ? ` Delivery method/recipient unknown:${itemNote(r.delivery_item)}` : ""}`;
const itemOut = (r: ItemResult | null | undefined) => (r ? { item_id: r.item_id, item_type: r.item_type ?? "deadline" } : null);

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
    action: z.enum(["read", "save_company", "add_member"]).describe("read, save_company (create or update), or add_member."),
    company_id: companyId,
    name: z.string().trim().max(200).optional().describe("Company name (required to create)."),
    your_name: z.string().trim().max(120).optional().describe("Your display name on the company (when creating)."),
    agent_name: z.string().trim().max(60).optional().describe("What to call the agent. Default 'Athena'."),
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
  },
  annotations: { ...WRITE, idempotentHint: true },
  handler: (args, ctx) =>
    run("onboarding", ctx, undefined, async (sb) => {
      capInput(args);
      let cid: string | undefined = args.company_id;
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
      } else if (args.action === "add_member") {
        cid = await resolveCompany(sb, cid);
        if (!args.member_email || !args.member_name || !args.member_role) throw new ToolError("add_member needs member_email, member_name and member_role.");
        await rpc(sb, "mcp_member_add", { _company: cid, _email: args.member_email, _display_name: args.member_name, _role: args.member_role });
      } else {
        cid = await resolveCompany(sb, cid);
        await audit(sb, null, "onboarding", "company_view", cid, cid);
      }
      const [{ data: c, error }, { data: members }] = await Promise.all([
        sb.from("mcp_companies").select("name, agent_name, company_role, work_types, trades, tool_stack, decision_rights, default_flags").eq("id", cid!).maybeSingle(),
        sb.from("mcp_company_members").select("display_name, role").eq("company_id", cid!),
      ]);
      if (error) throw new Error(error.message);
      if (!c) throw new ToolError("Company not found.");
      const rights = (c.decision_rights ?? {}) as Record<string, string[]>;
      return {
        ...text(
          [
            args.action === "read" ? "Company profile:" : "Saved.",
            `Company: ${c.name} (company_id ${cid})`,
            `Agent name: ${c.agent_name}`,
            `Role: ${c.company_role ?? "unknown"} | Work types: ${(c.work_types ?? []).join(", ") || "unknown"} | Trades: ${(c.trades ?? []).join(", ") || "unknown"}`,
            `Tool stack: ${Object.entries((c.tool_stack ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join("; ") || "unknown"}`,
            `Decision rights: ${Object.entries(rights).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v.join(", ")}`).join("; ")}`,
            `Default applicability: ${Object.entries((c.default_flags ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join("; ") || "none"}`,
            `Members: ${(members ?? []).map((m) => `${m.display_name} (${m.role})`).join(", ")}`,
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
function triFrom(v: boolean | undefined): "yes" | "no" | "unknown" {
  return v === undefined ? "unknown" : v ? "yes" : "no";
}
function clauseFlag(v: string | undefined): "yes" | "no" | undefined {
  if (v === undefined || !v.trim()) return undefined;
  return /^(none|no|n\/a|not included)\.?$/i.test(v.trim()) ? "no" : "yes";
}

export const intake = defineTool({
  name: "intake",
  title: "Job setup intake",
  description:
    "Create a job (keyed by job number) and record its setup: job settings (time zone, PM), step 0 scoping, contract terms, contract deadlines, estimate handoff, budget and SOV, open items, or a two-week lookahead. Missing data is recorded as unknown, never guessed.",
  inputSchema: {
    section: z.enum(["create_job", "job_settings", "scope", "contract", "deadline", "handoff", "budget", "warranty", "open_item", "lookahead"]).describe("Which part of setup to record."),
    job_number: jobNumber,
    company_id: companyId,
    job_name: z.string().trim().max(200).optional().describe("create_job: job name."),
    restrict_to: z.array(z.string().trim().min(1).max(120)).max(30).optional().describe("create_job: member names who may see this job (leave out for all members)."),
    // Job settings
    time_zone: z.string().trim().max(60).optional().describe("job_settings: IANA time zone, e.g. America/Chicago. Deadlines are computed in it."),
    pm: z.string().trim().max(120).optional().describe("job_settings: member name to assign as the job's PM."),
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
    contract_document_provided: z.boolean().optional().describe("contract: true only if these terms were read from the contract (source document). Terms the member types in without it are kept and marked manual."),
    pay_terms: short("contract"), notice_timing: short("contract: notice deadline and clause, as written"), tia_timing: short("contract"),
    change_process: short("contract"), claim_process: short("contract"), retainage: short("contract: % and clause"),
    retainage_reduction: short("contract"), beneficial_use_clause: short("contract"), liquidated_damages: short("contract"),
    savings_split: short("contract"), closeout: short("contract"), warranty_clauses: short("contract"),
    // Warranty and closeout (job setup)
    workmanship_warranty: tri.optional().describe("warranty: is there a workmanship warranty?"),
    workmanship_warranty_months: z.number().int().min(0).max(240).optional().describe("warranty: how long the workmanship warranty runs, in months."),
    warranty_start_trigger: z.enum(["substantial_completion", "final_acceptance", "other"]).optional().describe("warranty: what starts the workmanship warranty."),
    warranty_start_trigger_other: short("warranty: describe the trigger when warranty_start_trigger is other"),
    warranty_trigger_date: date.optional().describe("warranty: the actual date of the trigger event, once it has happened. Leave out until then."),
    warranty_start_basis: short("warranty: what sets the warranty start date (clause or document)"),
    closeout_documents: short("warranty: required closeout documents (O&Ms, as-builts, etc.); \"unknown\" if not known"),
    punch_final_acceptance: short("warranty: punch list and final acceptance requirements"),
    manufacturer_warranties: short("warranty: manufacturer warranties to collect, or none"),
    // Handoff (C)
    sold_scope: short("handoff"), carried_scope: short("handoff"), exclusions: short("handoff"), allowances: short("handoff"), addenda: short("handoff"),
    concessions: short("handoff"), quantities: short("handoff"), production_rates: short("handoff"), crew_assumptions: short("handoff"), sub_qualifications: short("handoff"),
    gaps: z.array(gap).max(50).optional().describe("handoff: each gap becomes an open item with its named owner."),
    // Budget (F)
    budget_lines: z.array(budgetLine).max(300).optional().describe("budget: internal cost budget by cost code (internal only)."),
    sov_lines: z.array(sovLine).max(300).optional().describe("budget: owner SOV lines at billable value, with the cost codes each maps to."),
    // Open item
    action: short("open_item: what has to happen"), kind: z.enum(["general", "commercial", "warranty"]).optional(),
    commercial_type: z.enum(["co", "rea", "claim", "retainage"]).optional(), owner: short("open_item: accountable named person"), needed_by: date.optional(),
    cost_effect: short("open_item"), time_effect: short("open_item"), cash_effect: short("open_item"), effect_is_estimate: z.boolean().optional(),
    next_action: short("open_item"), next_action_approved_by: short("open_item"), internal_only: z.boolean().optional(),
    // Lookahead
    start_date: date.optional(), end_date: date.optional(),
    schedule_export: doc("lookahead: schedule export"), crews: doc("lookahead: crews/subs by day"), submittal_log: doc("lookahead: submittal log"),
    rfi_log: doc("lookahead: RFI log"), inspection_list: doc("lookahead: inspection list"), deliveries: doc("lookahead: deliveries list"),
  },
  annotations: { ...WRITE, idempotentHint: false },
  handler: (args, ctx) =>
    run("intake", ctx, undefined, async (sb) => {
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
        if (!args.time_zone && !args.pm) throw new ToolError("job_settings needs time_zone and/or pm.");
        const r = await rpc<{ time_zone: string | null; pm: string | null }>(sb, "mcp_job_settings", { _job: job.job_id, _time_zone: args.time_zone ?? null, _pm_name: args.pm ?? null });
        return { ...text(`${P}Job settings saved. Time zone: ${r.time_zone ?? "unknown"} | PM: ${r.pm ?? "unassigned"}`), structuredContent: { time_zone: r.time_zone, pm: r.pm } };
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
            owner: args.owner, source: args.contract_document_provided ? "document" : "member_answer",
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
          `${P}Step 0 scoping saved.\nRecorded: ${fr.known.join(", ") || "none"}\nUnknown: ${fr.unknown.join(", ") || "none"}\n\nApplicability flags:\n${(all ?? []).map((f) => `- ${f.flag_key.replace(/_/g, " ")}: ${f.value} (${f.source.replace(/_/g, " ")})`).join("\n")}\n${flagNote(r)}\n\nNext: intake section "contract", or next_question.`,
        );
      }

      if (args.section === "contract") {
        const fromDoc = args.contract_document_provided === true;
        const source = fromDoc ? "document" : "member_answer";
        const keys = ["pay_terms", "notice_timing", "tia_timing", "change_process", "claim_process", "retainage", "retainage_reduction", "beneficial_use_clause", "liquidated_damages", "savings_split", "closeout", "warranty_clauses"] as const;
        // Values the member gave are always kept: "document" when read from the contract, otherwise "manual"
        // (member_answer). Keys not given are never overwritten; they are recorded as unknown only the first time.
        const given: Record<string, string> = {};
        for (const k of keys) { const v = args[k]?.trim(); if (v) given[k] = v; }
        const { data: prior, error: priorErr } = await sb.from("mcp_job_facts").select("key").eq("job_id", job.job_id).eq("module", "contract");
        if (priorErr) throw new Error(priorErr.message);
        const had = new Set((prior ?? []).map((p) => p.key));
        const fill: Record<string, null> = {};
        for (const k of keys) if (!(k in given) && !had.has(k)) fill[k] = null;
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
          await settleFlagConfirms(sb, job);
        }
        const saved = Object.keys(given);
        return text(
          `${P}Contract terms saved${saved.length ? (fromDoc ? " from the contract (source: document)" : " as manual entries (source: manual)") : ""}.\n${!fromDoc && saved.length ? "These were entered by hand, not read from the contract. Confirm them against the contract when you have it.\n" : ""}Known: ${fr.known.join(", ") || "none"}\nUnknown: ${fr.unknown.join(", ") || "none"}${note ? `\n${note}` : ""}`,
        );
      }

      if (args.section === "warranty") {
        const facts: Record<string, unknown> = {};
        const put = (k: string, v: unknown) => { if (v !== undefined) facts[k] = typeof v === "string" ? v.trim() || null : v; };
        put("workmanship_warranty", args.workmanship_warranty);
        put("workmanship_warranty_months", args.workmanship_warranty_months);
        put("warranty_start_trigger", args.warranty_start_trigger);
        put("warranty_start_trigger_other", args.warranty_start_trigger_other);
        put("warranty_trigger_date", args.warranty_trigger_date);
        for (const k of ["warranty_start_basis", "closeout_documents", "punch_final_acceptance", "manufacturer_warranties"] as const) put(k, args[k]);
        const { data: prior, error: priorErr } = await sb.from("mcp_job_facts").select("key").eq("job_id", job.job_id).eq("module", "warranty");
        if (priorErr) throw new Error(priorErr.message);
        const had = new Set((prior ?? []).map((p) => p.key));
        for (const q of WARRANTY_SETUP_QUESTIONS) if (!(q.key in facts) && !had.has(q.key)) facts[q.key] = null;
        if (Object.keys(facts).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "warranty", _facts: facts, _source: "member_answer" });
        const { data: all, error: allErr } = await sb.from("mcp_job_facts").select("key, value, status, source").eq("job_id", job.job_id).eq("module", "warranty");
        if (allErr) throw new Error(allErr.message);
        const made: ItemResult[] = [];
        for (const it of warrantyOpenItems(all ?? [])) {
          made.push(await rpc<ItemResult>(sb, "mcp_add_item", {
            _job: job.job_id,
            _f: {
              check_key: it.check_key, action: it.action, item_type: it.item_type, kind: it.item_type === "unknown" ? "confirm_unknown" : "gap", section: "warranty", category: "Warranty",
              recommendation: it.recommendation ?? null, why: it.why ?? null, accountable: args.owner ?? null, needed_by: args.needed_by ?? null, source: "member_answer", tool: "intake",
            },
          }));
        }
        const today = new Date().toISOString().slice(0, 10);
        return {
          ...text(`${P}Warranty and closeout setup saved.\n\nWARRANTY REGISTER\n${renderWarrantyRegister(all ?? [], today).join("\n")}${made.map((m) => itemNote(m)).join("")}`),
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
        return text(`${P}Estimate-to-execution baseline saved (internal only).\nKnown: ${fr.known.join(", ") || "none"}\nUnknown: ${fr.unknown.join(", ") || "none"}\nGaps:\n${notes.join("\n") || "- none"}`);
      }

      if (args.section === "budget") {
        const budget: Record<string, unknown> = {};
        for (const b of args.budget_lines ?? []) budget[b.cost_code] = { description: b.description ?? null, amount: b.amount ?? null };
        const sov: Record<string, unknown> = {};
        for (const s of args.sov_lines ?? []) sov[s.line] = { description: s.description ?? null, billable_value: s.billable_value ?? null, cost_codes: s.cost_codes ?? [] };
        if (Object.keys(budget).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "budget", _facts: budget, _source: "member_answer" });
        if (Object.keys(sov).length) await rpc(sb, "mcp_set_facts", { _job: job.job_id, _module: "sov", _facts: sov, _source: "member_answer" });
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
          `${P}Budget and SOV saved. Budget is internal only.\nCost codes: ${codes.size} | SOV lines: ${sovRows.length}\nSOV lines not mapped to a cost code: ${unmappedLines.join(", ") || "none"}\nCost codes not on any SOV line: ${unmappedCodes.join(", ") || "none"}\nSOV codes missing from the budget: ${badRefs.join(", ") || "none"}${note}`,
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

      // lookahead
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
      return {
        ...text(
          `${P}Lookahead created.\nlookahead_id: ${la.id}\n\nProvided:\n${provided.map((k) => `- ${INPUT_LABELS[k as InputKey]}`).join("\n") || "- none"}\n\nMissing (recorded as unknown):\n${missing.map((k) => `- ${INPUT_LABELS[k]}`).join("\n") || "- none"}\n\nNext: next_question with this job_number and lookahead_id.`,
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
    await rpc(sb, "mcp_resolve_item", { _item: it.id, _kind: "member_statement", _evidence: `Answered: ${k.replace(/_/g, " ")} = ${v}.`, _stated_by: "member answer", _stated_on: new Date().toISOString().slice(0, 10),
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
    run("next_question", ctx, args.lookahead_id, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const P = prefix(job);
      if (args.lookahead_id) {
        const la = await lookaheadForJob(sb, job, args.lookahead_id);
        const { check, index, total } = await currentCheck(sb, la, "next_question");
        await audit(sb, job, "next_question", "view_lookahead_question", la.id);
        if (!check) return text(`${P}All lookahead checks are done. Call report with lookahead_id.`);
        const how = check.rule_type === "confirm" ? 'Answer with response "yes", "no" or "unknown".' : 'Answer with detail listing the items, or detail "none". Use response "unknown" if you don\'t know.';
        return {
          ...text(`${P}Question ${index} of ${total} [${check.trade} / ${check.category}]\ncheck_key: ${check.key}\n\n${check.prompt}\n\n${how}\nCall answer with job_number, lookahead_id and check_key.`),
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
          `${P}${auto}Setup question ${q.index} — ${q.total - q.index === 0 ? "last one" : `${q.total - q.index} more after this`}${q.label ? ` (${q.label})` : ""} [${q.category}${q.section ? ` / section ${q.section}` : ""}]\ncheck_key: ${q.key}\n\n${confirm ? `${q.prompt}\n${ask}` : ask}\n\nAnswer with response yes, no, na (with a reason in detail) or unknown. For unknown or no, add owner and due_date if known. To mark the whole section N/A use answer action "mark_na" with scope "section".`,
        ),
        structuredContent: { check_key: q.key, index: q.index, total: q.total, remaining_after: q.total - q.index, auto_answered: auto ? "job_number_assigned" : null },
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
    check_key: z.string().min(1).max(100).optional().describe("answer: check_key from next_question. mark_na/reenable with scope item: the check_key."),
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
    run("answer", ctx, args.lookahead_id, async (sb) => {
      capInput(args);
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
      if (!args.check_key) throw new ToolError("answer needs check_key from next_question.");

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

      if (!args.response) throw new ToolError("answer needs response yes, no, na or unknown.");
      // A "no" on the look-ahead check is not accepted: push back and offer to build one from the schedule.
      if (args.check_key === LOOKAHEAD_SETUP_KEY && args.response === "no" && args.lookahead_help !== "decline") {
        await audit(sb, job, "answer", args.lookahead_help === "accept" ? "lookahead_help_accepted" : "lookahead_no_pushback", args.check_key);
        if (args.lookahead_help === "accept")
          return { ...text(buildQuestionsText(P, job.job_number)), structuredContent: { recorded: null, lookahead_help: "accepted", questions: [...LOOKAHEAD_BUILD_QUESTIONS] } };
        return { ...text(pushbackText(P)), structuredContent: { recorded: null, lookahead_help: "offered", prompt: LOOKAHEAD_PUSHBACK } };
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
  description: "Render the fixed job setup report (internal or client-facing), or the two-week lookahead report when lookahead_id is given. Client-facing reports leave out internal cost and strategy detail.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    audience: z.enum(["internal", "client"]).optional().describe("Default internal."),
    lookahead_id: uuid.optional().describe("Only for a two-week lookahead report."),
  },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("report", ctx, args.lookahead_id, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (args.lookahead_id) {
        const la = await lookaheadForJob(sb, job, args.lookahead_id);
        await audit(sb, job, "report", "view_lookahead_report", la.id);
        return text(`${prefix(job)}${await renderReport(sb, la)}`);
      }
      const audience = args.audience ?? "internal";
      await audit(sb, job, "report", `view_setup_report_${audience}`, null);
      const body = await renderSetupReport(sb, job, audience);
      let iq = sb.from("mcp_open_items").select("id, section, check_key, item_type").eq("job_id", job.job_id).eq("status", "open");
      if (audience === "client") iq = iq.eq("internal_only", false);
      const [{ data: its }, nas] = await Promise.all([iq, activeNa(sb, job.job_id)]);
      return { ...text(body), structuredContent: { items: (its ?? []).map((i) => ({ item_id: i.id, item_type: itemType(i, nas) })) } };
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
    run("carry_forward", ctx, args.to_lookahead_id, async (sb) => {
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
      return {
        ...text(`${prefix(job)}${typed.length} open item(s) carried forward.${typed.map((i) => `\n- item ${i.item_id} (type ${i.item_type})`).join("")}\nNext: next_question for the new lookahead.`),
        structuredContent: { items: typed },
      };
    }),
});

// ---------- list_open_items ----------
export const listOpenItems = defineTool({
  name: "list_open_items",
  title: "List open items",
  description: "List a job's open items with accountable person, needed-by date, verified or last-reported status, source and effects. Items under an N/A section are labeled for disposition.",
  inputSchema: { job_number: jobNumber, company_id: companyId, lookahead_id: uuid.optional().describe("Limit to one lookahead.") },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("list_open_items", ctx, args.lookahead_id, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      let q = sb.from("mcp_open_items").select(ITEM_COLS).eq("job_id", job.job_id).eq("status", "open");
      if (args.lookahead_id) q = q.eq("lookahead_id", args.lookahead_id);
      const [{ data, error }, nas] = await Promise.all([q.order("needed_by", { nullsFirst: false }).limit(200), activeNa(sb, job.job_id)]);
      if (error) throw new Error(error.message);
      await audit(sb, job, "list_open_items", "view_open_items", null);
      if (!data?.length) return text(`${prefix(job)}No open items.`);
      const lines = (data as unknown as Parameters<typeof itemLine>[0][]).map((it) => `- ${itemLine(it, nas, job.scope !== "full")}`);
      const rows = data as unknown as Parameters<typeof itemLine>[0][];
      return { ...text(`${prefix(job)}Open items (${data.length}):\n${lines.join("\n")}`), structuredContent: { items: rows.map((i) => ({ item_id: i.id, item_type: itemType(i, nas) })) } };
    }),
});

// ---------- resolve_item ----------
export const resolveItem = defineTool({
  name: "resolve_item",
  title: "Resolve or update an open item",
  description:
    "Close an open item with evidence, close a confirm item with a dated statement, waive it (decision right and reason required), close a commercial item on approval + billing + collection, or record a last-reported status update. N/A is not a resolution.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    item_id: uuid.describe("Open item id."),
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
    run("resolve_item", ctx, undefined, async (sb) => {
      capInput(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "write");
      const { data: it, error } = await sb.from("mcp_open_items").select("id, job_id, section, check_key, item_type").eq("id", args.item_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!it || it.job_id !== job.job_id) throw new ToolError(`Item not found on job ${job.job_number}.`);
      // Closing needs real evidence: a document, a dated who-said-what statement, or an explicit waiver.
      if ((args.kind === "verified" || args.kind === "member_statement") && isVagueEvidence(args.evidence)) {
        await audit(sb, job, "resolve_item", "close_rejected_no_evidence", args.item_id);
        return { ...text(`${prefix(job)}${EVIDENCE_ASK}`), structuredContent: { item_id: args.item_id, item_type: itemType(it, await activeNa(sb, job.job_id)), closed: false } };
      }
      // Statements are attributed to the calling user (name and role) unless the member named who said it.
      const me = await callerLabel(sb, job, ctx.getUserId?.());
      const statedBy = args.kind === "member_statement" || args.kind === "update" ? (args.stated_by?.trim() || me) : args.stated_by ?? null;
      const evidence = args.kind === "member_statement" && args.evidence ? `${args.evidence.trim()} (recorded by ${me})` : args.evidence ?? null;
      const r = await rpc<{ closed: boolean; resolution?: string }>(sb, "mcp_resolve_item", {
        _item: args.item_id, _kind: args.kind, _evidence: evidence, _stated_by: statedBy, _stated_on: args.stated_on ?? null,
        _reason: args.reason ?? null, _approval: args.approval ?? null, _billing: args.billing ?? null, _collection: args.collection ?? null,
      });
      const t = itemType(it, await activeNa(sb, job.job_id));
      const msg = r.closed ? `${prefix(job)}Item ${args.item_id} (type ${t}) closed (${r.resolution}). Evidence and history kept.` : `${prefix(job)}Item ${args.item_id} updated (last reported by ${statedBy}). Still open.`;
      return { ...text(msg), structuredContent: { item_id: args.item_id, item_type: t, closed: r.closed } };
    }),
});
