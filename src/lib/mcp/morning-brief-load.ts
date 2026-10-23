// Loads the caller's jobs for the morning brief. Falls back to job names when the feed
// function is not installed yet. Does not send anything and does not delete rows.
import { signedJobPages } from "./board-url";
import { dbError, isMissingFunction, type Sb } from "./guard";
import { audit } from "./jobs";
import {
  briefSettingsFrom,
  buildMorningBrief,
  ensureBriefCard,
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
import { chaseBriefRows, type ChaseRow } from "./submittal-chase";

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

async function companies(sb: Sb): Promise<{ id: string; name: string | null }[] | null> {
  try {
    const res = await sb.from("mcp_companies").select("id, name");
    if (res.error) return null;
    return (res.data ?? []) as { id: string; name: string | null }[];
  } catch {
    return null;
  }
}

async function withLinks(sb: Sb, jobs: BriefJob[]): Promise<BriefJob[]> {
  return Promise.all(jobs.map(async (job) => {
    const scope = job.scope === "super" ? "super" : job.scope === "full" ? "full" : null;
    const links = scope ? await signedJobPages((fn, args) => sb.rpc(fn, args), job.job_id, scope) : {};
    return { ...job, links };
  }));
}

function stubJob(j: { job_number: string; name: string | null; company_id: string }): BriefJob {
  return {
    job_id: "",
    job_number: j.job_number,
    name: j.name ?? "Job",
    company_id: j.company_id,
    time_zone: "America/New_York",
    scope: "full",
    seat: "pm",
    activities: [],
    items: [],
    lookahead: null,
    payApps: [],
    invoices: [],
    links: {},
  };
}

/** The feed can come back empty, or drop a job whose scope field is missing, while mcp_open_items still has 2701. */
export function mergeBriefJobs(listed: { job_number: string; name: string | null; company_id: string }[], feed: BriefJob[]): BriefJob[] {
  const byNumber = new Map(feed.map((job) => [job.job_number, job]));
  const merged = listed.map((job) => byNumber.get(job.job_number) ?? stubJob(job));
  for (const job of feed) if (!merged.some((row) => row.job_number === job.job_number)) merged.push(job);
  return merged;
}

async function fillOpenItems(sb: Sb, jobs: BriefJob[]): Promise<BriefJob[]> {
  // The feed already returned items for jobs it found. This query is only for a stub the feed dropped.
  const stubs = jobs.filter((job) => !job.job_id);
  if (!stubs.length) return jobs;
  const numbers = [...new Set(stubs.map((job) => job.job_number).filter(Boolean))];
  if (!numbers.length) return jobs;
  try {
    const found = await sb.from("mcp_jobs").select("id, job_number").in("job_number", numbers);
    if (found.error || !Array.isArray(found.data)) return jobs;
    const idOf = new Map((found.data as { id: string; job_number: string }[]).map((row) => [row.job_number, row.id]));
    const ids = [...idOf.values()];
    if (!ids.length) return jobs;
    const items = await sb.from("mcp_open_items").select("id, job_id, action, check_key, category, item_type, kind, owner, accountable, needed_by, due_date, updated_at, internal_only").in("job_id", ids).eq("status", "open").limit(500);
    if (items.error || !Array.isArray(items.data)) return jobs;
    const byJob = new Map<string, BriefItem[]>();
    for (const raw of items.data as (RawItem & { job_id?: string })[]) {
      if (!raw.job_id || !raw.action) continue;
      const list = byJob.get(raw.job_id) ?? [];
      list.push({
        id: String(raw.id ?? raw.action),
        action: String(raw.action),
        check_key: raw.check_key ?? null,
        category: raw.category ?? null,
        item_type: raw.item_type ?? null,
        kind: raw.kind ?? null,
        owner: raw.owner ?? null,
        accountable: raw.accountable ?? null,
        needed_by: raw.needed_by ?? null,
        due_date: raw.due_date ?? null,
        updated_at: raw.updated_at ?? null,
        internal_only: raw.internal_only === true,
        cost_effect: null,
      });
      byJob.set(raw.job_id, list);
    }
    return jobs.map((job) => {
      const id = job.job_id || idOf.get(job.job_number) || "";
      const table = byJob.get(id) ?? [];
      if (job.items.length || !table.length) return { ...job, job_id: id || job.job_id };
      return { ...job, job_id: id, items: table };
    });
  } catch {
    return jobs;
  }
}

export async function loadBriefJobs(sb: Sb, companyId?: string): Promise<{ hasCompany: boolean; jobs: BriefJob[] }> {
  const cos = await companies(sb);
  if (cos && !cos.length) return { hasCompany: false, jobs: [] };
  void companyId;
  let listed: { job_number: string; name: string | null; company_id: string }[] = [];
  try {
    listed = await listedJobs(sb, undefined, { allCompanies: true });
  } catch {
    listed = [];
  }
  let feed: BriefJob[] = [];
  try {
    const res = await sb.rpc("mcp_morning_brief_feed");
    if (res.error) {
      if (!isMissingFunction(res.error) && (res.error.message ?? "").startsWith("MCP_")) dbError(res.error);
    } else if (Array.isArray(res.data)) {
      feed = briefJobsFromFeed(res.data as RawJob[]);
    }
  } catch (e) {
    if (e instanceof ToolError) throw e;
  }
  // An empty or filtered feed used to return no jobs, so 2701's saved open items never reached the card.
  const names = new Map((cos ?? []).map((company) => [company.id, company.name?.trim() || "Company"]));
  const named = (await fillOpenItems(sb, mergeBriefJobs(listed, feed))).map((job) => ({
    ...job,
    company_name: names.get(job.company_id) || job.company_name,
  }));
  return { hasCompany: cos === null ? named.length > 0 : true, jobs: await withLinks(sb, named) };
}

/** Records the day for the proactive push only. A failure here never blocks the brief the member asked for. */
async function markBriefShown(sb: Sb): Promise<void> {
  try {
    await sb.rpc("mcp_morning_brief_mark_shown");
  } catch {
    /* one push a day; a missed mark still returns the full brief */
  }
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
  built.card = ensureBriefCard(built.card);
  try {
    const due = await sb.rpc("mcp_submittal_chase_due");
    if (!due.error && Array.isArray(due.data) && due.data.length) {
      const rows = chaseBriefRows(due.data as ChaseRow[]);
      const overdue = rows.filter((row) => row.flag === "overdue").length;
      built.card.sections = [...(built.card.sections ?? []), { heading: "Chases", kind: "list", rows }];
      built.card.kpis = [...(built.card.kpis ?? []), { label: "Chases", value: String(rows.length), flag: overdue ? "overdue" : null }];
    }
  } catch {
    /* a missing chase feed never blocks the brief */
  }
  try {
    await audit(sb, null, "morning_brief", "view_morning_brief", null);
  } catch {
    /* audit never blocks the brief */
  }
  await markBriefShown(sb);
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
