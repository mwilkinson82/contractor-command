// Saved daily evidence only; references are reported, not approved mappings.
export type DailyProductionRow = {
  id: string; daily_id: string; report_date: string; created_at: string;
  work: string; sov_item: string | null; activity_id: string | null; unit: string;
  qty: number | string; crew: number | string; hours: number | string;
  man_hours: number | string; qty_per_man_hour: number | string;
};

/** "SOV 26.04, activity E090", or says which link the job doesn't have. */
export function productionRef(sov: string | null | undefined, activity: string | null | undefined): string {
  if (sov && activity) return `SOV ${sov}, activity ${activity}`;
  if (sov) return `SOV ${sov}, no CPM activity`;
  if (activity) return `No SOV item, activity ${activity}`;
  return "No SOV item or CPM activity";
}

export function summarizeProduction(rows: DailyProductionRow[]) {
  const groups = new Map<string, { sov_item: string | null; activity_id: string | null; work?: string | null; unit: string; quantity: number; reported_person_hours: number; records: number }>();
  for (const row of rows) {
    const quantity = Number(row.qty), hours = Number(row.man_hours);
    if (!row.unit || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(hours) || hours <= 0) continue;
    const sov = row.sov_item || null, activity = row.activity_id || null;
    // Work saved with no SOV item and no CPM activity groups by its description instead.
    const work = sov || activity ? null : row.work.trim().toLowerCase() || null;
    const key = JSON.stringify([sov, activity, work, row.unit]);
    const group = groups.get(key) ?? { sov_item: sov, activity_id: activity, work: work ? row.work.trim() : null, unit: row.unit, quantity: 0, reported_person_hours: 0, records: 0 };
    group.quantity += quantity; group.reported_person_hours += hours; group.records++;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, actual_rate: group.quantity / group.reported_person_hours }));
}

export function productionPeriod(from: string | undefined, to: string | undefined, today: string, range?: "last_7_days" | "this_week") {
  if (range && (from || to)) throw new Error("Choose either a named period or two dates.");
  if (!!from !== !!to) throw new Error("Provide both dates for the production period.");
  const parse = (date: string) => { const ms = Date.parse(`${date}T00:00:00Z`); if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error("Use valid production dates."); return ms; };
  const todayMs = parse(today);
  if (range === "this_week") {
    const weekday = new Date(todayMs).getUTCDay();
    const monday = todayMs - ((weekday + 6) % 7) * 86400000;
    return { from: new Date(monday).toISOString().slice(0, 10), to: new Date(monday + 6 * 86400000).toISOString().slice(0, 10) };
  }
  const end = to ?? today;
  const endMs = parse(end);
  const start = from ?? new Date(endMs - 6 * 86400000).toISOString().slice(0, 10);
  const startMs = parse(start);
  if (startMs > endMs || endMs - startMs > 30 * 86400000) throw new Error("Choose a production period of at most 31 days.");
  return { from: start, to: end };
}
