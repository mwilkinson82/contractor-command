import { activityTitle } from "../styled-views";
import { dedupeOpenRows, meetingItem } from "../open-feed";
import { blankFlowData } from "./job-2701";
import type { FlowData, FlowItem, IorRow } from "./types";

type Query = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{ data: unknown; error: { message?: string } | null }> & {
        eq: (col: string, val: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function kindOf(action: string, category: string): FlowItem["kind"] {
  const s = `${action} ${category}`;
  if (/change order|\bCO[- ]?\d/i.test(s)) return "change";
  if (/photo/i.test(s)) return "photo";
  if (/daily/i.test(s)) return "daily";
  if (/disrupt|slip|delay/i.test(s)) return "delay";
  if (/risk|\brfi\b|inspect/i.test(s)) return "risk";
  if (/sub|supplier|crew|material/i.test(s)) return "crew";
  return "open";
}

async function rows(sb: Query, table: string, cols: string, jobId: string): Promise<Record<string, unknown>[]> {
  try {
    const q = sb.from(table).select(cols).eq("job_id", jobId);
    const res = await q;
    if (res.error || !Array.isArray(res.data)) return [];
    return res.data as Record<string, unknown>[];
  } catch {
    return [];
  }
}

type SchedAct = { id?: string; name?: string; description?: string; pct_complete?: number | null; critical?: boolean | null; duration?: number | null };

function numish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[%,]/g, "")))) return Number(v.replace(/[%,]/g, ""));
  return null;
}

function actPct(a: Record<string, unknown>): number | null {
  return numish(a.pct_complete ?? a.percent_complete ?? a.percent ?? a.pct);
}

export function scheduleActivities(data: Record<string, unknown>): SchedAct[] {
  const nested = data.schedule && typeof data.schedule === "object" ? (data.schedule as Record<string, unknown>).activities : null;
  const raw = Array.isArray(data.activities) ? data.activities : Array.isArray(nested) ? nested : [];
  return raw.filter((a): a is Record<string, unknown> => !!a && typeof a === "object").map((a) => ({
    id: typeof a.id === "string" ? a.id : undefined,
    name: typeof a.name === "string" ? a.name : undefined,
    description: typeof a.description === "string" ? a.description : undefined,
    pct_complete: actPct(a),
    critical: a.critical === true,
    duration: numish(a.duration),
  }));
}

/** Average of the percents on the saved schedule. Null when none are recorded. */
export function schedulePercent(activities: SchedAct[], root?: Record<string, unknown>): number | null {
  const top = root ? numish(root.percent_complete ?? root.pct_complete ?? root.percent) : null;
  if (top != null) return Math.max(0, Math.min(100, Math.round(top)));
  const pcts = activities.map((a) => a.pct_complete).filter((n): n is number => n != null);
  if (!pcts.length) return null;
  return Math.max(0, Math.min(100, Math.round(pcts.reduce((s, n) => s + n, 0) / pcts.length)));
}

/** Reads the job's lookahead, pay app, IOR, and open items. Does not write or delete. */
export async function loadFlowData(sb: Query, job: { job_id: string; job_number: string; name: string; scope: string }, selfPerform: boolean): Promise<FlowData> {
  const showMoney = job.scope === "full";
  const data = blankFlowData(job.job_number, job.name, showMoney);
  data.jobId = job.job_id;
  data.selfPerform = selfPerform;
  const [items, lookaheads, reports] = await Promise.all([
    rows(sb, "mcp_open_items", "id, action, owner, accountable, due_date, needed_by, status, category, check_key, updated_at", job.job_id),
    rows(sb, "mcp_lookaheads", "id, start_date, end_date", job.job_id),
    (async () => {
      const out: Record<string, unknown> = {};
      for (const type of ["cpm", "billing_forecast", "ior"]) {
        try {
          const res = await sb.rpc("mcp_living_report_get", { _job: job.job_id, _type: type, _version: null });
          if (!res.error && res.data) out[type] = res.data;
        } catch {
          /* a missing report leaves that part of the card as Needed */
        }
      }
      try {
        const prev = await sb.rpc("mcp_guided_latest", { _job: job.job_id, _flow: "pm_meeting" });
        if (!prev.error && prev.data) out.previous = prev.data;
      } catch {
        /* comparison stays empty until a meeting has been saved */
      }
      return out;
    })(),
  ]);
  data.lookaheadLocked = lookaheads.some((l) => l.start_date && l.end_date) ? true : lookaheads.length ? false : null;
  const open = items.filter((i) => i.status !== "closed" && i.status !== "resolved");
  const distinct = dedupeOpenRows(open.map((i) => ({
    id: String(i.id ?? ""),
    action: String(i.action ?? ""),
    check_key: typeof i.check_key === "string" ? i.check_key : null,
    needed_by: typeof i.needed_by === "string" ? i.needed_by : null,
    due_date: typeof i.due_date === "string" ? i.due_date : null,
    updated_at: typeof i.updated_at === "string" ? i.updated_at : null,
    owner: (i.accountable as string | null) ?? (i.owner as string | null) ?? null,
  })));
  const byId = new Map(open.map((i) => [String(i.id ?? ""), i]));
  data.items = distinct.map((row) => {
    const i = byId.get(row.id) ?? {};
    return {
      id: row.id,
      action: String(i.action ?? row.action),
      owner: (i.accountable as string | null) ?? (i.owner as string | null) ?? row.owner ?? null,
      due: String(i.needed_by ?? i.due_date ?? "").slice(0, 10) || null,
      kind: kindOf(String(i.action ?? row.action), String(i.category ?? "")),
      status: "open" as const,
    };
  });
  data.crewsConfirmed = data.items.some((i) => i.kind === "crew") ? false : data.items.length ? true : null;
  data.onSchedule = data.items.some((i) => i.kind === "delay") ? false : data.lookaheadLocked ? true : null;
  const billing = (reports.billing_forecast as { found?: boolean; data?: { billing?: { billed_to_date?: number; months?: { amount?: number; kind?: string }[] } }; contract_total?: number } | undefined) ?? {};
  if (showMoney && billing.found) {
    const months = billing.data?.billing?.months ?? [];
    const forecast = months.filter((m) => m.kind === "forecast").reduce((s, m) => s + (m.amount ?? 0), 0);
    data.money.plan = forecast || null;
    data.money.billed = billing.data?.billing?.billed_to_date ?? null;
    data.money.contract = billing.contract_total ?? null;
    if (data.money.contract !== null && data.money.billed !== null) data.money.remaining = Math.round((data.money.contract - data.money.billed) * 100) / 100;
  }
  const cpm = reports.cpm as { found?: boolean; data?: Record<string, unknown> } | undefined;
  if (cpm?.found && cpm.data) {
    const acts = scheduleActivities(cpm.data);
    data.percentComplete = schedulePercent(acts, cpm.data);
    data.activitiesDone = acts.filter((a) => schedulePercent([a]) === 100).map((a) => activityTitle(a));
    const critical = acts.filter((a) => a.critical);
    const open = critical.filter((a) => a.pct_complete !== 100);
    data.criticalPath = critical.length ? (open.length ? `Open: ${open.slice(0, 3).map((a) => activityTitle(a)).join(", ")}` : "Clear") : null;
  }
  const ior = reports.ior as { found?: boolean; data?: { items?: IorRow[] } } | undefined;
  if (ior?.found && Array.isArray(ior.data?.items)) data.iorNow = ior.data.items;
  const previous = reports.previous as { found?: boolean; snapshot?: { ior?: IorRow[] } } | undefined;
  data.hasSnapshot = previous?.found === true;
  if (data.hasSnapshot && Array.isArray(previous?.snapshot?.ior)) data.iorPrevious = previous.snapshot.ior;
  data.spillover = data.items.filter((i) => /last night|spill/i.test(i.action)).map((i) => i.action);
  data.dailies = data.items.filter((i) => i.kind === "daily").map((i) => i.action);
  data.photos = data.items.filter((i) => i.kind === "photo").map((i) => i.action);
  data.disruptions = data.items.filter((i) => i.kind === "disruption" || i.kind === "delay").map((i) => i.action);
  return data;
}

export async function saveFlowNote(sb: Query, jobId: string, flow: string, stage: string, note: string, snapshot: unknown): Promise<{ item: boolean; snapshot: boolean }> {
  let item = false;
  let snapshotOk = false;
  try {
    const meeting = meetingItem(note);
    const added = meeting
      ? await sb.rpc("mcp_meeting_item_save", { _job: jobId, _key: meeting.key, _action: note, _close: meeting.close })
      : await sb.rpc("mcp_add_item", { _job: jobId, _f: { action: note, category: flow === "pm_evening" ? "Daily" : "Risk", tool: flow, section: stage } });
    const missing = !!added.error && /does not exist|schema cache|PGRST202/i.test(String((added.error as { message?: string; code?: string }).message ?? "") + String((added.error as { code?: string }).code ?? ""));
    if (meeting && missing) {
      const fallback = await sb.rpc("mcp_add_item", { _job: jobId, _f: { action: note, check_key: meeting.key, category: "Meeting", tool: flow, section: stage } });
      item = !fallback.error;
    } else item = !added.error;
  } catch {
    item = false;
  }
  try {
    const saved = await sb.rpc("mcp_guided_save", { _job: jobId, _flow: flow, _stage: stage, _snapshot: snapshot });
    snapshotOk = !saved.error;
  } catch {
    snapshotOk = false;
  }
  return { item, snapshot: snapshotOk };
}
