// Reads the deeper job facts the PM morning brief needs for a few focus jobs: the saved CPM,
// the IOR, change orders, buyout, saved pay applications and recent daily reports.
// Read-only. Every part is optional: a missing or refused read leaves that part null.
import type { Sb } from "./guard";
import type { BriefJob } from "./morning-brief";
import { SovMismatch, buildSov } from "./sov";

/** Contract total from the saved SOV with executed change orders, as the living reports read it. */
async function contractTotal(sb: Sb, jobId: string): Promise<number | null> {
  const [jr, facts] = await Promise.all([
    sb.from("mcp_jobs").select("sov_fee_pct").eq("id", jobId).maybeSingle(),
    sb.from("mcp_job_facts").select("key, value").eq("job_id", jobId).eq("module", "sov"),
  ]);
  if (jr.error || facts.error) return null;
  const lines = ((facts.data ?? []) as { key: string; value: unknown }[]).map((f) => {
    const v = (f.value ?? {}) as { executed_change_order?: string; fee_included?: boolean; description?: string | null; billable_value?: number | null };
    return { executed_change_order: v.executed_change_order, fee_included: v.fee_included, item_no: f.key, description: v.description ?? null, scheduled_value: typeof v.billable_value === "number" ? v.billable_value : null };
  });
  if (!lines.length) return null;
  const fee = (jr.data as { sov_fee_pct?: unknown } | null)?.sov_fee_pct == null ? null : Number((jr.data as { sov_fee_pct: unknown }).sov_fee_pct);
  try {
    return buildSov(lines, fee, null).summary.contract_total;
  } catch (e) {
    if (e instanceof SovMismatch) return null;
    throw e;
  }
}

export type FocusAct = {
  id: string;
  name: string;
  start: string | null;
  finish: string | null;
  duration: number | null;
  pct: number;
  critical: boolean;
  total_float: number | null;
  party: "sub" | "self" | null;
  subco: string | null;
  remaining: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  sov_line: string | null;
  milestone: boolean;
};

export type FocusRisk = {
  title: string;
  owner: string | null;
  status: string;
  response: string | null;
  category: string | null;
  dollar: number;
  probability: number | null;
  next_review: string | null;
  next_move: string | null;
};

export type FocusCo = {
  number: string;
  title: string;
  state: string;
  total: number | null;
  due: string | null;
};

export type FocusData = {
  cpm: {
    version: number | null;
    data_date: string | null;
    contract_completion: string | null;
    forecast_finish: string | null;
    work_days_mask: number | null;
    acts: FocusAct[];
  } | null;
  ior: {
    pct: number | null;
    cost_to_date: number | null;
    original_contract: number | null;
    original_budget: number | null;
    cost_growth: number | null;
    risks: FocusRisk[];
    pending_cos: { number: string; title: string; amount: number | null; status: string }[];
  } | null;
  cos: FocusCo[] | null;
  buyout: { parties: string[]; ordered: string[]; packages: number } | null;
  pay: { count: number; latest: { number: string; period_end: string | null; state: string } | null; issue: string | null } | null;
  contract_total: number | null;
  /** Daily report dates (YYYY-MM-DD) saved in the last few weeks. */
  dailies: string[] | null;
  /** The job's submittal log, current revision of each number. Null when it couldn't be read. */
  submittals?: FocusSubmittal[] | null;
};

export type FocusSubmittal = {
  number: string;
  revision: number;
  title: string;
  status: string;
  ball: string | null;
  ball_name: string | null;
  due: string | null;
};

const SUBMITTAL_DONE = new Set(["approved", "approved_as_noted", "closed", "void"]);

/** Current revision of each submittal number, with its due date (due back, else required by). */
export function focusSubmittals(rows: unknown): FocusSubmittal[] | null {
  if (!Array.isArray(rows)) return null;
  const latest = new Map<string, FocusSubmittal>();
  for (const raw of rows) {
    const r = obj(raw);
    const number = str(r?.number);
    if (!r || !number) continue;
    const row: FocusSubmittal = {
      number,
      revision: num(r.revision) ?? 0,
      title: str(r.title) ?? "Submittal",
      status: str(r.status) ?? "not_started",
      ball: str(r.ball_in_court),
      ball_name: str(r.ball_in_court_name),
      due: day(r.due_back) ?? day(r.required_by),
    };
    const key = number.toLowerCase();
    const prev = latest.get(key);
    if (!prev || row.revision >= prev.revision) latest.set(key, row);
  }
  return [...latest.values()];
}

/** Submittals still moving: not approved, closed or void. */
export const openSubmittals = (rows: FocusSubmittal[] | null | undefined): FocusSubmittal[] =>
  (rows ?? []).filter((row) => !SUBMITTAL_DONE.has(row.status));

type Call = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

async function quiet<T>(work: () => PromiseLike<T> | T): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

/** Saved CPM: activities with their responsible party and subcontractor from the schedule's activity codes. */
export function focusCpm(report: unknown): FocusData["cpm"] {
  const g = obj(report);
  if (!g || g.found === false) return null;
  const data = obj(g.data) ?? {};
  const control = obj(data.schedule_control) ?? {};
  const codeValues = obj(control.code_values) ?? obj(data.code_values) ?? {};
  const subNames = new Map<string, string>();
  for (const code of [...arr(control.activity_codes), ...arr(data.activity_codes)]) {
    const c = obj(code);
    if (!c || c.id !== "subco") continue;
    for (const v of arr(c.values)) {
      const value = obj(v);
      const id = str(value?.id);
      const name = str(value?.name);
      if (id && name) subNames.set(id, name);
    }
  }
  const acts: FocusAct[] = [];
  for (const raw of arr(data.activities)) {
    const a = obj(raw);
    if (!a) continue;
    const id = str(a.id) ?? "";
    const codes = obj(codeValues[id]) ?? {};
    const party = codes.party === "sub" || codes.party === "self" ? codes.party : null;
    const subcoId = str(codes.subco);
    const type = str(a.activity_type) ?? "";
    acts.push({
      id,
      name: str(a.name) ?? str(a.description) ?? "Activity",
      start: day(a.start),
      finish: day(a.finish),
      duration: num(a.duration),
      pct: Math.max(0, Math.min(100, num(a.pct_complete) ?? (day(a.actual_finish) ? 100 : 0))),
      critical: a.critical === true,
      total_float: num(a.total_float),
      party,
      subco: subcoId ? subNames.get(subcoId) ?? null : null,
      remaining: num(a.remaining_duration),
      actual_start: day(a.actual_start),
      actual_finish: day(a.actual_finish),
      sov_line: str(a.sov_line),
      milestone: type.startsWith("milestone") || num(a.duration) === 0,
    });
  }
  const calc = obj(control.calculation) ?? obj(data.calculation);
  const settings = obj(control.settings) ?? obj(data.settings);
  const calendars = arr(settings?.calendars).map(obj).filter(Boolean) as Record<string, unknown>[];
  const calId = str(settings?.default_calendar_id);
  const calendar = calendars.find((c) => c.id === calId) ?? calendars[0];
  const forecast = acts.reduce<string | null>((max, a) => (a.finish && (!max || a.finish > max) ? a.finish : max), null);
  return {
    version: num(g.version),
    data_date: day(g.data_date) ?? day(calc?.data_date) ?? day(data.data_date),
    contract_completion: day(g.contract_completion_date) ?? day(data.contract_completion_date) ?? day(data.contract_completion),
    forecast_finish: forecast,
    work_days_mask: num(calendar?.work_days),
    acts,
  };
}

/** IOR exposures, percent complete and cost, as the IOR model saved them. */
export function focusIor(report: unknown): FocusData["ior"] {
  const g = obj(report);
  if (!g || g.found === false) return null;
  const data = obj(g.data) ?? {};
  const model = obj(data.ior_model) ?? data;
  const risks: FocusRisk[] = [];
  for (const raw of arr(model.exposures ?? model.risks)) {
    const r = obj(raw);
    if (!r) continue;
    const title = str(r.title) ?? str(r.name);
    if (!title) continue;
    risks.push({
      title,
      owner: str(r.owner),
      status: (str(r.status) ?? "active").toLowerCase(),
      response: str(r.response),
      category: str(r.category),
      dollar: num(r.dollar_risk) ?? num(r.amount) ?? 0,
      probability: num(r.probability),
      next_review: day(r.next_review),
      next_move: str(r.next_move),
    });
  }
  const pending_cos = arr(model.change_orders)
    .map(obj)
    .filter((c): c is Record<string, unknown> => !!c && !/approved|executed|rejected/i.test(String(c.status ?? "")))
    .map((c) => ({ number: str(c.number) ?? "CO", title: str(c.description) ?? "Change order", amount: num(c.contract_amount), status: str(c.status) ?? "Pending" }));
  return {
    pct: num(model.percent_complete),
    cost_to_date: num(model.actual_cost_to_date),
    original_contract: num(model.original_contract),
    original_budget: num(model.original_cost_budget),
    cost_growth: num(model.cost_growth),
    risks,
    pending_cos,
  };
}

export function focusCos(payload: unknown): FocusData["cos"] {
  const p = obj(payload);
  if (!p) return null;
  const out: FocusCo[] = [];
  for (const raw of arr(p.records)) {
    const r = obj(raw);
    const d = obj(r?.change_order_details);
    if (!r || !d) continue;
    const cents = num(d.total_cents);
    out.push({
      number: str(r.number) ?? "CO",
      title: str(r.title) ?? "Change order",
      state: (str(d.state) ?? "draft").toLowerCase(),
      total: cents == null ? null : cents / 100,
      due: day(d.due_date),
    });
  }
  return out;
}

export function focusBuyout(ledger: unknown): FocusData["buyout"] {
  const l = obj(ledger);
  if (!l) return null;
  const parties = arr(l.parties).map(obj).filter(Boolean) as Record<string, unknown>[];
  const nameOf = new Map(parties.map((p) => [String(p.id), str(p.name) ?? ""]));
  const ordered = new Set<string>();
  for (const raw of arr(l.orders)) {
    const o = obj(raw);
    const latest = arr(o?.versions).map(obj).filter(Boolean).at(-1) as Record<string, unknown> | undefined;
    if (!o || /void|cancel/i.test(String(latest?.status ?? ""))) continue;
    const name = nameOf.get(String(o.party_id));
    if (name) ordered.add(name);
  }
  const packages = arr(l.records).filter((r) => obj(r)?.kind === "package").length;
  return { parties: [...nameOf.values()].filter(Boolean), ordered: [...ordered], packages };
}

export function focusPay(context: unknown): FocusData["pay"] {
  const c = obj(context);
  if (!c) return null;
  const apps = arr(c.applications).map(obj).filter((a): a is Record<string, unknown> => !!a && a.working_state !== "cancelled");
  const saved = apps.filter((a) => !a.working_state);
  const latest = saved.sort((a, b) => String(b.period_end ?? "").localeCompare(String(a.period_end ?? "")))[0];
  return {
    count: saved.length,
    latest: latest ? { number: str(latest.number) ?? "Pay app", period_end: day(latest.period_end), state: str(latest.state) ?? "" } : null,
    issue: str(c.snapshot_issue),
  };
}

/** Loads the deeper facts for one job. Superintendents get the schedule and dailies only; money stays out. */
export async function loadFocusData(sb: Sb, job: BriefJob, today: string): Promise<FocusData> {
  const call = sb.rpc.bind(sb) as unknown as Call;
  const full = job.scope === "full";
  const rpc = (fn: string, args: Record<string, unknown>) =>
    quiet(async () => {
      const res = await call(fn, args);
      return res.error ? null : res.data;
    });
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 400);
  const [cpm, ior, cos, buyout, pay, contract, dailies, submittals] = await Promise.all([
    job.scope === "contract" ? null : rpc("mcp_living_report_get", { _job: job.job_id, _type: "cpm", _version: null }),
    full ? rpc("mcp_living_report_get", { _job: job.job_id, _type: "ior", _version: null }) : null,
    job.scope === "super" ? null : rpc("mcp_change_rows", { _job: job.job_id }),
    full ? rpc("mcp_buyout_get", { _company: job.company_id, _job: job.job_id }) : null,
    full ? rpc("mcp_billing_evidence_record", { _job: job.job_id, _action: "payment_application_read", _p: {} }) : null,
    full ? quiet(() => contractTotal(sb, job.job_id)) : null,
    job.scope === "contract"
      ? null
      : quiet(async () => {
          const res = await sb.from("mcp_daily_reports").select("report_date").eq("job_id", job.job_id).gte("report_date", since.toISOString().slice(0, 10)).limit(500);
          if (res.error || !Array.isArray(res.data)) return null;
          return (res.data as { report_date?: string }[]).map((row) => day(row.report_date)).filter((d): d is string => !!d);
        }),
    job.scope === "super"
      ? null
      : quiet(async () => {
          const res = await sb.from("mcp_submittals").select("number, revision, title, status, ball_in_court, ball_in_court_name, due_back, required_by").eq("job_id", job.job_id).limit(500);
          return res.error ? null : focusSubmittals(res.data);
        }),
  ]);
  return {
    cpm: focusCpm(cpm),
    ior: full ? focusIor(ior) : null,
    cos: job.scope === "super" ? null : focusCos(cos),
    buyout: full ? focusBuyout(buyout) : null,
    pay: full ? focusPay(pay) : null,
    contract_total: full ? contract : null,
    dailies: dailies ?? null,
    submittals: submittals ?? null,
  };
}

/** Jobs that get the full brief: the named job, or up to three jobs with a saved schedule and work left. */
export function pickFocusJobs(jobs: BriefJob[], max = 3): BriefJob[] {
  const withIds = jobs.filter((job) => job.job_id);
  if (withIds.length <= 1) return withIds;
  const scored = withIds
    .map((job) => {
      const last = job.activities.reduce<string>((m, a) => (a.finish && a.finish > m ? a.finish : m), "");
      return { job, last, acts: job.activities.length };
    })
    .filter((row) => row.acts > 0)
    .sort((a, b) => b.last.localeCompare(a.last) || b.acts - a.acts);
  return scored.slice(0, max).map((row) => row.job);
}

/** The member's first name for the greeting, from their own member row. */
export async function memberFirstName(sb: Sb): Promise<string | null> {
  return quiet(async () => {
    const auth = (sb as unknown as { auth?: { getUser?: () => Promise<{ data?: { user?: { id?: string } | null } }> } }).auth;
    const user = auth?.getUser ? (await auth.getUser()).data?.user : null;
    if (!user?.id) return null;
    const res = await sb.from("mcp_company_members").select("display_name").eq("user_id", user.id).limit(5);
    if (res.error || !Array.isArray(res.data)) return null;
    const name = (res.data as { display_name?: string | null }[]).map((row) => row.display_name?.trim()).find(Boolean);
    const first = name?.split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, "");
    return first && first.length <= 30 ? first : null;
  });
}
