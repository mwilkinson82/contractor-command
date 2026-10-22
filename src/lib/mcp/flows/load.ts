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

/** Reads the job's lookahead, pay app, IOR, and open items. Does not write or delete. */
export async function loadFlowData(sb: Query, job: { job_id: string; job_number: string; name: string; scope: string }, selfPerform: boolean): Promise<FlowData> {
  const showMoney = job.scope === "full";
  const data = blankFlowData(job.job_number, job.name, showMoney);
  data.selfPerform = selfPerform;
  const [items, lookaheads, reports] = await Promise.all([
    rows(sb, "mcp_open_items", "id, action, owner, accountable, due_date, needed_by, status, category", job.job_id),
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
  data.items = items
    .filter((i) => i.status !== "closed")
    .map((i) => ({
      id: String(i.id ?? ""),
      action: String(i.action ?? ""),
      owner: (i.accountable as string | null) ?? (i.owner as string | null) ?? null,
      due: String(i.needed_by ?? i.due_date ?? "").slice(0, 10) || null,
      kind: kindOf(String(i.action ?? ""), String(i.category ?? "")),
      status: "open" as const,
    }));
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
    const added = await sb.rpc("mcp_add_item", { _job: jobId, _f: { action: note, category: flow === "pm_evening" ? "Daily" : "Risk", tool: flow, section: stage } });
    item = !added.error;
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
