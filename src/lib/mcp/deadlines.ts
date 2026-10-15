// Deadline math for the PM agent. Pure functions: dates are YYYY-MM-DD strings, no time-of-day.
export type DayType = "calendar" | "business" | "working";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000);
const dow = (s: string) => parse(s).getUTCDay();

function nthWeekday(y: number, m: number, wd: number, n: number) {
  const d = new Date(Date.UTC(y, m, 1));
  d.setUTCDate(1 + ((wd - d.getUTCDay() + 7) % 7) + (n - 1) * 7);
  return iso(d);
}
function lastWeekday(y: number, m: number, wd: number) {
  const d = new Date(Date.UTC(y, m + 1, 0));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - wd + 7) % 7));
  return iso(d);
}
function observed(s: string) {
  const w = dow(s);
  return w === 6 ? addDays(s, -1) : w === 0 ? addDays(s, 1) : s;
}
/** US federal holidays (observed dates) for a year. */
export function federalHolidays(y: number): string[] {
  return [
    observed(`${y}-01-01`), nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), lastWeekday(y, 4, 1), observed(`${y}-06-19`),
    observed(`${y}-07-04`), nthWeekday(y, 8, 1, 1), nthWeekday(y, 9, 1, 2), observed(`${y}-11-11`), nthWeekday(y, 10, 4, 4), observed(`${y}-12-25`),
  ];
}

export function addCountedDays(start: string, n: number, type: DayType, holidays: Set<string>) {
  if (type === "calendar") return addDays(start, n);
  let d = start;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const w = dow(d);
    if (w !== 0 && w !== 6 && !holidays.has(d)) left--;
  }
  return d;
}

export function rollForward(s: string, holidays: Set<string>) {
  let d = s;
  while (dow(d) === 0 || dow(d) === 6 || holidays.has(d)) d = addDays(d, 1);
  return d;
}

export type Clause = {
  id: string; label: string; clause_ref: string | null; trigger_desc: string | null; trigger_date: string | null; trigger_alternatives: string[];
  n_days: number | null; day_type: DayType | null; holidays: string[] | null; weekend_roll: boolean; fixed_date: string | null;
};
export type Computed = { due: string | null; precautions: string[]; math: string; alternatives: string[] };

/** Conservative due date: earliest trigger, earliest day-type reading, never pushed later for weekends unless the contract says so. */
export function computeDue(c: Clause): Computed {
  if (c.fixed_date) return { due: c.fixed_date, precautions: [], math: `fixed date ${c.fixed_date}${c.clause_ref ? ` (${c.clause_ref})` : ""}`, alternatives: [] };
  if (!c.trigger_date || c.n_days == null) return { due: null, precautions: [], math: "trigger date or day count unknown", alternatives: [] };
  const precautions: string[] = [];
  const alternatives: string[] = [];
  const triggers = [c.trigger_date, ...c.trigger_alternatives].sort();
  const trigger = triggers[0];
  if (triggers.length > 1) {
    precautions.push(`Precaution — assumed date, not a contract fact. Trigger is ambiguous; used the earliest reading (${trigger}). Basis: earliest of ${triggers.join(", ")}.`);
  }
  const years = new Set<number>();
  for (let y = Number(trigger.slice(0, 4)); y <= Number(trigger.slice(0, 4)) + 1; y++) years.add(y);
  const assumedHol = !c.holidays;
  const hol = new Set(c.holidays ?? [...years].flatMap(federalHolidays));
  let due: string;
  let math: string;
  if (c.day_type) {
    due = addCountedDays(trigger, c.n_days, c.day_type, hol);
    math = `${trigger} + ${c.n_days} ${c.day_type} days = ${due}`;
    if (c.day_type !== "calendar" && assumedHol) precautions.push(`Precaution — assumed date, not a contract fact. Holidays not listed in the contract; assumed US federal holidays. Basis: ${math}.`);
    if (c.day_type === "working") precautions.push(`Precaution — assumed date, not a contract fact. Working days not defined; counted Monday–Friday excluding holidays. Basis: ${math}.`);
  } else {
    const cal = addCountedDays(trigger, c.n_days, "calendar", hol);
    const bus = addCountedDays(trigger, c.n_days, "business", hol);
    due = cal <= bus ? cal : bus;
    const alt = cal <= bus ? bus : cal;
    math = `${trigger} + ${c.n_days} calendar days = ${cal}; ${trigger} + ${c.n_days} business days = ${bus}`;
    alternatives.push(`alternative reading: ${alt}`);
    precautions.push(`Precaution — assumed date, not a contract fact. Day type not defined in the contract; used the earlier date ${due}. Basis: ${math}${assumedHol ? " (business days exclude US federal holidays, assumed)" : ""}.`);
  }
  if (c.weekend_roll) {
    const rolled = rollForward(due, hol);
    if (rolled !== due) { math += `; contract allows weekend/holiday roll to ${rolled}`; due = rolled; }
  }
  return { due, precautions, math, alternatives };
}

/** Today's date in a time zone. */
export function todayIn(tz: string, now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p; // en-CA gives YYYY-MM-DD
}
