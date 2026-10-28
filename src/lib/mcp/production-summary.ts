// Saved daily evidence only; references are reported, not approved mappings.
export type DailyProductionRow = {
  id: string; daily_id: string; report_date: string; created_at: string;
  work: string; sov_item: string; activity_id: string; unit: string;
  qty: number | string; crew: number | string; hours: number | string;
  man_hours: number | string; qty_per_man_hour: number | string;
};

export function summarizeProduction(rows: DailyProductionRow[]) {
  const groups = new Map<string, { sov_item: string; activity_id: string; unit: string; quantity: number; reported_person_hours: number; records: number }>();
  for (const row of rows) {
    const quantity = Number(row.qty), hours = Number(row.man_hours);
    if (!row.sov_item || !row.activity_id || !row.unit || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(hours) || hours <= 0) continue;
    const key = JSON.stringify([row.sov_item, row.activity_id, row.unit]);
    const group = groups.get(key) ?? { sov_item: row.sov_item, activity_id: row.activity_id, unit: row.unit, quantity: 0, reported_person_hours: 0, records: 0 };
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
