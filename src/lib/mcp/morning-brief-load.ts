// Loads the caller's jobs for the morning brief. Falls back to job names when the feed
// function is not installed yet. Does not send anything and does not delete rows.
import { signedJobPages } from "./board-url";
import { dbError, isMissingFunction, type Sb } from "./guard";
import { audit } from "./jobs";
import {
  briefSettingsFrom,
  buildMorningBrief,
  parseBriefingTime,
  presentBrief,
  settingsCard,
  settingsLine,
  type BriefActivity,
  type BriefItem,
  type BriefJob,
  type BriefPay,
  type BriefScope,
  type BriefSeat,
  type BriefSettings,
} from "./morning-brief";
import { normalizeRole } from "./team";
import { listedJobs } from "./tools/workflow-tools";
import { ToolError } from "@lovable.dev/mcp-js";

type RawItem = {
  id?: string;
  action?: string;
  check_key?: string | null;
  category?: string | null;
  item_type?: string | null;
  kind?: string | null;
  owner?: string | null;
  accountable?: string | null;
  needed_by?: string | null;
  due_date?: string | null;
  updated_at?: string | null;
  internal_only?: boolean | null;
  cost_effect?: number | string | null;
};

type RawJob = {
  job_id?: string;
  job_number?: string;
  name?: string;
  company_id?: string;
  time_zone?: string;
  scope?: string;
  seat?: string;
  items?: RawItem[];
  lookahead?: { start_date?: string | null; end_date?: string | null } | null;
  cpm?: { found?: boolean; data?: { activities?: Record<string, unknown>[] } } | null;
  billing?: { found?: boolean; data?: Record<string, unknown> } | null;
  daily_today?: boolean;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function activitiesOf(cpm: RawJob["cpm"]): BriefActivity[] {
  const raw = cpm?.found === false ? [] : cpm?.data?.activities ?? [];
  return raw.filter((a) => a && typeof a === "object").map((a) => ({
    id: String(a.id ?? ""),
    name: String(a.name ?? a.description ?? "Activity"),
    description: typeof a.description === "string" ? a.description : null,
    start: typeof a.start === "string" ? a.start : null,
    finish: typeof a.finish === "string" ? a.finish : null,
    duration: num(a.duration),
    total_float: num(a.total_float),
    critical: a.critical === true,
  }));
}

function payAppsOf(billing: RawJob["billing"]): { payApps: BriefPay[]; invoices: BriefPay[] } {
  if (!billing || billing.found === false || !billing.data) return { payApps: [], invoices: [] };
  const data = billing.data;
  const body = data.billing && typeof data.billing === "object" ? (data.billing as Record<string, unknown>) : data;
  const amount = num(body.billed_to_date);
  const payApps: BriefPay[] = [];
  for (const key of ["pay_app_date", "application_date", "period_to"]) {
    const due = body[key];
    if (typeof due === "string" && due) payApps.push({ label: "Pay app", due, amount });
  }
  const invoices: BriefPay[] = [];
  const list = Array.isArray(body.invoices) ? body.invoices : [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    invoices.push({ label: typeof rec.label === "string" ? rec.label : "Invoice", due: typeof rec.due === "string" ? rec.due : null, amount: num(rec.amount) });
  }
  return { payApps, invoices };
}

export function briefJobsFromFeed(rows: RawJob[]): BriefJob[] {
  const jobs: BriefJob[] = [];
  for (const row of rows) {
    if (!row.job_id || !row.job_number) continue;
    if (row.scope !== "full" && row.scope !== "contract" && row.scope !== "super") continue;
    const seat = normalizeRole(String(row.seat ?? "")) ?? "pm";
    const scope = row.scope as BriefScope;
    const items: BriefItem[] = (row.items ?? []).filter((it) => it && it.action).map((it) => ({
      id: String(it.id ?? it.action),
      action: String(it.action),
      check_key: it.check_key ?? null,
      category: it.category ?? null,
      item_type: it.item_type ?? null,
      kind: it.kind ?? null,
      owner: it.owner ?? null,
      accountable: it.accountable ?? null,
      needed_by: it.needed_by ?? null,
      due_date: it.due_date ?? null,
      updated_at: it.updated_at ?? null,
      internal_only: it.internal_only === true,
      cost_effect: scope === "full" ? num(it.cost_effect) : null,
    }));
    const pay = payAppsOf(row.billing);
    const start = row.lookahead?.start_date?.slice(0, 10);
    const end = row.lookahead?.end_date?.slice(0, 10);
    jobs.push({
      job_id: row.job_id,
      job_number: row.job_number,
      name: row.name ?? "Job",
      company_id: row.company_id ?? "",
      time_zone: row.time_zone?.trim() || "America/New_York",
      scope,
      seat: seat as BriefSeat,
      activities: activitiesOf(row.cpm),
      items: scope === "full" ? items : items.filter((it) => !it.internal_only),
      lookahead: start && end ? { start, end } : null,
      payApps: scope === "full" ? pay.payApps : [],
      invoices: scope === "full" ? pay.invoices : [],
      dailyToday: row.daily_today,
      links: {},
    });
  }
  return jobs;
}

async function companies(sb: Sb): Promise<{ id: string }[] | null> {
  try {
    const res = await sb.from("mcp_companies").select("id, name");
    if (res.error) return null;
    return (res.data ?? []) as { id: string }[];
  } catch {
    return null;
  }
}

async function withLinks(sb: Sb, jobs: BriefJob[]): Promise<BriefJob[]> {
  const out: BriefJob[] = [];
  for (const job of jobs) {
    const scope = job.scope === "super" ? "super" : job.scope === "full" ? "full" : null;
    const links = scope ? await signedJobPages((fn, args) => sb.rpc(fn, args), job.job_id, scope) : {};
    out.push({ ...job, links });
  }
  return out;
}

export async function loadBriefJobs(sb: Sb, companyId?: string): Promise<{ hasCompany: boolean; jobs: BriefJob[] }> {
  const cos = await companies(sb);
  if (cos && !cos.length) return { hasCompany: false, jobs: [] };
  let listed: { job_number: string; name: string | null; company_id: string }[] = [];
  try {
    listed = await listedJobs(sb, companyId);
  } catch {
    listed = [];
  }
  if (cos && cos.length && !listed.length) return { hasCompany: true, jobs: [] };
  try {
    const res = await sb.rpc("mcp_morning_brief_feed");
    if (res.error) {
      if ((res.error.message ?? "").startsWith("MCP_")) dbError(res.error);
    } else if (Array.isArray(res.data)) {
      const want = new Set(listed.map((j) => j.job_number));
      const jobs = briefJobsFromFeed(res.data as RawJob[]).filter((j) => !want.size || want.has(j.job_number));
      return { hasCompany: true, jobs: await withLinks(sb, jobs) };
    }
  } catch (e) {
    if (e instanceof ToolError) throw e;
  }
  return {
    hasCompany: cos === null ? listed.length > 0 : true,
    jobs: listed.map((j) => ({
      job_id: "",
      job_number: j.job_number,
      name: j.name ?? "Job",
      company_id: j.company_id,
      time_zone: "America/New_York",
      scope: "full" as const,
      seat: "pm" as const,
      activities: [],
      items: [],
      lookahead: null,
      payApps: [],
      invoices: [],
      links: {},
    })),
  };
}

export async function loadMorningBrief(sb: Sb, companyId?: string) {
  const loaded = await loadBriefJobs(sb, companyId);
  let settings: BriefSettings | undefined;
  try {
    const res = await sb.rpc("mcp_morning_brief_settings_get");
    if (!res.error && res.data && typeof res.data === "object") settings = briefSettingsFrom(res.data as BriefSettings);
  } catch {
    settings = undefined;
  }
  const built = buildMorningBrief({ jobs: loaded.jobs, hasCompany: loaded.hasCompany, settings });
  try {
    await audit(sb, null, "morning_brief", "view_morning_brief", null);
  } catch {
    /* audit never blocks the brief */
  }
  return presentBrief(built.card);
}

export async function readBriefSettings(sb: Sb): Promise<BriefSettings> {
  const res = await sb.rpc("mcp_morning_brief_settings_get");
  if (res.error) {
    if (isMissingFunction(res.error)) return briefSettingsFrom(null);
    dbError(res.error);
  }
  return briefSettingsFrom((res.data ?? null) as Partial<BriefSettings> | null);
}

export async function saveBriefSettings(sb: Sb, input: { enabled?: boolean; send_time?: string; time_zone?: string }): Promise<BriefSettings> {
  let send: string | null = null;
  if (input.send_time?.trim()) {
    send = parseBriefingTime(input.send_time);
    if (!send) throw new ToolError("Say the time like 6:30 AM. Nothing was saved.");
  }
  const res = await sb.rpc("mcp_morning_brief_settings_save", {
    _enabled: input.enabled ?? null,
    _send: send,
    _tz: input.time_zone?.trim() || null,
  });
  if (res.error) dbError(res.error);
  return briefSettingsFrom((res.data ?? null) as Partial<BriefSettings> | null);
}

export function presentSettings(settings: BriefSettings) {
  return presentBrief(settingsCard(settings));
}

export { settingsLine };
