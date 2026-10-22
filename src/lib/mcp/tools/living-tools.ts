// 0.8.9: cpm_activities (full activity handoff), living_report_get and living_report_save (master copy per job).
import { readDelay, ganttPins, noteDateConflicts, pageLine, payAppView, emptyCard, type Billing } from "../styled-views";
import { signedJobPages } from "../board-url";
import { pageUrl } from "../../report-pages";
import { IOR_VIEW_SPEC, PAY_APP_VIEW_SPEC, PORTFOLIO_VIEW_SPEC } from "../views";
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { renderHtml } from "../cards/html";
import { htmlBlock, renderMarkdown } from "../cards/markdown";
import { jobBoardCard } from "./report-page-tools";
import { PERMANENT_LINK_ASK, type ReportPage } from "../../report-pages";

/** Which saved page a living report maps to (0.8.14). Dashboard → company portfolio is offered separately. */
const pageFor = (type: string, scope: string | undefined): ReportPage | null =>
  type === "cpm" && (scope === "full" || scope === "super") ? "schedule" : type === "ior" && scope === "full" ? "ior" : null;

function boardCardText(jobLabel: string, links: { label: string; href: string }[]): string {
  if (!links.length) return "";
  const card = jobBoardCard(jobLabel, links);
  return `${renderMarkdown(card)}\n\n${htmlBlock(renderHtml(card))}`;
}
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

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const READ = { readOnlyHint: true, openWorldHint: false } as const;
// Ask-first: ChatGPT and Claude confirm destructive tools with the member before calling.
const SAVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const reportType = z.enum(LIVING_REPORT_TYPES);

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
  owner_furnished: z.boolean().optional(),
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
  description: "Returns the saved CPM activities for a job.",
  inputSchema: { job_number: jobNumber, company_id: companyId, version: z.number().int().min(1).optional() },
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
      const delay = readDelay(data as Record<string, unknown>);
      const of = acts.filter(isOwnerFurnished);
      const ofValued = ownerFurnishedWithValue(acts);
      const scheduleBoard = await signedJobPages((fn, a) => sb.rpc(fn, a), job.job_id, job.scope);
      const lines = [
        ...(scheduleBoard.schedule ? [pageLine("schedule", scheduleBoard.schedule)] : []),
        CPM_REQUIRED_TOP,
        `${prefix(job)}${job.name} · ${LIVING_LABEL.cpm} ${stamp(g)}`,
        `Contract completion: ${g.contract_completion_date ?? "Needed"}`,
        `Count check: ${showMoney ? count.line : `${count.dated} of ${count.expected} activities dated.`}${count.complete ? "" : ` Missing dates: ${count.missing.join(", ")}.`}`,
        ...(tie ? [`Tie: ${tie.line}`] : []),
        ...CPM_GANTT_SPEC,
        ...(showMoney && of.length ? [`Owner-furnished (schedule-only, $0.00 in ALP billing): ${of.map((a) => a.id).join(", ")}.${ofValued.length ? ` Saved with a value that is excluded here: ${ofValued.map((a) => `${a.id} ${money(a.value ?? 0)}`).join(", ")}.` : ""}`] : []),
        ...(showMoney ? [`Earned to date: ${money(earnedToDate(acts))}`] : []),
        ...(delay ? [delay.line] : tia ? [`Delay fragnet result (${tia.fragnet}): ${tia.math} ${tia.statement}`] : []),
        ...ganttPins(delay),
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
            delay,
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
  description: "Returns the saved living report for a job.",
  inputSchema: { job_number: jobNumber, company_id: companyId, report_type: reportType, version: z.number().int().min(1).optional() },
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
      const board = await signedJobPages((fn, a) => sb.rpc(fn, a), job.job_id, job.scope);
      const payappUrl = board.payapp ?? null;
      const iorUrl = board.ior ?? null;
      const scheduleUrl = board.schedule ?? null;
      if (!g.found && type === "billing_forecast" && job.scope === "full") {
        // 0.8.17: styled empty pay-app card with the hosted page and a Next move.
        return guide(
          { ...text(`${prefix(job)}${emptyCard("pay_app", `${job.job_number} – ${job.name}`, "Send the billed-to-date figure and the latest pay app; Athena builds the forecast from the saved schedule, ties it to the contract, and saves it as version 1 after the PM approves.", ["Billed to date", "Latest pay app (SOV lines)"], payappUrl)}`), structuredContent: { found: false, report_type: type, version: 0 } },
          `Nothing saved: build the ${label} from Athena's data, mark it "Draft: not saved", and after the PM says yes call living_report_save with base_version 0.`,
        );
      }
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
      const boardLinks = [
        ...(board.items ? [{ label: "Open items", href: board.items }] : []),
        ...(iorUrl ? [{ label: "Open IOR", href: iorUrl }] : []),
        ...(scheduleUrl ? [{ label: "Open schedule", href: scheduleUrl }] : []),
      ];
      const linkCard = type === "ior" || type === "cpm" ? boardCardText(`${job.job_number} – ${job.name}`, boardLinks) : "";
      return guide(
        {
          ...text([...(type === "billing_forecast" && job.scope === "full" ? [payAppView({ title: `${job.job_number} – ${job.name}`, version: g.version, dataDate: g.data_date ?? null, billing: (data as { billing?: Billing }).billing ?? null, contract, pageUrl: payappUrl }), "", "---"] : []), ...(linkCard ? [linkCard] : type === "dashboard" && job.scope === "full" ? [pageLine("portfolio dashboard", pageUrl("portfolio", job.company_id))] : []), LIVING_REQUIRED_TOP, `${prefix(job)}${job.name} · ${label}`, stamp(g), ...(tie ? [`Tie: ${tie.line}`] : []), ...(type === "cpm" ? [...CPM_GANTT_SPEC, ...(readDelay(data as Record<string, unknown>) ? [readDelay(data as Record<string, unknown>)!.line] : []), ...ganttPins(readDelay(data as Record<string, unknown>))] : []), ...(type === "billing_forecast" && job.scope === "full" ? PAY_APP_VIEW_SPEC : []), ...(type === "ior" && job.scope === "full" ? IOR_VIEW_SPEC : []), ...(type === "dashboard" && job.scope === "full" ? PORTFOLIO_VIEW_SPEC : []), "", "Change log (latest 5):", ...(log.length ? log : ["- None yet."])].join("\n")),
          structuredContent: { found: true, report_type: type, version: g.version, data_date: g.data_date ?? null, updated_at: g.updated_at ?? null, updated_by: g.updated_by_name ?? null, contract_completion_date: g.contract_completion_date ?? null, tie, data: data as never, change_log: g.change_log ?? [], no_financials: job.scope !== "full", board_links: boardLinks },
        },
        `Say "Picked up v${g.version}${g.updated_by_name ? `, last updated by ${g.updated_by_name}` : ""}." For a view-only ask, build a NEW private view or artifact from structuredContent.data in the same layout; never update or replace the saved shared master or an existing shared artifact. Only when the user explicitly asks to update or save it, confirm first, then to save the update ask "${LIVING_SAVE_ASK}" and only after a yes call living_report_save with base_version ${g.version}.`,
        ...(pageFor(type, job.scope) ? [`After you show the ${label}, ask once: "${PERMANENT_LINK_ASK}" On a yes, call report_page_link for page items and for page ${pageFor(type, job.scope)}. Show each link as its own card. Never make a share link unless they ask.`] : []),
      );
    }),
});

// ---------- living_report_save ----------
export const livingReportSave = defineTool({
  name: "living_report_save",
  title: "Save living report version (after approval)",
  description: "Saves a new version of a living report after approval.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    report_type: reportType,
    base_version: z.number().int().min(0),
    approved: z.literal(true),
    data_date: date.optional(),
    what_changed: z.string().trim().min(1).max(500),
    why: z.string().trim().max(500).optional(),
    activities: z.array(activity).max(400).optional(),
    billing: z.object({ billed_to_date: z.number().min(0).nullable().optional(), months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), amount: z.number(), kind: z.enum(["actual", "forecast"]) })).max(120) }).optional(),
    tia: z.object({ fragnet: z.string().trim().min(1).max(40), prior_completion: date, updated_completion: date, fragnet_only_completion: date.nullable().optional() }).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    contract_completion_date: date.optional(),
    replace_completion_date: z.boolean().optional(),
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
      // 0.8.17: a save note can't name a different date for a saved milestone (2701 v3 said Sep 30 / Jul 27; saved Sep 16 / Jul 13).
      const savedCompletion = args.replace_completion_date === true ? args.contract_completion_date ?? null : prev.contract_completion_date ?? args.contract_completion_date ?? null;
      const clash = noteDateConflicts(`${args.what_changed}\n${args.why ?? ""}`, savedCompletion, (acts ?? []) as never);
      if (clash.length) {
        await audit(sb, job, "living_report_save", `living_${type}_refused`, null);
        throw new ToolError(`${prefix(job)}Not saved. The change note doesn't match the saved dates:\n${clash.map((p) => `- ${p}`).join("\n")}\nUse the saved dates in the note (or confirm a date change with the PM first).`);
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
        ...(pageFor(type, job.scope) ? [`Then ask once: "${PERMANENT_LINK_ASK}" On a yes, call report_page_link for page items and for page ${pageFor(type, job.scope)}. Show each link as its own card.`] : []),
      );
    }),
});

