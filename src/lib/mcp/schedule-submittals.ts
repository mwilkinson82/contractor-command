// Schedule-derived submittal groups and the open tracking items that sit beside the living log.
// Read only. Nothing here writes a job.
import { isMissingFunction, type Sb } from "./guard";

export type ScheduleActivity = {
  id: string;
  name: string;
  start?: string | null;
  finish?: string | null;
  critical?: boolean | null;
};

export type TrackingItem = { id: string; action: string; due: string; overdue: boolean };

const SUBMIT = /\bsubmit(?:tal|tals)?\b/i;

/** Submission activities on the saved CPM. Architect review activities stay off this list. */
export function scheduleSubmittalGroups(activities: ScheduleActivity[]): ScheduleActivity[] {
  return activities
    .filter((activity) => activity.id && SUBMIT.test(activity.name) && !/\breview\b/i.test(activity.name))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function scheduleGroupOverdue(activity: ScheduleActivity, today: string): boolean {
  const due = (activity.finish ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today;
}

/** Open items that track a submittal, including E14 turnaround. */
export function trackingFromItems(
  items: { id?: string; action?: string; needed_by?: string | null; due_date?: string | null }[],
  today: string,
): TrackingItem[] {
  const out: TrackingItem[] = [];
  for (const item of items) {
    const action = item.action?.trim() ?? "";
    if (!action) continue;
    const submittal = /\bsubmittals?\b/i.test(action);
    const code = /\bE\d+\b/.test(action) && /turnaround|submittal/i.test(action);
    if (!submittal && !code) continue;
    const due = (item.needed_by ?? item.due_date ?? "").slice(0, 10);
    out.push({
      id: String(item.id ?? action),
      action,
      due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "",
      overdue: /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today,
    });
  }
  return out.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.action.localeCompare(b.action));
}

export async function readScheduleActivities(sb: Sb, jobId: string): Promise<ScheduleActivity[]> {
  try {
    const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>)(
      "mcp_living_report_get",
      { _job: jobId, _type: "cpm", _version: null },
    );
    if (error) {
      if (isMissingFunction(error)) return [];
      return [];
    }
    const body = data as { found?: boolean; data?: { activities?: ScheduleActivity[] } } | null;
    if (!body || body.found === false) return [];
    return Array.isArray(body.data?.activities) ? body.data.activities : [];
  } catch {
    return [];
  }
}

export async function readSubmittalTracking(sb: Sb, jobId: string, today: string): Promise<TrackingItem[]> {
  try {
    const res = await sb.from("mcp_open_items").select("id, action, needed_by, due_date").eq("job_id", jobId).eq("status", "open").limit(200);
    if (res.error || !Array.isArray(res.data)) return [];
    return trackingFromItems(res.data as { id?: string; action?: string; needed_by?: string | null; due_date?: string | null }[], today);
  } catch {
    return [];
  }
}
