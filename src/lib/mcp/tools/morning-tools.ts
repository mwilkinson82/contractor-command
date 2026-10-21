// 0.8.13: morning_briefing, read-only, one call. Role scope from mcp_job_scope (no access = job left out);
// non-full scopes (super/field, contract) get no dollars; PMs see only the jobs they are PM on.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text, type Sb } from "../guard";
import { audit, type Job } from "../jobs";
import { runSweep } from "../sweep";
import { todayIn } from "../deadlines";
import { guide } from "../visible";
import { CONNECT_CHECK_RULE, withNextMove } from "../coach";
import { FIELD_UPDATE_QUESTIONS, MORNING_BRIEFING_VIEW_SPEC, isRfiItem, isSubmittalItem, logSection, stripDollars, todaysActivities, visibleForRole, type BriefActivity, type LogItem } from "../morning";

const READ = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;
type JobRow = { id: string; job_number: string; name: string; company_id: string; time_zone: string | null; pm_user_id: string | null };
const LA_KEYS = { inspections: "inspection_list", deliveries: "deliveries", rfis: "rfi_log", submittals: "submittal_log" } as const;

async function jobBrief(sb: Sb, j: JobRow, scope: string, today: string) {
  const full = scope === "full";
  const clean = (s: unknown) => (typeof s === "string" ? (full ? s : stripDollars(s)) : null);
  const [laR, cpmR, sweep, itemsR, logR] = await Promise.all([
    sb.from("mcp_lookaheads").select("id, start_date, end_date, inputs").eq("job_id", j.id).lte("start_date", today).gte("end_date", today).order("created_at", { ascending: false }).limit(1),
    Promise.resolve(sb.rpc("mcp_living_report_get", { _job: j.id, _type: "cpm", _version: null })).catch(() => ({ data: null })),
    runSweep(sb, { jobNumber: j.job_number }),
    // 0.8.13 dry-run fix: RFIs and submittals always come back (open items + the latest lookahead logs), or a labeled empty state.
    Promise.resolve(sb.from("mcp_open_items").select("id, action, needed_by, due_date, created_at, owner, waiting_on_who, category, check_key").eq("job_id", j.id).eq("status", "open").limit(200)).catch(() => ({ data: null })),
    Promise.resolve(sb.from("mcp_lookaheads").select("inputs").eq("job_id", j.id).order("created_at", { ascending: false }).limit(1)).catch(() => ({ data: null })),
  ]);
  const la = ((laR as { data?: unknown[] }).data?.[0] ?? null) as { id: string; start_date: string; end_date: string; inputs?: Record<string, unknown> } | null;
  const acts = (((cpmR as { data?: { data?: { activities?: BriefActivity[] } } | null }).data?.data?.activities) ?? []) as BriefActivity[];
  const items = (sweep?.items ?? []).filter((x) => x.bucket !== "upcoming" || x.days <= 7);
  const fromLa = (k: keyof typeof LA_KEYS) => clean(la?.inputs?.[LA_KEYS[k]]);
  const lastLog = ((logR as { data?: { inputs?: Record<string, unknown> }[] | null }).data?.[0]?.inputs ?? null) as Record<string, unknown> | null;
  const logText = (k: "rfis" | "submittals") => fromLa(k) ?? clean(lastLog?.[LA_KEYS[k]]);
  type OI = { id: string; action: string; needed_by: string | null; due_date: string | null; created_at: string; owner: string | null; waiting_on_who: string | null; category: string | null; check_key: string | null };
  const open = (((itemsR as { data?: OI[] | null }).data) ?? []) as OI[];
  const toLog = (o: OI): LogItem => ({
    ref: o.id.slice(0, 5).toUpperCase(), subject: clean(o.action) ?? "", due: o.due_date ?? o.needed_by ?? null,
    days_open: Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(o.created_at)) / 86_400_000)) || 0,
    ball_in_court: o.waiting_on_who ?? o.owner ?? null, source: "open_item",
  });
  const tag = (o: OI) => `${o.action} ${o.category ?? ""} ${o.check_key ?? ""}`;
  const rfis = logSection("rfi", open.filter((o) => isRfiItem(tag(o))).map(toLog), logText("rfis"));
  const submittals = logSection("submittal", open.filter((o) => !isRfiItem(tag(o)) && isSubmittalItem(tag(o))).map(toLog), logText("submittals"));
  return {
    job_number: j.job_number, name: j.name, scope, dollars_shown: full,
    overdue: items.filter((x) => x.bucket === "overdue").map((x) => ({ ref: x.item_ref ?? x.ref, due: x.due, days_late: -x.days })),
    reminders: items.filter((x) => x.bucket !== "overdue").map((x) => ({ ref: x.item_ref ?? x.ref, due: x.due, countdown_days: x.days })),
    lookahead_today: todaysActivities(acts, today),
    lookahead_window: la ? `${la.start_date} to ${la.end_date}` : null,
    inspections: fromLa("inspections"), deliveries: fromLa("deliveries"), rfis, submittals,
    sweep_text: sweep?.text ? (full ? sweep.text : stripDollars(sweep.text)) : null,
  };
}

export const morningBriefing = defineTool({
  name: "morning_briefing",
  title: "Morning briefing",
  description:
    "Read-only. Call once when the member says \"good morning\" (or \"Athena, good morning\", \"morning briefing\") or the daily check-in fires. Returns, scoped to the caller's role: today's top 3, overdue items and risks, today's lookahead activities, inspections and deliveries, the open RFI and submittal logs (or \"No open RFIs\" / \"No open submittals\"), reminders with countdowns, and the field-update questions. Supers and field roles get no dollars; PMs get only their own jobs. Changes nothing.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40).optional().describe("One job; leave out for every job the member can see."),
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("morning_briefing", ctx, undefined, async (sb) => {
      let jq = sb.from("mcp_jobs").select("id, job_number, name, company_id, time_zone, pm_user_id").not("company_id", "is", null);
      if (args.job_number) jq = jq.eq("job_number", args.job_number.trim());
      const { data } = await jq;
      const rows = (data ?? []) as JobRow[];
      const scopes = await Promise.all(rows.map((j) => sb.rpc("mcp_job_scope", { _job: j.id })));
      const me = ctx.getUserId?.() ?? null;
      const roles = new Map<string, string | null>();
      for (const c of new Set(rows.map((r) => r.company_id))) roles.set(c, ((await sb.rpc("mcp_member_role", { _company: c })).data as string | null) ?? null);
      const allowed = rows.filter((_, i) => !!scopes[i].data);
      const scopeOf = new Map(rows.map((j, i) => [j.id, (scopes[i].data as string | null) ?? null]));
      const jobs = allowed.filter((j) => visibleForRole([j], roles.get(j.company_id) ?? null, me).length);
      const briefs = [];
      for (const j of jobs.slice(0, 10)) briefs.push(await jobBrief(sb, j, scopeOf.get(j.id)!, todayIn(j.time_zone ?? "America/New_York")));
      const top3 = briefs.flatMap((b) => [...b.overdue.map((o) => ({ job_number: b.job_number, ref: o.ref, due: o.due, owner: null as string | null, why: `overdue ${o.days_late} day(s)` })), ...b.reminders.filter((r) => r.countdown_days === 0).map((r) => ({ job_number: b.job_number, ref: r.ref, due: r.due, owner: null as string | null, why: "due today" }))]).slice(0, 3);
      const first = jobs[0];
      if (first) await audit(sb, { job_id: first.id, job_number: first.job_number, name: first.name, company_id: first.company_id } satisfies Job, "morning_briefing", "view_morning_briefing", null);
      const body = briefs.length
        ? briefs.map((b) => `${b.job_number} – ${b.name}\n${b.sweep_text ?? "Nothing overdue or due soon."}\nToday on the lookahead: ${b.lookahead_today.map((a) => `${a.id} ${a.name} ${a.event}`).join("; ") || "nothing starting or finishing"}\nRFIs: ${b.rfis.label}\nSubmittals: ${b.submittals.label}`).join("\n\n")
        : "No jobs to brief on for your role.";
      return withNextMove(
        guide(
          { ...text(`Good morning. Here's today.\n\n${body}\n\n${FIELD_UPDATE_QUESTIONS[0]}`), structuredContent: { top3, jobs: briefs, email_section: { connect_check_first: true, connectors: ["Google email", "Outlook email"] }, field_update_questions: [...FIELD_UPDATE_QUESTIONS], read_only: true } },
          `Before the overnight-email card (item 3), run the connect check: ${CONNECT_CHECK_RULE}`,
          ...MORNING_BRIEFING_VIEW_SPEC,
        ),
        "briefing",
        guide,
      );
    }),
});
