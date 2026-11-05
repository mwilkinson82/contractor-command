import { ganttModel, ganttSummary } from "./cpm-gantt";
import type { LivingData } from "./mcp/living";
import { readScheduleControl } from "./mcp/schedule-control";
import type { IorCpmFinish } from "./ior-model";

/** The finish the job's CPM forecasts, read the same way the schedule page reads it. */
export type CpmFinish = IorCpmFinish;

/** A saved cpm living report, as mcp_living_report_get returns it. */
export type CpmReportLike =
  | {
      found?: boolean;
      version?: number | null;
      data_date?: string | null;
      contract_completion_date?: string | null;
      data?: unknown;
    }
  | null
  | undefined;

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The CPM's forecast finish, or null when the job has no schedule with dates.
 * Order of comparison: the CPM's active baseline finish, then the contract completion date.
 */
export function cpmFinish(report: CpmReportLike): CpmFinish | null {
  if (!report || report.found === false || !report.data || typeof report.data !== "object")
    return null;
  const data = report.data as LivingData;
  const acts = Array.isArray(data.activities) ? data.activities : [];
  if (!acts.length) return null;
  const contract = isDay(report.contract_completion_date)
    ? report.contract_completion_date.slice(0, 10)
    : null;
  const version = typeof report.version === "number" ? report.version : null;
  const dataDate = isDay(report.data_date) ? report.data_date.slice(0, 10) : null;
  const control = readScheduleControl(data);
  if (control) {
    const s = ganttSummary(
      ganttModel({ data, control, dataDate: report.data_date, contractCompletion: contract }),
    );
    if (s.forecast === null) return null;
    const onBaseline = s.baselineFinish !== null;
    return {
      forecast: iso(s.forecast),
      against: onBaseline ? iso(s.baselineFinish!) : contract,
      againstKind: onBaseline ? "baseline" : contract ? "contract" : null,
      workDays: onBaseline ? s.versusBaseline : contract ? s.versusContract : null,
      version,
      dataDate,
    };
  }
  // A reported (not calculated) schedule: its last finish, against the contract date.
  const finishes = acts
    .map((a) => (isDay(a.finish) ? a.finish.slice(0, 10) : null))
    .filter((d): d is string => !!d);
  if (!finishes.length) return null;
  return {
    forecast: finishes.reduce((a, b) => (b > a ? b : a)),
    against: contract,
    againstKind: contract ? "contract" : null,
    workDays: null,
    version,
    dataDate,
  };
}
