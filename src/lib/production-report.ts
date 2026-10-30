import { DEFAULT_TZ, todayIn } from "./mcp/deadlines";
import {
  productionPeriod,
  summarizeProduction,
  type DailyProductionRow,
} from "./mcp/production-summary";
import type { DailyPagePayload } from "./report-pages";

type ReadError = { message: string; code?: string; status?: number };
type Result = { data: unknown; error: ReadError | null };
interface Query extends PromiseLike<Result> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: string): Query;
  lte(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): Query;
}
/** Always the member's client. No privileged client or board-token fallback. */
export type ProductionClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Result>;
  from: (table: string) => Query;
};
export const productionClient = (client: unknown) => client as ProductionClient;
type Period = { from: string; to: string };
export type ProductionOptions = {
  from_date?: string;
  to_date?: string;
  range?: "last_7_days" | "this_week";
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readError(message: string, source?: ReadError | null): never {
  throw Object.assign(new Error(message), { code: source?.code, status: source?.status });
}
function array(result: Result, label: string): unknown[] {
  if (result.error || !Array.isArray(result.data))
    readError(
      `${label} could not be read. No partial production report was returned.`,
      result.error,
    );
  return result.data;
}

/** Shared bounded read for the existing MCP summary and the authenticated page.
 * Callers check membership and full/assigned-super job scope before this read.
 * Every source query is still constrained to that job and subject to its RLS.
 */
export async function readSavedProduction(client: ProductionClient, jobId: string, period: Period) {
  const reports = array(
    await client
      .from("mcp_daily_reports")
      .select("id, report_date")
      .eq("job_id", jobId)
      .gte("report_date", period.from)
      .lte("report_date", period.to)
      .order("report_date", { ascending: true })
      .limit(32),
    "Saved daily reports",
  ) as { id: string; report_date: string }[];
  const rows: DailyProductionRow[] = [];
  let complete = reports.length <= 31;
  for (const report of reports.slice(0, 31)) {
    const rates = array(
      await client
        .from("mcp_production_rates")
        .select(
          "id, daily_id, work, sov_item, activity_id, qty, unit, crew, hours, man_hours, qty_per_man_hour, created_at",
        )
        .eq("job_id", jobId)
        .eq("daily_id", report.id)
        .order("id", { ascending: true })
        .limit(81),
      "Saved production rows",
    ) as Omit<DailyProductionRow, "report_date">[];
    if (rates.length > 80) complete = false;
    rows.push(...rates.slice(0, 80).map((rate) => ({ ...rate, report_date: report.report_date })));
  }
  return { complete, reports_count: reports.length, rows, groups: summarizeProduction(rows) };
}

/** The existing writable report-read entry point keeps the 0042 cold-cache repair.
 * Signed-in access failures are unavailable states, never an empty production total.
 */
async function productionAccess(client: ProductionClient, jobId: string) {
  if (!uuid.test(jobId)) throw new Error("Choose a valid project.");
  const result = await client.rpc("mcp_report_page_get", {
    _page: "field",
    _job: jobId,
    _company: null,
  });
  if (result.error)
    readError(
      "This project's production is currently unavailable. Check your project access and try again.",
      result.error,
    );
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
    readError(
      "This project's production is currently unavailable. Check your project access and try again.",
    );
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

export async function readProductionReport(
  client: ProductionClient,
  jobId: string,
  options: ProductionOptions = {},
  now = new Date(),
) {
  const access = await productionAccess(client, jobId);
  const period = productionPeriod(
    options.from_date,
    options.to_date,
    todayIn(access.time_zone_used, now),
    options.range,
  );
  const data = await readSavedProduction(client, jobId, period);
  return {
    ...access,
    ...data,
    job_id: jobId,
    period,
    captured_at: now.toISOString(),
    planned_rate: null,
    earned_value: null,
    source: "current_saved_dailies",
    references: "reported_unverified",
  };
}
export type ProductionReport = Awaited<ReturnType<typeof readProductionReport>>;

/** An exact dated daily, rather than silently opening the latest daily for this job. */
export async function readProductionDaily(
  client: ProductionClient,
  jobId: string,
  date: string,
): Promise<DailyPagePayload> {
  productionPeriod(date, date, date);
  const access = await productionAccess(client, jobId);
  const report = await client
    .from("mcp_daily_reports")
    .select("id, report_date, weather, manpower, subs_on_site, deliveries, issues, delays, safety")
    .eq("job_id", jobId)
    .eq("report_date", date)
    .maybeSingle();
  if (report.error) readError("The source daily could not be read. Try again.", report.error);
  const row = report.data as ({ id: string } & DailyPagePayload) | null;
  if (!row) return { ...access, page: "daily", found: false, report_date: date };
  const lines = array(
    await client
      .from("mcp_daily_work_lines")
      .select("work, sov_item, activity_id, qty, unit, crew, hours")
      .eq("job_id", jobId)
      .eq("daily_id", row.id)
      .order("line_no", { ascending: true })
      .limit(81),
    "Source daily work",
  ) as DailyPagePayload["lines"];
  if ((lines?.length ?? 0) > 80)
    throw new Error(
      "This daily exceeds the supported source limit. No partial daily was returned.",
    );
  return { ...row, ...access, page: "daily", found: true, report_date: date, lines };
}

export function productionReportPath(jobId: string, period?: Period) {
  if (!uuid.test(jobId)) throw new Error("Choose a valid project.");
  if (period) productionPeriod(period.from, period.to, period.to);
  return `/r/job/${jobId}/production${period ? `?${new URLSearchParams({ from: period.from, to: period.to })}` : ""}`;
}
export const productionReportUrl = (jobId: string, period: Period) =>
  `https://app.meetathena.io${productionReportPath(jobId, period)}`;
export function productionDailyPath(jobId: string, date: string) {
  if (!uuid.test(jobId)) throw new Error("Choose a valid project.");
  productionPeriod(date, date, date);
  return `/r/job/${jobId}/daily?${new URLSearchParams({ date })}`;
}
