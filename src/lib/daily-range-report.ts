// Daily reports for a date range, read once for the printable page, the PDF download and the Athena tool.
// Before: a daily could only be read one date at a time, so nothing could be attached to a pay app, a T&M change
// order or a dispute. After: one bounded read of every saved daily in the range, its work lines and that day's
// progress photos, under the member's own access (RLS), with nothing inferred for days that have no daily.
import { accountingDate } from "./accounting-report";
import { DEFAULT_TZ, todayIn } from "./mcp/deadlines";
import { dailyDisplayText } from "./mcp/superintendent";

type ReadError = { message: string; code?: string; status?: number };
type Result = { data: unknown; error: ReadError | null };
interface Query extends PromiseLike<Result> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  gte(column: string, value: string): Query;
  lte(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
}
/** Always the member's own client. No privileged client or board-token fallback. */
export type DailyRangeClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Result>;
  from: (table: string) => Query;
};
export const dailyRangeClient = (client: unknown) => client as DailyRangeClient;

export const DAILY_RANGE_MAX_DAYS = 93;
export const DAILY_RANGE_MAX_PHOTOS = 400;
const LINES_PER_DAILY = 80;
export const PHOTO_MODES = ["all", "client_safe", "none"] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];
export const PHOTO_MODE_LABEL: Record<PhotoMode, string> = {
  all: "All photos",
  client_safe: "Client-safe photos only",
  none: "No photos",
};

export type DailyRangeLine = {
  line_no: number;
  work: string;
  qty: number | null;
  unit: string | null;
  crew: number | null;
  hours: number | null;
  sov_item: string | null;
  activity_id: string | null;
  pct_complete: number | null;
};
export type DailyRangePhoto = {
  id: string;
  daily_id: string | null;
  taken_on: string;
  area: string;
  work: string | null;
  sov_item: string | null;
  activity_id: string | null;
  client_safe: boolean;
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string | null;
};
export type DailyRangeEntry = {
  id: string;
  report_date: string;
  weather: string;
  manpower: string;
  subs_on_site: string;
  deliveries: string;
  issues: string;
  delays: string;
  safety: string;
  created_at: string | null;
  updated_at: string | null;
  lines: DailyRangeLine[];
};
/** One calendar date in the range that has a saved daily, photos, or both. */
export type DailyRangeDay = {
  date: string;
  daily: DailyRangeEntry | null;
  photos: DailyRangePhoto[];
};
export type DailyRangeReport = {
  job_id: string;
  job_number: string;
  job_name: string;
  company: string;
  time_zone_used: string;
  period: { from: string; to: string };
  photos_mode: PhotoMode;
  days: DailyRangeDay[];
  /** Dates in the range with no saved daily. Missing is not zero: nothing is inferred for them. */
  no_daily_dates: string[];
  dailies_count: number;
  photos_count: number;
  captured_at: string;
  source: "current_saved_dailies";
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

function readError(message: string, source?: ReadError | null): never {
  throw Object.assign(new Error(message), { code: source?.code, status: source?.status });
}
function rows(result: Result, label: string): unknown[] {
  if (result.error || !Array.isArray(result.data))
    readError(`${label} could not be read. No partial daily report was returned.`, result.error);
  return result.data;
}
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Both dates required, in order, and no longer than the supported window. */
export function dailyRangePeriod(from: string | undefined, to: string | undefined) {
  if (!from || !to) throw new Error("Choose both a start date and an end date.");
  if (!accountingDate.safeParse(from).success || !accountingDate.safeParse(to).success)
    throw new Error("Use valid report dates.");
  const a = dayMs(from),
    b = dayMs(to);
  if (a > b) throw new Error("Choose a start date on or before the end date.");
  if ((b - a) / DAY + 1 > DAILY_RANGE_MAX_DAYS)
    throw new Error(`Choose a range of at most ${DAILY_RANGE_MAX_DAYS} days.`);
  return { from, to };
}
export function rangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = dayMs(from); t <= dayMs(to); t += DAY)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
export const photoMode = (v: unknown): PhotoMode =>
  (PHOTO_MODES as readonly unknown[]).includes(v) ? (v as PhotoMode) : "all";

/** The same membership and full/assigned-super check the single daily page uses, before any range read. */
async function rangeAccess(client: DailyRangeClient, jobId: string) {
  if (!uuid.test(jobId)) throw new Error("Choose a valid project.");
  const result = await client.rpc("mcp_report_page_get", {
    _page: "field",
    _job: jobId,
    _company: null,
  });
  const unavailable =
    "This project's daily reports are currently unavailable. Check your project access and try again.";
  if (result.error) readError(unavailable, result.error);
  const data = result.data as {
    page?: string;
    scope?: string;
    job_number?: string;
    job_name?: string;
    company?: string;
    time_zone?: string;
  } | null;
  if (
    data?.page !== "field" ||
    !["full", "super"].includes(data.scope ?? "") ||
    typeof data.job_number !== "string"
  )
    readError(unavailable);
  let zone = data.time_zone?.trim() || DEFAULT_TZ;
  try {
    todayIn(zone);
  } catch {
    zone = DEFAULT_TZ;
  }
  return {
    job_number: data.job_number,
    job_name: data.job_name ?? "",
    company: data.company ?? "",
    time_zone_used: zone,
  };
}

/** Every saved daily from `from` through `to`, with its work lines and that day's photos. All or nothing. */
export async function readDailyRange(
  client: DailyRangeClient,
  jobId: string,
  options: { from?: string; to?: string; photos?: PhotoMode },
  now = new Date(),
): Promise<DailyRangeReport> {
  const period = dailyRangePeriod(options.from, options.to);
  const mode = photoMode(options.photos);
  const access = await rangeAccess(client, jobId);
  const reports = rows(
    await client
      .from("mcp_daily_reports")
      .select(
        "id, report_date, weather, manpower, subs_on_site, deliveries, issues, delays, safety, created_at, updated_at",
      )
      .eq("job_id", jobId)
      .gte("report_date", period.from)
      .lte("report_date", period.to)
      .order("report_date", { ascending: true })
      .limit(DAILY_RANGE_MAX_DAYS + 1),
    "Saved daily reports",
  ) as Record<string, unknown>[];
  if (reports.length > DAILY_RANGE_MAX_DAYS)
    throw new Error(
      "This range has more dailies than one export supports. Choose a shorter range.",
    );
  const ids = reports.map((r) => str(r.id));
  const lines = ids.length
    ? (rows(
        await client
          .from("mcp_daily_work_lines")
          .select(
            "daily_id, line_no, work, qty, unit, crew, hours, sov_item, activity_id, pct_complete",
          )
          .eq("job_id", jobId)
          .in("daily_id", ids)
          .order("line_no", { ascending: true })
          .limit(ids.length * LINES_PER_DAILY + 1),
        "Daily work lines",
      ) as Record<string, unknown>[])
    : [];
  if (lines.length > ids.length * LINES_PER_DAILY)
    throw new Error("This range exceeds the supported work-line limit. Choose a shorter range.");
  let photos: Record<string, unknown>[] = [];
  if (mode !== "none") {
    let q = client
      .from("mcp_progress_photos")
      .select(
        "id, daily_id, taken_on, area, work, sov_item, activity_id, client_safe, storage_path, mime_type, size_bytes, created_at",
      )
      .eq("job_id", jobId)
      .gte("taken_on", period.from)
      .lte("taken_on", period.to);
    if (mode === "client_safe") q = q.eq("client_safe", true);
    photos = rows(
      await q
        .order("taken_on", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(DAILY_RANGE_MAX_PHOTOS + 1),
      "Progress photos",
    ) as Record<string, unknown>[];
    if (photos.length > DAILY_RANGE_MAX_PHOTOS)
      throw new Error(
        `This range has more than ${DAILY_RANGE_MAX_PHOTOS} photos. Choose a shorter range, client-safe photos only, or no photos.`,
      );
  }
  const text = (v: unknown, date: string) => dailyDisplayText(str(v), date, jobId)?.trim() ?? "";
  const linesBy = new Map<string, DailyRangeLine[]>();
  for (const l of lines) {
    const key = str(l.daily_id);
    const list = linesBy.get(key) ?? [];
    list.push({
      line_no: Number(l.line_no ?? list.length + 1),
      work: str(l.work),
      qty: num(l.qty),
      unit: l.unit == null ? null : str(l.unit),
      crew: num(l.crew),
      hours: num(l.hours),
      sov_item: l.sov_item == null ? null : str(l.sov_item),
      activity_id: l.activity_id == null ? null : str(l.activity_id),
      pct_complete: num(l.pct_complete),
    });
    linesBy.set(key, list);
  }
  const days = new Map<string, DailyRangeDay>();
  const dayFor = (date: string) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = { date, daily: null, photos: [] }));
    return d;
  };
  for (const r of reports) {
    const date = accountingDate.parse(str(r.report_date).slice(0, 10));
    dayFor(date).daily = {
      id: str(r.id),
      report_date: date,
      weather: text(r.weather, date),
      manpower: text(r.manpower, date),
      subs_on_site: text(r.subs_on_site, date),
      deliveries: text(r.deliveries, date),
      issues: text(r.issues, date),
      delays: text(r.delays, date),
      safety: text(r.safety, date),
      created_at: r.created_at == null ? null : str(r.created_at),
      updated_at: r.updated_at == null ? null : str(r.updated_at),
      lines: (linesBy.get(str(r.id)) ?? [])
        .sort((a, b) => a.line_no - b.line_no)
        .map((l) => ({ ...l, work: text(l.work, date) })),
    };
  }
  for (const p of photos) {
    const date = str(p.taken_on).slice(0, 10);
    if (date < period.from || date > period.to) continue;
    dayFor(date).photos.push({
      id: str(p.id),
      daily_id: p.daily_id == null ? null : str(p.daily_id),
      taken_on: date,
      area: str(p.area),
      work: p.work == null ? null : str(p.work),
      sov_item: p.sov_item == null ? null : str(p.sov_item),
      activity_id: p.activity_id == null ? null : str(p.activity_id),
      client_safe: p.client_safe === true,
      storage_path: str(p.storage_path),
      mime_type: str(p.mime_type),
      size_bytes: num(p.size_bytes),
      created_at: p.created_at == null ? null : str(p.created_at),
    });
  }
  const ordered = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    job_id: jobId,
    ...access,
    period,
    photos_mode: mode,
    days: ordered,
    no_daily_dates: rangeDates(period.from, period.to).filter((d) => !days.get(d)?.daily),
    dailies_count: reports.length,
    photos_count: ordered.reduce((n, d) => n + d.photos.length, 0),
    captured_at: now.toISOString(),
    source: "current_saved_dailies",
  };
}

export function dailyRangePath(
  jobId: string,
  period?: { from: string; to: string },
  photos?: PhotoMode,
) {
  if (!uuid.test(jobId)) throw new Error("Choose a valid project.");
  if (!period) return `/r/job/${jobId}/daily-log`;
  dailyRangePeriod(period.from, period.to);
  const q = new URLSearchParams({
    from: period.from,
    to: period.to,
    ...(photos && photos !== "all" ? { photos } : {}),
  });
  return `/r/job/${jobId}/daily-log?${q}`;
}
export const dailyRangeUrl = (
  jobId: string,
  period: { from: string; to: string },
  photos?: PhotoMode,
) => `https://app.meetathena.io${dailyRangePath(jobId, period, photos)}`;
export const dailyRangePdfName = (jobNumber: string, from: string, to: string) =>
  `${jobNumber} Daily Reports ${from} to ${to}.pdf`.replace(/[\\/:*?"<>|]/g, "-");

// ---------- shared presentation ----------
export const longDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
export const mediumDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
export function stamp(iso: string | null | undefined, zone: string) {
  if (!iso) return "Not recorded";
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return "Not recorded";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
      timeZoneName: "short",
    }).format(t);
  } catch {
    return t.toISOString();
  }
}
export const numberText = (v: number | null) =>
  v === null || !Number.isFinite(v)
    ? ""
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
/** Ranges of consecutive dates, so a month of missing weekends reads "Nov 1 - Nov 2, Nov 8 - Nov 9". */
export function dateRuns(dates: string[]): string {
  const runs: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    let j = i;
    while (j + 1 < dates.length && dayMs(dates[j + 1]) - dayMs(dates[j]) === DAY) j++;
    runs.push(i === j ? mediumDate(dates[i]) : `${mediumDate(dates[i])} - ${mediumDate(dates[j])}`);
    i = j;
  }
  return runs.join(", ");
}
export const DAILY_SECTIONS = [
  ["weather", "Weather"],
  ["manpower", "Crews & hours"],
  ["subs_on_site", "Subcontractors on site"],
  ["deliveries", "Deliveries"],
  ["issues", "Issues & constraints"],
  ["delays", "Delays"],
  ["safety", "Safety"],
] as const;
const NONE_RE =
  /^(none|n\/?a|no|nothing|no issues?|no delays?|none reported|nothing to report)\.?$/i;
/** True when a section says something happened, not "none". */
export const reported = (s: string) => !!s.trim() && !NONE_RE.test(s.trim());
export const photoCaption = (p: DailyRangePhoto) =>
  [p.area, p.work].filter(Boolean).join(" · ") || "Progress photo";
export function photoFacts(p: DailyRangePhoto, zone: string): string[] {
  return [
    `Taken ${mediumDate(p.taken_on)}`,
    p.sov_item ? `SOV ${p.sov_item}` : "",
    p.activity_id ? `Activity ${p.activity_id}` : "",
    `Uploaded ${stamp(p.created_at, zone)}`,
    `Photo ${p.id.slice(0, 8)}`,
  ].filter(Boolean);
}
