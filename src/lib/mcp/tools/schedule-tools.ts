import { assertScheduleCompany } from "../schedule-job";
import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text } from "../guard";
import { resolveJob, named, FULL_ACCESS_MESSAGE } from "../jobs";
import { scheduleRequest, scheduleDate, scheduleLayout } from "../schedule-schema";
import {
  layoutCatalog,
  layoutRows,
  scheduleLayoutUrl,
  scopedDelay,
  unknownRefs,
} from "../schedule-layout-actions";
import type { LayoutSpec } from "../../schedule-layouts";
import {
  prepareSchedule,
  readScheduleControl,
  schedulePortfolio,
  starterWbs,
  ScheduleInputError,
} from "../schedule-control";
import { projectMilestoneRequest, projectMilestonesPresent } from "../../schedule-milestones";
import type { LivingData } from "../living";
import { loadJobSourceClauses } from "../source-clauses";
import { draftScheduleNotice } from "../schedule-notice";
import { scheduleToXer, xerToScheduleRequest, XerImportError } from "../schedule-xer";

const json = (value: unknown): JsonValueInput => JSON.parse(JSON.stringify(value));

/**
 * A calculated schedule with no start or Substantial Completion milestone gets a
 * note and the add_activities/updates that would add them; nothing is saved.
 */
function milestoneCheck(data: LivingData | null | undefined) {
  const acts = data?.activities ?? [];
  if (!acts.length || readScheduleControl(data)?.calculation.status !== "calculated") return null;
  const present = projectMilestonesPresent(acts);
  const proposal = projectMilestoneRequest(acts);
  if (!proposal) return null;
  const missing = [
    ...(present.start ? [] : ["start milestone"]),
    ...(present.finish ? [] : ["Substantial Completion milestone"]),
  ];
  return {
    missing,
    /** Member-facing line. */
    line: `This schedule has no ${missing.join(" and no ")}. Athena can add ${missing.length === 1 ? "it" : "them"} in the next recalculated revision.`,
    /** For the AI only. */
    guidance: `Milestones: to add them, prepare a schedule_request recalculate at the current data date with milestones.add_activities as add_activities and milestones.updates as updates (${proposal.notes.join(" ")}). Confirm the ties with the member before saving.`,
    add_activities: proposal.add_activities,
    updates: proposal.updates,
  };
}

/** Preparation is read-only. The existing approved save tool remains the only write path. */
export const scheduleWorkflow = defineTool({
  name: "schedule_workflow",
  title: "Prepare WBS, schedule update or delay comparison",
  description:
    "Reviews a job's schedule or prepares a calculated WBS, progress, baseline, delay scenario or source-grounded draft notice without saving or sending. layouts lists saved schedule layouts and activity codes with the link that opens each layout (pass layout_id to open one and get its rows). query sorts and filters the schedule by any column, activity code or WBS (view: group, columns, sort, filter) and returns the rows; to save it as a layout, prepare organize with request.layouts. Activity codes are created and assigned with organize (request.activity_codes, request.code_assignments). On prepare or inspect, layout_id or view limits the delay and TIA results to that layout's activities. import_xer turns a Primavera P6 XER file's text into a first-import draft for a job with no saved schedule; export_xer returns the saved schedule as XER text for P6.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    action: z.enum([
      "inspect",
      "prepare",
      "draft_notice",
      "import_xer",
      "export_xer",
      "layouts",
      "query",
    ]),
    /** layouts: open this saved layout. prepare/inspect: limit delay and TIA results to it. */
    layout_id: z.string().trim().min(1).max(80).optional(),
    /** query: a one-off layout (no id or name needed). prepare/inspect: its filter scopes delay and TIA results. */
    view: scheduleLayout
      .omit({ id: true, name: true })
      .extend({ columns: scheduleLayout.shape.columns.optional() })
      .optional(),
    /** import_xer: the full text of the .xer file, exactly as exported from P6. */
    xer_text: z.string().min(1).max(5_000_000).optional(),
    /** import_xer: the P6 project ID to import when the file holds more than one project. */
    xer_project: z.string().trim().min(1).max(40).optional(),
    base_version: z.number().int().min(0).optional(),
    version: z.number().int().min(1).optional(),
    request: scheduleRequest.optional(),
    event: z
      .object({
        id: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(2000),
        delay_start: scheduleDate.nullable(),
        affected_activity_ids: z.array(z.string().max(20)).min(1).max(100),
        source_refs: z.array(z.string().max(300)).max(30),
      })
      .strict()
      .optional(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run("schedule_workflow", ctx, { jobNumber: args.job_number, sweep: false }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      await assertScheduleCompany(sb, job, args.company_id);
      if (job.scope !== "full") throw new ToolError(FULL_ACCESS_MESSAGE);
      if (
        !["inspect", "export_xer", "layouts", "query"].includes(args.action) &&
        args.version != null
      )
        throw new ToolError(
          "Revisions and notices use the current saved version; historical versions are view-only.",
        );
      const got = await sb.rpc("mcp_living_report_get", {
        _job: job.job_id,
        _type: "cpm",
        _version: args.version ?? null,
      });
      if (got.error) dbError(got.error);
      const saved = got.data as {
        found: boolean;
        version?: number;
        data?: LivingData;
        data_date?: string | null;
      };
      const version = saved.found ? saved.version! : 0;
      if (args.action === "export_xer") {
        if (!saved.found || !saved.data?.activities?.length)
          throw new ToolError(`${named(job)} has no saved schedule to export.`);
        const exportedOn = new Date().toISOString().slice(0, 10);
        try {
          const xer = scheduleToXer(saved.data, {
            project_short_name: job.job_number,
            project_name: job.name || job.job_number,
            exported_on: exportedOn,
            data_date: saved.data_date ?? null,
          });
          const file = `${job.job_number.replace(/[^A-Za-z0-9._-]+/g, "-")}-v${version}.xer`;
          return {
            ...text(
              `${named(job)} · Schedule v${version} as a P6 XER file (${saved.data.activities.length} activities). Give the member the file ${file} with the xer text exactly as returned; in P6 they use File, Import, Primavera PM (XER) as a new project. No changes saved.`,
            ),
            structuredContent: {
              saved: false,
              version,
              file_name: file,
              media_type: "text/plain",
              xer,
            },
          };
        } catch (e) {
          if (e instanceof XerImportError) throw new ToolError(e.message);
          throw e;
        }
      }
      if (args.action === "import_xer") {
        if (!args.xer_text || args.request || args.event)
          throw new ToolError("Supply the XER file's text alone to import it.");
        if (saved.found && saved.data?.activities?.length)
          throw new ToolError(
            `${named(job)} already has a saved schedule (v${version}). An XER import starts a schedule; update this one with prepare instead.`,
          );
        if (args.base_version !== version)
          throw new ToolError(`This schedule is v${version}. Load that version before importing.`);
        try {
          const imp = xerToScheduleRequest(args.xer_text, args.xer_project);
          const prepared = prepareSchedule(
            saved.data ?? null,
            version,
            imp.request,
            saved.data_date,
          );
          return {
            ...text(
              `${named(job)} · Draft from P6 project ${imp.project.name}, not saved.\n${imp.counts.activities} activities, ${imp.counts.relationships} relationships, ${imp.counts.calendars} calendars, ${imp.counts.wbs} WBS nodes. Data date ${imp.project.data_date}.\n${imp.notes.map((n) => `Not carried: ${n}`).join("\n")}\nThe P6 dates are kept as reported. Review, then save with living_report_save using the save request; recalculate in Athena as the next revision.`,
            ),
            structuredContent: {
              saved: false,
              base_version: version,
              project: imp.project,
              counts: imp.counts,
              not_carried: imp.notes,
              prepared: json(prepared),
              save: {
                tool: "living_report_save",
                report_type: "cpm",
                base_version: version,
                schedule_request: json(imp.request),
                approval_required: true,
                what_changed_required: true,
              },
            },
          };
        } catch (e) {
          if (e instanceof XerImportError || e instanceof ScheduleInputError)
            throw new ToolError(e.message);
          throw e;
        }
      }
      const control = readScheduleControl(saved.data);
      // A saved layout or a one-off view; its filter can also scope delay and TIA results.
      const spec: LayoutSpec | null = args.layout_id
        ? ((control?.layouts ?? []).find((l) => l.id === args.layout_id) ??
          (() => {
            throw new ToolError(
              `${named(job)} has no saved layout ${args.layout_id}. Use action layouts to list them.`,
            );
          })())
        : args.view
          ? { ...args.view, columns: args.view.columns ?? [] }
          : null;
      if (spec && control) {
        const bad = unknownRefs(control, spec);
        if (bad.length) throw new ToolError(`This schedule has no ${bad.join(", ")}.`);
      }
      if (args.action === "layouts" || args.action === "query") {
        if (!saved.found || !saved.data?.activities?.length || !control)
          throw new ToolError(`${named(job)} has no saved CPM schedule yet.`);
        const catalog = layoutCatalog(control, job.job_id);
        if (args.action === "query" && !spec)
          throw new ToolError("Give a view (group, columns, sort, filter) to query.");
        if (!spec) {
          const lines = catalog.layouts.map((l) => `- ${l.name}: ${l.filter} · ${l.url}`);
          const codeLines = catalog.codes.map(
            (c) => `- ${c.name}: ${c.values.map((v) => `${v.name} (${v.activities})`).join(", ")}`,
          );
          return {
            ...text(
              `${named(job)} · Schedule v${version} · ${catalog.layouts.length} saved ${catalog.layouts.length === 1 ? "layout" : "layouts"}${lines.length ? `\n${lines.join("\n")}` : ""}\nActivity codes: ${codeLines.length ? `\n${codeLines.join("\n")}` : "none yet"}\nDefault view: ${scheduleLayoutUrl(job.job_id, null)}. No changes saved.`,
            ),
            structuredContent: {
              saved: false,
              version,
              ...(json(catalog) as Record<string, JsonValueInput>),
            },
          };
        }
        const rows = layoutRows(saved.data, control, spec);
        const opened = args.layout_id ? catalog.layouts.find((l) => l.id === args.layout_id) : null;
        return {
          ...text(
            `${named(job)} · Schedule v${version}${opened ? ` · Layout ${opened.name}` : " · One-off view"} · ${rows.count} ${rows.count === 1 ? "activity" : "activities"} · ${rows.filter}\n${rows.table}${opened ? `\nOpen it: ${opened.url}` : "\nTo keep this view, save it as a layout with organize (request.layouts)."} No changes saved.`,
          ),
          structuredContent: {
            saved: false,
            version,
            layout: opened ? json(opened) : null,
            ...(json(rows) as Record<string, JsonValueInput>),
          },
        };
      }
      if (args.action !== "inspect" && args.base_version !== version)
        throw new ToolError(
          `This schedule is v${version}. Load that version before preparing a revision or notice.`,
        );
      if (args.action === "inspect") {
        const milestones = milestoneCheck(saved.data);
        const scoped =
          spec && control && saved.data ? scopedDelay(saved.data, control, spec) : null;
        return {
          ...text(
            `${named(job)} · Schedule ${saved.found ? `v${version}` : "not saved"}. Review the WBS and missing inputs before preparation. No changes saved.${milestones ? `\n${milestones.line}` : ""}${scoped ? `\nLimited to ${scoped.filter}: ${scoped.activity_count} activities, ${scoped.delay_events.length} modeled delay ${scoped.delay_events.length === 1 ? "event touches" : "events touch"} them.` : ""}`,
          ),
          structuredContent: {
            ...(scoped ? { scoped: json(scoped) } : {}),
            found: saved.found,
            version,
            data: json(saved.data ?? null),
            starter_wbs: starterWbs(),
            portfolio_contract: schedulePortfolio(saved.data ?? null, {
              company_id: job.company_id,
              job_id: job.job_id,
              version,
              data_date: saved.data_date ?? null,
            }),
            next: "Prepare with explicit calendars/project start for calculation, or organize only to retain imported dates. Review, then save using living_report_save with the identical schedule_request, base_version and approved=true.",
            ...(milestones
              ? { milestones: json(milestones), assistant_guidance: [milestones.guidance] }
              : {}),
          },
        };
      }
      if (args.action === "draft_notice") {
        if (!args.event || args.request)
          throw new ToolError(
            "Supply the reported event for a draft notice, without a revision request.",
          );
        const ids = new Set((saved.data?.activities ?? []).map((a) => a.id));
        for (const id of args.event.affected_activity_ids)
          if (!ids.has(id))
            throw new ToolError(`Affected activity ${id} is not in this job's saved schedule.`);
        const sources = await loadJobSourceClauses(sb, job, args.company_id);
        const draft = draftScheduleNotice({
          job_label: named(job),
          event: args.event,
          clauses: sources.clauses,
          source_issues: sources.problems,
          data: saved.data ?? null,
        });
        return {
          ...text(draft.body),
          structuredContent: {
            draft_only: true,
            sent: false,
            saved: false,
            base_version: version,
            ...draft,
          },
        };
      }
      if (!args.request || args.event)
        throw new ToolError("Supply one schedule request to prepare.");
      if (saved.data_date && args.request.data_date < saved.data_date)
        throw new ToolError("Revision data date cannot precede the current saved data date.");
      try {
        const prepared = prepareSchedule(
          saved.data ?? null,
          version,
          args.request,
          saved.data_date,
        );
        const a = prepared.control.analysis;
        const milestones = milestoneCheck(prepared.data);
        const scoped = spec
          ? scopedDelay(prepared.data, prepared.control, spec, prepared.changes)
          : null;
        // The TIA hands off to a time request; it never drafts or sends one by itself.
        const timeRequest =
          a && a.impact_calendar_days > 0
            ? {
                event_id: a.event_id,
                schedule_days: a.impact_calendar_days,
                project_work_days: a.impact_project_work_days,
                next: `After this TIA is saved, the member can ask for time with change_order_record: schedule_days ${a.impact_calendar_days} (calendar days; use the contract's day basis if it counts working days, ${a.impact_project_work_days} WD), event ${a.event_id} in the condition, and the saved TIA version as a reference. Ask before drafting; nothing is sent.`,
              }
            : null;
        return {
          ...text(
            `${named(job)} · Draft, not saved · based on v${version}.\nOperation: ${args.request.operation}. ${prepared.changes.length} activities changed.\nCalculation: ${prepared.control.calculation.status}.${prepared.control.analysis ? `\nModeled completion movement: ${prepared.control.analysis.impact_calendar_days} calendar days (${prepared.control.analysis.prior_completion} → ${prepared.control.analysis.updated_completion}). ${prepared.control.analysis.limitation}` : ""}\n${prepared.missing.map((m) => `Needed: ${m}`).join("\n")}${timeRequest ? `\nTime request: ${timeRequest.next}` : ""}${milestones ? `\n${milestones.line}` : ""}${scoped ? `\nLimited to ${scoped.filter}: ${scoped.changed_activity_ids.length} of its ${scoped.activity_count} activities changed${scoped.analysis ? `; this delay ${scoped.analysis.touches_scope ? "touches" : "does not touch"} them, and ${scoped.analysis.moved.length} of them finish later` : ""}.` : ""}\nReview this draft before saving. No notice sent.`,
          ),
          structuredContent: {
            saved: false,
            base_version: version,
            prepared: json(prepared),
            ...(timeRequest ? { time_request: timeRequest } : {}),
            ...(scoped ? { scoped: json(scoped) } : {}),
            ...(milestones
              ? { milestones: json(milestones), assistant_guidance: [milestones.guidance] }
              : {}),
            save: {
              tool: "living_report_save",
              report_type: "cpm",
              base_version: version,
              schedule_request: args.request,
              approval_required: true,
              what_changed_required: true,
            },
            portfolio_contract: schedulePortfolio(prepared.data, {
              company_id: job.company_id,
              job_id: job.job_id,
              version,
              data_date: args.request.data_date,
            }),
          },
        };
      } catch (e) {
        if (e instanceof ScheduleInputError) throw new ToolError(e.message);
        throw e;
      }
    }),
});
