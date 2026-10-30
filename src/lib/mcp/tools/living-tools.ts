import { assertScheduleCompany } from "../schedule-job";
import { scheduleActivity, scheduleRequest } from "../schedule-schema";
import { prepareSchedule, readScheduleControl, schedulePortfolio, controlledTiaResult, ScheduleInputError } from "../schedule-control";
import { safeBillingView } from "../billing-semantics";
import {loadJobSourceClauses} from "../source-clauses";
import {clauseKinds} from "../literal-clauses";
import { billingForecastCardModel, presentPayApp } from "../pay-app-card";
// 0.8.9: cpm_activities (full activity handoff), living_report_get and living_report_save (master copy per job).
import { readDelay, identifiedDelayActivityId, ganttPins, noteDateConflicts, pageLine, payModel, type Billing } from "../styled-views";
import { PayAppMismatch, buildFieldPayApp, progressByItem } from "../superintendent";
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
import { FULL_ACCESS_MESSAGE, READ_ONLY_MESSAGE, audit, named, prefix, resolveJob, type Job } from "../jobs";
import { SovMismatch, buildSov, money, retainagePct } from "../sov";
import { guide } from "../visible";
import { cedarOutcome } from "../../ior-outcome";
import {
  CPM_REQUIRED_TOP, LIVING_LABEL, LIVING_REPORT_TYPES, LIVING_REQUIRED_TOP, LIVING_SAVE_ASK, TIED_TYPES,
  activityLine, checkSave, costLoadTotal, countCheck, draftBillingFromSchedule, earnedToDate, iorSectionsText, isOwnerFurnished, ownerFurnishedWithValue, reportCalendarHolidays, resolveDataDate, retainageStepDownLines, stripMoney, tieCheck, tiaResult,
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

const activity = scheduleActivity;

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
    const v = (f.value ?? {}) as { executed_change_order?: string; fee_included?: boolean; description?: string | null; billable_value?: number | null };
    return { executed_change_order: v.executed_change_order, fee_included: v.fee_included, item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null };
  });
  const fee = jr.data?.sov_fee_pct == null ? null : Number(jr.data.sov_fee_pct);
  try {
    return buildSov(lines, fee, null).summary.contract_total;
  } catch (e) {
    if (e instanceof SovMismatch) return null;
    throw e;
  }
}

const ITEM_NO = /^\d{2}\.\d{2,3}$/;

/** Reported earned work from dailies; this is not an issued invoice or payment. */
async function reportedDailyEarned(sb: Sb, job: Job, retainageTerm: string | null): Promise<number | null> {
  const [jobRes, factsRes, daysRes, linesRes] = await Promise.all([
    sb.from("mcp_jobs").select("sov_fee_pct").eq("id", job.job_id).maybeSingle(),
    sb.from("mcp_job_facts").select("key, value, module").eq("job_id", job.job_id),
    sb.from("mcp_daily_reports").select("id, report_date").eq("job_id", job.job_id),
    sb.from("mcp_daily_work_lines").select("daily_id, sov_item, qty, pct_complete").eq("job_id", job.job_id),
  ]);
  if (jobRes.error || factsRes.error || daysRes.error || linesRes.error) return null;
  const facts = (factsRes.data ?? []) as { key: string; value: unknown; module?: string }[];
  const lines = facts
    .filter((f) => f.module === "sov" && ITEM_NO.test(f.key))
    .map((f) => {
      const v = (f.value ?? {}) as { executed_change_order?: string; fee_included?: boolean; description?: string | null; billable_value?: number | null };
      return { executed_change_order: v.executed_change_order, fee_included: v.fee_included, item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null };
    });
  if (!lines.length) return null;
  const dateOf = new Map(((daysRes.data ?? []) as { id: string; report_date: string }[]).map((d) => [d.id, d.report_date]));
  const saved = ((linesRes.data ?? []) as { daily_id: string; sov_item: string; qty: number | null; pct_complete: number | null }[])
    .map((line) => ({
      sov_item: line.sov_item,
      qty: line.qty == null ? null : Number(line.qty),
      pct_complete: line.pct_complete == null ? null : Number(line.pct_complete),
      report_date: dateOf.get(line.daily_id) ?? "",
    }))
    .filter((line) => line.report_date);
  if (!saved.length) return null;
  const period = saved.map((line) => line.report_date).sort().at(-1)!;
  const feeRaw = (jobRes.data as { sov_fee_pct?: number | null } | null)?.sov_fee_pct;
  const fee = feeRaw == null ? null : Number(feeRaw);
  try {
    const progress = progressByItem(saved, [], period);
    if (!lines.every((line) => progress.some((item) => item.item_no === line.item_no && item.pct != null))) return null;
    return buildFieldPayApp(lines, fee != null && Number.isFinite(fee) ? fee : null, retainagePct(retainageTerm), progress, []).completed_and_stored;
  } catch (e) {
    if (e instanceof PayAppMismatch) return null;
    throw e;
  }
}

/** Unsaved billing forecast from the cost-loaded schedule, the contract, and the latest pay app. */
async function unsavedBillingDraft(
  sb: Sb,
  job: Job,
  contract: number,
): Promise<{ billing: Billing; retainageTerm: string | null } | null> {
  const [cpm, factsRes] = await Promise.all([
    getReport(sb, job, "cpm"),
    sb.from("mcp_job_facts").select("key, value, module").eq("job_id", job.job_id),
  ]);
  if (factsRes.error) return null;
  const facts = (factsRes.data ?? []) as { key: string; value: unknown; module?: string }[];
  const retainageFact = facts.find((f) => f.key === "retainage" && (f.module == null || f.module === "contract"));
  const retainageTerm = typeof retainageFact?.value === "string" ? retainageFact.value : null;
  const acts = (cpm.found ? (cpm.data?.activities ?? []) : []) as Activity[];
  const dailyEarned = await reportedDailyEarned(sb, job, retainageTerm);
  const valued = acts.filter((a) => !isOwnerFurnished(a) && (a.value ?? 0) > 0);
  const scheduleEarned = valued.length && valued.every((a) => a.pct_complete != null) ? earnedToDate(acts) : null;
  const billing = draftBillingFromSchedule(acts, contract, null, reportCalendarHolidays(cpm.found ? cpm.data ?? null : null));
  return billing ? { billing: { ...billing, earned_from_dailies: dailyEarned, earned_from_schedule: scheduleEarned, payments_received: null }, retainageTerm } : null;
}

async function whoAmI(sb: Sb, job: Job, userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await sb.from("mcp_company_members").select("display_name, role").eq("company_id", job.company_id).eq("user_id", userId).maybeSingle();
  return data ? `${data.display_name} (${data.role === "pm" ? "PM" : data.role === "all_access" ? "All-access" : String(data.role).charAt(0).toUpperCase() + String(data.role).slice(1)})` : null;
}

const SHOW_UNSAVED_BILLING =
  "Show this card as written. Leave it as Athena drew it. Only after the PM says yes, call living_report_save with base_version 0.";

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
      const sources=await loadJobSourceClauses(sb,job,args.company_id);
      const sourceClauses=sources.clauses.filter(c=>clauseKinds(c).includes("schedule_context")).map(c=>({...c,text:c.text.slice(0,4000),parts:c.parts.slice(0,2).map(p=>({...p,text:p.text.slice(0,2000)})),response_truncated:c.text.length>4000||c.parts.length>2})).slice(0,25);
      await audit(sb, job, "cpm_activities", "view_cpm_activities", null);
      if (!g.found) {
        return guide(
          { ...text(`${prefix(job)}No approved CPM is saved for this job yet, so there's no activity list to hand over. Contract completion: ${g.contract_completion_date ?? "Needed"}.\nBuild and approve the baseline first, then save it as version 1.`), structuredContent: { source_clauses:sourceClauses,source_issues:sources.problems,found: false, activities: [], contract_completion_date: g.contract_completion_date ?? null } },
          "No saved CPM: follow the no-schedule flow, then after the PM approves the baseline call living_report_save with report_type cpm and base_version 0. Never draw a CPM or billing split from an earlier chat.",
        );
      }
      const data = showMoney ? (g.data ?? {}) : stripMoney(g.data ?? {});
      const acts = (data.activities ?? []) as Activity[];
      const count = countCheck(acts, Math.max(acts.length, g.activity_count ?? 0));
      const contract = showMoney ? await contractTotal(sb, job) : null;
      const tie = showMoney ? tieCheck(costLoadTotal(acts), contract) : null;
      const control = readScheduleControl(data);
      const tia = controlledTiaResult(control) ?? tiaResult(data.tia ?? null);
      const ganttSpec = control ? CPM_GANTT_SPEC.map((line, i) => i === 3 ? "3. Controlled schedule bars: blue actual periods use only saved actual_start/actual_finish and split at the saved data date for in-progress work. Percent complete remains reported work progress and does not invent dates. Remaining work is green noncritical/red critical; unknown actual dates have no blue as-built segment. Use zero-duration diamonds. Draw the active baseline's saved date bars beneath current bars and show WBS paths from schedule_control.wbs." : i === 5 ? "5. Data date: a thin vertical line at the saved data date; show Needed if missing. Do not replace it with today." : line) : CPM_GANTT_SPEC;
      const delay = readDelay(data as Record<string, unknown>);
      const holidays = reportCalendarHolidays(data);
      const of = acts.filter(isOwnerFurnished);
      const ofValued = ownerFurnishedWithValue(acts);
      const scheduleBoard = await signedJobPages((fn, a) => sb.rpc(fn, a), job.job_id, job.scope);
      const lines = [
        ...(scheduleBoard.schedule ? [pageLine("schedule", scheduleBoard.schedule)] : []),
        CPM_REQUIRED_TOP,
        `${named(job)} · ${LIVING_LABEL.cpm} ${stamp(g)}`,
        `Contract completion: ${g.contract_completion_date ?? "Needed"}`,
        `Count check: ${showMoney ? count.line : `${count.dated} of ${count.expected} activities dated.`}${count.complete ? "" : ` Missing dates: ${count.missing.join(", ")}.`}`,
        ...(tie ? [`Tie: ${tie.line}`] : []),
        ...ganttSpec,
        ...(showMoney && of.length ? [`Owner-furnished (schedule-only, $0.00 in ALP billing): ${of.map((a) => a.id).join(", ")}.${ofValued.length ? ` Saved with a value that is excluded here: ${ofValued.map((a) => `${a.id} ${money(a.value ?? 0)}`).join(", ")}.` : ""}`] : []),
        ...(showMoney ? [`Earned to date: ${money(earnedToDate(acts))}`] : []),
        ...(delay ? [delay.line] : tia ? [`Delay fragnet result (${tia.fragnet}): ${tia.math} ${tia.statement}`] : []),
        ...ganttPins(delay),
        "",
        `Activities (${acts.length}):`,
        ...acts.map((a) => activityLine(a, showMoney, holidays)),
      ];
      return guide(
        {
          ...text(lines.join("\n")),
          structuredContent: {
            found: true,
            source_clauses:sourceClauses,source_issues:sources.problems,
            schedule_control: JSON.parse(JSON.stringify(data.schedule_control ?? null)),
            tia_basis: control?.analysis ? "calculated_isolated_fragnet" : "reported_completion_dates_only",
            portfolio_contract: schedulePortfolio(data, {company_id: job.company_id, job_id: job.job_id, version: g.version!, data_date: g.data_date ?? null}),
            version: g.version, data_date: g.data_date ?? null, updated_at: g.updated_at ?? null, updated_by: g.updated_by_name ?? null,
            contract_completion_date: g.contract_completion_date ?? null,
            count_check: count,
            tie,
            contract_total: contract, contract_total_display: contract === null ? null : money(contract),
            earned_to_date: showMoney ? earnedToDate(acts) : null,
            tia,
            delay,
            identified_delay_activity_id: identifiedDelayActivityId(data as Record<string, unknown>),
            owner_furnished: of.map((a) => a.id),
            no_financials: !showMoney,
            activities: acts.map((a) => ({ ...a, owner_furnished: isOwnerFurnished(a), billable_value: showMoney ? (isOwnerFurnished(a) ? 0 : a.value) : null })),
          },
        },
        "View-only asks (e.g. \"pull up the schedule\"): build a NEW private view or artifact; never update or replace the saved shared master or an existing shared artifact unless the user explicitly asks to update or save it, and confirm first. Use structuredContent.activities, count_check, tie, contract_completion_date and tia and identified_delay_activity_id exactly. Hatch only the explicitly identified delay activity. Treat schedule allocations as planned, and earned progress, issued billing and payments received as distinct. Never infer billed or paid amounts from earned progress or planned work; where authoritative billing or payment evidence is unavailable, say Unknown. Never invent a date, duration, float or dollar figure.",
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
        const contract = await contractTotal(sb, job);
        const draft = contract == null ? null : await unsavedBillingDraft(sb, job, contract);
        if (draft && contract != null) {
          const model = payModel(draft.billing, contract);
          const card = billingForecastCardModel(named(job), model, payappUrl, {
            draft: true,
            retainageLines: retainageStepDownLines(draft.retainageTerm, contract),
          });
          const presented = presentPayApp(card);
          return guide(
            {
              ...presented,
              structuredContent: {
                ...presented.structuredContent,
                found: false,
                report_type: type,
                version: 0,
                draft: true,
                contract_total: contract,
                tie: tieCheck(model.total, contract),
                data: { billing: draft.billing },
              },
            },
            `${SHOW_UNSAVED_BILLING} Pass data.billing from this result.`,
          );
        }
        const presented = presentPayApp({
          state: "ask", show_state: false, title: "Pay App & Billing Forecast", job: named(job),
          sections: [{ heading: "Needed", kind: "list", rows: [{ cells: ["Billed to date"] }, { cells: ["Latest pay app (SOV lines)"] }] }],
          next_move: "Send the billed-to-date figure and the latest pay app; Athena builds the forecast from the saved schedule after the PM approves.",
        });
        return guide(
          { ...presented, structuredContent: { ...presented.structuredContent, found: false, report_type: type, version: 0 } },
          SHOW_UNSAVED_BILLING,
        );
      }
      if (!g.found) {
        return guide(
          { ...text(`${prefix(job)}No saved ${label} for this job yet. Build it once, then save it as version 1 after the PM approves.`), structuredContent: { found: false, report_type: type, version: 0 } },
          `Nothing saved: build the ${label} from Athena's data, mark it "Draft: not saved", and after the PM says yes call living_report_save with base_version 0.`,
        );
      }
      const rawData = job.scope === "full" ? g.data ?? {} : stripMoney(g.data ?? {});
      const data = type === "billing_forecast" && rawData.billing
        ? { ...rawData, billing: safeBillingView(rawData.billing as Record<string, unknown>) }
        : rawData;
      const contract = job.scope === "full" && TIED_TYPES.includes(type) ? await contractTotal(sb, job) : null;
      const ft = g.forecast_total ?? null;
      const tie = job.scope === "full" && TIED_TYPES.includes(type) && ft !== null ? tieCheck(Number(ft), contract) : null;
      const log = logLines(g);
      const boardLinks = [
        ...(board.items ? [{ label: "Open items", href: board.items }] : []),
        ...(iorUrl ? [{ label: "Open IOR", href: iorUrl }] : []),
        ...(scheduleUrl ? [{ label: "Open schedule", href: scheduleUrl }] : []),
      ];
      const linkCard = type === "ior" || type === "cpm" ? boardCardText(`${named(job)}`, boardLinks) : "";
      const billingCard = type === "billing_forecast" && job.scope === "full"
        ? billingForecastCardModel(named(job), payModel((data as { billing?: Billing }).billing, contract), payappUrl)
        : null;
      if (billingCard && tie && !tie.ties) {
        billingCard.sections = billingCard.sections!.filter((section) => section.heading !== "Monthly billing");
        billingCard.sections.push({ heading: "Saved forecast tie check", kind: "list", rows: [{ cells: [tie.line], flag: "risk" }] });
        billingCard.next_move = "Correct the forecast so it ties to the contract before drawing the billing schedule.";
      }
      if (billingCard) billingCard.sections!.push(
        { heading: "Saved version", kind: "list", rows: [{ cells: [stamp(g)] }] },
        { heading: "Change log (latest 5)", kind: "list", rows: (log.length ? log : ["None yet."]).map((line) => ({ cells: [line] })) },
      );
      const presented = billingCard ? presentPayApp(billingCard) : null;
      const outcome = type === "ior" && job.scope === "full" ? cedarOutcome(job.job_id, { version: g.version, contract_total: g.contract_total, forecast_total: g.forecast_total, data }) : null;
      const iorBody = type === "ior" ? iorSectionsText(data as Record<string, unknown>, { jobId: job.job_id, version: g.version, contract_total: g.contract_total, forecast_total: g.forecast_total }) : [];
      return guide(
        {
          ...(presented ?? text([ ...(linkCard ? [linkCard] : type === "dashboard" && job.scope === "full" ? [pageLine("portfolio dashboard", pageUrl("portfolio", job.company_id))] : []), ...(type === "ior" ? [] : [LIVING_REQUIRED_TOP]), `${named(job)} · ${label}`, stamp(g), ...(iorBody.length ? ["", ...iorBody] : []), ...(tie ? [`Tie: ${tie.line}`] : []), ...(type === "cpm" ? [...CPM_GANTT_SPEC, ...(readDelay(data as Record<string, unknown>) ? [readDelay(data as Record<string, unknown>)!.line] : []), ...ganttPins(readDelay(data as Record<string, unknown>))] : []), ...(type === "billing_forecast" && job.scope === "full" ? PAY_APP_VIEW_SPEC : []), ...(type === "ior" && job.scope === "full" ? IOR_VIEW_SPEC : []), ...(type === "dashboard" && job.scope === "full" ? PORTFOLIO_VIEW_SPEC : []), "", "Change log (latest 5):", ...(log.length ? log : ["- None yet."])].join("\n"))),
          structuredContent: { ...presented?.structuredContent, found: true, report_type: type, job_id: job.job_id, version: g.version, data_date: g.data_date ?? null, updated_at: g.updated_at ?? null, updated_by: g.updated_by_name ?? null, contract_completion_date: g.contract_completion_date ?? null, contract_total: job.scope === "full" ? g.contract_total ?? null : null, forecast_total: job.scope === "full" ? g.forecast_total ?? null : null, ior_outcome: outcome ? { contract: outcome.contract == null ? null : outcome.contract / 100, planned_gp: outcome.planned == null ? null : outcome.planned / 100, planned_margin_pct: outcome.planned == null || !outcome.contract ? null : Number((outcome.planned / outcome.contract * 100).toFixed(2)), indicated_gp: outcome.indicated == null ? null : outcome.indicated / 100, indicated_margin_pct: outcome.indicated == null || !outcome.contract ? null : Number((outcome.indicated / outcome.contract * 100).toFixed(2)), e_holds: outcome.eHolds == null ? null : outcome.eHolds / 100, c_holds: outcome.cHolds == null ? null : outcome.cHolds / 100, basis: outcome.indicated == null ? "Calculation unavailable: review the current report basis and inputs." : "Owner-confirmed report v3: planned profit after allocated overhead less active E- and C-holds; actual cost and billing are not supplied." } : null, tie, data: data as never, change_log: g.change_log ?? [], no_financials: job.scope !== "full", board_links: boardLinks },
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
    schedule_request: scheduleRequest.optional(),
    billing: z.object({ billed_to_date: z.number().min(0).nullable().optional(), unverified_billed_to_date: z.number().min(0).nullable().optional(), unverified_payments_received: z.number().min(0).nullable().optional(), earned_from_dailies: z.number().min(0).nullable().optional(), earned_from_schedule: z.number().min(0).nullable().optional(), payments_received: z.number().min(0).nullable().optional(), months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), amount: z.number(), kind: z.enum(["actual", "forecast", "unverified"]) })).max(120) }).optional(),
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
      if (type === "cpm" && !args.activities?.length && !args.schedule_request) throw new ToolError("Send the full activity list to save the CPM. Nothing was saved.");
      if (type === "cpm" && args.schedule_request) await assertScheduleCompany(sb, job, args.company_id);
      const prev = await getReport(sb, job, type);
      if ((prev.found ? prev.version! : 0) !== args.base_version)
        throw new ToolError(`This report changed since you loaded it (now v${prev.found ? prev.version : 0}). Load the latest version and update that one. Nothing was saved.`);
      if (args.schedule_request && type !== "cpm") throw new ToolError("Schedule requests apply only to the CPM.");
      if (type === "cpm" && args.details && ["schedule_control", "activities", "tia"].some(k => k in args.details!)) throw new ToolError("Use the schedule workflow to preserve schedule controls and analysis; do not replace them in details.");
      if (type === "cpm" && readScheduleControl(prev.data ?? null) && !args.schedule_request) throw new ToolError("This plan uses controlled scheduling. Prepare and review a schedule revision before saving; no history or settings were replaced.");
      if (args.schedule_request && prev.data_date && args.schedule_request.data_date < prev.data_date) throw new ToolError("Revision data date cannot precede the saved data date.");
      if (args.schedule_request && (args.activities || args.tia || args.details || args.data_date && args.data_date !== args.schedule_request.data_date)) throw new ToolError("Save the reviewed schedule revision alone; conflicting activity, TIA, details or data-date overrides are not allowed.");
      if (type === "cpm" && !args.schedule_request && args.activities?.some(a => ["wbs_id", "calendar_id", "actual_start", "actual_finish", "remaining_duration", "activity_type", "start_no_earlier_than", "finish_no_later_than"].some(k => k in a) || a.predecessors.some(p => p.lag_calendar_basis))) throw new ToolError("Prepare and review these schedule facts first so actuals, calendars and logic are verified.");
      let prepared: ReturnType<typeof prepareSchedule> | undefined;
      if (args.schedule_request) {
        try { prepared = prepareSchedule(prev.found ? prev.data ?? null : null, args.base_version, args.schedule_request, prev.data_date); }
        catch (e) { if (e instanceof ScheduleInputError) throw new ToolError(e.message); throw e; }
      }
      // Carry the activity list forward when a non-CPM report doesn't resend it, so no save can drop activities silently.
      let acts = (prepared?.data.activities ?? args.activities) as Activity[] | undefined;
      if (!acts && TIED_TYPES.includes(type)) {
        const cpm = type === "cpm" ? prev : await getReport(sb, job, "cpm");
        acts = cpm.found ? ((cpm.data?.activities ?? []) as Activity[]) : undefined;
      }
      const next: LivingData = prepared?.data ?? { ...(type === "cpm" ? prev.data ?? {} : {}), ...(args.details ?? {}), ...(acts ? { activities: acts } : {}), ...(args.billing ? { billing: args.billing } : {}), ...(args.tia ? { tia: args.tia } : {}) };
      const contract = await contractTotal(sb, job);
      const chk = checkSave(type, next, prev.found ? prev.data ?? null : null, contract);
      if (!chk.ok) {
        await audit(sb, job, "living_report_save", `living_${type}_refused`, null);
        throw new ToolError(`${prefix(job)}Not saved. ${LIVING_LABEL[type]} stays at v${prev.found ? prev.version : 0}.\n${chk.problems.map((p) => `- ${p}`).join("\n")}`);
      }
      const dated = resolveDataDate(args.schedule_request?.data_date ?? args.data_date);
      if (!dated.ok) {
        await audit(sb, job, "living_report_save", `living_${type}_refused`, null);
        throw new ToolError(`${prefix(job)}${dated.error}`);
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
        _job: job.job_id, _type: type, _base_version: args.base_version, _data: next, _data_date: dated.dataDate,
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

