// 0.8.9: cpm_activities (full activity handoff), living_report_get and living_report_save (master copy per job).
import { IOR_VIEW_SPEC, PAY_APP_VIEW_SPEC, PORTFOLIO_VIEW_SPEC } from "../views";
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, READ_ONLY_MESSAGE, audit, prefix, resolveJob, type Job } from "../jobs";
import { SovMismatch, buildSov, money } from "../sov";
import { guide } from "../visible";
import {
  CPM_REQUIRED_TOP, LIVING_LABEL, LIVING_REPORT_TYPES, LIVING_REQUIRED_TOP, LIVING_SAVE_ASK, TIED_TYPES,
  activityLine, checkSave, costLoadTotal, countCheck, earnedToDate, isOwnerFurnished, ownerFurnishedWithValue, stripMoney, tieCheck, tiaResult,
  type Activity, type LivingData, type LivingReportType,
  CPM_GANTT_SPEC,
} from "../living";

const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company. Pass the company name exactly as Athena lists it.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const READ = { readOnlyHint: true, openWorldHint: false } as const;
// Ask-first: ChatGPT and Claude confirm destructive tools with the member before calling.
const SAVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const reportType = z.enum(LIVING_REPORT_TYPES).describe("cpm (cost-loaded CPM), billing_forecast, ior or dashboard.");

const activity = z.object({
  id: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(160),
  duration: z.number().int().min(0).max(5000).nullable(),
  start: date.nullable(),
  finish: date.nullable(),
  predecessors: z.array(z.object({ id: z.string().trim().min(1).max(20), type: z.enum(["FS", "SS", "FF", "SF"]).optional(), lag: z.number().int().min(-999).max(999).optional() })).max(20),
  total_float: z.number().int().min(-5000).max(5000).nullable(),
  critical: z.boolean().nullable(),
  pct_complete: z.number().min(0).max(100).nullable(),
  value: z.number().min(0).nullable(),
  sov_line: z.string().trim().max(20).nullable(),
  cost_code: z.string().trim().max(20).nullable(),
  owner_furnished: z.boolean().optional().describe("true for owner-furnished work (schedule-only, $0.00 in ALP billing)."),
});

type Got = {
  found: boolean; version?: number; status?: string; data_date?: string | null; updated_at?: string; updated_by_name?: string | null;
  activity_count?: number | null; contract_total?: number | null; forecast_total?: number | null; data?: LivingData;
  change_log?: { version: number; at: string; who: string | null; what: string; why: string | null }[]; contract_completion_date?: string | null; scope?: string;
};

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

const getReport = (sb: Sb, job: Job, type: LivingReportType, version?: number) =>
  rpc<Got>(sb, "mcp_living_report_get", { _job: job.job_id, _type: type, _version: version ?? null });

/** The contract value is the saved SOV contract sum (server-built); null when the SOV can't be built yet. */
export async function contractTotal(sb: Sb, job: Job): Promise<number | null> {
  const [jr, facts] = await Promise.all([
    sb.from("mcp_jobs").select("sov_fee_pct").eq("id", job.job_id).maybeSingle(),
    sb.from("mcp_job_facts").select("key, value").eq("job_id", job.job_id).eq("module", "sov"),
  ]);
  if (jr.error || facts.error) return null;
  const lines = ((facts.data ?? []) as { key: string; value: unknown }[]).map((f) => {
    const v = (f.value ?? {}) as { description?: string | null; billable_value?: number | null };
    return { item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null };
  });
  const fee = jr.data?.sov_fee_pct == null ? null : Number(jr.data.sov_fee_pct);
  try {
    return buildSov(lines, fee, null).summary.contract_total;
  } catch (e) {
    if (e instanceof SovMismatch) return null;
    throw e;
  }
}

async function whoAmI(sb: Sb, job: Job, userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await sb.from("mcp_company_members").select("display_name, role").eq("company_id", job.company_id).eq("user_id", userId).maybeSingle();
  return data ? `${data.display_name} (${data.role === "pm" ? "PM" : data.role === "all_access" ? "All-access" : String(data.role).charAt(0).toUpperCase() + String(data.role).slice(1)})` : null;
}

const stamp = (g: Got) => `Version v${g.version} · Last updated ${g.updated_at ? new Date(g.updated_at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "Needed"}${g.updated_by_name ? `, ${g.updated_by_name}` : ""} · Data date ${g.data_date ?? "Needed"}`;
const logLines = (g: Got) => (g.change_log ?? []).slice(0, 5).map((c) => `- v${c.version} · ${c.at.slice(0, 10)} · ${c.who ?? "member"} · ${c.what}${c.why ? ` (why: ${c.why})` : ""}`);

// ---------- cpm_activities ----------
export const cpmActivities = defineTool({
  name: "cpm_activities",
  title: "Full CPM activity list",
  description:
    "REQUIRED: call this before drawing or updating any cost-loaded CPM, billing forecast, billing drill-down, coaching, IOR or dashboard. Returns every saved activity on the job (ID, name, duration, start/finish, predecessors and logic, total float, critical flag, % complete, $ value, SOV line, cost code), the count check (e.g. 39 of 39), the tie to the contract, the ONE saved contract completion date and the computed delay (TIA) result. Use these values exactly; never recompute, rebuild from an earlier chat, or guess them. Owner-furnished activities are $0.00 in ALP billing. Supers get the schedule with no dollars.",
  inputSchema: { job_number: jobNumber, company_id: companyId, version: z.number().int().min(1).optional().describe("A past CPM version to view; default the latest saved one.") },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("cpm_activities", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (job.scope === "contract") throw new ToolError(FULL_ACCESS_MESSAGE);
      const showMoney = job.scope === "full";
      const g = await getReport(sb, job, "cpm", args.version);
      await audit(sb, job, "cpm_activities", "view_cpm_activities", null);
      if (!g.found) {
        return guide(
          { ...text(`${prefix(job)}No approved CPM is saved for this job yet, so there's no activity list to hand over. Contract completion: ${g.contract_completion_date ?? "Needed"}.\nBuild and approve the baseline first, then save it as version 1.`), structuredContent: { found: false, activities: [], contract_completion_date: g.contract_completion_date ?? null } },
          "No saved CPM: follow the no-schedule flow, then after the PM approves the baseline call living_report_save with report_type cpm and base_version 0. Never draw a CPM or billing split from an earlier chat.",
        );
      }
      const data = showMoney ? (g.data ?? {}) : stripMoney(g.data ?? {});
      const acts = (data.activities ?? []) as Activity[];
      const count = countCheck(acts, Math.max(acts.length, g.activity_count ?? 0));
      const contract = showMoney ? await contractTotal(sb, job) : null;
      const tie = showMoney ? tieCheck(costLoadTotal(acts), contract) : null;
      const tia = tiaResult(data.tia ?? null);
      const of = acts.filter(isOwnerFurnished);
      const ofValued = ownerFurnishedWithValue(acts);
      const lines = [
        CPM_REQUIRED_TOP,
        `${prefix(job)}${job.name} · ${LIVING_LABEL.cpm} ${stamp(g)}`,
        `Contract completion: ${g.contract_completion_date ?? "Needed"}`,
        `Count check: ${showMoney ? count.line : `${count.dated} of ${count.expected} activities dated.`}${count.complete ? "" : ` Missing dates: ${count.missing.join(", ")}.`}`,
        ...(tie ? [`Tie: ${tie.line}`] : []),
        ...CPM_GANTT_SPEC,
        ...(showMoney && of.length ? [`Owner-furnished (schedule-only, $0.00 in ALP billing): ${of.map((a) => a.id).join(", ")}.${ofValued.length ? ` Saved with a value that is excluded here: ${ofValued.map((a) => `${a.id} ${money(a.value ?? 0)}`).join(", ")}.` : ""}`] : []),
        ...(showMoney ? [`Earned to date: ${money(earnedToDate(acts))}`] : []),
        ...(tia ? [`Delay fragnet result (${tia.fragnet}): ${tia.math} ${tia.statement}`] : []),
        "",
        `Activities (${acts.length}):`,
        ...acts.map((a) => activityLine(a, showMoney)),
      ];
      return guide(
        {
          ...text(lines.join("\n")),
          structuredContent: {
            found: true,
            version: g.version, data_date: g.data_date ?? null, updated_at: g.updated_at ?? null, updated_by: g.updated_by_name ?? null,
            contract_completion_date: g.contract_completion_date ?? null,
            count_check: count,
            tie,
            contract_total: contract, contract_total_display: contract === null ? null : money(contract),
            earned_to_date: showMoney ? earnedToDate(acts) : null,
            tia,
            owner_furnished: of.map((a) => a.id),
            no_financials: !showMoney,
            activities: acts.map((a) => ({ ...a, owner_furnished: isOwnerFurnished(a), billable_value: showMoney ? (isOwnerFurnished(a) ? 0 : a.value) : null })),
          },
        },
        "View-only asks (e.g. \"pull up the schedule\"): build a NEW private view or artifact; never update or replace the saved shared master or an existing shared artifact unless the user explicitly asks to update or save it, and confirm first. Use structuredContent.activities, count_check, tie, contract_completion_date and tia exactly. Split billing by each activity's working days from these dates; never invent a date, duration, float or dollar figure. Remaining forecast after a % complete or pay app update = contract − the higher of billed and earned to date, spread over open activities; never add earned dollars on top of the old remaining spread.",
        showMoney ? "" : "Super view: no dollars. Never show or estimate any $ value, billing or forecast.",
      );
    }),
});

// ---------- living_report_get ----------
export const livingReportGet = defineTool({
  name: "living_report_get",
  title: "Living report master copy",
  description:
    "REQUIRED: call this before updating a cost-loaded CPM, billing forecast, IOR or PM dashboard, and when a new chat picks one up. Returns the saved master copy (latest or a named version) with its version, last-updated stamp, data date, data and change log. Viewing: build a new private view from it and never change the saved master. Updating (only when the user explicitly asks, after confirming): update that copy in place; never start a second saved one. Supers: CPM only, no dollars.",
  inputSchema: { job_number: jobNumber, company_id: companyId, report_type: reportType, version: z.number().int().min(1).optional().describe("A past version (for v6 vs v7 or a rollback view); default the latest.") },
  annotations: { ...READ, idempotentHint: true },
  handler: (args, ctx) =>
    run("living_report_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const type = args.report_type as LivingReportType;
      if (job.scope === "super" && type !== "cpm") throw new ToolError(READ_ONLY_MESSAGE);
      if (job.scope === "contract") throw new ToolError(FULL_ACCESS_MESSAGE);
      const g = await getReport(sb, job, type, args.version);
      await audit(sb, job, "living_report_get", `view_living_${type}`, null);
      const label = LIVING_LABEL[type];
      if (!g.found) {
        return guide(
          { ...text(`${prefix(job)}No saved ${label} for this job yet. Build it once, then save it as version 1 after the PM approves.`), structuredContent: { found: false, report_type: type, version: 0 } },
          `Nothing saved: build the ${label} from Athena's data, mark it "Draft: not saved", and after the PM says yes call living_report_save with base_version 0.`,
        );
      }
      const data = job.scope === "full" ? g.data ?? {} : stripMoney(g.data ?? {});
      const contract = job.scope === "full" && TIED_TYPES.includes(type) ? await contractTotal(sb, job) : null;
      const ft = g.forecast_total ?? null;
      const tie = job.scope === "full" && TIED_TYPES.includes(type) && ft !== null ? tieCheck(Number(ft), contract) : null;
      const log = logLines(g);
      return guide(
        {
          ...text([LIVING_REQUIRED_TOP, `${prefix(job)}${job.name} · ${label}`, stamp(g), ...(tie ? [`Tie: ${tie.line}`] : []), ...(type === "billing_forecast" && job.scope === "full" ? PAY_APP_VIEW_SPEC : []), ...(type === "ior" && job.scope === "full" ? IOR_VIEW_SPEC : []), ...(type === "dashboard" && job.scope === "full" ? PORTFOLIO_VIEW_SPEC : []), "", "Change log (latest 5):", ...(log.length ? log : ["- None yet."])].join("\n")),
          structuredContent: { found: true, report_type: type, version: g.version, data_date: g.data_date ?? null, updated_at: g.updated_at ?? null, updated_by: g.updated_by_name ?? null, contract_completion_date: g.contract_completion_date ?? null, tie, data: data as never, change_log: g.change_log ?? [], no_financials: job.scope !== "full" },
        },
        `Say "Picked up v${g.version}${g.updated_by_name ? `, last updated by ${g.updated_by_name}` : ""}." For a view-only ask, build a NEW private view or artifact from structuredContent.data in the same layout; never update or replace the saved shared master or an existing shared artifact. Only when the user explicitly asks to update or save it, confirm first, then to save the update ask "${LIVING_SAVE_ASK}" and only after a yes call living_report_save with base_version ${g.version}.`,
      );
    }),
});

// ---------- living_report_save ----------
export const livingReportSave = defineTool({
  name: "living_report_save",
  title: "Save living report version (after approval)",
  description:
    "REQUIRED: ask the PM first and call this only after they say yes to this exact update. Saves a new version of the job's cost-loaded CPM, billing forecast, IOR or PM dashboard as the master copy, with what changed and why. Athena refuses the save if any activity is dropped, an activity is undated, or (CPM and billing forecast) the total doesn't equal the contract to the cent. Owner-furnished work is $0.00 in ALP billing. Full job access only.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    report_type: reportType,
    base_version: z.number().int().min(0).describe("The version you loaded with living_report_get (0 for the first save)."),
    approved: z.literal(true).describe("true only after the PM said yes to saving this exact update."),
    data_date: date.optional().describe("The update's data date."),
    what_changed: z.string().trim().min(1).max(500).describe("One line: what changed since the last version."),
    why: z.string().trim().max(500).optional().describe("Why it changed."),
    activities: z.array(activity).max(400).optional().describe("The FULL activity list (every activity, none dropped). Required for cpm."),
    billing: z.object({ billed_to_date: z.number().min(0).nullable().optional(), months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), amount: z.number(), kind: z.enum(["actual", "forecast"]) })).max(120) }).optional().describe("Billing forecast: every month, billed actuals and forecast. Months must total the contract."),
    tia: z.object({ fragnet: z.string().trim().min(1).max(40).describe("The delay fragnet ID, e.g. FRAG-01."), prior_completion: date, updated_completion: date, fragnet_only_completion: date.nullable().optional().describe("Completion with only this delay fragnet inserted.") }).optional().describe("cpm: the delay fragnet analysis dates from the forward pass."),
    details: z.record(z.string(), z.unknown()).optional().describe("ior items or dashboard KPIs, as given."),
    contract_completion_date: date.optional().describe("cpm: the contract completion date. Saved once per job."),
    replace_completion_date: z.boolean().optional().describe("true only when the PM confirmed changing the saved contract completion date."),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("living_report_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.approved !== true) throw new ToolError("Ask the PM to approve this update first. Nothing was saved.");
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const type = args.report_type as LivingReportType;
      if (type === "cpm" && !args.activities?.length) throw new ToolError("Send the full activity list to save the CPM. Nothing was saved.");
      const prev = await getReport(sb, job, type);
      if ((prev.found ? prev.version! : 0) !== args.base_version)
        throw new ToolError(`This report changed since you loaded it (now v${prev.found ? prev.version : 0}). Load the latest version and update that one. Nothing was saved.`);
      // Carry the activity list forward when a non-CPM report doesn't resend it, so no save can drop activities silently.
      let acts = args.activities as Activity[] | undefined;
      if (!acts && TIED_TYPES.includes(type)) {
        const cpm = type === "cpm" ? prev : await getReport(sb, job, "cpm");
        acts = cpm.found ? ((cpm.data?.activities ?? []) as Activity[]) : undefined;
      }
      const next: LivingData = { ...(args.details ?? {}), ...(acts ? { activities: acts } : {}), ...(args.billing ? { billing: args.billing } : {}), ...(args.tia ? { tia: args.tia } : {}) };
      const contract = await contractTotal(sb, job);
      const chk = checkSave(type, next, prev.found ? prev.data ?? null : null, contract);
      if (!chk.ok) {
        await audit(sb, job, "living_report_save", `living_${type}_refused`, null);
        throw new ToolError(`${prefix(job)}Not saved. ${LIVING_LABEL[type]} stays at v${prev.found ? prev.version : 0}.\n${chk.problems.map((p) => `- ${p}`).join("\n")}`);
      }
      const who = await whoAmI(sb, job, ctx.getUserId?.());
      const r = await rpc<{ id: string; version: number }>(sb, "mcp_living_report_save", {
        _job: job.job_id, _type: type, _base_version: args.base_version, _data: next, _data_date: args.data_date ?? null,
        _activity_count: acts?.length ?? null, _contract_total: contract, _forecast_total: chk.forecast_total,
        _what: args.what_changed, _why: args.why ?? null, _who: who, _completion: args.contract_completion_date ?? null, _replace_completion: args.replace_completion_date === true,
      });
      await audit(sb, job, "living_report_save", `save_living_${type}`, r.id);
      return guide(
        {
          ...text([`${prefix(job)}${LIVING_LABEL[type]} saved as v${r.version}.`, `What changed since v${args.base_version}: ${args.what_changed}`, ...(chk.count ? [`Count check: ${chk.count.line}`] : []), ...(chk.tie ? [`Tie: ${chk.tie.line}`] : [])].join("\n")),
          structuredContent: { saved: true, report_type: type, version: r.version, count_check: chk.count, tie: chk.tie },
        },
        `Update the view's header to v${r.version} with the Last updated stamp and remove "Draft: not saved".`,
      );
    }),
});
